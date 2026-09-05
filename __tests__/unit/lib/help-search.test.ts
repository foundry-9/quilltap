/**
 * Help Search Unit Tests
 *
 * Tests for the DB-backed HelpSearch class that loads help documents
 * from the database and searches them using cosine similarity.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  __esModule: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Mock the help-doc-sync module (not covered by jest.setup.ts)
jest.mock('@/lib/help/help-doc-sync', () => ({
  ensureHelpDocsSynced: jest.fn().mockResolvedValue(undefined),
}))

// Mock cosine similarity with a simple dot product
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
    return dot
  }),
}))

import { HelpSearch, getHelpSearch, resetHelpSearch } from '@/lib/help-search'
import { ensureHelpDocsSynced } from '@/lib/help/help-doc-sync'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

// Cast to jest.Mock for the mocked functions (these are created by global jest in jest.setup.ts / jest.mock)
const mockedEnsureHelpDocsSynced = ensureHelpDocsSynced as jest.Mock
const mockedGetRepositories = getRepositories as jest.Mock
const mockedLogger = logger as jest.Mocked<typeof logger>

const mockHelpDocs = [
  { id: 'doc-0', title: 'Document 0', path: 'help/doc-0.md', url: '/test/doc-0', content: 'Content 0', contentHash: 'hash0', embedding: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  { id: 'doc-1', title: 'Document 1', path: 'help/doc-1.md', url: '/test/doc-1', content: 'Content 1', contentHash: 'hash1', embedding: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  { id: 'doc-2', title: 'Document 2', path: 'help/doc-2.md', url: '/test/doc-2', content: 'Content 2', contentHash: 'hash2', embedding: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
]

const mockEmbeddedDocs = [
  { ...mockHelpDocs[0], embedding: [1, 0, 0, 0] },
  { ...mockHelpDocs[1], embedding: [0, 1, 0, 0] },
  { ...mockHelpDocs[2], embedding: [0, 0, 1, 0] },
]

describe('HelpSearch', () => {
  let helpSearch: HelpSearch
  let mockFindAll: jest.Mock
  let mockFindAllWithEmbeddings: jest.Mock
  let mockChunksWithEmbeddings: jest.Mock

  beforeEach(() => {
    helpSearch = new HelpSearch()

    // Create fresh mock functions for each test
    mockFindAll = jest.fn().mockResolvedValue(mockHelpDocs)
    mockFindAllWithEmbeddings = jest.fn().mockResolvedValue(mockEmbeddedDocs)
    mockChunksWithEmbeddings = jest.fn().mockResolvedValue([])

    // Configure getRepositories to return our fresh mocks
    mockedGetRepositories.mockReturnValue({
      helpDocs: {
        findAll: mockFindAll,
        findAllWithEmbeddings: mockFindAllWithEmbeddings,
      },
      helpDocChunks: {
        findAllWithEmbeddings: mockChunksWithEmbeddings,
      },
    })

    mockedEnsureHelpDocsSynced.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetHelpSearch()
    jest.clearAllMocks()
  })

  describe('loadFromDatabase', () => {
    it('should load documents from the database', async () => {
      await helpSearch.loadFromDatabase()

      expect(mockedEnsureHelpDocsSynced).toHaveBeenCalled()
      expect(mockFindAll).toHaveBeenCalled()
      expect(helpSearch.isLoaded()).toBe(true)
    })

    it('should store the correct number of documents', async () => {
      await helpSearch.loadFromDatabase()

      const docs = await helpSearch.getAllDocuments()
      expect(docs.length).toBe(3)
    })

    it('should deduplicate concurrent loadFromDatabase calls', async () => {
      const p1 = helpSearch.loadFromDatabase()
      const p2 = helpSearch.loadFromDatabase()

      await Promise.all([p1, p2])

      // ensureHelpDocsSynced and findAll should only be called once
      expect(mockedEnsureHelpDocsSynced).toHaveBeenCalledTimes(1)
      expect(mockFindAll).toHaveBeenCalledTimes(1)
    })
  })

  describe('isLoaded', () => {
    it('should return false before loading', () => {
      expect(helpSearch.isLoaded()).toBe(false)
    })

    it('should return true after loading', async () => {
      await helpSearch.loadFromDatabase()
      expect(helpSearch.isLoaded()).toBe(true)
    })
  })

  describe('search', () => {
    it('should return results from embedded docs with cosine similarity scoring', async () => {
      const results = await helpSearch.search([1, 0, 0, 0])

      expect(results.length).toBe(3)
      expect(results[0].document.id).toBe('doc-0')
      expect(results[0].score).toBe(1) // Perfect match via dot product
    })

    it('should return results sorted by score descending', async () => {
      const results = await helpSearch.search([0.5, 0.5, 0, 0])

      expect(results.length).toBe(3)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
      }
    })

    it('should respect the limit parameter', async () => {
      const results = await helpSearch.search([1, 0, 0, 0], 2)
      expect(results.length).toBe(2)
    })

    it('should handle empty results when no embedded docs exist', async () => {
      mockFindAllWithEmbeddings.mockResolvedValue([])

      const results = await helpSearch.search([1, 0, 0, 0])
      expect(results).toEqual([])
    })

    it('should skip docs with dimension mismatch', async () => {
      // Docs have 4-dimensional embeddings, query has 2 dimensions
      const results = await helpSearch.search([1, 0])

      expect(results).toEqual([])
    })

    it('should skip docs with null or empty embeddings', async () => {
      mockFindAllWithEmbeddings.mockResolvedValue([
        { ...mockHelpDocs[0], embedding: null },
        { ...mockHelpDocs[1], embedding: [] },
        { ...mockHelpDocs[2], embedding: [0, 0, 1, 0] },
      ])

      const results = await helpSearch.search([0, 0, 1, 0])
      expect(results.length).toBe(1)
      expect(results[0].document.id).toBe('doc-2')
    })

    describe('section-level scoring', () => {
      it('lifts a doc whose section matches, even when the whole-doc vector is a poor match', async () => {
        // doc-1's whole-document vector is orthogonal to the query (score 0),
        // but one of its sections points straight at it. That is the case this
        // exists for: a long page whose single vector smears across topics.
        // The query points along the fourth axis, which no document's own
        // vector touches — every whole-doc score is 0. Only doc-1's section
        // knows the answer.
        mockChunksWithEmbeddings.mockResolvedValue([
          {
            id: 'chunk-a', docId: 'doc-1', chunkIndex: 3,
            heading: 'Image Description Settings',
            content: 'Describing images for models that cannot see.',
            embedding: [0, 0, 0, 1],
          },
        ])

        const results = await helpSearch.search([0, 0, 0, 1])

        expect(results[0].document.id).toBe('doc-1')
        expect(results[0].score).toBe(1)
        expect(results[0].matchedSection).toEqual({
          heading: 'Image Description Settings',
          content: 'Describing images for models that cannot see.',
          chunkIndex: 3,
        })
      })

      it('keeps the best of several sections in one doc', async () => {
        mockChunksWithEmbeddings.mockResolvedValue([
          { id: 'c1', docId: 'doc-1', chunkIndex: 0, heading: 'Weak', content: 'weak', embedding: [0.2, 0, 0, 0] },
          { id: 'c2', docId: 'doc-1', chunkIndex: 1, heading: 'Strong', content: 'strong', embedding: [0.9, 0, 0, 0] },
        ])

        const results = await helpSearch.search([1, 0, 0, 0])
        const doc1 = results.find(r => r.document.id === 'doc-1')

        expect(doc1?.score).toBeCloseTo(0.9, 5)
        expect(doc1?.matchedSection?.heading).toBe('Strong')
      })

      it('keeps the whole-document score when it beats every section', async () => {
        mockChunksWithEmbeddings.mockResolvedValue([
          { id: 'c1', docId: 'doc-0', chunkIndex: 0, heading: null, content: 'weak', embedding: [0.1, 0, 0, 0] },
        ])

        const results = await helpSearch.search([1, 0, 0, 0])
        const doc0 = results.find(r => r.document.id === 'doc-0')

        // doc-0's own vector is a perfect match; the feeble section must not drag it down.
        expect(doc0?.score).toBe(1)
        expect(doc0?.matchedSection).toBeUndefined()
      })

      it('still ranks docs that have no sections embedded yet', async () => {
        mockChunksWithEmbeddings.mockResolvedValue([])

        const results = await helpSearch.search([1, 0, 0, 0])

        expect(results.length).toBe(3)
        expect(results[0].document.id).toBe('doc-0')
        expect(results[0].matchedSection).toBeUndefined()
      })

      it('skips sections whose embedding dimension does not match the query', async () => {
        mockChunksWithEmbeddings.mockResolvedValue([
          { id: 'c1', docId: 'doc-1', chunkIndex: 0, heading: 'Stale', content: 'old profile', embedding: [1, 0] },
        ])

        const results = await helpSearch.search([1, 0, 0, 0])
        const doc1 = results.find(r => r.document.id === 'doc-1')

        expect(doc1?.matchedSection).toBeUndefined()
        expect(doc1?.score).toBe(0)
      })

      it('falls back to whole-document scores when the chunk lookup fails', async () => {
        mockChunksWithEmbeddings.mockRejectedValue(new Error('table missing'))

        const results = await helpSearch.search([1, 0, 0, 0])

        expect(results.length).toBe(3)
        expect(results[0].document.id).toBe('doc-0')
        expect(mockedLogger.warn).toHaveBeenCalled()
      })
    })

    describe('literal-phrase boost', () => {
      it('boosts a doc whose title contains the trimmed query verbatim', async () => {
        // Two docs, both at 0.5 cosine, but only doc-0 has the literal title hit.
        mockFindAllWithEmbeddings.mockResolvedValue([
          {
            ...mockHelpDocs[0],
            title: 'The Sunlit Archives',
            content: 'Boring body.',
            embedding: [0.5, 0.5, 0, 0],
          },
          {
            ...mockHelpDocs[1],
            title: 'Unrelated guide',
            content: 'More boring body.',
            embedding: [0.5, 0.5, 0, 0],
          },
        ])

        const results = await helpSearch.search([1, 0, 0, 0], 5, 'sunlit archives')

        expect(results.length).toBe(2)
        expect(results[0].document.id).toBe('doc-0')
        // Cosine 0.5 + (1-0.5)/2 = 0.75 for the literal hit.
        expect(results[0].score).toBeCloseTo(0.75, 5)
        // Other doc keeps raw cosine 0.5.
        expect(results[1].score).toBeCloseTo(0.5, 5)
      })

      it('skips the boost when the trimmed query is below 8 characters', async () => {
        mockFindAllWithEmbeddings.mockResolvedValue([
          {
            ...mockHelpDocs[0],
            title: 'About cats',
            content: 'cat cat cat',
            embedding: [0.5, 0, 0, 0],
          },
        ])

        const results = await helpSearch.search([1, 0, 0, 0], 5, 'cat')
        expect(results.length).toBe(1)
        // Phrase too short to qualify; no boost applied.
        expect(results[0].score).toBeCloseTo(0.5, 5)
      })

      it('does not boost when no query is supplied', async () => {
        mockFindAllWithEmbeddings.mockResolvedValue([
          {
            ...mockHelpDocs[0],
            title: 'The Sunlit Archives',
            content: 'A note about the sunlit archives.',
            embedding: [0.5, 0, 0, 0],
          },
        ])

        const results = await helpSearch.search([1, 0, 0, 0]) // no query arg
        expect(results.length).toBe(1)
        expect(results[0].score).toBeCloseTo(0.5, 5)
      })
    })
  })

  describe('getDocument', () => {
    it('should return null before loading', () => {
      // isLoaded is false before any load call
      expect(helpSearch.isLoaded()).toBe(false)
    })

    it('should return the correct document after loading', async () => {
      await helpSearch.loadFromDatabase()

      const doc = await helpSearch.getDocument('doc-1')
      expect(doc).not.toBeNull()
      expect(doc?.id).toBe('doc-1')
      expect(doc?.title).toBe('Document 1')
      expect(doc?.path).toBe('help/doc-1.md')
      expect(doc?.url).toBe('/test/doc-1')
      expect(doc?.content).toBe('Content 1')
    })

    it('should return null for non-existent ID', async () => {
      await helpSearch.loadFromDatabase()

      const doc = await helpSearch.getDocument('non-existent')
      expect(doc).toBeNull()
    })

    it('should auto-load from database when not yet loaded', async () => {
      // getDocument calls ensureLoaded which triggers loadFromDatabase
      const doc = await helpSearch.getDocument('doc-0')
      expect(mockedEnsureHelpDocsSynced).toHaveBeenCalled()
      expect(mockFindAll).toHaveBeenCalled()
      expect(doc?.id).toBe('doc-0')
    })
  })

  describe('getAllDocuments', () => {
    it('should return empty array before loading when DB is empty', async () => {
      mockFindAll.mockResolvedValue([])

      const docs = await helpSearch.getAllDocuments()
      expect(docs).toEqual([])
    })

    it('should return all documents after loading', async () => {
      await helpSearch.loadFromDatabase()

      const docs = await helpSearch.getAllDocuments()
      expect(docs.length).toBe(3)

      for (const doc of docs) {
        expect(doc).toHaveProperty('id')
        expect(doc).toHaveProperty('title')
        expect(doc).toHaveProperty('path')
        expect(doc).toHaveProperty('url')
        expect(doc).toHaveProperty('content')
      }
    })

    it('should not include embedding data in returned documents', async () => {
      await helpSearch.loadFromDatabase()

      const docs = await helpSearch.getAllDocuments()
      for (const doc of docs) {
        expect(doc).not.toHaveProperty('embedding')
        expect(doc).not.toHaveProperty('contentHash')
        expect(doc).not.toHaveProperty('createdAt')
        expect(doc).not.toHaveProperty('updatedAt')
      }
    })
  })

  describe('listDocuments', () => {
    it('should return empty array before loading when DB is empty', async () => {
      mockFindAll.mockResolvedValue([])

      const list = await helpSearch.listDocuments()
      expect(list).toEqual([])
    })

    it('should return document listing after loading', async () => {
      await helpSearch.loadFromDatabase()

      const list = await helpSearch.listDocuments()
      expect(list.length).toBe(3)

      for (const item of list) {
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('title')
        expect(item).toHaveProperty('path')
        expect(item).toHaveProperty('url')
        expect(item).not.toHaveProperty('content')
        expect(item).not.toHaveProperty('embedding')
      }
    })
  })

  describe('invalidate', () => {
    it('should reset loaded state', async () => {
      await helpSearch.loadFromDatabase()
      expect(helpSearch.isLoaded()).toBe(true)

      helpSearch.invalidate()
      expect(helpSearch.isLoaded()).toBe(false)
    })

    it('should cause next access to reload from database', async () => {
      await helpSearch.loadFromDatabase()
      expect(mockFindAll).toHaveBeenCalledTimes(1)

      helpSearch.invalidate()

      await helpSearch.getAllDocuments()
      expect(mockFindAll).toHaveBeenCalledTimes(2)
    })
  })
})

describe('Singleton', () => {
  afterEach(() => {
    resetHelpSearch()
  })

  it('should return the same instance', () => {
    const instance1 = getHelpSearch()
    const instance2 = getHelpSearch()
    expect(instance1).toBe(instance2)
  })

  it('should return a new instance after reset', () => {
    const instance1 = getHelpSearch()
    resetHelpSearch()
    const instance2 = getHelpSearch()
    expect(instance1).not.toBe(instance2)
  })
})
