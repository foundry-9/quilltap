/**
 * Tests for the startup render/embed reconciliation sweep.
 *
 * Uses the global `jest` (no `@jest/globals` import) and imports the subject
 * dynamically after the mocks are registered, per repo test conventions.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueConversationRender: jest.fn(),
}));

// Pin the size cap so the bound parameter is deterministic in assertions.
jest.mock('@/lib/embedding/embedding-service', () => ({
  EMBEDDING_MAX_CHARS: 131072,
}));

// Pin the per-chunk budget (arm C's over-budget bound) without loading the
// renderer's transitive deps.
jest.mock('@/lib/scriptorium/markdown-renderer', () => ({
  CHUNK_CHAR_BUDGET: 24000,
}));

// The staleness gate is exercised as a mock: the reconcile must consult it and
// skip stale (cold-tiered) chats, but its internals belong to the sweep tests.
// embeddingProfiles.findAll feeds the FAILED-status exclusion's profile bind.
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => ({
    embeddingProfiles: {
      findAll: jest.fn(async () => [
        { id: 'profile-old', isDefault: false },
        { id: 'profile-default', isDefault: true },
      ]),
    },
  })),
}));

jest.mock('@/lib/background-jobs/maintenance/collapse-stale-chat-assets', () => ({
  isStale: jest.fn(async () => false),
}));

jest.mock('@/lib/background-jobs/maintenance/retention-constants', () => ({
  resolveStaleChatDays: jest.fn(async () => 30),
  retentionCutoff: jest.fn(() => new Date('2026-01-01T00:00:00.000Z')),
}));

const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as {
  getRawDatabase: jest.Mock;
};
const { enqueueConversationRender } = jest.requireMock('@/lib/background-jobs/queue-service') as {
  enqueueConversationRender: jest.Mock;
};
const { isStale } = jest.requireMock(
  '@/lib/background-jobs/maintenance/collapse-stale-chat-assets'
) as { isStale: jest.Mock };

type IncompleteChatRow = { chatId: string; userId: string; updatedAt?: string | null };

/** Build a fake better-sqlite3 db whose SELECT returns the given rows. */
function makeDb(rows: IncompleteChatRow[]) {
  const all = jest.fn(() => rows);
  const prepare = jest.fn(() => ({ all }));
  return { db: { prepare }, prepare, all };
}

