/**
 * Imported memories must be re-embedded, not carried.
 *
 * A memory's vector is only meaningful against the model that produced it, so
 * `.qtap` exports no longer carry embeddings and importers drop any that
 * arrive from an older archive. That leaves imported rows with a NULL
 * embedding — and before this work, *nothing* in the import path re-embedded
 * them: semantic search over freshly imported memories stayed broken until the
 * next restart's reconcile sweep happened to notice.
 *
 * These tests pin the repair: one targeted `EMBEDDING_GENERATE` per created
 * memory against the **system default profile whatever its provider** (never
 * a blanket `EMBEDDING_REINDEX_ALL`, which walks every character's entire
 * corpus plus conversation chunks, help docs and mount chunks), a debounced
 * vocabulary refit when that default is the corpus-derived BUILTIN TF-IDF
 * one, and a plain warning only when no default profile exists at all.
 */

import {
  createMockCharacter,
  createMockMemory,
  createMockExportedCharacter,
  createMockExportManifest,
  generateId,
} from '../fixtures/test-factories';
import {
  createMockUserRepositories,
  createMockGlobalRepositories,
  configureFindById,
  configureCreate,
} from '../fixtures/mock-repositories';

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingGenerate: jest.fn(),
  enqueueEmbeddingReindexAll: jest.fn(),
}));

jest.mock('@/lib/embedding/embedding-service', () => ({
  getDefaultEmbeddingProfile: jest.fn(),
}));

jest.mock('@/lib/embedding/embedding-job-scheduler', () => ({
  scheduleRefit: jest.fn(),
}));

import { executeImport } from '@/lib/import/quilltap-import-service';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import {
  enqueueEmbeddingGenerate,
  enqueueEmbeddingReindexAll,
} from '@/lib/background-jobs/queue-service';
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service';
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler';

describe('import → memory re-embedding', () => {
  const mockUserRepos = createMockUserRepositories();
  const mockGlobalRepos = createMockGlobalRepositories();
  const testUserId = generateId();

  const importOptions = {
    conflictStrategy: 'duplicate' as const,
    includeMemories: true,
    includeRelatedEntities: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getUserRepositories as jest.Mock).mockReturnValue(mockUserRepos);
    (getRepositories as jest.Mock).mockReturnValue(mockGlobalRepos);
    configureCreate(mockUserRepos.characters.create);
    configureCreate(mockUserRepos.memories.create);
    (enqueueEmbeddingGenerate as jest.Mock).mockResolvedValue({ jobId: 'job-1', isNew: true });
  });

  /** An export of one character plus `count` of its memories. */
  function buildExport(character: ReturnType<typeof createMockCharacter>, count: number) {
    return {
      manifest: createMockExportManifest({ exportType: 'characters' }),
      data: {
        characters: [createMockExportedCharacter(character)],
        memories: Array.from({ length: count }, () =>
          createMockMemory({ characterId: character.id })
        ),
      },
    };
  }

  it('enqueues one EMBEDDING_GENERATE per imported memory, never a full reindex', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      provider: 'OPENAI',
    });

    const result = await executeImport(testUserId, buildExport(character, 3) as never, importOptions);

    expect(result.success).toBe(true);
    expect(result.imported.memories).toBe(3);
    expect(enqueueEmbeddingGenerate).toHaveBeenCalledTimes(3);
    expect(enqueueEmbeddingGenerate).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({
        entityType: 'MEMORY',
        profileId: 'profile-1',
      })
    );
    // A blanket reindex would walk the whole corpus — wildly out of
    // proportion to importing a handful of rows.
    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled();
  });

  it('creates memories with no embedding at all', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      provider: 'OPENAI',
    });

    // A memory arriving from an older archive, vector and all.
    const exportData = buildExport(character, 1);
    (exportData.data.memories[0] as Record<string, unknown>).embedding = [0.1, 0.2, 0.3];

    await executeImport(testUserId, exportData as never, importOptions);

    expect(mockUserRepos.memories.create).toHaveBeenCalledTimes(1);
    const created = (mockUserRepos.memories.create as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(created).not.toHaveProperty('embedding');
  });

  it('warns rather than enqueueing when no embedding profile is configured', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue(null);

    const result = await executeImport(testUserId, buildExport(character, 2) as never, importOptions);

    expect(enqueueEmbeddingGenerate).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => w.includes('without embeddings'))).toBe(true);
    // The memories themselves still import — only their indexing is deferred.
    expect(result.imported.memories).toBe(2);
  });

  it('embeds under a BUILTIN default too, and schedules the vocabulary refit', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({
      id: 'profile-builtin',
      provider: 'BUILTIN',
    });

    const result = await executeImport(testUserId, buildExport(character, 2) as never, importOptions);

    // The system default embeds everything — a BUILTIN default is no
    // exception. The corpus just grew, so the debounced refit (whose reindex
    // also heals any row embedded before the vocabulary was first fitted)
    // rides along, exactly as manual memory creation does.
    expect(enqueueEmbeddingGenerate).toHaveBeenCalledTimes(2);
    expect(enqueueEmbeddingGenerate).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({ entityType: 'MEMORY', profileId: 'profile-builtin' })
    );
    expect(scheduleRefit).toHaveBeenCalledWith(testUserId, 'profile-builtin');
    expect(result.warnings.some((w) => w.includes('TF-IDF'))).toBe(false);
  });

  it('does not schedule a refit for an API-backed default profile', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      provider: 'OPENAI',
    });

    await executeImport(testUserId, buildExport(character, 1) as never, importOptions);

    expect(scheduleRefit).not.toHaveBeenCalled();
  });

  it('does not fail the import when enqueueing throws', async () => {
    const character = createMockCharacter();
    configureFindById(mockUserRepos.characters.findById, []);
    (getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      provider: 'OPENAI',
    });
    (enqueueEmbeddingGenerate as jest.Mock).mockRejectedValue(new Error('queue is down'));

    const result = await executeImport(testUserId, buildExport(character, 1) as never, importOptions);

    // The rows are already committed; a scheduling failure must not undo them.
    expect(result.success).toBe(true);
    expect(result.imported.memories).toBe(1);
    expect(result.warnings.some((w) => w.includes('could not be'))).toBe(true);
  });
});
