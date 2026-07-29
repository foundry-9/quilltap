/**
 * @jest-environment node
 *
 * Tests for the startup embedding-dimension reconcile.
 *
 * Regression context: a TF-IDF-era corpus (258-d vectors, some in legacy raw
 * Float32 blobs, some int8-quantized) survived a switch to a 1024-d neural
 * default profile because switching WHICH profile is default never triggered
 * a re-embed. The reconcile must delete non-conforming vector-index entries,
 * snap index metadata, converge stale chats to the cold tier, count the
 * recoverable non-conforming rows, and enqueue a mismatched-dim reindex —
 * while excluding FAILED rows and orphans that would re-trigger the sweep on
 * every boot with no progress.
 */

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingReindexAll: jest.fn(),
}));

jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn(),
}));

jest.mock('@/lib/background-jobs/maintenance/collapse-stale-chat-assets', () => ({
  isStale: jest.fn(),
}));

jest.mock('@/lib/background-jobs/maintenance/retention-constants', () => ({
  resolveStaleChatDays: jest.fn(async () => 30),
  retentionCutoff: jest.fn(() => new Date(0)),
}));

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { reconcileEmbeddingDimensions } from '@/lib/startup/reconcile-embedding-dimensions';
import { float32ToBlob, float32ToBlobRaw } from '@/lib/embedding/float32-conversion';

// Real binding, required by absolute root path so the global mock is bypassed.
const nodePath = require('path');
function loadRealSqlite(): any {
  const root = process.cwd();
  try {
    return require(nodePath.join(root, 'node_modules', 'better-sqlite3-multiple-ciphers'));
  } catch {
    return require(nodePath.join(root, 'node_modules', 'better-sqlite3'));
  }
}
const RealDatabase = loadRealSqlite();

const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as {
  getRawDatabase: jest.Mock;
};
const { getRawMountIndexDatabase } = jest.requireMock(
  '@/lib/database/backends/sqlite/mount-index-client'
) as { getRawMountIndexDatabase: jest.Mock };
const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};
const { enqueueEmbeddingReindexAll } = jest.requireMock('@/lib/background-jobs/queue-service') as {
  enqueueEmbeddingReindexAll: jest.Mock;
};
const { getVectorStoreManager } = jest.requireMock('@/lib/embedding/vector-store') as {
  getVectorStoreManager: jest.Mock;
};
const { isStale } = jest.requireMock(
  '@/lib/background-jobs/maintenance/collapse-stale-chat-assets'
) as { isStale: jest.Mock };

const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TARGET_DIM = 1024;
const OLD_DIM = 258;

function vec(dim: number): Float32Array {
  const v = new Float32Array(dim);
  v.fill(0.1);
  return v;
}

/** Quantized (current-format) blob at the given dimension. */
const goodBlob = (dim: number) => float32ToBlob(vec(dim));
/** Legacy raw Float32 blob at the given dimension (the TF-IDF-era format). */
const rawBlob = (dim: number) => float32ToBlobRaw(vec(dim));

function createMainDb(): any {
  const db = new RealDatabase(':memory:');
  db.exec(`
    CREATE TABLE embedding_profiles (
      id TEXT PRIMARY KEY, userId TEXT, provider TEXT,
      dimensions INTEGER, truncateToDimensions INTEGER, isDefault INTEGER
    );
    CREATE TABLE vector_entries (id TEXT PRIMARY KEY, characterId TEXT, embedding BLOB);
    CREATE TABLE vector_indices (characterId TEXT PRIMARY KEY, dimensions INTEGER);
    CREATE TABLE chats (id TEXT PRIMARY KEY, updatedAt TEXT);
    CREATE TABLE conversation_chunks (id TEXT PRIMARY KEY, chatId TEXT, embedding BLOB);
    CREATE TABLE memories (id TEXT PRIMARY KEY, characterId TEXT, embedding BLOB);
    CREATE TABLE help_docs (id TEXT PRIMARY KEY, embedding BLOB);
    CREATE TABLE embedding_status (
      id TEXT PRIMARY KEY, entityType TEXT, entityId TEXT, profileId TEXT, status TEXT
    );
    CREATE TABLE doc_mount_points (id TEXT PRIMARY KEY, enabled INTEGER);
  `);
  return db;
}

