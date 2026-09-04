/**
 * @jest-environment node
 *
 * End-to-end exercise of the `realign-file-entry-sha256-v1` migration against
 * real in-memory-ish SQLite databases (bug 117).
 *
 * Chat uploads hashed their *input* bytes and let the storage bridge transcode
 * afterwards, so a converted bitmap left a `files` row whose `sha256` named
 * bytes that exist nowhere — and every join to `doc_mount_files.sha256`
 * returned an empty result its caller read as "no such file". This migration
 * reads each row's hash back out of the mount blob its `storageKey` names.
 *
 * Guards:
 *   - migrations/scripts/realign-file-entry-sha256.ts
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  sqliteTableExists: jest.fn(() => true),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
  // The mount-index side is opened for real (against the temp file the
  // `lib/paths` mock below points at) so the SQLCipher key path is exercised.
  openMountIndexDbIfPresent: jest.requireActual('../../../migrations/lib/database-utils')
    .openMountIndexDbIfPresent,
}));

jest.mock('../../../lib/paths', () => ({
  getMountIndexDatabasePath: jest.fn(
    () => (global as Record<string, unknown>).__testMountIndexPath as string
  ),
}));

// The root package.json aliases better-sqlite3-multiple-ciphers as
// better-sqlite3, and the jest moduleNameMapper replaces both bare names with a
// no-op mock. The migration opens the mount-index database itself via a
// module-scope `import Database from 'better-sqlite3'`, so hand it the real
// binding by absolute path (which the mapper's `^name$` patterns don't match).
jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { realignFileEntrySha256Migration } from '../../../migrations/scripts/realign-file-entry-sha256';
import { reportProgress } from '../../../migrations/lib/progress';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const MOUNT = 'mount-1';

const INPUT_PNG_SHA = 'a'.repeat(64);
const STORED_WEBP_SHA = 'b'.repeat(64);
const ALREADY_CORRECT_SHA = 'c'.repeat(64);

let tmpDir: string;
let mainDb: any;
let mountDb: any;

function makeMainDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "files" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "sha256" TEXT NOT NULL,
      "originalFilename" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "source" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "storageKey" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

/**
 * The real mount-index database is SQLCipher-encrypted under
 * `ENCRYPTION_MASTER_PEPPER`, and the migration opens it with that key — so
 * this one is created the same way. (`node_modules/better-sqlite3` is the
 * multiple-ciphers build; the root package.json aliases it.) A plaintext file
 * opened with a key fails with "file is not a database", so getting this wrong
 * would test the abort path rather than the repair.
 */
