/**
 * `searchVaultConversationSummaries` — the precomputed-embedding path.
 *
 * The per-turn conversation-summary cadence only pays for itself because it
 * reuses the vector the turn's memory search already embedded. These tests pin
 * that contract: given a vector, the search must not call the embedding
 * provider at all, and must score the vault chunks against exactly the vector
 * it was handed; given none, it embeds the query as it always did.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockGetCharacterVaultStore = jest.fn()
const mockGenerateEmbeddingForUser = jest.fn()
const mockSearchDocumentChunks = jest.fn()
const mockReadDatabaseDocument = jest.fn()

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: (...args: any[]) => mockGetCharacterVaultStore(...args),
}))

jest.mock('@/lib/file-storage/conversation-summary-vault-bridge', () => ({
  SUMMARIES_FOLDER: 'Conversation Summaries',
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: (...args: any[]) => mockGenerateEmbeddingForUser(...args),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: (...args: any[]) => mockSearchDocumentChunks(...args),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: (...args: any[]) => mockReadDatabaseDocument(...args),
}))

jest.mock('@/lib/doc-edit/markdown-parser', () => ({
  parseFrontmatter: (content: string) => ({
    data: JSON.parse(content),
    content: '',
  }),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

const {
  searchVaultConversationSummaries,
} = require('@/lib/memory/conversation-summary-search') as typeof import('@/lib/memory/conversation-summary-search')

const baseOptions = {
  characterId: 'char-1',
  query: 'the storm off Lighthouse Point',
  userId: 'user-1',
}

describe('searchVaultConversationSummaries — precomputed embedding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCharacterVaultStore.mockResolvedValue({ mountPointId: 'mp-vault' })
    mockSearchDocumentChunks.mockResolvedValue([
      { relativePath: 'Conversation Summaries/a.md', score: 0.82 },
    ])
    mockReadDatabaseDocument.mockResolvedValue({
      content: JSON.stringify({
        conversationId: '11111111-2222-3333-4444-555555555555',
        conversationTitle: 'The Storm',
      }),
    })
  })

  it('reuses the supplied vector and never calls the embedding provider', async () => {
    const precomputed = new Float32Array([0.1, 0.2, 0.3])

    const matches = await searchVaultConversationSummaries({
      ...baseOptions,
      precomputedEmbedding: precomputed,
    })

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(mockSearchDocumentChunks).toHaveBeenCalledTimes(1)
    expect(mockSearchDocumentChunks.mock.calls[0][0]).toBe(precomputed)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      conversationId: '11111111-2222-3333-4444-555555555555',
      conversationTitle: 'The Storm',
    })
  })

  it('still scopes the chunk search to the vault summaries folder', async () => {
    await searchVaultConversationSummaries({
      ...baseOptions,
      precomputedEmbedding: new Float32Array([1, 0, 0]),
    })

    expect(mockSearchDocumentChunks.mock.calls[0][1]).toMatchObject({
      mountPointIds: ['mp-vault'],
      pathPrefix: 'Conversation Summaries/',
      query: 'the storm off Lighthouse Point',
    })
  })

  it('embeds the query itself when no vector is supplied', async () => {
    mockGenerateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([0.5, 0.5]) })

    await searchVaultConversationSummaries({ ...baseOptions, embeddingProfileId: 'profile-7' })

    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      'the storm off Lighthouse Point',
      'user-1',
      'profile-7',
    )
  })
})
