/**
 * `searchMemoriesSemantic` — the `captureQueryEmbedding` hook.
 *
 * One turn embeds its query once. The memory search reports that vector back
 * so the per-turn conversation-summary list can be scored against the very
 * same numbers without a second provider call. Pinned here: the hook fires
 * with the query text and the embedded vector, it fires even when this
 * character's memory index has drifted to another dimensionality (the vault's
 * document index is built separately and may still match), and it never fires
 * for the extra retrospective probes.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] * b[i]
    return sum
  }),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
  getVectorStoreManager: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const embeddingMock = jest.requireMock('@/lib/embedding/embedding-service') as {
  generateEmbeddingForUser: jest.Mock
}
const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as {
  getCharacterVectorStore: jest.Mock
}

describe('searchMemoriesSemantic — captureQueryEmbedding', () => {
  let mockMemoriesRepo: {
    findByIds: jest.Mock
    searchByContent: jest.Mock
    updateAccessTimeBulk: jest.Mock
  }
  let mockVectorStore: { search: jest.Mock; getDimensions: jest.Mock }
  let searchMemoriesSemantic: typeof import('@/lib/memory/memory-service').searchMemoriesSemantic

  beforeEach(() => {
    jest.clearAllMocks()

    mockMemoriesRepo = {
      findByIds: jest.fn<any>().mockResolvedValue([]),
      searchByContent: jest.fn<any>().mockResolvedValue([]),
      updateAccessTimeBulk: jest.fn<any>().mockResolvedValue(undefined),
    }
    repositoriesMock.getRepositories.mockReturnValue({ memories: mockMemoriesRepo } as never)

    mockVectorStore = {
      search: jest.fn().mockReturnValue([]),
      getDimensions: jest.fn().mockReturnValue(3),
    }
    vectorStoreMock.getCharacterVectorStore.mockResolvedValue(mockVectorStore)

    embeddingMock.generateEmbeddingForUser.mockResolvedValue({
      embedding: new Float32Array([1, 0, 0]),
      model: 'test',
      dimensions: 3,
      provider: 'OPENAI',
    })

    jest.isolateModules(() => {
      const mod = require('@/lib/memory/memory-service')
      searchMemoriesSemantic = mod.searchMemoriesSemantic
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports the query text and the vector it embedded, exactly once', async () => {
    const captureQueryEmbedding = jest.fn()

    await searchMemoriesSemantic('char-1', 'the storm off Lighthouse Point', {
      userId: 'u1',
      limit: 5,
      captureQueryEmbedding,
    })

    expect(captureQueryEmbedding).toHaveBeenCalledTimes(1)
    const captured = captureQueryEmbedding.mock.calls[0][0] as {
      query: string
      embedding: Float32Array
    }
    expect(captured.query).toBe('the storm off Lighthouse Point')
    expect(Array.from(captured.embedding)).toEqual([1, 0, 0])
  })

  it('reports the vector even when the memory index has drifted to another dimensionality', async () => {
    // The character's vector store is 768-dim while the query came back 3-dim:
    // memory recall degrades to text search, but the vault's document index is
    // a separate corpus and the vector may still be usable there.
    mockVectorStore.getDimensions.mockReturnValue(768)
    const captureQueryEmbedding = jest.fn()

    await searchMemoriesSemantic('char-1', 'a drifted query', {
      userId: 'u1',
      limit: 5,
      captureQueryEmbedding,
    })

    expect(captureQueryEmbedding).toHaveBeenCalledTimes(1)
  })

  it('does not fire for the extra retrospective probes', async () => {
    const captureQueryEmbedding = jest.fn()

    await searchMemoriesSemantic('char-1', 'main query', {
      userId: 'u1',
      limit: 5,
      extraProbes: ['a second probe', 'a third probe'],
      captureQueryEmbedding,
    })

    expect(captureQueryEmbedding).toHaveBeenCalledTimes(1)
    expect(
      (captureQueryEmbedding.mock.calls[0][0] as { query: string }).query,
    ).toBe('main query')
  })
})
