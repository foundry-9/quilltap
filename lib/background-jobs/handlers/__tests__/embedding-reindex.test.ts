/**
 * @jest-environment node
 *
 * Tests for the EMBEDDING_REINDEX_ALL handler's fan-out:
 *  - characters come from memories.findDistinctCharacterIds (NOT the
 *    characters repo, whose vault-failure semantics silently drop rows),
 *  - stale chats are skipped in the conversation-chunk phase,
 *  - FAILED-marked entities are skipped in mismatched-dim scope,
 *  - document mount chunks (enabled mounts) are included.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../processor', () => ({
  ensureProcessorRunning: jest.fn(),
}));

jest.mock('@/lib/help/help-doc-sync', () => ({
  syncHelpDocs: jest.fn(async () => ({
    created: 0, updated: 0, unchanged: 0, deleted: 0, totalOnDisk: 0,
  })),
}));

jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn(),
}));

jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateAll: jest.fn(),
}));

jest.mock('@/lib/background-jobs/maintenance/collapse-stale-chat-assets', () => ({
  isStale: jest.fn(),
}));

jest.mock('@/lib/background-jobs/maintenance/retention-constants', () => ({
  resolveStaleChatDays: jest.fn(async () => 30),
  retentionCutoff: jest.fn(() => new Date(0)),
}));

import { handleEmbeddingReindexAll } from '../embedding-reindex';
import type { BackgroundJob } from '@/lib/schemas/types';

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
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

const goodEmbedding = new Float32Array(TARGET_DIM);
const oldEmbedding = new Float32Array(258);

function makeJob(scope: 'all' | 'mismatched-dim'): BackgroundJob {
  return {
    id: 'job-1',
    userId: USER_ID,
    type: 'EMBEDDING_REINDEX_ALL',
    status: 'PROCESSING',
    payload: { profileId: PROFILE_ID, scope },
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    scheduledAt: '2026-07-29T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  } as unknown as BackgroundJob;
}

interface RepoOverrides {
  failedIds?: Partial<Record<string, Set<string>>>;
}

function makeRepos(overrides: RepoOverrides = {}) {
  const createBatch = jest.fn(async () => undefined);
  const deleteStore = jest.fn(async () => true);
  getVectorStoreManager.mockReturnValue({ deleteStore });

  const repos = {
    embeddingProfiles: {
      findById: jest.fn(async () => ({
        id: PROFILE_ID,
        userId: USER_ID,
        provider: 'OPENAI',
        modelName: 'text-embedding-3-large',
        dimensions: TARGET_DIM,
        truncateToDimensions: null,
        isDefault: true,
      })),
    },
    backgroundJobs: {
      cancelByType: jest.fn(async () => 0),
      createBatch,
    },
    embeddingStatus: {
      markAllPendingByProfileId: jest.fn(async () => 0),
      listFailedEntityIds: jest.fn(
        async (entityType: string) => overrides.failedIds?.[entityType] ?? new Set<string>()
      ),
    },
    helpDocs: {
      findAll: jest.fn(async () => [
        { id: 'doc-old', embedding: oldEmbedding },
        { id: 'doc-good', embedding: goodEmbedding },
      ]),
      clearAllEmbeddings: jest.fn(async () => undefined),
    },
    memories: {
      // 'char-vaultless' would be DROPPED by characters.findByUserId — the
      // handler must reach its memories anyway.
      findDistinctCharacterIds: jest.fn(async () => ['char-ok', 'char-vaultless']),
      findByCharacterId: jest.fn(async (characterId: string) =>
        characterId === 'char-ok'
          ? [
              { id: 'mem-old', characterId, embedding: oldEmbedding },
              { id: 'mem-good', characterId, embedding: goodEmbedding },
            ]
          : [{ id: 'mem-vaultless', characterId, embedding: oldEmbedding }]
      ),
    },
    chats: {
      findByUserId: jest.fn(async () => [
        { id: 'live-chat', updatedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'stale-chat', updatedAt: '2025-01-01T00:00:00.000Z' },
      ]),
    },
    conversationChunks: {
      findByChatId: jest.fn(async (chatId: string) =>
        chatId === 'live-chat'
          ? [
              { id: 'cc-old', chatId, embedding: oldEmbedding },
              { id: 'cc-good', chatId, embedding: goodEmbedding },
            ]
          : [{ id: 'cc-stale-old', chatId, embedding: oldEmbedding }]
      ),
    },
    docMountPoints: {
      findEnabled: jest.fn(async () => [{ id: 'mp-1' }]),
    },
    docMountChunks: {
      findByMountPointId: jest.fn(async () => [
        { id: 'mc-old', mountPointId: 'mp-1', embedding: oldEmbedding },
        { id: 'mc-good', mountPointId: 'mp-1', embedding: goodEmbedding },
      ]),
    },
  };
  getRepositories.mockReturnValue(repos);
  return { repos, createBatch, deleteStore };
}

/** All entityType/entityId pairs across every createBatch call. */
function enqueuedEntities(createBatch: jest.Mock): Array<{ type: string; id: string }> {
  return createBatch.mock.calls
    .flatMap((call) => call[0] as Array<{ payload: { entityType: string; entityId: string } }>)
    .map((r) => ({ type: r.payload.entityType, id: r.payload.entityId }));
}