function createMountDb(): any {
  const db = new RealDatabase(':memory:');
  db.exec(`CREATE TABLE doc_mount_chunks (id TEXT PRIMARY KEY, mountPointId TEXT, embedding BLOB);`);
  return db;
}

function insertDefaultProfile(db: any, provider = 'OPENAI'): void {
  db.prepare(
    `INSERT INTO embedding_profiles (id, userId, provider, dimensions, truncateToDimensions, isDefault)
     VALUES (?, ?, ?, ?, NULL, 1)`
  ).run(PROFILE_ID, USER_ID, provider, TARGET_DIM);
}

describe('reconcileEmbeddingDimensions', () => {
  let mainDb: any;
  let mountDb: any;
  let unloadAll: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mainDb = createMainDb();
    mountDb = createMountDb();
    getRawDatabase.mockReturnValue(mainDb);
    getRawMountIndexDatabase.mockReturnValue(mountDb);
    unloadAll = jest.fn();
    getVectorStoreManager.mockReturnValue({ unloadAll });
    getRepositories.mockReturnValue({
      chats: { getLastPlayedMessageAt: jest.fn(async () => null) },
      backgroundJobs: { findRecentByType: jest.fn(async () => []) },
    });
    isStale.mockImplementation(async (chat: { id: string }) => chat.id.startsWith('stale'));
  });

  afterEach(() => {
    mainDb.close();
    mountDb.close();
  });

  it('deletes non-conforming vector entries (raw AND quantized) and snaps index meta', async () => {
    insertDefaultProfile(mainDb);
    const ins = mainDb.prepare('INSERT INTO vector_entries (id, characterId, embedding) VALUES (?, ?, ?)');
    ins.run('e-raw-258', 'char-1', rawBlob(OLD_DIM));
    ins.run('e-quant-258', 'char-1', goodBlob(OLD_DIM));
    ins.run('e-good', 'char-1', goodBlob(TARGET_DIM));
    mainDb.prepare('INSERT INTO vector_indices (characterId, dimensions) VALUES (?, ?)').run('char-1', OLD_DIM);

    const result = await reconcileEmbeddingDimensions();

    expect(result.skippedReason).toBeNull();
    expect(result.targetDimensions).toBe(TARGET_DIM);
    expect(result.vectorEntriesDeleted).toBe(2);
    expect(result.vectorIndexMetaFixed).toBe(1);
    expect(unloadAll).toHaveBeenCalled();

    const remaining = mainDb.prepare('SELECT id FROM vector_entries').all();
    expect(remaining.map((r: { id: string }) => r.id)).toEqual(['e-good']);
    const meta = mainDb.prepare('SELECT dimensions FROM vector_indices').get();
    expect(meta.dimensions).toBe(TARGET_DIM);
  });

  it('counts non-conforming and NULL memories, excludes FAILED rows, and enqueues a mismatched-dim reindex', async () => {
    insertDefaultProfile(mainDb);
    const ins = mainDb.prepare('INSERT INTO memories (id, characterId, embedding) VALUES (?, ?, ?)');
    ins.run('m-old', 'char-1', rawBlob(OLD_DIM));
    ins.run('m-null', 'char-1', null);
    ins.run('m-good', 'char-1', goodBlob(TARGET_DIM));
    ins.run('m-failed', 'char-1', rawBlob(OLD_DIM));
    ins.run('m-orphan', null, rawBlob(OLD_DIM));
    mainDb.prepare(
      `INSERT INTO embedding_status (id, entityType, entityId, profileId, status)
       VALUES ('s1', 'MEMORY', 'm-failed', ?, 'FAILED')`
    ).run(PROFILE_ID);

    const result = await reconcileEmbeddingDimensions();

    expect(result.mismatched.memories).toBe(2); // m-old + m-null; not good/failed/orphan
    expect(result.reindexEnqueued).toBe(true);
    expect(enqueueEmbeddingReindexAll).toHaveBeenCalledWith(USER_ID, {
      profileId: PROFILE_ID,
      scope: 'mismatched-dim',
    });
  });

  it('NULLs non-conforming chunks on stale chats and counts only live-chat chunks', async () => {
    insertDefaultProfile(mainDb);
    mainDb.prepare(`INSERT INTO chats (id, updatedAt) VALUES ('stale-chat', '2025-01-01T00:00:00.000Z')`).run();
    mainDb.prepare(`INSERT INTO chats (id, updatedAt) VALUES ('live-chat', '2026-07-01T00:00:00.000Z')`).run();
    const ins = mainDb.prepare('INSERT INTO conversation_chunks (id, chatId, embedding) VALUES (?, ?, ?)');
    ins.run('cc-stale', 'stale-chat', rawBlob(OLD_DIM));
    ins.run('cc-live', 'live-chat', rawBlob(OLD_DIM));
    ins.run('cc-live-good', 'live-chat', goodBlob(TARGET_DIM));
    ins.run('cc-orphan', 'gone-chat', rawBlob(OLD_DIM));

    const result = await reconcileEmbeddingDimensions();

    expect(result.staleChunkEmbeddingsCleared).toBe(1);
    const staleRow = mainDb.prepare(`SELECT embedding FROM conversation_chunks WHERE id = 'cc-stale'`).get();
    expect(staleRow.embedding).toBeNull();
    // Live non-conforming chunk counted; orphan (chat gone) and good chunk not.
    expect(result.mismatched.conversationChunks).toBe(1);
  });

  it('counts non-conforming mount chunks only for ENABLED mount points', async () => {
    insertDefaultProfile(mainDb);
    mainDb.prepare(`INSERT INTO doc_mount_points (id, enabled) VALUES ('mp-on', 1)`).run();
    mainDb.prepare(`INSERT INTO doc_mount_points (id, enabled) VALUES ('mp-off', 0)`).run();
    const ins = mountDb.prepare('INSERT INTO doc_mount_chunks (id, mountPointId, embedding) VALUES (?, ?, ?)');
    ins.run('mc-on-old', 'mp-on', rawBlob(OLD_DIM));
    ins.run('mc-on-good', 'mp-on', goodBlob(TARGET_DIM));
    ins.run('mc-off-old', 'mp-off', rawBlob(OLD_DIM));

    const result = await reconcileEmbeddingDimensions();

    expect(result.mismatched.mountChunks).toBe(1);
    expect(result.reindexEnqueued).toBe(true);
  });

  it('does not stack a second reindex while one is already pending', async () => {
    insertDefaultProfile(mainDb);
    mainDb.prepare('INSERT INTO memories (id, characterId, embedding) VALUES (?, ?, ?)')
      .run('m-old', 'char-1', rawBlob(OLD_DIM));
    getRepositories.mockReturnValue({
      chats: { getLastPlayedMessageAt: jest.fn(async () => null) },
      backgroundJobs: {
        findRecentByType: jest.fn(async () => [{ status: 'PENDING' }]),
      },
    });

    const result = await reconcileEmbeddingDimensions();

    expect(result.mismatched.memories).toBe(1);
    expect(result.reindexEnqueued).toBe(false);
    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled();
  });

  it('is a no-op for a BUILTIN default profile', async () => {
    insertDefaultProfile(mainDb, 'BUILTIN');
    mainDb.prepare('INSERT INTO vector_entries (id, characterId, embedding) VALUES (?, ?, ?)')
      .run('e-old', 'char-1', rawBlob(OLD_DIM));

    const result = await reconcileEmbeddingDimensions();

    expect(result.skippedReason).toBe('builtin-profile');
    expect(mainDb.prepare('SELECT COUNT(*) AS n FROM vector_entries').get().n).toBe(1);
    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled();
  });

  it('does nothing and enqueues nothing on a fully conforming corpus', async () => {
    insertDefaultProfile(mainDb);
    mainDb.prepare('INSERT INTO memories (id, characterId, embedding) VALUES (?, ?, ?)')
      .run('m-good', 'char-1', goodBlob(TARGET_DIM));
    mainDb.prepare('INSERT INTO vector_entries (id, characterId, embedding) VALUES (?, ?, ?)')
      .run('e-good', 'char-1', goodBlob(TARGET_DIM));

    const result = await reconcileEmbeddingDimensions();

    expect(result.vectorEntriesDeleted).toBe(0);
    expect(result.mismatched.memories).toBe(0);
    expect(result.reindexEnqueued).toBe(false);
    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled();
  });
});
