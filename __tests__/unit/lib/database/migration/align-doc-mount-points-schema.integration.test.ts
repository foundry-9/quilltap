/**
 * @jest-environment node
 *
 * Regression tests for alignDocMountPointsSchema() — the helper that repairs
 * `doc_mount_points` schema drift on mount-index DBs created before columns
 * like `storeType` existed.
 *
 * Background: the doc_mount_* tables are created with `CREATE TABLE IF NOT
 * EXISTS`, which is a no-op when the table already exists. Instances whose
 * mount-index DB predates a column never gain it, so later INSERT/UPDATEs that
 * reference the column fail (the storeType-drift bug fixed in 19592b4a). This
 * helper backfills every missing addable column via idempotent ALTER TABLE.
 *
 * Uses a real in-memory SQLite DB (the jest better-sqlite3 mock is a no-op stub
 * that would make PRAGMA/ALTER meaningless). Mirrors the loadDriver() pattern
 * used by the other real-binding migration suites. The `@jest-environment node`
 * docblock is mandatory for real-binding suites — it keeps the native Buffers
 * off the jsdom realm boundary that triggers SQLCipher segfaults.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';

// ---------------------------------------------------------------------------
// Load the real native SQLite driver (not the jest mock alias).
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

import { alignDocMountPointsSchema } from '@/migrations/lib/mount-index-schema';

// Every column the helper is responsible for adding, with the expected default
// it stamps onto pre-existing rows. `null` means the column is nullable with no
// default. Kept in lockstep with DOC_MOUNT_POINTS_ADDABLE_COLUMNS in the source.
const ADDABLE_COLUMNS: Array<{ name: string; expectedDefault: unknown }> = [
  { name: 'basePath',         expectedDefault: '' },
  { name: 'mountType',        expectedDefault: 'filesystem' },
  { name: 'storeType',        expectedDefault: 'documents' },
  { name: 'includePatterns',  expectedDefault: '[]' },
  { name: 'excludePatterns',  expectedDefault: '[]' },
  { name: 'enabled',          expectedDefault: 1 },
  { name: 'lastScannedAt',    expectedDefault: null },
  { name: 'scanStatus',       expectedDefault: 'idle' },
  { name: 'lastScanError',    expectedDefault: null },
  { name: 'conversionStatus', expectedDefault: 'idle' },
  { name: 'conversionError',  expectedDefault: null },
  { name: 'fileCount',        expectedDefault: 0 },
  { name: 'chunkCount',       expectedDefault: 0 },
  { name: 'totalSizeBytes',   expectedDefault: 0 },
];

// The minimal pre-drift shape: only the columns that predate every addable one.
// These are NOT-NULL-without-default, which is exactly why the helper skips them
// (SQLite forbids ALTER-adding such a column to a non-empty table).
function buildLegacySchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE "doc_mount_points" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
}

function columnNames(db: DatabaseInstance): Set<string> {
  const rows = db.prepare(`PRAGMA table_info("doc_mount_points")`).all() as Array<{ name: string }>;
  return new Set(rows.map(r => r.name));
}

function insertLegacyRow(db: DatabaseInstance, id: string): void {
  db.prepare(
    `INSERT INTO "doc_mount_points" (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`
  ).run(id, `mount-${id}`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

let db: DatabaseInstance | null = null;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
});

describe('alignDocMountPointsSchema', () => {
  it('adds every missing addable column to a legacy doc_mount_points table', () => {
    buildLegacySchema(db!);

    const before = columnNames(db!);
    for (const col of ADDABLE_COLUMNS) {
      expect(before.has(col.name)).toBe(false);
    }

    alignDocMountPointsSchema(db!);

    const after = columnNames(db!);
    for (const col of ADDABLE_COLUMNS) {
      expect(after.has(col.name)).toBe(true);
    }
    // The legacy columns are untouched.
    expect(after.has('id')).toBe(true);
    expect(after.has('name')).toBe(true);
  });

  it('backfills the documented defaults onto a pre-existing row (the storeType-drift fix)', () => {
    buildLegacySchema(db!);
    insertLegacyRow(db!, 'mp-1');

    alignDocMountPointsSchema(db!);

    const row = db!
      .prepare(`SELECT * FROM "doc_mount_points" WHERE id = ?`)
      .get('mp-1') as Record<string, unknown>;

    for (const col of ADDABLE_COLUMNS) {
      expect(row[col.name]).toEqual(col.expectedDefault);
    }
    // storeType specifically — the column whose absence caused INSERT/UPDATE
    // failures on older instances — must default to 'documents'.
    expect(row.storeType).toBe('documents');
  });

  it('does not clobber a column that already exists with data (partial drift)', () => {
    // A DB that drifted only partway: it already has storeType (with a custom
    // value) but is missing the rest.
    db!.exec(`
      CREATE TABLE "doc_mount_points" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "storeType" TEXT NOT NULL DEFAULT 'documents',
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );
    `);
    db!
      .prepare(
        `INSERT INTO "doc_mount_points" (id, name, storeType, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('mp-1', 'mount-1', 'character', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    alignDocMountPointsSchema(db!);

    const row = db!
      .prepare(`SELECT storeType, basePath FROM "doc_mount_points" WHERE id = ?`)
      .get('mp-1') as { storeType: string; basePath: string };

    // Existing custom storeType is preserved; the newly-added column gets its default.
    expect(row.storeType).toBe('character');
    expect(row.basePath).toBe('');
  });

  it('is idempotent: a second run makes no further changes and does not throw', () => {
    buildLegacySchema(db!);
    insertLegacyRow(db!, 'mp-1');

    alignDocMountPointsSchema(db!);
    const afterFirst = columnNames(db!);

    expect(() => alignDocMountPointsSchema(db!)).not.toThrow();

    const afterSecond = columnNames(db!);
    expect([...afterSecond].sort()).toEqual([...afterFirst].sort());

    const count = db!.prepare(`SELECT COUNT(*) AS n FROM "doc_mount_points"`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('is a no-op when the doc_mount_points table is absent', () => {
    // No table created at all — older mount-index DBs may not have provisioned it yet.
    expect(() => alignDocMountPointsSchema(db!)).not.toThrow();

    const tableRow = db!
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='doc_mount_points'`)
      .get();
    expect(tableRow).toBeUndefined();
  });

  it('lets an INSERT referencing the drifted columns succeed after alignment', () => {
    // This is the end-to-end shape of the original bug: code that INSERTs with
    // storeType (etc.) blew up on legacy DBs. After alignment it must work.
    buildLegacySchema(db!);
    alignDocMountPointsSchema(db!);

    expect(() => {
      db!
        .prepare(
          `INSERT INTO "doc_mount_points"
             (id, name, storeType, mountType, basePath, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('mp-new', 'character-vault', 'character', 'database', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }).not.toThrow();

    const row = db!
      .prepare(`SELECT storeType FROM "doc_mount_points" WHERE id = ?`)
      .get('mp-new') as { storeType: string };
    expect(row.storeType).toBe('character');
  });
});
