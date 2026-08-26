/**
 * The help-doc chunks repository — section-level slices of each help document,
 * and the corpus section-precise semantic search scores against.
 *
 * Two things here are load-bearing and easy to break silently. The blob-column
 * registration must be re-asserted on EVERY collection access, because it is
 * keyed to the backend rather than to this instance: a cached "already
 * registered" flag leaves a fresh backend without blob handling, and the write
 * path then persists an index-keyed JSON object (`{"0":...}`) where a BLOB
 * belongs — which is exactly how the "legacy JSON-text embeddings" were minted.
 * And `replaceForDoc` must delete before it inserts, because chunk boundaries
 * move when the prose above them changes; matching old rows to new ones by
 * index would keep embeddings that no longer describe their content.
 */

import { HelpDocChunksRepository } from '@/lib/database/repositories/help-doc-chunks.repository'
import { registerBlobColumns } from '@/lib/database/manager'
import type { HelpDocChunk } from '@/lib/schemas/help-doc-chunk.types'

jest.mock('@/lib/database/manager', () => ({
  registerBlobColumns: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/database/repositories/base.repository', () => {
  class AbstractBaseRepository {
    collectionName: string
    constructor(collectionName: string) {
      this.collectionName = collectionName
    }
    protected async getCollection() {
      return { name: this.collectionName }
    }
    // The real safeQuery swallows a thrown query and returns the fallback; the
    // fallback is the third or fourth argument depending on the overload.
    protected async safeQuery(fn: () => Promise<unknown>, _msg: string, _ctx?: unknown, fallback?: unknown) {
      try {
        return await fn()
      } catch {
        return fallback
      }
    }
    protected async _findAll(): Promise<unknown[]> { return [] }
    protected async findByFilter(): Promise<unknown[]> { return [] }
    protected async _create(data: unknown): Promise<unknown> { return data }
    protected async _update(): Promise<unknown> { return null }
    protected async _delete(): Promise<boolean> { return true }
    protected async deleteMany(): Promise<number> { return 0 }
    protected async updateMany(): Promise<number> { return 0 }
  }
  return { AbstractBaseRepository }
})

const mockRegisterBlobColumns = registerBlobColumns as jest.MockedFunction<typeof registerBlobColumns>

/** Reach the protected surface without `any` littered through every test. */
type Internals = {
  getCollection: () => Promise<unknown>
  findByFilter: jest.Mock
  _findAll: jest.Mock
  _create: jest.Mock
  _update: jest.Mock
  _delete: jest.Mock
  deleteMany: jest.Mock
  updateMany: jest.Mock
}

function makeRepo() {
  const repo = new HelpDocChunksRepository()
  const inner = repo as unknown as Internals
  inner.findByFilter = jest.fn().mockResolvedValue([])
  inner._findAll = jest.fn().mockResolvedValue([])
  inner._create = jest.fn().mockImplementation(async (data: unknown) => data)
  inner._update = jest.fn().mockResolvedValue(null)
  inner._delete = jest.fn().mockResolvedValue(true)
  inner.deleteMany = jest.fn().mockResolvedValue(0)
  inner.updateMany = jest.fn().mockResolvedValue(0)
  return { repo, inner }
}

function chunk(over: Partial<HelpDocChunk> & { id: string; docId: string; chunkIndex: number }): HelpDocChunk {
  return {
    heading: null,
    content: 'prose',
    embedding: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as HelpDocChunk
}

describe('HelpDocChunksRepository', () => {
  beforeEach(() => {
    mockRegisterBlobColumns.mockClear()
  })

  describe('blob-column registration', () => {
    it('registers the embedding column before handing back a collection', async () => {
      const { inner } = makeRepo()

      await inner.getCollection()

      expect(mockRegisterBlobColumns).toHaveBeenCalledWith('help_doc_chunks', ['embedding'])
    })

    it('re-asserts it on every access rather than remembering it on the instance', async () => {
      const { inner } = makeRepo()

      await inner.getCollection()
      await inner.getCollection()
      await inner.getCollection()

      // A cached flag here is how a fresh backend ends up writing JSON text
      // into a BLOB column.
      expect(mockRegisterBlobColumns).toHaveBeenCalledTimes(3)
    })
  })

  describe('findByDocId', () => {
    it('returns the document\'s chunks in document order, not storage order', async () => {
      const { repo, inner } = makeRepo()
      inner.findByFilter.mockResolvedValue([
        chunk({ id: 'c3', docId: 'doc-1', chunkIndex: 2 }),
        chunk({ id: 'c1', docId: 'doc-1', chunkIndex: 0 }),
        chunk({ id: 'c2', docId: 'doc-1', chunkIndex: 1 }),
      ])

      const result = await repo.findByDocId('doc-1')

      expect(result.map(c => c.chunkIndex)).toEqual([0, 1, 2])
      expect(inner.findByFilter).toHaveBeenCalledWith({ docId: 'doc-1' })
    })

    it('answers with an empty list rather than throwing when the query fails', async () => {
      const { repo, inner } = makeRepo()
      inner.findByFilter.mockRejectedValue(new Error('database is locked'))

      await expect(repo.findByDocId('doc-1')).resolves.toEqual([])
    })
  })

  describe('replaceForDoc', () => {
    it('deletes the old slices before writing the new ones', async () => {
      const { repo, inner } = makeRepo()
      const order: string[] = []
      inner.deleteMany.mockImplementation(async () => { order.push('delete'); return 2 })
      inner._create.mockImplementation(async (data: unknown) => { order.push('create'); return data })

      const written = await repo.replaceForDoc('doc-1', [
        { chunkIndex: 0, heading: 'Overview', content: 'first' },
        { chunkIndex: 1, heading: null, content: 'second' },
      ])

      expect(written).toBe(2)
      expect(order).toEqual(['delete', 'create', 'create'])
    })

    it('leaves every new chunk\'s embedding null for the embedding job to fill', async () => {
      const { repo, inner } = makeRepo()

      await repo.replaceForDoc('doc-1', [{ chunkIndex: 0, heading: null, content: 'first' }])

      expect(inner._create.mock.calls[0][0]).toEqual({
        docId: 'doc-1',
        chunkIndex: 0,
        heading: null,
        content: 'first',
        embedding: null,
      })
    })

    it('still clears the old slices when the new content has none', async () => {
      const { repo, inner } = makeRepo()

      await expect(repo.replaceForDoc('doc-1', [])).resolves.toBe(0)

      expect(inner.deleteMany).toHaveBeenCalledWith({ docId: 'doc-1' })
      expect(inner._create).not.toHaveBeenCalled()
    })
  })

  describe('findAllWithEmbeddings', () => {
    it('keeps only chunks that carry a usable vector', async () => {
      const { repo, inner } = makeRepo()
      inner._findAll.mockResolvedValue([
        chunk({ id: 'a', docId: 'd', chunkIndex: 0, embedding: new Float32Array([0.1, 0.2]) }),
        chunk({ id: 'b', docId: 'd', chunkIndex: 1, embedding: null }),
        chunk({ id: 'c', docId: 'd', chunkIndex: 2, embedding: new Float32Array([]) }),
      ])

      const result = await repo.findAllWithEmbeddings()

      expect(result.map(c => c.id)).toEqual(['a'])
    })
  })

  describe('deleteOrphaned', () => {
    it('removes only the chunks whose owning document is gone', async () => {
      const { repo, inner } = makeRepo()
      inner._findAll.mockResolvedValue([
        chunk({ id: 'keep-1', docId: 'live', chunkIndex: 0 }),
        chunk({ id: 'drop-1', docId: 'pruned', chunkIndex: 0 }),
        chunk({ id: 'drop-2', docId: 'pruned', chunkIndex: 1 }),
      ])

      const removed = await repo.deleteOrphaned(new Set(['live']))

      expect(removed).toBe(2)
      expect(inner._delete).toHaveBeenCalledTimes(2)
      expect(inner._delete).toHaveBeenCalledWith('drop-1')
      expect(inner._delete).toHaveBeenCalledWith('drop-2')
      expect(inner._delete).not.toHaveBeenCalledWith('keep-1')
    })

    it('removes nothing when every document is still live', async () => {
      const { repo, inner } = makeRepo()
      inner._findAll.mockResolvedValue([chunk({ id: 'keep-1', docId: 'live', chunkIndex: 0 })])

      await expect(repo.deleteOrphaned(new Set(['live']))).resolves.toBe(0)
      expect(inner._delete).not.toHaveBeenCalled()
    })
  })

  describe('clearAllEmbeddings', () => {
    it('nulls the column across every row without touching the chunk text', async () => {
      const { repo, inner } = makeRepo()
      inner.updateMany.mockResolvedValue(7)

      await expect(repo.clearAllEmbeddings()).resolves.toBe(7)
      expect(inner.updateMany).toHaveBeenCalledWith({}, { embedding: null })
    })

    it('reports zero rather than throwing when the sweep fails', async () => {
      const { repo, inner } = makeRepo()
      inner.updateMany.mockRejectedValue(new Error('database is locked'))

      await expect(repo.clearAllEmbeddings()).resolves.toBe(0)
    })
  })

  describe('updateEmbedding', () => {
    it('writes the vector straight through to the row', async () => {
      const { repo, inner } = makeRepo()
      const vector = new Float32Array([0.5, 0.25])

      await repo.updateEmbedding('chunk-1', vector)

      expect(inner._update).toHaveBeenCalledWith('chunk-1', { embedding: vector })
    })

    it('does not let a failed write escape into the sync loop', async () => {
      const { repo, inner } = makeRepo()
      inner._update.mockRejectedValue(new Error('database is locked'))

      await expect(repo.updateEmbedding('chunk-1', new Float32Array([0.5]))).resolves.toBeUndefined()
    })
  })
})
