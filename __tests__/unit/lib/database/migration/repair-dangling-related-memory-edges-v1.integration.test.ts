/**
 * @jest-environment node
 *
 * Unit tests for the repair-dangling-related-memory-edges-v1 migration.
 *
 * Uses a real in-memory SQLite DB so the batch loop, JSON parsing, and
 * UPDATE write path are all exercised end-to-end.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import path from 'path';

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
      // Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3, so
      // in CI (where only the root install runs) the driver lives at
      // <root>/node_modules/better-sqlite3. Require by absolute path so the jest
      // moduleNameMapper that mocks 'better-sqlite3' for the rest of the suite does
      // not intercept this load — we want the real native binding here.
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();
type DatabaseInstance = ReturnType<typeof Database>;

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

let testDb: DatabaseInstance = null as unknown as DatabaseInstance;

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: () => true,
  getSQLiteDatabase: () => testDb,
}));

function buildSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      characterId TEXT NOT NULL,
      relatedMemoryIds TEXT
    )
  `);
}

function insert(db: DatabaseInstance, id: string, characterId: string, related: string[] | null) {
  db.prepare(
    'INSERT INTO memories (id, characterId, relatedMemoryIds) VALUES (?, ?, ?)'
  ).run(id, characterId, related === null ? null : JSON.stringify(related));
}

function loadRelated(db: DatabaseInstance, id: string): string[] {
  const row = db.prepare('SELECT relatedMemoryIds FROM memories WHERE id = ?').get(id) as
    | { relatedMemoryIds: string | null }
    | undefined;
  if (!row || !row.relatedMemoryIds) return [];
  return JSON.parse(row.relatedMemoryIds);
}

describe('repair-dangling-related-memory-edges-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/repair-dangling-related-memory-edges-v1');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/repair-dangling-related-memory-edges-v1');
  });

  afterEach(() => {
    testDb.close();
  });

  describe('metadata', () => {
    it('has the expected id and version', () => {
      expect(migration.repairDanglingRelatedMemoryEdgesV1Migration.id).toBe(
        'repair-dangling-related-memory-edges-v1'
      );
      expect(migration.repairDanglingRelatedMemoryEdgesV1Migration.introducedInVersion).toBe('4.5.0');
    });
  });

  describe('shouldRun', () => {
    it('returns false on an empty table', async () => {
      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.shouldRun();
      expect(result).toBe(false);
    });

    it("returns false when every memory's relatedMemoryIds is null or '[]'", async () => {
      insert(testDb, 'a', 'c1', []);
      insert(testDb, 'b', 'c1', null);
      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.shouldRun();
      expect(result).toBe(false);
    });

    it('returns true when at least one row has a non-empty array', async () => {
      insert(testDb, 'a', 'c1', ['b']);
      insert(testDb, 'b', 'c1', []);
      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.shouldRun();
      expect(result).toBe(true);
    });
  });

  describe('run', () => {
    it('removes dangling IDs and leaves valid edges intact', async () => {
      // a links to b (valid) + ghost (dangling); b links to a; c links to two ghosts.
      insert(testDb, 'a', 'c1', ['b', 'ghost-1']);
      insert(testDb, 'b', 'c1', ['a']);
      insert(testDb, 'c', 'c1', ['ghost-2', 'ghost-3']);

      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();

      expect(result.success).toBe(true);
      expect(loadRelated(testDb, 'a')).toEqual(['b']);
      expect(loadRelated(testDb, 'b')).toEqual(['a']);
      expect(loadRelated(testDb, 'c')).toEqual([]);
      expect(result.message).toMatch(/Removed 3 dangling/);
    });

    it('preserves cross-character links', async () => {
      insert(testDb, 'x', 'char-A', ['y']);
      insert(testDb, 'y', 'char-B', ['x']);

      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();

      expect(result.success).toBe(true);
      expect(loadRelated(testDb, 'x')).toEqual(['y']);
      expect(loadRelated(testDb, 'y')).toEqual(['x']);
    });

    it('is idempotent: a second pass short-circuits via shouldRun', async () => {
      insert(testDb, 'a', 'c1', ['b', 'ghost']);
      insert(testDb, 'b', 'c1', []);

      await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();
      expect(loadRelated(testDb, 'a')).toEqual(['b']);

      const shouldRunAgain = await migration.repairDanglingRelatedMemoryEdgesV1Migration.shouldRun();
      // After the run, 'a' still has a non-empty array (['b']), so shouldRun
      // returns true again, but a second run is a no-op (no dangling left to remove).
      expect(shouldRunAgain).toBe(true);
      const secondResult = await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();
      expect(secondResult.success).toBe(true);
      expect(secondResult.message).toMatch(/Removed 0 dangling/);
    });

    it('reports zero work when every link is already valid', async () => {
      insert(testDb, 'a', 'c1', ['b']);
      insert(testDb, 'b', 'c1', ['a']);

      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(result.message).toMatch(/Removed 0 dangling/);
    });

    it('handles malformed JSON by treating it as empty', async () => {
      testDb
        .prepare('INSERT INTO memories (id, characterId, relatedMemoryIds) VALUES (?, ?, ?)')
        .run('busted', 'c1', '{not-json');
      insert(testDb, 'good', 'c1', ['busted']);

      const result = await migration.repairDanglingRelatedMemoryEdgesV1Migration.run();

      expect(result.success).toBe(true);
      // 'busted' still exists in the table, so the link from 'good' is valid.
      expect(loadRelated(testDb, 'good')).toEqual(['busted']);
    });
  });
});