describe('reconcileConversationRendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a zeroed result and enqueues nothing when no database is available', async () => {
    getRawDatabase.mockReturnValue(null);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 0,
      enqueued: 0,
      reused: 0,
      failed: 0,
      skippedStale: 0,
    });
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });

  it('is a no-op when every conversation is already rendered and embedded', async () => {
    const { db, all } = makeDb([]);
    getRawDatabase.mockReturnValue(db);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result.incompleteChats).toBe(0);
    expect(result.enqueued).toBe(0);
    // The scan binds the size cap (oversized-chunk exclusion), the default
    // profile id (permanently-FAILED-chunk exclusion), then arm (C)'s
    // over-budget / within-transport-cap window for the sub-chunk heal.
    expect(all).toHaveBeenCalledWith(131072, 'profile-default', 24000, 131072);
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });

  it('excludes chunks with a FAILED embedding_status for the default profile in the scan SQL', async () => {
    // Regression: the length guard alone counted >8k-token chunks (permanently
    // unembeddable, marked FAILED by the embedder) as "recoverable", so their
    // chats re-rendered and re-failed on every boot. The SQL must carry a
    // NOT EXISTS over embedding_status scoped to the profile a re-embed would
    // actually use.
    const { db, prepare } = makeDb([]);
    getRawDatabase.mockReturnValue(db);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    await reconcileConversationRendering();

    const sql = (prepare.mock.calls[0] as [string])[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('"embedding_status"');
    expect(sql).toContain(`"status" = 'FAILED'`);
    expect(sql).toContain(`"entityType" = 'CONVERSATION_CHUNK'`);
  });

  it('binds a matches-nothing sentinel when no embedding profile exists', async () => {
    const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock;
    };
    getRepositories.mockReturnValueOnce({
      embeddingProfiles: { findAll: jest.fn(async () => []) },
    });

    const { db, all } = makeDb([]);
    getRawDatabase.mockReturnValue(db);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result.incompleteChats).toBe(0);
    expect(all).toHaveBeenCalledWith(131072, '', 24000, 131072);
  });

  it('scans for sub-chunkable oversize chunks (arm C) so Bug 17 chats re-render once', async () => {
    // Arm (C): a chunk over the per-chunk budget but under the transport cap is
    // pulled back in — the renderer now sub-chunks it, so re-rendering heals it.
    // FAILED status is NOT excluded here (unlike arm B), because these are the
    // very chunks arm B skips.
    const { db, prepare } = makeDb([]);
    getRawDatabase.mockReturnValue(db);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    await reconcileConversationRendering();

    const sql = (prepare.mock.calls[0] as [string])[0];
    // The arm-(C) window: over CHUNK_CHAR_BUDGET, within EMBEDDING_MAX_CHARS.
    expect(sql).toContain('LENGTH(cc2."content") > ?');
    expect(sql).toContain('LENGTH(cc2."content") <= ?');
    expect(sql).toContain('cc2."embedding" IS NULL');
  });

  it('still scans (exclusion disabled) when profile resolution throws', async () => {
    const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock;
    };
    getRepositories.mockReturnValueOnce({
      embeddingProfiles: { findAll: jest.fn(async () => { throw new Error('db not ready'); }) },
    });

    const { db, all } = makeDb([{ chatId: 'chat-a', userId: 'user-1' }]);
    getRawDatabase.mockReturnValue(db);
    enqueueConversationRender.mockResolvedValueOnce({ jobId: 'job-a', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(all).toHaveBeenCalledWith(131072, '', 24000, 131072);
    expect(result.enqueued).toBe(1);
  });

  it('enqueues a render for each incomplete chat and counts new vs reused', async () => {
    const { db } = makeDb([
      { chatId: 'chat-a', userId: 'user-1' },
      { chatId: 'chat-b', userId: 'user-1' },
      { chatId: 'chat-c', userId: 'user-2' },
    ]);
    getRawDatabase.mockReturnValue(db);

    enqueueConversationRender
      .mockResolvedValueOnce({ jobId: 'job-a', isNew: true })
      .mockResolvedValueOnce({ jobId: 'job-b', isNew: false }) // already pending → reused
      .mockResolvedValueOnce({ jobId: 'job-c', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 3,
      enqueued: 2,
      reused: 1,
      failed: 0,
      skippedStale: 0,
    });
    expect(enqueueConversationRender).toHaveBeenCalledTimes(3);
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(1, 'user-1', { chatId: 'chat-a' });
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(2, 'user-1', { chatId: 'chat-b' });
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(3, 'user-2', { chatId: 'chat-c' });
  });

  it('continues past a failed enqueue and tallies it', async () => {
    const { db } = makeDb([
      { chatId: 'chat-a', userId: 'user-1' },
      { chatId: 'chat-b', userId: 'user-1' },
    ]);
    getRawDatabase.mockReturnValue(db);

    enqueueConversationRender
      .mockRejectedValueOnce(new Error('queue exploded'))
      .mockResolvedValueOnce({ jobId: 'job-b', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 2,
      enqueued: 1,
      reused: 0,
      failed: 1,
      skippedStale: 0,
    });
    expect(enqueueConversationRender).toHaveBeenCalledTimes(2);
  });

  it('swallows a scan failure and returns a zeroed result', async () => {
    const prepare = jest.fn(() => {
      throw new Error('no such table');
    });
    getRawDatabase.mockReturnValue({ prepare });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 0,
      enqueued: 0,
      reused: 0,
      failed: 0,
      skippedStale: 0,
    });
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });

  it('skips stale (cold-tiered) chats instead of re-enqueuing their renders', async () => {
    // Regression: the maintenance sweep cold-tiers stale chats into NULL
    // renderedMarkdown + NULL chunk embeddings. The reconcile must NOT read
    // that deliberate state as damage, or every boot re-embeds the cold tier.
    const { db } = makeDb([
      { chatId: 'chat-active', userId: 'user-1', updatedAt: '2026-07-20T00:00:00.000Z' },
      { chatId: 'chat-cold', userId: 'user-1', updatedAt: '2025-01-01T00:00:00.000Z' },
    ]);
    getRawDatabase.mockReturnValue(db);

    isStale.mockImplementation(async (chat: { id: string }) => chat.id === 'chat-cold');
    enqueueConversationRender.mockResolvedValueOnce({ jobId: 'job-a', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 2,
      enqueued: 1,
      reused: 0,
      failed: 0,
      skippedStale: 1,
    });
    expect(enqueueConversationRender).toHaveBeenCalledTimes(1);
    expect(enqueueConversationRender).toHaveBeenCalledWith('user-1', { chatId: 'chat-active' });

    isStale.mockImplementation(async () => false);
  });

  it('skips a chat whose staleness cannot be determined (never risks the re-embed loop)', async () => {
    const { db } = makeDb([{ chatId: 'chat-a', userId: 'user-1', updatedAt: null }]);
    getRawDatabase.mockReturnValue(db);

    isStale.mockRejectedValueOnce(new Error('messages table locked'));

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({
      incompleteChats: 1,
      enqueued: 0,
      reused: 0,
      failed: 0,
      skippedStale: 1,
    });
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });
});
