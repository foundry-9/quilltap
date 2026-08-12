/**
 * @jest-environment node
 *
 * Unit tests for the repair-mount-blob-sha256-from-bytes-v1 migration.
 *
 * Uses a real in-memory SQLite DB (routed via a temp file path) so the keyset
 * pagination loop, sha recomputation, and dual-UPDATE transaction are all
 * exercised end-to-end without touching production data.
 *
 * The mount-index DB is unencrypted in tests (ENCRYPTION_MASTER_PEPPER is not
 * set), matching how all migration tests operate — the encryption PRAGMAs are
 * no-ops when no pepper is present.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Load the real native SQLite driver (not the jest mock alias).
// Mirrors the loadDriver() pattern from repair-dangling-related-memory-edges-v1.
// ---------------------------------------------------------------------------
function loadDriver() {
  try {
    return require(path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'quilltap',
      'node_modules',
      'better-sqlite3-multiple-ciphers'
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

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
}));

// We mock lib/paths to route getMountIndexDatabasePath to our temp DB.
// The mock is set up via a module-level variable updated per test in beforeEach.
let testDbPath = '';

jest.mock('../../../../../lib/paths', () => ({
  getMountIndexDatabasePath: () => testDbPath,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDb: DatabaseInstance | null = null;

function buildSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "doc_mount_files" (
      "id" TEXT PRIMARY KEY,
      "sha256" TEXT NOT NULL,
      "fileSizeBytes" INTEGER NOT NULL,
      "fileType" TEXT NOT NULL DEFAULT 'blob',
      "source" TEXT NOT NULL DEFAULT 'database',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "idx_doc_mount_files_sha256"
      ON "doc_mount_files" ("sha256");

    CREATE TABLE IF NOT EXISTS "doc_mount_blobs" (
      "id" TEXT PRIMARY KEY,
      "fileId" TEXT NOT NULL REFERENCES "doc_mount_files"("id") ON DELETE CASCADE,
      "sha256" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storedMimeType" TEXT NOT NULL DEFAULT 'image/webp',
      "data" BLOB NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_blobs_fileId"
      ON "doc_mount_blobs" ("fileId");
  `);
}

function insertFile(db: DatabaseInstance, id: string, sha256: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "doc_mount_files" (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
     VALUES (?, ?, 0, 'blob', 'database', ?, ?)`
  ).run(id, sha256, now, now);
}

function insertBlob(
  db: DatabaseInstance,
  id: string,
  fileId: string,
  sha256: string,
  data: Buffer | null,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "doc_mount_blobs" (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'image/webp', ?, ?, ?)`
  ).run(id, fileId, sha256, data ? data.length : 0, data, now, now);
}

function getBlobSha(db: DatabaseInstance, id: string): string {
  const row = db.prepare('SELECT sha256 FROM "doc_mount_blobs" WHERE id = ?').get(id) as
    | { sha256: string }
    | undefined;
  return row?.sha256 ?? '';
}

function getFileSha(db: DatabaseInstance, id: string): string {
  const row = db.prepare('SELECT sha256 FROM "doc_mount_files" WHERE id = ?').get(id) as
    | { sha256: string }
    | undefined;
  return row?.sha256 ?? '';
}

// Compute actual sha256 of a buffer for test assertions.
function actualSha256(data: Buffer): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Create a fresh temp file for each test (opened by name so the migration's
  // openMountIndexDb() call uses the same file, not :memory:).
  testDbPath = path.join(os.tmpdir(), `test-mount-index-${randomUUID()}.db`);
  testDb = new Database(testDbPath);
  buildSchema(testDb);

  // Inject the real seeded DB as the live mount-index handle so the migration
  // reuses it (openMountIndexDb prefers getRawMountIndexDatabase() over opening
  // its own connection — the latter would hit the jest better-sqlite3 mock).
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = testDb;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
  if (testDb) {
    try { testDb.close(); } catch { /* ignore */ }
    testDb = null;
  }
  if (testDbPath && fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repair-mount-blob-sha256-from-bytes-v1 migration', () => {
  // lazily imported after mocks are set up
  type MigrationModule = typeof import('@/migrations/scripts/repair-mount-blob-sha256-from-bytes');
  let migration: MigrationModule;

  beforeEach(async () => {
    migration = await import(
      '../../../../../migrations/scripts/repair-mount-blob-sha256-from-bytes'
    ) as MigrationModule;
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has the expected id', () => {
      expect(migration.repairMountBlobSha256FromBytesMigration.id).toBe(
        'repair-mount-blob-sha256-from-bytes-v1'
      );
    });

    it('has introducedInVersion 4.6.0', () => {
      expect(migration.repairMountBlobSha256FromBytesMigration.introducedInVersion).toBe('4.6.0');
    });

    it('declares the expected dependsOn list', () => {
      expect(migration.repairMountBlobSha256FromBytesMigration.dependsOn).toEqual([
        'relink-files-to-mount-blobs-v1',
        'repair-files-mime-and-size-from-mount-blob-v1',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // shouldRun
  // -------------------------------------------------------------------------

  describe('shouldRun', () => {
    it('returns true when the mount-index DB exists and has blob rows', async () => {
      const data = Buffer.from('some bytes');
      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(testDb!, fileId, 'bogus-sha');
      insertBlob(testDb!, blobId, fileId, 'bogus-sha', data);

      const result = await migration.repairMountBlobSha256FromBytesMigration.shouldRun();
      expect(result).toBe(true);
    });

    it('returns false when the mount-index DB has no blob rows', async () => {
      // Schema exists but the table is empty.
      const result = await migration.repairMountBlobSha256FromBytesMigration.shouldRun();
      expect(result).toBe(false);
    });

    it('returns false when the mount-index DB file does not exist', async () => {
      // Point to a non-existent path.
      const missingPath = path.join(os.tmpdir(), `no-such-db-${randomUUID()}.db`);
      testDbPath = missingPath;
      const result = await migration.repairMountBlobSha256FromBytesMigration.shouldRun();
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Core behaviour: mismatched sha gets corrected on both tables
  // -------------------------------------------------------------------------

  describe('run', () => {
    it('corrects sha256 on both the blob row and the file row when they mismatch', async () => {
      const data = Buffer.from('real image bytes for sha test');
      const trueHash = actualSha256(data);
      const bogusHash = 'a'.repeat(64);

      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(testDb!, fileId, bogusHash);
      insertBlob(testDb!, blobId, fileId, bogusHash, data);

      const result = await migration.repairMountBlobSha256FromBytesMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1);
      expect(getBlobSha(testDb!, blobId)).toBe(trueHash);
      expect(getFileSha(testDb!, fileId)).toBe(trueHash);
    });

    // -------------------------------------------------------------------------
    // Idempotency
    // -------------------------------------------------------------------------

    it('is idempotent: a second run makes no further changes', async () => {
      const data = Buffer.from('idempotency test data');
      const trueHash = actualSha256(data);
      const bogusHash = 'b'.repeat(64);

      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(testDb!, fileId, bogusHash);
      insertBlob(testDb!, blobId, fileId, bogusHash, data);

      const first = await migration.repairMountBlobSha256FromBytesMigration.run();
      expect(first.itemsAffected).toBe(1);
      expect(getBlobSha(testDb!, blobId)).toBe(trueHash);
      expect(getFileSha(testDb!, fileId)).toBe(trueHash);

      const second = await migration.repairMountBlobSha256FromBytesMigration.run();
      expect(second.success).toBe(true);
      expect(second.itemsAffected).toBe(0);
      // sha values are still correct after the no-op second pass
      expect(getBlobSha(testDb!, blobId)).toBe(trueHash);
      expect(getFileSha(testDb!, fileId)).toBe(trueHash);
    });

    // -------------------------------------------------------------------------
    // Orphan blobs (empty / null data)
    // -------------------------------------------------------------------------

    it('skips a blob with empty data and counts it as orphaned, not corrected', async () => {
      // Use an empty Buffer (zero bytes) — stored as empty BLOB.
      const fileId = randomUUID();
      const blobId = randomUUID();
      insertFile(testDb!, fileId, 'c'.repeat(64));
      // Insert with an empty buffer so the `data.length === 0` guard fires.
      insertBlob(testDb!, blobId, fileId, 'c'.repeat(64), Buffer.alloc(0));

      const result = await migration.repairMountBlobSha256FromBytesMigration.run();

      expect(result.success).toBe(true);
      // The empty-data row must not be counted as corrected.
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/orphaned/);
      // The stored sha is unchanged because the row was skipped.
      expect(getBlobSha(testDb!, blobId)).toBe('c'.repeat(64));
    });

    // -------------------------------------------------------------------------
    // Collision: two blobs whose corrected sha matches an existing file row
    // -------------------------------------------------------------------------

    it('does not throw when two files end up with the same sha after correction (non-unique index)', async () => {
      // Both blobs carry the same bytes, so after correction both file rows
      // will share the same sha.  The idx_doc_mount_files_sha256 index is NOT
      // UNIQUE, so this should succeed without error.
      const data = Buffer.from('same bytes for both blobs');
      const trueHash = actualSha256(data);
      const bogusHashA = 'd'.repeat(64);
      const bogusHashB = 'e'.repeat(64);

      const fileIdA = randomUUID();
      const fileIdB = randomUUID();
      const blobIdA = randomUUID();
      const blobIdB = randomUUID();

      insertFile(testDb!, fileIdA, bogusHashA);
      insertFile(testDb!, fileIdB, bogusHashB);
      insertBlob(testDb!, blobIdA, fileIdA, bogusHashA, data);
      insertBlob(testDb!, blobIdB, fileIdB, bogusHashB, data);

      let result: Awaited<ReturnType<typeof migration.repairMountBlobSha256FromBytesMigration.run>>;
      await expect(async () => {
        result = await migration.repairMountBlobSha256FromBytesMigration.run();
      }).not.toThrow();

      expect(result!.success).toBe(true);
      expect(result!.itemsAffected).toBe(2);

      // Both file rows now carry the correct sha.
      expect(getFileSha(testDb!, fileIdA)).toBe(trueHash);
      expect(getFileSha(testDb!, fileIdB)).toBe(trueHash);

      // Both blob rows now carry the correct sha.
      expect(getBlobSha(testDb!, blobIdA)).toBe(trueHash);
      expect(getBlobSha(testDb!, blobIdB)).toBe(trueHash);
    });

    // -------------------------------------------------------------------------
    // Mixed bag: some correct, some wrong, one orphan
    // -------------------------------------------------------------------------

    it('handles a mixed batch correctly', async () => {
      const goodData = Buffer.from('good blob data');
      const goodHash = actualSha256(goodData);

      const badData = Buffer.from('bad blob data needs correction');
      const badHash = actualSha256(badData);
      const bogusHash = 'f'.repeat(64);

      const goodFileId = randomUUID();
      const goodBlobId = randomUUID();
      const badFileId = randomUUID();
      const badBlobId = randomUUID();
      const orphanFileId = randomUUID();
      const orphanBlobId = randomUUID();

      // Good row: sha already correct.
      insertFile(testDb!, goodFileId, goodHash);
      insertBlob(testDb!, goodBlobId, goodFileId, goodHash, goodData);

      // Bad row: sha is wrong.
      insertFile(testDb!, badFileId, bogusHash);
      insertBlob(testDb!, badBlobId, badFileId, bogusHash, badData);

      // Orphan row: empty data.
      insertFile(testDb!, orphanFileId, 'aa'.repeat(32));
      insertBlob(testDb!, orphanBlobId, orphanFileId, 'aa'.repeat(32), Buffer.alloc(0));

      const result = await migration.repairMountBlobSha256FromBytesMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1); // only the bad row

      // Good row untouched.
      expect(getBlobSha(testDb!, goodBlobId)).toBe(goodHash);
      expect(getFileSha(testDb!, goodFileId)).toBe(goodHash);

      // Bad row corrected.
      expect(getBlobSha(testDb!, badBlobId)).toBe(badHash);
      expect(getFileSha(testDb!, badFileId)).toBe(badHash);

      // Orphan row untouched.
      expect(getBlobSha(testDb!, orphanBlobId)).toBe('aa'.repeat(32));
    });

    // -------------------------------------------------------------------------
    // Early return: no rows
    // -------------------------------------------------------------------------

    it('returns a success no-op result when the table is empty', async () => {
      const result = await migration.repairMountBlobSha256FromBytesMigration.run();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/nothing to reconcile|No doc_mount_blobs/i);
    });

    // -------------------------------------------------------------------------
    // Early return: no mount-index DB
    // -------------------------------------------------------------------------

    it('returns a no-op result when the mount-index DB does not exist', async () => {
      testDbPath = path.join(os.tmpdir(), `nonexistent-${randomUUID()}.db`);
      // No live mount-index handle either, so openMountIndexDb falls through to
      // the (now-missing) path and returns null.
      (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;

      // Re-import the migration so the mock re-evaluates testDbPath.
      jest.resetModules();
      const freshMigration = await import(
        '../../../../../migrations/scripts/repair-mount-blob-sha256-from-bytes'
      ) as MigrationModule;

      const result = await freshMigration.repairMountBlobSha256FromBytesMigration.run();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/nothing to reconcile/i);
    });
  });
});
