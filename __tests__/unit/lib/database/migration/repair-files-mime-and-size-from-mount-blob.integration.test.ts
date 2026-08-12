/**
 * @jest-environment node
 *
 * Unit tests for the repair-files-mime-and-size-from-mount-blob-v1 migration.
 *
 * Unlike the sha256 repair (which lives entirely in the mount-index DB), this
 * migration straddles two databases:
 *
 *   - the MAIN DB (`getSQLiteDatabase()`), which owns the `files` table that
 *     gets read and UPDATEd; and
 *   - the MOUNT-INDEX DB (`openMountIndexDb()` → `new Database(path)`), which
 *     owns the `doc_mount_blobs` table that is read-only here.
 *
 * So the harness wires up two real SQLite handles:
 *   - `mainDb` is an in-memory DB returned by the mocked `getSQLiteDatabase`.
 *   - the mount-index DB is a real temp file; the migration opens its own
 *     connection to it via the default `better-sqlite3` import. The global
 *     jest mock for that module is a no-op, so this file overrides it with the
 *     real native driver (see the jest.mock('better-sqlite3', ...) below).
 *
 * The mount-index DB is unencrypted in tests: the seed handle (`mountDb`) is
 * opened with no key. `jest.setup.ts` *does* set ENCRYPTION_MASTER_PEPPER, so
 * `openMountIndexDb()` would normally issue a `PRAGMA key`; the mock below
 * swallows all pragmas rather than forwarding them, so that key never reaches
 * — and never poisons — the unencrypted seed handle.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Load the real native SQLite driver (not the jest mock alias) for seeding.
// Mirrors the loadDriver() pattern from the sha256 repair test.
// ---------------------------------------------------------------------------
function loadDriver() {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();
type DatabaseInstance = ReturnType<typeof Database>;

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any module imports that pull in the subject.
// ---------------------------------------------------------------------------

// Module-level handles/paths the mock factories read lazily at call time.
let mainDb: DatabaseInstance | null = null;
let mountDbPath = '';

// Override the GLOBAL no-op better-sqlite3 mock so the migration's
// `new Database(mountDbPath)` hands back the SAME real handle we seeded
// (`mountDb`), rather than opening a second connection. A second connection to
// the SQLCipher (`multiple-ciphers`) file under test proved fragile; reusing
// the proven-good seed handle is a single connection with no reopen.
//
// `close()` is a no-op here because the migration closes its mount handle in a
// `finally`, and the idempotency test runs the migration twice — we must keep
// the seed handle alive for the second pass and for afterEach cleanup. The
// real handle is created via the unmocked `loadDriver()` in beforeEach (the
// `better-sqlite3-multiple-ciphers` specifier is not matched by the
// `^better-sqlite3$` moduleNameMapper, so it resolves to the real binary).
// `pragma` is a deliberate NO-OP, not a forwarder. `jest.setup.ts` sets
// ENCRYPTION_MASTER_PEPPER, so `openMountIndexDb()` runs `db.pragma("key = ...")`
// against this handle. Forwarding that to the already-open, unencrypted seed
// handle (`mountDb`) poisons it — SQLCipher then fails every subsequent read
// with "file is not a database". The seed handle is already opened and
// configured (journal_mode = WAL) in beforeEach, so the migration's pragmas
// (key / journal_mode / busy_timeout / foreign_keys) are all redundant or
// harmful here; swallowing them keeps the seed handle readable.
jest.mock('better-sqlite3', () => {
  return function FakeDatabase(this: unknown) {
    return {
      pragma: () => { /* swallow: do not re-key the already-open seed handle */ },
      prepare: (sql: string) => (mountDb as DatabaseInstance).prepare(sql),
      close: () => { /* keep the seed handle open across runs */ },
      get open() { return true; },
    };
  };
});

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('../../../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

// Route the migration's main-DB accessors at our in-memory `mainDb`.
jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: () => true,
  getSQLiteDatabase: () => mainDb,
}));

