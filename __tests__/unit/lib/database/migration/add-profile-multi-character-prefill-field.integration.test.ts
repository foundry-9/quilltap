/**
 * @jest-environment node
 *
 * Unit tests for the add-profile-multi-character-prefill-field-v1 migration.
 *
 * The load-bearing property is the backfill: after the column lands, every
 * existing profile must behave exactly as it did before. Anthropic was the
 * sole provider that never received the `[Name]` prefill (4.6+ rejects a
 * request ending on an assistant message), so those rows must come out 0 and
 * everything else 1. A real in-memory SQLite DB exercises the ALTER and both
 * UPDATE statements end-to-end.
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
      provider TEXT NOT NULL
    )
  `);
}

function insert(db: DatabaseInstance, id: string, provider: string): void {
  db.prepare('INSERT INTO connection_profiles (id, name, provider) VALUES (?, ?, ?)').run(
    id,
    `${provider} profile`,
    provider
  );
}

function prefillOf(db: DatabaseInstance, id: string): number | null {
  const row = db
    .prepare('SELECT multiCharacterPrefill FROM connection_profiles WHERE id = ?')
    .get(id) as { multiCharacterPrefill: number | null } | undefined;
  return row ? row.multiCharacterPrefill : null;
}

function hasColumn(db: DatabaseInstance): boolean {
  const cols = db.prepare('PRAGMA table_info(connection_profiles)').all() as Array<{ name: string }>;
  return cols.some((c) => c.name === 'multiCharacterPrefill');
}

describe('add-profile-multi-character-prefill-field-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/add-profile-multi-character-prefill-field');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/add-profile-multi-character-prefill-field');
  });

  afterEach(() => {
    testDb.close();
  });

  it('has the expected id and depends on the prior connection-profile column', () => {
    expect(migration.addProfileMultiCharacterPrefillFieldMigration.id).toBe(
      'add-profile-multi-character-prefill-field-v1'
    );
    expect(migration.addProfileMultiCharacterPrefillFieldMigration.dependsOn).toContain(
      'add-pseudo-tool-mode-field-v1'
    );
  });

  it('runs only while the column is missing', async () => {
    expect(await migration.addProfileMultiCharacterPrefillFieldMigration.shouldRun()).toBe(true);
    await migration.addProfileMultiCharacterPrefillFieldMigration.run();
    expect(await migration.addProfileMultiCharacterPrefillFieldMigration.shouldRun()).toBe(false);
  });

  it('adds the column', async () => {
    const result = await migration.addProfileMultiCharacterPrefillFieldMigration.run();

    expect(result.success).toBe(true);
    expect(hasColumn(testDb)).toBe(true);
  });

  it('turns the prefill off for Anthropic and leaves it on for everyone else', async () => {
    insert(testDb, 'anthropic-1', 'ANTHROPIC');
    insert(testDb, 'openai-1', 'OPENAI');
    insert(testDb, 'ollama-1', 'OLLAMA');
    insert(testDb, 'deepseek-1', 'DEEPSEEK');

    await migration.addProfileMultiCharacterPrefillFieldMigration.run();

    expect(prefillOf(testDb, 'anthropic-1')).toBe(0);
    expect(prefillOf(testDb, 'openai-1')).toBe(1);
    expect(prefillOf(testDb, 'ollama-1')).toBe(1);
    expect(prefillOf(testDb, 'deepseek-1')).toBe(1);
  });

  it('matches the provider case-insensitively', async () => {
    insert(testDb, 'lower-1', 'anthropic');

    await migration.addProfileMultiCharacterPrefillFieldMigration.run();

    expect(prefillOf(testDb, 'lower-1')).toBe(0);
  });

  it('reports how many rows it touched', async () => {
    insert(testDb, 'anthropic-1', 'ANTHROPIC');
    insert(testDb, 'anthropic-2', 'ANTHROPIC');
    insert(testDb, 'openai-1', 'OPENAI');

    const result = await migration.addProfileMultiCharacterPrefillFieldMigration.run();

    // Two Anthropic rows flipped off; the rest were already 1 by column default.
    expect(result.itemsAffected).toBe(2);
    expect(result.message).toContain('2 Anthropic profiles set off');
  });

  it('succeeds on an empty table', async () => {
    const result = await migration.addProfileMultiCharacterPrefillFieldMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(0);
  });
});
