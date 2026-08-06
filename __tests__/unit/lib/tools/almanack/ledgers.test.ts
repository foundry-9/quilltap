/**
 * @jest-environment node
 *
 * The Almanack's phase-3 ledger collectors, run against a real in-memory SQLite
 * database so the SQL itself is exercised — the three defects here (bugs 19, 20,
 * 21) all live in the query text, not the TypeScript around it.
 *
 * - Bug 19: the embedding census filtered `status = 'PERMANENTLY_FAILED'`, a
 *   value `EmbeddingStatusEnum` (PENDING/EMBEDDED/FAILED) can never hold, so the
 *   cell was structurally always 0.
 * - Bug 20: the cast-size histogram grouped by the bare `participants` alias,
 *   which SQLite binds to the raw JSON column, so every distinct cast string was
 *   its own row instead of rolling up by cast size.
 * - Bug 21: the wardrobe-permission counts tested `= 1` where the runtime
 *   permission is null-safe (`!== false`) — NULL means allowed — so every
 *   default-state character went uncounted.
 */

// NOTE: no `@jest/globals` import — it breaks jest.mock hoisting in this repo;
// use the global jest/describe/it/expect (see project jest-mock conventions).

let db: import('better-sqlite3').Database;

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Route the Almanack's `mainRows`/`mainRow` helpers (via `db.ts`) at the real
// in-memory database so the actual SQL runs.
jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(...(params as never[])),
  ),
  registerBlobColumns: jest.fn(),
}));

const mockFindDefault = jest.fn().mockResolvedValue(null);
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    embeddingProfiles: { findDefault: mockFindDefault },
  }),
}));

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both names with a no-op mock. Require
// the real binding by absolute path so this suite exercises actual SQL.
const path = require('path');
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

import {
  collectChatBreakdown,
  collectCharacterBreakdown,
  collectEmbeddingPipeline,
} from '@/lib/tools/almanack/phase3-ledgers';

const USER = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockFindDefault.mockResolvedValue(null);
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

// --- Bug 20 -----------------------------------------------------------------

describe('collectChatBreakdown — participant histogram (Bug 20)', () => {
  beforeEach(() => {
    db.exec(`CREATE TABLE "chats" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "chatType" TEXT,
      "participants" TEXT,
      "isPaused" INTEGER,
      "documentEditingMode" INTEGER,
      "equippedOutfit" TEXT,
      "pendingOutfitNotifications" TEXT,
      "timelineMode" TEXT,
      "state" TEXT
    )`);
    const insert = db.prepare(
      `INSERT INTO "chats" ("id", "userId", "participants") VALUES (?, ?, ?)`,
    );
    // Three chats share a cast size of 2 but list different casts.
    insert.run('c1', USER, JSON.stringify(['alice', 'bob']));
    insert.run('c2', USER, JSON.stringify(['carol', 'dave']));
    insert.run('c3', USER, JSON.stringify(['erin', 'frank']));
    // Two solo chats.
    insert.run('c4', USER, JSON.stringify(['gina']));
    insert.run('c5', USER, JSON.stringify(['hank']));
  });

  it('participant_histogram_rolls_up_by_cast_size', async () => {
    const result = await collectChatBreakdown(USER);

    // Rolled up by cast size, not per distinct cast: one row per size.
    expect(result.participantHistogram).toEqual([
      { participants: 1, chats: 2 },
      { participants: 2, chats: 3 },
    ]);
  });
});

// --- Bug 21 -----------------------------------------------------------------

describe('collectCharacterBreakdown — wardrobe permissions (Bug 21)', () => {
  beforeEach(() => {
    db.exec(`CREATE TABLE "characters" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "characterDocumentMountPointId" TEXT,
      "npc" INTEGER,
      "controlledBy" TEXT,
      "canBeCarina" INTEGER,
      "systemTransparency" INTEGER,
      "canDressThemselves" INTEGER DEFAULT NULL,
      "canCreateOutfits" INTEGER DEFAULT NULL,
      "coreWhisperEnabled" INTEGER DEFAULT NULL
    )`);
    const insert = db.prepare(
      `INSERT INTO "characters" ("id", "userId", "canDressThemselves", "canCreateOutfits")
       VALUES (?, ?, ?, ?)`,
    );
    // Default state (NULL) — allowed at runtime, previously uncounted.
    insert.run('ch1', USER, null, null);
    insert.run('ch2', USER, null, null);
    // Explicit opt-in.
    insert.run('ch3', USER, 1, 1);
    // Explicit opt-out — the only genuinely denied state.
    insert.run('ch4', USER, 0, 0);
  });

  it('dress_outfit_counts_are_effective_permission', async () => {
    const result = await collectCharacterBreakdown(USER);

    // Effective permission: NULL (default) + 1 (explicit) count; only 0 denies.
    expect(result.canDressThemselves).toBe(3);
    expect(result.canCreateOutfits).toBe(3);
  });
});

// --- Bug 19 -----------------------------------------------------------------

describe('collectEmbeddingPipeline — failed census (Bug 19)', () => {
  beforeEach(() => {
    db.exec(`CREATE TABLE "embedding_status" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "entityType" TEXT,
      "status" TEXT
    )`);
    db.exec(`CREATE TABLE "conversation_chunks" ("id" TEXT PRIMARY KEY, "embedding" BLOB)`);
    db.exec(`CREATE TABLE "help_docs" ("id" TEXT PRIMARY KEY, "embedding" BLOB)`);
    db.exec(`CREATE TABLE "memories" ("id" TEXT PRIMARY KEY, "embedding" BLOB)`);
    const insert = db.prepare(
      `INSERT INTO "embedding_status" ("id", "userId", "entityType", "status") VALUES (?, ?, ?, ?)`,
    );
    insert.run('e1', USER, 'memory', 'EMBEDDED');
    insert.run('e2', USER, 'memory', 'FAILED');
    insert.run('e3', USER, 'memory', 'FAILED');
    insert.run('e4', USER, 'memory', 'PENDING');
  });

  it('counts rows in the FAILED terminal state, not the never-stored PERMANENTLY_FAILED', async () => {
    const result = await collectEmbeddingPipeline(USER);

    // FAILED is a real enum value; the old filter matched nothing → always 0.
    expect(result.failed).toBe(2);
  });
});