// Route getMountIndexDatabasePath at our temp file.
jest.mock('../../../../../lib/paths', () => ({
  getMountIndexDatabasePath: () => mountDbPath,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mountDb: DatabaseInstance | null = null;

function buildMainSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "files" (
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
}

function buildMountSchema(db: DatabaseInstance): void {
  // Minimal: the migration only SELECTs storedMimeType/sizeBytes by id.
  db.exec(`
    CREATE TABLE IF NOT EXISTS "doc_mount_blobs" (
      "id" TEXT PRIMARY KEY,
      "sizeBytes" INTEGER NOT NULL,
      "storedMimeType" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
}

function storageKeyFor(blobId: string): string {
  // Real keys are `mount-blob:<mountPoint>:<blobId>`; parseBlobId returns
  // everything after the first ':' past the prefix.
  return `mount-blob:mp1:${blobId}`;
}

function insertFile(
  db: DatabaseInstance,
  opts: { id: string; sha256: string; mimeType: string; size: number; storageKey: string | null },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "files"
       (id, userId, sha256, originalFilename, mimeType, size, source, category, storageKey, createdAt, updatedAt)
     VALUES (?, 'user-1', ?, 'photo.jpg', ?, ?, 'upload', 'image', ?, ?, ?)`
  ).run(opts.id, opts.sha256, opts.mimeType, opts.size, opts.storageKey, now, now);
}

function insertBlob(
  db: DatabaseInstance,
  opts: { id: string; storedMimeType: string; sizeBytes: number },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "doc_mount_blobs" (id, sizeBytes, storedMimeType, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(opts.id, opts.sizeBytes, opts.storedMimeType, now, now);
}

function getFile(db: DatabaseInstance, id: string): { mimeType: string; size: number; sha256: string } | undefined {
  return db.prepare('SELECT mimeType, size, sha256 FROM "files" WHERE id = ?').get(id) as
    | { mimeType: string; size: number; sha256: string }
    | undefined;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Main DB: a single in-memory handle, shared via the getSQLiteDatabase mock.
  mainDb = new Database(':memory:');
  buildMainSchema(mainDb);

  // Mount-index DB: a real temp file so openMountIndexDb()'s fs.existsSync
  // checks pass and its own connection can read it. WAL to match the
  // migration's connection so its reader sees our committed seed rows.
  mountDbPath = path.join(os.tmpdir(), `test-mount-index-${randomUUID()}.db`);
  mountDb = new Database(mountDbPath);
  mountDb.pragma('journal_mode = WAL');
  buildMountSchema(mountDb);
});

afterEach(() => {
  if (mainDb) {
    try { mainDb.close(); } catch { /* ignore */ }
    mainDb = null;
  }
  if (mountDb) {
    try { mountDb.close(); } catch { /* ignore */ }
    mountDb = null;
  }
  if (mountDbPath && fs.existsSync(mountDbPath)) {
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(mountDbPath + ext); } catch { /* ignore */ }
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repair-files-mime-and-size-from-mount-blob-v1 migration', () => {
  type MigrationModule = typeof import('@/migrations/scripts/repair-files-mime-and-size-from-mount-blob');
  let migration: MigrationModule;

  beforeEach(async () => {
    migration = await import(
      '../../../../../migrations/scripts/repair-files-mime-and-size-from-mount-blob'
    ) as MigrationModule;
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has the expected id', () => {
      expect(migration.repairFilesMimeAndSizeFromMountBlobMigration.id).toBe(
        'repair-files-mime-and-size-from-mount-blob-v1'
      );
    });

    it('declares the expected dependsOn list', () => {
      expect(migration.repairFilesMimeAndSizeFromMountBlobMigration.dependsOn).toEqual([
        'relink-files-to-mount-blobs-v1',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // shouldRun
  // -------------------------------------------------------------------------

  describe('shouldRun', () => {
    it('returns true when the mount-index DB exists and a mount-blob file row is present', async () => {
      const blobId = randomUUID();
      insertFile(mainDb!, { id: randomUUID(), sha256: 'x'.repeat(64), mimeType: 'image/jpeg', size: 100, storageKey: storageKeyFor(blobId) });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.shouldRun();
      expect(result).toBe(true);
    });

    it('returns false when there are no mount-blob file rows', async () => {
      // A file row that is NOT stored as a mount blob.
      insertFile(mainDb!, { id: randomUUID(), sha256: 'x'.repeat(64), mimeType: 'image/png', size: 50, storageKey: 's3:something' });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.shouldRun();
      expect(result).toBe(false);
    });

    it('returns false when the mount-index DB file does not exist', async () => {
      mountDbPath = path.join(os.tmpdir(), `no-such-db-${randomUUID()}.db`);
      const blobId = randomUUID();
      insertFile(mainDb!, { id: randomUUID(), sha256: 'x'.repeat(64), mimeType: 'image/jpeg', size: 100, storageKey: storageKeyFor(blobId) });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.shouldRun();
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Core behaviour
  // -------------------------------------------------------------------------

  describe('run', () => {
    it('rewrites a jpeg-labeled WebP row to the blob mimeType and size, leaving sha256 untouched', async () => {
      const fileId = randomUUID();
      const blobId = randomUUID();
      const originalSha = 'a'.repeat(64); // input-bytes hash; must NOT change

      insertFile(mainDb!, { id: fileId, sha256: originalSha, mimeType: 'image/jpeg', size: 12345, storageKey: storageKeyFor(blobId) });
      insertBlob(mountDb!, { id: blobId, storedMimeType: 'image/webp', sizeBytes: 9876 });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1);

      const file = getFile(mainDb!, fileId)!;
      expect(file.mimeType).toBe('image/webp');
      expect(file.size).toBe(9876);
      // The dedup-critical input-bytes hash is deliberately preserved.
      expect(file.sha256).toBe(originalSha);
    });

    it('updates when only the size drifts (mimeType already correct)', async () => {
      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(mainDb!, { id: fileId, sha256: 'b'.repeat(64), mimeType: 'image/webp', size: 100, storageKey: storageKeyFor(blobId) });
      insertBlob(mountDb!, { id: blobId, storedMimeType: 'image/webp', sizeBytes: 222 });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.itemsAffected).toBe(1);
      expect(getFile(mainDb!, fileId)!.size).toBe(222);
    });

    it('skips a row already in agreement with its blob', async () => {
      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(mainDb!, { id: fileId, sha256: 'c'.repeat(64), mimeType: 'image/webp', size: 500, storageKey: storageKeyFor(blobId) });
      insertBlob(mountDb!, { id: blobId, storedMimeType: 'image/webp', sizeBytes: 500 });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      const file = getFile(mainDb!, fileId)!;
      expect(file.mimeType).toBe('image/webp');
      expect(file.size).toBe(500);
    });

    it('leaves an orphaned storage key (no matching blob) untouched and counts it as orphaned', async () => {
      const fileId = randomUUID();
      const missingBlobId = randomUUID(); // never inserted into doc_mount_blobs
      insertFile(mainDb!, { id: fileId, sha256: 'd'.repeat(64), mimeType: 'image/jpeg', size: 777, storageKey: storageKeyFor(missingBlobId) });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/orphaned/);
      const file = getFile(mainDb!, fileId)!;
      expect(file.mimeType).toBe('image/jpeg');
      expect(file.size).toBe(777);
    });

    it('leaves a malformed mount-blob storage key untouched and counts it as malformed', async () => {
      const fileId = randomUUID();
      // No second ':' after the prefix → parseBlobId returns null.
      insertFile(mainDb!, { id: fileId, sha256: 'e'.repeat(64), mimeType: 'image/jpeg', size: 321, storageKey: 'mount-blob:onlyonepart' });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/malformed/);
      const file = getFile(mainDb!, fileId)!;
      expect(file.mimeType).toBe('image/jpeg');
      expect(file.size).toBe(321);
    });

    it('is idempotent: a second run makes no further changes', async () => {
      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(mainDb!, { id: fileId, sha256: 'f'.repeat(64), mimeType: 'image/jpeg', size: 1, storageKey: storageKeyFor(blobId) });
      insertBlob(mountDb!, { id: blobId, storedMimeType: 'image/webp', sizeBytes: 4242 });

      const first = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();
      expect(first.itemsAffected).toBe(1);
      expect(getFile(mainDb!, fileId)!.mimeType).toBe('image/webp');
      expect(getFile(mainDb!, fileId)!.size).toBe(4242);

      const second = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();
      expect(second.success).toBe(true);
      expect(second.itemsAffected).toBe(0);
      expect(getFile(mainDb!, fileId)!.mimeType).toBe('image/webp');
      expect(getFile(mainDb!, fileId)!.size).toBe(4242);
    });

    it('handles a mixed batch: corrects the drifted row, skips the correct one, leaves orphan and malformed alone', async () => {
      const driftedId = randomUUID();
      const driftedBlob = randomUUID();
      const correctId = randomUUID();
      const correctBlob = randomUUID();
      const orphanId = randomUUID();
      const orphanBlob = randomUUID(); // not inserted
      const malformedId = randomUUID();

      insertFile(mainDb!, { id: driftedId, sha256: '1'.repeat(64), mimeType: 'image/jpeg', size: 10, storageKey: storageKeyFor(driftedBlob) });
      insertBlob(mountDb!, { id: driftedBlob, storedMimeType: 'image/webp', sizeBytes: 99 });

      insertFile(mainDb!, { id: correctId, sha256: '2'.repeat(64), mimeType: 'image/webp', size: 88, storageKey: storageKeyFor(correctBlob) });
      insertBlob(mountDb!, { id: correctBlob, storedMimeType: 'image/webp', sizeBytes: 88 });

      insertFile(mainDb!, { id: orphanId, sha256: '3'.repeat(64), mimeType: 'image/jpeg', size: 70, storageKey: storageKeyFor(orphanBlob) });
      insertFile(mainDb!, { id: malformedId, sha256: '4'.repeat(64), mimeType: 'image/jpeg', size: 60, storageKey: 'mount-blob:bogus' });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1); // only the drifted row

      expect(getFile(mainDb!, driftedId)).toMatchObject({ mimeType: 'image/webp', size: 99 });
      expect(getFile(mainDb!, correctId)).toMatchObject({ mimeType: 'image/webp', size: 88 });
      expect(getFile(mainDb!, orphanId)).toMatchObject({ mimeType: 'image/jpeg', size: 70 });
      expect(getFile(mainDb!, malformedId)).toMatchObject({ mimeType: 'image/jpeg', size: 60 });
    });

    it('returns a success no-op when there are no mount-blob FileEntries', async () => {
      insertFile(mainDb!, { id: randomUUID(), sha256: '5'.repeat(64), mimeType: 'image/png', size: 5, storageKey: 's3:elsewhere' });

      const result = await migration.repairFilesMimeAndSizeFromMountBlobMigration.run();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/No mount-blob FileEntries/i);
    });

    it('returns a no-op when the mount-index DB does not exist', async () => {
      mountDbPath = path.join(os.tmpdir(), `nonexistent-${randomUUID()}.db`);
      insertFile(mainDb!, { id: randomUUID(), sha256: '6'.repeat(64), mimeType: 'image/jpeg', size: 9, storageKey: storageKeyFor(randomUUID()) });

      jest.resetModules();
      const freshMigration = await import(
        '../../../../../migrations/scripts/repair-files-mime-and-size-from-mount-blob'
      ) as MigrationModule;

      const result = await freshMigration.repairFilesMimeAndSizeFromMountBlobMigration.run();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/No mount-index database present/i);
    });
  });
});
