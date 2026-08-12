/**
 * @jest-environment node
 *
 * Unit tests for the rp-delimiter-kinds-v1 migration.
 *
 * Uses a real in-memory SQLite DB so the row loop, JSON classification, and the
 * UPDATE write path (including rendering-pattern regeneration via the real
 * generateRenderingPatterns) are exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';

function loadDriver() {
  try {
    return require(path.join(__dirname, '..', '..', '..', '..', '..', 'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'));
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

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
    CREATE TABLE roleplay_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      delimiters TEXT,
      renderingPatterns TEXT,
      narrationDelimiters TEXT,
      updatedAt TEXT
    )
  `);
}

function insert(db: DatabaseInstance, id: string, delimiters: unknown, narration: unknown = '*') {
  db.prepare(
    'INSERT INTO roleplay_templates (id, name, delimiters, renderingPatterns, narrationDelimiters, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, id, JSON.stringify(delimiters), '[]', JSON.stringify(narration), '2020-01-01T00:00:00.000Z');
}

function loadDelimiters(db: DatabaseInstance, id: string): any[] {
  const row = db.prepare('SELECT delimiters FROM roleplay_templates WHERE id = ?').get(id) as { delimiters: string };
  return JSON.parse(row.delimiters);
}

function loadPatterns(db: DatabaseInstance, id: string): any[] {
  const row = db.prepare('SELECT renderingPatterns FROM roleplay_templates WHERE id = ?').get(id) as { renderingPatterns: string };
  return JSON.parse(row.renderingPatterns);
}

describe('rp-delimiter-kinds-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/rp-delimiter-kinds-v1');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/rp-delimiter-kinds-v1');
  });

  afterEach(() => {
    testDb.close();
  });

  it('has the expected id and dependencies', () => {
    expect(migration.rpDelimiterKindsMigration.id).toBe('rp-delimiter-kinds-v1');
    expect(migration.rpDelimiterKindsMigration.dependsOn).toContain('migrate-plugin-templates-to-native-v1');
  });

  describe('shouldRun', () => {
    it('returns false when every delimiter already has a kind', async () => {
      insert(testDb, 't1', [{ kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' }]);
      expect(await migration.rpDelimiterKindsMigration.shouldRun()).toBe(false);
    });

    it('returns true when a delimiter is missing a kind', async () => {
      insert(testDb, 't1', [{ name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' }]);
      expect(await migration.rpDelimiterKindsMigration.shouldRun()).toBe(true);
    });
  });

  describe('run', () => {
    it('classifies a [marker, ""] entry as linePrefix and a string/pair as wrap', async () => {
      insert(testDb, 't1', [
        { name: 'Narration', buttonName: 'Nar', delimiters: ['[', ']'], style: 'qt-chat-narration' },
        { name: 'Internal', buttonName: 'Int', delimiters: ['{', '}'], style: 'qt-chat-inner-monologue' },
        { name: 'Out of Character', buttonName: 'OOC', delimiters: ['// ', ''], style: 'qt-chat-ooc' },
      ], ['[', ']']);

      const result = await migration.rpDelimiterKindsMigration.run();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1);

      const delims = loadDelimiters(testDb, 't1');
      expect(delims[0]).toMatchObject({ kind: 'wrap', delimiters: ['[', ']'] });
      expect(delims[1]).toMatchObject({ kind: 'wrap', delimiters: ['{', '}'] });
      expect(delims[2]).toMatchObject({ kind: 'linePrefix', marker: '// ' });
      expect(delims[2]).not.toHaveProperty('delimiters');
    });

    it('regenerates rendering patterns with scope:line for the line prefix', async () => {
      insert(testDb, 't1', [
        { name: 'Out of Character', buttonName: 'OOC', delimiters: ['// ', ''], style: 'qt-chat-ooc' },
      ], ['[', ']']);

      await migration.rpDelimiterKindsMigration.run();
      const patterns = loadPatterns(testDb, 't1');
      const ooc = patterns.find((p) => p.className === 'qt-chat-ooc');
      expect(ooc).toBeDefined();
      expect(ooc.scope).toBe('line');
      expect(ooc.pattern).toBe('^// (?<rpBody>.+)$');
    });

    it('classifies a single-string delimiter as wrap', async () => {
      insert(testDb, 't1', [{ name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' }]);
      await migration.rpDelimiterKindsMigration.run();
      expect(loadDelimiters(testDb, 't1')[0]).toMatchObject({ kind: 'wrap', delimiters: '*' });
    });

    it('leaves already-migrated rows untouched (no double work)', async () => {
      insert(testDb, 't1', [{ kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' }]);
      const result = await migration.rpDelimiterKindsMigration.run();
      expect(result.itemsAffected).toBe(0);
    });
  });
});