describe('handleEmbeddingReindexAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isStale.mockImplementation(async (chat: { id: string }) => chat.id.startsWith('stale'));
  });

  it('mismatched-dim scope: re-embeds only non-conforming rows, skipping stale chats', async () => {
    const { createBatch } = makeRepos();

    await handleEmbeddingReindexAll(makeJob('mismatched-dim'));

    const entities = enqueuedEntities(createBatch);
    expect(entities).toEqual(
      expect.arrayContaining([
        { type: 'HELP_DOC', id: 'doc-old' },
        { type: 'MEMORY', id: 'mem-old' },
        { type: 'MEMORY', id: 'mem-vaultless' },
        { type: 'CONVERSATION_CHUNK', id: 'cc-old' },
        { type: 'MOUNT_CHUNK', id: 'mc-old' },
      ])
    );
    const ids = entities.map((e) => e.id);
    expect(ids).not.toContain('doc-good');
    expect(ids).not.toContain('mem-good');
    expect(ids).not.toContain('cc-good');
    expect(ids).not.toContain('mc-good');
    expect(ids).not.toContain('cc-stale-old'); // stale chat skipped
  });

  it('mismatched-dim scope: excludes entities marked FAILED for the profile', async () => {
    const { repos, createBatch } = makeRepos({
      failedIds: {
        MEMORY: new Set(['mem-old']),
        MOUNT_CHUNK: new Set(['mc-old']),
      },
    });

    await handleEmbeddingReindexAll(makeJob('mismatched-dim'));

    const ids = enqueuedEntities(createBatch).map((e) => e.id);
    expect(ids).not.toContain('mem-old');
    expect(ids).not.toContain('mc-old');
    expect(ids).toContain('mem-vaultless');
    expect(repos.embeddingStatus.listFailedEntityIds).toHaveBeenCalledWith('MEMORY', PROFILE_ID);
  });

  it('all scope: clears vector stores for every memory-holding character (vaults not consulted)', async () => {
    const { repos, createBatch, deleteStore } = makeRepos();

    await handleEmbeddingReindexAll(makeJob('all'));

    expect(deleteStore).toHaveBeenCalledWith('char-ok');
    expect(deleteStore).toHaveBeenCalledWith('char-vaultless');
    expect(repos.embeddingStatus.markAllPendingByProfileId).toHaveBeenCalledWith(PROFILE_ID);
    // 'all' scope re-embeds conforming rows too — but still not stale chats.
    const ids = enqueuedEntities(createBatch).map((e) => e.id);
    expect(ids).toContain('mem-good');
    expect(ids).toContain('cc-good');
    expect(ids).toContain('mc-good');
    expect(ids).not.toContain('cc-stale-old');
    // FAILED lookups are a mismatched-dim concern only.
    expect(repos.embeddingStatus.listFailedEntityIds).not.toHaveBeenCalled();
  });
});
