/**
 * @jest-environment node
 *
 * Unit tests for the retire-prefill-on-thinking-profiles-v1 migration.
 *
 * Two load-bearing properties, pulling against each other:
 *
 *   - It must clear the stored `1` on rows that are genuinely running a
 *     thinking turn. Those got their `1` from the old provider-shaped default
 *     at creation, not from a user choice, and a stored boolean outranks every
 *     later default — so fixing the default alone fixes nothing for them
 *     (bug 85).
 *   - It must touch nothing else. A non-thinking DeepSeek or Ollama profile
 *     keeps the prefill, which is the stronger anchor and what weak models
 *     need most — that was bug 68's stated objection to a blanket provider
 *     rule, and this migration must not re-incur it.
 *
 * A real in-memory SQLite DB exercises the select and the updates end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
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
  getSQLiteTableColumns: (name: string) =>
    testDb.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>,
}));

function buildSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE connection_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      modelName TEXT,
      parameters TEXT,
      multiCharacterPrefill INTEGER DEFAULT 1
    )
  `);
}

function insert(
  db: DatabaseInstance,
  id: string,
  provider: string,
  modelName: string | null,
  parameters: string | null,
  prefill: number | null = 1
): void {
  db.prepare(
    `INSERT INTO connection_profiles
       (id, name, provider, modelName, parameters, multiCharacterPrefill)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, `${provider} profile`, provider, modelName, parameters, prefill);
}

function prefillOf(db: DatabaseInstance, id: string): number | null {
  const row = db
    .prepare('SELECT multiCharacterPrefill FROM connection_profiles WHERE id = ?')
    .get(id) as { multiCharacterPrefill: number | null } | undefined;
  return row ? row.multiCharacterPrefill : null;
}

describe('retire-prefill-on-thinking-profiles-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/retire-prefill-on-thinking-profiles');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/retire-prefill-on-thinking-profiles');
  });

  afterEach(() => {
    testDb.close();
  });

  it('has the expected id and depends on the column it edits', () => {
    expect(migration.retirePrefillOnThinkingProfilesMigration.id).toBe(
      'retire-prefill-on-thinking-profiles-v1'
    );
    expect(migration.retirePrefillOnThinkingProfilesMigration.dependsOn).toContain(
      'add-profile-multi-character-prefill-field-v1'
    );
  });

  it('runs once the column exists', async () => {
    expect(await migration.retirePrefillOnThinkingProfilesMigration.shouldRun()).toBe(true);
  });

  describe('what it clears', () => {
    it('clears a DeepSeek profile that reasons by default (the bug 85 row)', async () => {
      // The reproducing profile exactly: V4 flash, `parameters: '{}'`, stored 1.
      insert(testDb, 'ds-default', 'DEEPSEEK', 'deepseek-v4-flash', '{}');

      const result = await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(1);
      expect(prefillOf(testDb, 'ds-default')).toBe(0);
    });

    it('clears a DeepSeek profile with thinking explicitly enabled', async () => {
      insert(testDb, 'ds-on', 'DEEPSEEK', 'deepseek-v4-pro', '{"thinking":"enabled"}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ds-on')).toBe(0);
    });

    it('clears an Ollama profile with thinking ticked on (bug 68)', async () => {
      insert(testDb, 'ol-on', 'OLLAMA', 'qwen3:8b', '{"enable_thinking":true}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ol-on')).toBe(0);
    });

    it('matches the provider case-insensitively', async () => {
      insert(testDb, 'ds-lower', 'deepseek', 'deepseek-v4-flash', '{}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ds-lower')).toBe(0);
    });
  });

  describe('what it leaves alone', () => {
    it('keeps the prefill on a DeepSeek profile that disabled thinking', async () => {
      // Bug 68's objection, satisfied rather than re-incurred: an explicit
      // choice outranks the model's habit and the stronger anchor survives.
      insert(testDb, 'ds-off', 'DEEPSEEK', 'deepseek-v4-flash', '{"thinking":"disabled"}');

      const result = await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(result.itemsAffected).toBe(0);
      expect(prefillOf(testDb, 'ds-off')).toBe(1);
    });

    it('keeps the prefill on an Ollama profile with thinking off or unset', async () => {
      insert(testDb, 'ol-off', 'OLLAMA', 'llama3.1:8b', '{"enable_thinking":false}');
      insert(testDb, 'ol-unset', 'OLLAMA', 'llama3.1:8b', '{}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ol-off')).toBe(1);
      expect(prefillOf(testDb, 'ol-unset')).toBe(1);
    });

    it('keeps the prefill on a DeepSeek model the frozen catalogue does not list', async () => {
      insert(testDb, 'ds-unknown', 'DEEPSEEK', 'deepseek-v4-flash-vision-exp', '{}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ds-unknown')).toBe(1);
    });

    it('never touches a provider that declares no thinking rule', async () => {
      insert(testDb, 'openai-1', 'OPENAI', 'gpt-5', '{}');
      insert(testDb, 'anthropic-1', 'ANTHROPIC', 'claude-opus-5', '{}');

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'openai-1')).toBe(1);
      expect(prefillOf(testDb, 'anthropic-1')).toBe(1);
    });

    it('leaves a row already at 0 alone and does not count it', async () => {
      insert(testDb, 'ds-already', 'DEEPSEEK', 'deepseek-v4-flash', '{}', 0);

      const result = await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(result.itemsAffected).toBe(0);
      expect(prefillOf(testDb, 'ds-already')).toBe(0);
    });

    it('leaves a stored null alone — it resolves through the default at use time', async () => {
      insert(testDb, 'ds-null', 'DEEPSEEK', 'deepseek-v4-flash', '{}', null);

      await migration.retirePrefillOnThinkingProfilesMigration.run();

      expect(prefillOf(testDb, 'ds-null')).toBe(null);
    });
  });

  it('survives unparseable parameters without clearing the row', async () => {
    // A malformed JSON blob must not be read as "thinking enabled", and must
    // not take the whole migration down with it.
    insert(testDb, 'ds-bad', 'DEEPSEEK', 'llama-guess', 'not json at all');

    const result = await migration.retirePrefillOnThinkingProfilesMigration.run();

    expect(result.success).toBe(true);
    expect(prefillOf(testDb, 'ds-bad')).toBe(1);
  });

  it('reports how many it examined and how many it cleared', async () => {
    insert(testDb, 'ds-1', 'DEEPSEEK', 'deepseek-v4-flash', '{}');
    insert(testDb, 'ds-2', 'DEEPSEEK', 'deepseek-v4-flash', '{"thinking":"disabled"}');
    insert(testDb, 'ol-1', 'OLLAMA', 'qwen3:8b', '{"enable_thinking":true}');

    const result = await migration.retirePrefillOnThinkingProfilesMigration.run();

    expect(result.itemsAffected).toBe(2);
    expect(result.message).toContain('Examined 3');
    expect(result.message).toContain('on 2');
  });
});
