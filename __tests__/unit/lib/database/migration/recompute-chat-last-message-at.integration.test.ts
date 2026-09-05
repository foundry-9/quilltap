/**
 * @jest-environment node
 *
 * Integration tests for recompute-chat-last-message-at-v1 against a real
 * in-memory SQLite database, so the correlated-subquery drift detection and the
 * UPDATE write path are exercised end-to-end.
 *
 * The migration's SQL is the mirror of `isCharacterAuthoredMessage`
 * (`lib/chat/chat-activity.ts`). These cases are deliberately the same edge
 * cases as that predicate's unit tests — if the two ever disagree, the live
 * bump and the backfill have drifted, which is the one failure this pair of
 * suites exists to catch.
 */

import path from 'path';

import { recomputeChatLastMessageAtMigration } from '../../../../../migrations/scripts/recompute-chat-last-message-at';

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

let mockTestDb: DatabaseInstance = null as unknown as DatabaseInstance;

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: () => true,
  getSQLiteDatabase: () => mockTestDb,
  getSQLiteTableColumns: (table: string) =>
    table === 'chats'
      ? [{ name: 'id' }, { name: 'lastMessageAt' }, { name: 'createdAt' }, { name: 'updatedAt' }]
      : [
          { name: 'id' },
          { name: 'chatId' },
          { name: 'type' },
          { name: 'role' },
          { name: 'systemSender' },
          { name: 'customAnnouncer' },
          { name: 'createdAt' },
        ],
}));


function buildSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      lastMessageAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      type TEXT DEFAULT 'message',
      role TEXT,
      systemSender TEXT DEFAULT NULL,
      customAnnouncer TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL
    );
  `);
}

let messageSeq = 0;

function addChat(id: string, lastMessageAt: string | null): void {
  mockTestDb
    .prepare('INSERT INTO chats (id, lastMessageAt, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run(id, lastMessageAt, '2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z');
}

function addMessage(
  chatId: string,
  createdAt: string,
  overrides: { type?: string; role?: string | null; systemSender?: string | null; customAnnouncer?: string | null } = {},
): void {
  const { type = 'message', role = 'ASSISTANT', systemSender = null, customAnnouncer = null } = overrides;
  mockTestDb
    .prepare(
      'INSERT INTO chat_messages (id, chatId, type, role, systemSender, customAnnouncer, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(`m${++messageSeq}`, chatId, type, role, systemSender, customAnnouncer, createdAt);
}

function storedLastMessageAt(chatId: string): string | null {
  return (mockTestDb.prepare('SELECT lastMessageAt FROM chats WHERE id = ?').get(chatId) as { lastMessageAt: string | null })
    .lastMessageAt;
}

describe('recompute-chat-last-message-at-v1', () => {
  beforeEach(() => {
    messageSeq = 0;
    mockTestDb = new Database(':memory:');
    buildSchema(mockTestDb);
  });

  afterEach(() => {
    mockTestDb.close();
  });

  it('walks the date back off a Staff announcement to the last thing a character said', async () => {
    addChat('chat-1', '2026-08-30T00:00:00.000Z'); // stamped by the Lantern
    addMessage('chat-1', '2026-08-16T00:00:00.000Z', { role: 'USER' });
    addMessage('chat-1', '2026-08-30T00:00:00.000Z', { systemSender: 'lantern' });

    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(true);
    const result = await recomputeChatLastMessageAtMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(1);
    expect(storedLastMessageAt('chat-1')).toBe('2026-08-16T00:00:00.000Z');
  });

  it('keeps whispers — a character murmuring to another is still the conversation moving', async () => {
    // A whisper carries targetParticipantIds but no systemSender, so it is
    // character-authored and must remain the chat's date.
    addChat('chat-1', '2026-05-01T00:00:00.000Z');
    addMessage('chat-1', '2026-05-01T00:00:00.000Z', { role: 'ASSISTANT' });

    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(false);
    expect(storedLastMessageAt('chat-1')).toBe('2026-05-01T00:00:00.000Z');
  });

  it.each([
    ['a Staff announcement', { systemSender: 'host' }],
    ['an announcement bubble', { role: 'USER', customAnnouncer: '{"kind":"custom","displayName":"The Narrator"}' }],
    ['a raw tool row', { role: 'TOOL' }],
    ['a SYSTEM-role row', { role: 'SYSTEM' }],
    ['a context-summary event', { type: 'context-summary', role: null }],
    ['a system event', { type: 'system', role: null }],
  ])('clears the date to NULL when the only message is %s', async (_label, overrides) => {
    addChat('chat-1', '2026-08-30T00:00:00.000Z');
    addMessage('chat-1', '2026-08-30T00:00:00.000Z', overrides);

    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(true);
    const result = await recomputeChatLastMessageAtMigration.run();

    expect(result.success).toBe(true);
    expect(storedLastMessageAt('chat-1')).toBeNull();
    expect(result.message).toContain('1 with no character-authored messages');
  });

  it('leaves an already-correct chat untouched and reports nothing to do', async () => {
    addChat('chat-1', '2026-08-16T00:00:00.000Z');
    addMessage('chat-1', '2026-08-16T00:00:00.000Z', { role: 'USER' });

    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(false);

    const result = await recomputeChatLastMessageAtMigration.run();
    expect(result.itemsAffected).toBe(0);
    expect(storedLastMessageAt('chat-1')).toBe('2026-08-16T00:00:00.000Z');
  });

  it('fills in a chat whose column was never stamped at all', async () => {
    addChat('chat-1', null);
    addMessage('chat-1', '2026-03-03T00:00:00.000Z', { role: 'ASSISTANT' });

    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(true);
    await recomputeChatLastMessageAtMigration.run();

    expect(storedLastMessageAt('chat-1')).toBe('2026-03-03T00:00:00.000Z');
  });

  it('corrects only the drifted chats in a mixed instance, and is idempotent', async () => {
    addChat('drifted', '2026-08-30T00:00:00.000Z');
    addMessage('drifted', '2026-08-01T00:00:00.000Z', { role: 'USER' });
    addMessage('drifted', '2026-08-30T00:00:00.000Z', { systemSender: 'pascal' });

    addChat('correct', '2026-07-07T00:00:00.000Z');
    addMessage('correct', '2026-07-07T00:00:00.000Z', { role: 'ASSISTANT' });

    addChat('staff-only', '2026-08-30T00:00:00.000Z');
    addMessage('staff-only', '2026-08-30T00:00:00.000Z', { systemSender: 'concierge' });

    const first = await recomputeChatLastMessageAtMigration.run();
    expect(first.itemsAffected).toBe(2);
    expect(storedLastMessageAt('drifted')).toBe('2026-08-01T00:00:00.000Z');
    expect(storedLastMessageAt('correct')).toBe('2026-07-07T00:00:00.000Z');
    expect(storedLastMessageAt('staff-only')).toBeNull();

    // A second pass must find nothing — the rewrite is its own fixed point.
    expect(await recomputeChatLastMessageAtMigration.shouldRun()).toBe(false);
    const second = await recomputeChatLastMessageAtMigration.run();
    expect(second.itemsAffected).toBe(0);
  });
});
