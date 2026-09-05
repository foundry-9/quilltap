/**
 * Hybrid recall in searchMemoriesSemantic
 *
 * Pins the contract added when the unified `search` tool got the
 * literal-phrase boost: when applyLiteralPhraseBoost is on,
 *  1. all memories whose content/summary contain the trimmed query
 *     verbatim (case-insensitive, ≥ 8 chars) are unioned into the
 *     vector-store top-K candidate pool — explicitly scored against the
 *     query embedding when not already there;
 *  2. items with literal hits get their cosine score lifted halfway to
 *     1.0 BEFORE the importance/recency blend;
 *  3. per-turn injectors (which leave the flag off) see no change.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EmbeddingError'
    }
  },
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
    // The real logger exposes `child`; modules that build a scoped logger at
    // import time (the realtime bus, reached through the activity registry)
    // need it present on the mock too.
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
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

const baseTime = '2026-04-01T00:00:00.000Z'

function makeMemory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mem-x',
    characterId: 'char-1',
    content: 'Body text',
    summary: 'Summary text',
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    aboutCharacterId: null,
    chatId: null,
    source: 'AUTO' as const,
    sourceMessageId: null,
    reinforcementCount: 1,
    relatedMemoryIds: [],
    embedding: new Float32Array([1, 0, 0]),
    lastAccessedAt: null,
    lastReinforcedAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  }
}

describe('searchMemoriesSemantic — hybrid recall', () => {
  let mockMemoriesRepo: {
    findByIds: jest.Mock
    searchByContent: jest.Mock
    updateAccessTimeBulk: jest.Mock
  }
  let mockVectorStore: {
    search: jest.Mock
    getDimensions: jest.Mock
  }
  let searchMemoriesSemantic: typeof import('@/lib/memory/memory-service').searchMemoriesSemantic

  beforeEach(() => {
    jest.clearAllMocks()

    mockMemoriesRepo = {
      findByIds: jest.fn(),
      searchByContent: jest.fn(),
      updateAccessTimeBulk: jest.fn().mockResolvedValue(undefined),
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: mockMemoriesRepo,
    } as never)

    mockVectorStore = {
      search: jest.fn(),
      getDimensions: jest.fn().mockReturnValue(3),
    }
    vectorStoreMock.getCharacterVectorStore.mockResolvedValue(mockVectorStore)

    embeddingMock.generateEmbeddingForUser.mockResolvedValue({
      embedding: new Float32Array([1, 0, 0]),
      model: 'test',
    })

    jest.isolateModules(() => {
      const mod = require('@/lib/memory/memory-service')
      searchMemoriesSemantic = mod.searchMemoriesSemantic
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('unions a direct hit that was outside the vector-store top-K and applies the boost', async () => {
    // Top-K pool: a strong vector neighbour with no literal hit (cosine 0.5).
    const vectorOnly = makeMemory({
      id: 'vec-only',
      content: 'Unrelated content about libraries.',
      summary: 'Libraries in general',
      embedding: new Float32Array([0.5, 0, 0]),
    })
    // Direct hit: low cosine (0.1), excluded from top-K, but its content
    // contains the verbatim query "covenant wall".
    const directHit = makeMemory({
      id: 'direct-hit',
      content: 'Friday described the covenant wall pattern.',
      summary: 'Covenant wall pattern',
      embedding: new Float32Array([0.1, 0, 0]),
    })

    mockVectorStore.search.mockReturnValue([
      { id: 'vec-only', score: 0.5, metadata: { memoryId: 'vec-only', characterId: 'char-1' } },
    ])
    mockMemoriesRepo.searchByContent.mockResolvedValue([directHit])
    mockMemoriesRepo.findByIds.mockResolvedValue([vectorOnly, directHit])

    const results = await searchMemoriesSemantic('char-1', 'covenant wall', {
      userId: 'u1',
      applyLiteralPhraseBoost: true,
      limit: 10,
    })

    // Both should be present.
    expect(results).toHaveLength(2)
    const ids = results.map(r => r.memory.id)
    expect(ids).toContain('vec-only')
    expect(ids).toContain('direct-hit')

    // Direct hit's cosine boosted from 0.1 → 0.55 (= 0.1 + 0.9/2).
    const direct = results.find(r => r.memory.id === 'direct-hit')!
    expect(direct.score).toBeCloseTo(0.55, 5)

    // Vector-only stays at raw cosine 0.5 (no literal hit).
    const vec = results.find(r => r.memory.id === 'vec-only')!
    expect(vec.score).toBeCloseTo(0.5, 5)

    // searchByContent was called with the trimmed query.
    expect(mockMemoriesRepo.searchByContent).toHaveBeenCalledWith('char-1', 'covenant wall')
  })

  it('boosts a memory already in the top-K when its body contains the literal phrase', async () => {
    const inPool = makeMemory({
      id: 'in-pool',
      content: 'Conversation included covenant wall language explicitly.',
      summary: 'Covenant wall language',
      embedding: new Float32Array([0.4, 0, 0]),
    })

    mockVectorStore.search.mockReturnValue([
      { id: 'in-pool', score: 0.4, metadata: { memoryId: 'in-pool', characterId: 'char-1' } },
    ])
    // searchByContent also returns this same memory — confirms the union
    // logic doesn't double-add and the boost still applies.
    mockMemoriesRepo.searchByContent.mockResolvedValue([inPool])
    mockMemoriesRepo.findByIds.mockResolvedValue([inPool])

    const results = await searchMemoriesSemantic('char-1', 'covenant wall', {
      userId: 'u1',
      applyLiteralPhraseBoost: true,
      limit: 10,
    })

    expect(results).toHaveLength(1)
    // 0.4 → 0.7 (= 0.4 + 0.6/2).
    expect(results[0].score).toBeCloseTo(0.7, 5)
  })

  it('does NOT call searchByContent when applyLiteralPhraseBoost is off (per-turn injector contract)', async () => {
    const memory = makeMemory({
      id: 'm-1',
      content: 'covenant wall mentioned',
      summary: 'cw',
      embedding: new Float32Array([0.5, 0, 0]),
    })
    mockVectorStore.search.mockReturnValue([
      { id: 'm-1', score: 0.5, metadata: { memoryId: 'm-1', characterId: 'char-1' } },
    ])
    mockMemoriesRepo.findByIds.mockResolvedValue([memory])

    await searchMemoriesSemantic('char-1', 'covenant wall', {
      userId: 'u1',
      // applyLiteralPhraseBoost intentionally omitted — per-turn injectors
      // pass through the natural-language query without the literal step.
      limit: 10,
    })

    expect(mockMemoriesRepo.searchByContent).not.toHaveBeenCalled()
  })

  it('skips the literal step when the trimmed query is below 8 characters', async () => {
    const memory = makeMemory({
      id: 'm-1',
      content: 'mentions cat',
      summary: 'cat note',
      embedding: new Float32Array([0.5, 0, 0]),
    })
    mockVectorStore.search.mockReturnValue([
      { id: 'm-1', score: 0.5, metadata: { memoryId: 'm-1', characterId: 'char-1' } },
    ])
    mockMemoriesRepo.findByIds.mockResolvedValue([memory])

    await searchMemoriesSemantic('char-1', 'cat', {
      userId: 'u1',
      applyLiteralPhraseBoost: true,
      limit: 10,
    })

    // Query too short — searchByContent must not run.
    expect(mockMemoriesRepo.searchByContent).not.toHaveBeenCalled()
  })

  it('drops a direct hit whose embedding dimension does not match the query', async () => {
    // A non-empty top-K so we don't fall through to the text-search fallback;
    // the stale direct hit (4 dims vs 3-dim query) must be silently dropped
    // because feeding mismatched embeddings to cosineSimilarity is unsafe.
    const inPool = makeMemory({
      id: 'in-pool',
      content: 'Unrelated body.',
      summary: 'Unrelated',
      embedding: new Float32Array([0.5, 0, 0]),
    })
    const stale = makeMemory({
      id: 'stale',
      content: 'covenant wall present here too',
      summary: 'cw stale',
      embedding: new Float32Array([0.9, 0, 0, 0]),
    })

    mockVectorStore.search.mockReturnValue([
      { id: 'in-pool', score: 0.5, metadata: { memoryId: 'in-pool', characterId: 'char-1' } },
    ])
    mockMemoriesRepo.searchByContent.mockResolvedValue([stale])
    mockMemoriesRepo.findByIds.mockResolvedValue([inPool])

    const results = await searchMemoriesSemantic('char-1', 'covenant wall', {
      userId: 'u1',
      applyLiteralPhraseBoost: true,
      limit: 10,
    })

    // Only the dimension-matched in-pool memory survives. Stale direct hit
    // is silently dropped — no boost can be applied without a valid score.
    expect(results).toHaveLength(1)
    expect(results[0].memory.id).toBe('in-pool')
  })
})
