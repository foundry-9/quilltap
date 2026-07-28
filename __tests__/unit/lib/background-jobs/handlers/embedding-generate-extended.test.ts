/**
 * Unit tests for the HELP_DOC and MOUNT_CHUNK entity type branches
 * of lib/background-jobs/handlers/embedding-generate.ts
 *
 * Covers:
 *  - Successful embedding generation and storage for HELP_DOC
 *  - Not-found handling for HELP_DOC
 *  - Error propagation for HELP_DOC
 *  - Successful embedding generation and storage for MOUNT_CHUNK
 *  - Not-found handling for MOUNT_CHUNK
 *  - Error propagation for MOUNT_CHUNK
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EMBEDDING_MAX_CHARS: 128 * 1024,
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn().mockReturnValue({
    unloadStore: jest.fn(),
  }),
}))

jest.mock('@/lib/database/repositories/vector-indices.repository', () => ({
  getVectorIndicesRepository: jest.fn().mockReturnValue({
    entryExists: jest.fn().mockResolvedValue(false),
    addEntry: jest.fn().mockResolvedValue(undefined),
    updateEntryEmbedding: jest.fn().mockResolvedValue(true),
    saveMeta: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { handleEmbeddingGenerate } from '@/lib/background-jobs/handlers/embedding-generate'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import type { BackgroundJob } from '@/lib/schemas/types'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGenerateEmbeddingForUser = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(entityType: string, entityId: string = 'entity-1'): BackgroundJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    type: 'EMBEDDING_GENERATE',
    status: 'pending',
    payload: {
      entityType,
      entityId,
      profileId: 'profile-1',
    },
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as BackgroundJob
}

const fakeEmbedding = [0.1, 0.2, 0.3]
const embeddingResult = {
  embedding: fakeEmbedding,
  model: 'test-model',
  dimensions: 3,
  provider: 'TEST',
}

function makeRepos(helpDocs = {}, docMountChunks = {}, embeddingStatus = {}) {
  return {
    helpDocs: {
      findById: jest.fn(),
      updateEmbedding: jest.fn().mockResolvedValue(undefined),
      ...helpDocs,
    },
    docMountChunks: {
      findById: jest.fn(),
      updateEmbedding: jest.fn().mockResolvedValue(undefined),
      ...docMountChunks,
    },
    embeddingStatus: {
      markAsEmbedded: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
      ...embeddingStatus,
    },
    // Other repos that MEMORY/CONVERSATION_CHUNK branches need:
    memories: { findById: jest.fn(), updateForCharacter: jest.fn() },
    conversationChunks: { findById: jest.fn(), updateEmbedding: jest.fn() },
  }
}

// ---------------------------------------------------------------------------
// HELP_DOC tests
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — HELP_DOC entity type', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  it('generates and stores embedding for a found HELP_DOC', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello world.' }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      `${doc.title}\n\n${doc.content}`,
      'user-1',
      'profile-1',
      { priority: 'background' }
    )
    expect(repos.helpDocs.updateEmbedding).toHaveBeenCalledWith('doc-1', fakeEmbedding)
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalledWith(
      'HELP_DOC',
      'doc-1',
      'profile-1',
      'user-1'
    )
  })

  it('marks status as failed and returns when HELP_DOC is not found', async () => {
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(null) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'missing-doc'))

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'HELP_DOC',
      'missing-doc',
      'profile-1',
      expect.stringContaining('not found'),
      'user-1'
    )
  })

  it('marks status as failed and rethrows when embedding generation fails for HELP_DOC', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello.' }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const embeddingError = new Error('Embedding API unavailable')
    mockGenerateEmbeddingForUser.mockRejectedValue(embeddingError)

    await expect(handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))).rejects.toThrow(
      'Embedding API unavailable'
    )
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'HELP_DOC',
      'doc-1',
      'profile-1',
      'Embedding API unavailable',
      'user-1'
    )
    expect(repos.helpDocs.updateEmbedding).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// MOUNT_CHUNK tests
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — MOUNT_CHUNK entity type', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  it('generates and stores embedding for a found MOUNT_CHUNK', async () => {
    const chunk = {
      id: 'chunk-1',
      mountPointId: 'mp-1',
      content: 'Chapter content here.',
    }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))

    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      chunk.content,
      'user-1',
      'profile-1',
      { priority: 'background' }
    )
    expect(repos.docMountChunks.updateEmbedding).toHaveBeenCalledWith('chunk-1', fakeEmbedding)
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      'user-1'
    )
  })

  it('marks status as failed and returns when MOUNT_CHUNK is not found', async () => {
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(null) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'missing-chunk'))

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'missing-chunk',
      'profile-1',
      expect.stringContaining('not found'),
      'user-1'
    )
  })

  it('skips an empty/whitespace MOUNT_CHUNK without calling the provider or retrying', async () => {
    const chunk = { id: 'chunk-empty', mountPointId: 'mp-1', content: '   \n  \t ' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    // Empty input is deterministically unembeddable (and triggers NaN on some
    // models) — it must be marked failed and skipped, never sent to the
    // provider and never rethrown (which would retry to DEAD).
    await expect(
      handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-empty'))
    ).resolves.toBeUndefined()

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-empty',
      'profile-1',
      expect.stringContaining('Empty input'),
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })

  it('marks failed but does NOT rethrow on a deterministic (NaN) error for MOUNT_CHUNK', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'Some content.' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    // A NaN/over-context error will recur on every retry, so it must be marked
    // failed and dropped — not rethrown (which would retry it to DEAD).
    mockGenerateEmbeddingForUser.mockRejectedValue(
      new Error('Ollama embedding failed: failed to encode response: json: unsupported value: NaN')
    )

    await expect(
      handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))
    ).resolves.toBeUndefined()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      expect.stringContaining('NaN'),
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })

  it('marks status as failed and rethrows when embedding generation fails for MOUNT_CHUNK', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'Some content.' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const embeddingError = new Error('Provider timeout')
    mockGenerateEmbeddingForUser.mockRejectedValue(embeddingError)

    await expect(handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))).rejects.toThrow(
      'Provider timeout'
    )
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      'Provider timeout',
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Routing tests — ensure entity type dispatch works correctly
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — entity type routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  it('routes HELP_DOC to the help doc handler (uses helpDocs repository)', async () => {
    const doc = { id: 'doc-1', title: 'T', content: 'C' }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    expect(repos.helpDocs.findById).toHaveBeenCalledWith('doc-1')
    expect(repos.docMountChunks.findById).not.toHaveBeenCalled()
  })

  it('routes MOUNT_CHUNK to the mount chunk handler (uses docMountChunks repository)', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'C' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))

    expect(repos.docMountChunks.findById).toHaveBeenCalledWith('chunk-1')
    expect(repos.helpDocs.findById).not.toHaveBeenCalled()
  })

  it('throws for an unsupported entity type', async () => {
    const repos = makeRepos()
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await expect(handleEmbeddingGenerate(makeJob('UNSUPPORTED_TYPE', 'entity-1'))).rejects.toThrow(
      /unsupported entity type/i
    )
  })
})