function makeMountDb(file: string) {
  const db = new Database(file);
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.exec(`
    CREATE TABLE "doc_mount_blobs" (
      "id" TEXT PRIMARY KEY,
      "fileId" TEXT NOT NULL,
      "sha256" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storedMimeType" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

function seedFile(id: string, sha256: string, storageKey: string | null) {
  const now = '2026-01-01T00:00:00.000Z';
  mainDb
    .prepare(
      `INSERT INTO "files" (id, userId, sha256, originalFilename, mimeType, size, source, category, storageKey, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'image/webp', 100, 'UPLOADED', 'IMAGE', ?, ?, ?)`
    )
    .run(id, USER, sha256, `${id}.webp`, storageKey, now, now);
}

function seedBlob(blobId: string, sha256: string) {
  const now = '2026-01-01T00:00:00.000Z';
  mountDb
    .prepare(
      `INSERT INTO "doc_mount_blobs" (id, fileId, sha256, sizeBytes, storedMimeType, createdAt, updatedAt)
       VALUES (?, ?, ?, 100, 'image/webp', ?, ?)`
    )
    .run(blobId, `content-${blobId}`, sha256, now, now);
}

const shaOf = (id: string): string =>
  (mainDb.prepare(`SELECT sha256 FROM "files" WHERE id = ?`).get(id) as { sha256: string }).sha256;

const updatedAtOf = (id: string): string =>
  (mainDb.prepare(`SELECT updatedAt FROM "files" WHERE id = ?`).get(id) as { updatedAt: string })
    .updatedAt;

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-realign-sha-'));
  const mountPath = path.join(tmpDir, 'quilltap-mount-index.db');

  mainDb = makeMainDb();
  mountDb = makeMountDb(mountPath);

  (global as Record<string, unknown>).__testMainDb = mainDb;
  (global as Record<string, unknown>).__testMountIndexPath = mountPath;
});

afterEach(() => {
  try { mainDb?.close(); } catch { /* ignore */ }
  try { mountDb?.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete (global as Record<string, unknown>).__testMainDb;
  delete (global as Record<string, unknown>).__testMountIndexPath;
});

describe('realign-file-entry-sha256-v1', () => {
  it('rewrites a drifted row to the hash of the bytes actually stored', async () => {
    seedBlob('blob-1', STORED_WEBP_SHA);
    seedFile('file-1', INPUT_PNG_SHA, `mount-blob:${MOUNT}:blob-1`);

    expect(await realignFileEntrySha256Migration.shouldRun()).toBe(true);
    const result = await realignFileEntrySha256Migration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(1);
    expect(shaOf('file-1')).toBe(STORED_WEBP_SHA);
    expect(reportProgress).toHaveBeenCalled();
  });

  it('leaves a row that already agrees exactly as it found it', async () => {
    // The 121 uploads that always joined cleanly must not be touched — not
    // even their updatedAt, which would misdate them for no reason.
    seedBlob('blob-2', ALREADY_CORRECT_SHA);
    seedFile('file-2', ALREADY_CORRECT_SHA, `mount-blob:${MOUNT}:blob-2`);
    const before = updatedAtOf('file-2');

    const result = await realignFileEntrySha256Migration.run();

    expect(result.itemsAffected).toBe(0);
    expect(shaOf('file-2')).toBe(ALREADY_CORRECT_SHA);
    expect(updatedAtOf('file-2')).toBe(before);
  });

  it('logs and leaves a row whose blob has gone missing, rather than guessing', async () => {
    seedFile('file-3', INPUT_PNG_SHA, `mount-blob:${MOUNT}:blob-gone`);

    const result = await realignFileEntrySha256Migration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(0);
    expect(shaOf('file-3')).toBe(INPUT_PNG_SHA);
    expect(result.message).toContain('1 orphaned');
  });

  it('skips a malformed storage key without aborting the batch around it', async () => {
    seedBlob('blob-4', STORED_WEBP_SHA);
    seedFile('file-4a', INPUT_PNG_SHA, 'mount-blob:no-blob-id-here');
    seedFile('file-4b', INPUT_PNG_SHA, `mount-blob:${MOUNT}:blob-4`);

    const result = await realignFileEntrySha256Migration.run();

    expect(result.itemsAffected).toBe(1);
    expect(shaOf('file-4a')).toBe(INPUT_PNG_SHA);
    expect(shaOf('file-4b')).toBe(STORED_WEBP_SHA);
    expect(result.message).toContain('1 malformed storage keys');
  });

  it('ignores rows that are not mount-blob backed', async () => {
    seedFile('file-5', INPUT_PNG_SHA, 'local:some/legacy/path.png');

    expect(await realignFileEntrySha256Migration.shouldRun()).toBe(false);
    const result = await realignFileEntrySha256Migration.run();

    expect(result.itemsAffected).toBe(0);
    expect(shaOf('file-5')).toBe(INPUT_PNG_SHA);
  });

  it('is idempotent — a second run finds nothing left to do', async () => {
    seedBlob('blob-6', STORED_WEBP_SHA);
    seedFile('file-6', INPUT_PNG_SHA, `mount-blob:${MOUNT}:blob-6`);

    expect((await realignFileEntrySha256Migration.run()).itemsAffected).toBe(1);
    expect((await realignFileEntrySha256Migration.run()).itemsAffected).toBe(0);
    expect(shaOf('file-6')).toBe(STORED_WEBP_SHA);
  });

  it('walks past the first batch', async () => {
    // The keyset pagination (`id > ?` ORDER BY id) has to advance, or a
    // library larger than one batch silently stops after 500 rows.
    const total = 1200;
    for (let i = 0; i < total; i++) {
      const id = `file-${String(i).padStart(5, '0')}`;
      seedBlob(`blob-${i}`, STORED_WEBP_SHA);
      seedFile(id, INPUT_PNG_SHA, `mount-blob:${MOUNT}:blob-${i}`);
    }

    const result = await realignFileEntrySha256Migration.run();

    expect(result.itemsAffected).toBe(total);
    expect(shaOf('file-01199')).toBe(STORED_WEBP_SHA);
  });
});
