/**
 * Help Doc Sync Unit Tests
 *
 * Covers the disk -> database sync for help documentation: what makes
 * ensureHelpDocsSynced() decide a sync is warranted, how changed/unchanged
 * docs are detected, pruning of rows whose Markdown file has been deleted,
 * and the embedding top-up for newly synced docs.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { join } from 'node:path'

jest.mock('@/lib/logger', () => {
  // `child` is needed because the chunker (reached through help-doc-chunking)
  // builds a service logger at module load.
  const base: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  base.child = jest.fn(() => base)
  return { __esModule: true, logger: base }
})

jest.mock('node:fs', () => ({
  __esModule: true,
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  __esModule: true,
  enqueueEmbeddingGenerate: jest.fn().mockResolvedValue({ jobId: 'job-1', isNew: true }),
}))

import { syncHelpDocs, ensureHelpDocsSynced } from '@/lib/help/help-doc-sync'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'

const mockedGetRepositories = getRepositories as jest.Mock
const mockedEnqueue = enqueueEmbeddingGenerate as jest.Mock
const mockedExistsSync = existsSync as jest.Mock
const mockedReaddirSync = readdirSync as jest.Mock
const mockedStatSync = statSync as jest.Mock
const mockedReadFileSync = readFileSync as jest.Mock

const HELP_DIR = join(process.cwd(), 'help')

/** Point the mocked fs at a flat help/ directory of `filename -> contents`. */
function givenHelpDirContains(files: Record<string, string>): void {
  mockedExistsSync.mockReturnValue(true)
  mockedReaddirSync.mockImplementation((dir: string) =>
    dir === HELP_DIR ? Object.keys(files) : []
  )
  mockedStatSync.mockReturnValue({ isDirectory: () => false })
  mockedReadFileSync.mockImplementation((path: string) => {
    const name = path.replace(`${HELP_DIR}/`, '')
    if (!(name in files)) throw new Error(`ENOENT: ${path}`)
    return files[name]
  })
}

function helpDocRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'existing-id',
    title: 'Aurora',
    path: 'help/aurora.md',
    url: '/aurora',
    content: '# Aurora',
    contentHash: 'stale-hash',
    embedding: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  }
}

describe('help-doc-sync', () => {
  let mockHelpDocs: Record<string, jest.Mock>
  let mockHelpDocChunks: Record<string, jest.Mock>
  let mockEmbeddingStatus: Record<string, jest.Mock>

  beforeEach(() => {
    jest.clearAllMocks()

    mockHelpDocs = {
      findAll: jest.fn().mockResolvedValue([]),
      findByPath: jest.fn().mockResolvedValue(null),
      upsertByPath: jest.fn().mockImplementation(async (path: string) => ({
        id: `id-for-${path}`,
        path,
      })),
      clearAllEmbeddingsForDoc: jest.fn().mockResolvedValue(undefined),
      findAllNeedingEmbedding: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(true),
    }
    mockHelpDocChunks = {
      replaceForDoc: jest.fn().mockResolvedValue(0),
      deleteByDocId: jest.fn().mockResolvedValue(0),
      count: jest.fn().mockResolvedValue(0),
    }
    mockEmbeddingStatus = {
      deleteByEntity: jest.fn().mockResolvedValue(1),
    }

    mockedGetRepositories.mockReturnValue({
      helpDocs: mockHelpDocs,
      helpDocChunks: mockHelpDocChunks,
      embeddingStatus: mockEmbeddingStatus,
      embeddingProfiles: {
        findAll: jest.fn().mockResolvedValue([{ id: 'profile-1', isDefault: true }]),
      },
      users: { findAll: jest.fn().mockResolvedValue([{ id: 'user-1' }]) },
    })
  })

  describe('syncHelpDocs', () => {
    it('creates docs that are on disk but not in the database', async () => {
      givenHelpDirContains({
        'answer-confirmation.md': '---\nurl: /salon\n---\n# Answer Confirmation\n\nBody.',
      })

      const result = await syncHelpDocs()

      expect(result.created).toBe(1)
      expect(result.totalOnDisk).toBe(1)
      expect(mockHelpDocs.upsertByPath).toHaveBeenCalledWith(
        'help/answer-confirmation.md',
        expect.objectContaining({ title: 'Answer Confirmation', url: '/salon' })
      )
    })

    it('skips docs whose content hash is unchanged', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])

      const result = await syncHelpDocs()

      expect(result.unchanged).toBe(1)
      expect(result.updated).toBe(0)
      expect(mockHelpDocs.upsertByPath).not.toHaveBeenCalled()
    })

    it('clears the embedding of a doc whose content changed', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora\n\nRewritten.' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: 'stale-hash' })])

      const result = await syncHelpDocs()

      expect(result.updated).toBe(1)
      expect(mockHelpDocs.clearAllEmbeddingsForDoc).toHaveBeenCalledWith('id-for-help/aurora.md')
    })

    it('prunes rows whose file has been deleted from disk', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(1)
      expect(mockHelpDocs.delete).toHaveBeenCalledWith('gone-id')
      expect(mockEmbeddingStatus.deleteByEntity).toHaveBeenCalledWith('HELP_DOC', 'gone-id')
    })

    it('writes section chunks for every doc it creates', async () => {
      givenHelpDirContains({
        'aurora.md': '---\nurl: /aurora\n---\n# Aurora\n\n## First section\n\nBody one.\n\n## Second section\n\nBody two.',
      })

      const result = await syncHelpDocs()

      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith(
        'id-for-help/aurora.md',
        expect.arrayContaining([
          expect.objectContaining({ chunkIndex: 0, content: expect.stringContaining('Body one.') }),
        ])
      )
      expect(result.chunksWritten).toBeGreaterThan(0)
    })

    it('does not re-slice a doc whose content hash is unchanged', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])

      const result = await syncHelpDocs()

      expect(mockHelpDocChunks.replaceForDoc).not.toHaveBeenCalled()
      expect(result.chunksWritten).toBe(0)
    })

    it('removes a pruned doc\'s chunks along with the doc', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      await syncHelpDocs()

      expect(mockHelpDocChunks.deleteByDocId).toHaveBeenCalledWith('gone-id')
    })

    it('never prunes when the help directory is missing', async () => {
      mockedExistsSync.mockReturnValue(false)
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
    })

    it('never prunes when the help directory yields no readable files', async () => {
      givenHelpDirContains({})
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
    })

    it('never wipes the table when the only file on disk is whitespace-only (Bug 18)', async () => {
      // files.length is 1 here, so the empty-directory guard does not fire; the
      // file trims to nothing, produces no usable content, and the prune would
      // delete every populated row (measured: totalOnDisk 1, deleted 3, rows
      // left 0). An all-blank help set against a populated table is suspicious,
      // not an instruction to wipe.
      givenHelpDirContains({ 'aurora.md': '   \n\t\n  ' })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'a', path: 'help/aurora.md' }),
        helpDocRow({ id: 'b', path: 'help/brahma-console.md' }),
        helpDocRow({ id: 'c', path: 'help/carina.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.totalOnDisk).toBe(1)
      expect(result.deleted).toBe(0)
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
      expect(mockEmbeddingStatus.deleteByEntity).not.toHaveBeenCalled()
    })

    it('still prunes stale rows when at least one file has usable content', async () => {
      // The guard only trips when NOTHING parses; a real doc alongside a blank
      // one must still reconcile the genuinely-gone row.
      givenHelpDirContains({
        'aurora.md': '# Aurora\n\nReal content.',
        'blank.md': '   \n  ',
      })
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ id: 'keep', path: 'help/aurora.md' }),
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      const result = await syncHelpDocs()

      expect(result.deleted).toBe(1)
      expect(mockHelpDocs.delete).toHaveBeenCalledWith('gone-id')
      expect(mockHelpDocs.delete).not.toHaveBeenCalledWith('keep')
    })
  })

  describe('ensureHelpDocsSynced', () => {
    it('syncs a doc added after the initial sync, with a populated table', async () => {
      givenHelpDirContains({
        'aurora.md': '# Aurora',
        'brahma-console.md': '# Brahma Console',
      })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])

      await ensureHelpDocsSynced()

      expect(mockHelpDocs.upsertByPath).toHaveBeenCalledWith(
        'help/brahma-console.md',
        expect.objectContaining({ title: 'Brahma Console' })
      )
    })

    it('backfills sections for an instance whose docs are already synced', async () => {
      // The upgrade case: every content hash matches, so syncHelpDocs would
      // skip every file and the chunk table would stay empty forever.
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: hash, content: '# Aurora\n\nBody.' }),
      ])

      await ensureHelpDocsSynced()

      expect(mockHelpDocChunks.replaceForDoc).toHaveBeenCalledWith(
        'existing-id',
        expect.arrayContaining([expect.objectContaining({ chunkIndex: 0 })])
      )
      // The doc's own embedding is present, so only the chunk backfill can
      // enqueue the job that fills the section vectors.
      expect(mockedEnqueue).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ entityType: 'HELP_DOC', entityId: 'existing-id' })
      )
    })

    it('does not backfill when sections already exist', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])
      mockHelpDocChunks.count.mockResolvedValue(42)

      await ensureHelpDocsSynced()

      expect(mockHelpDocChunks.replaceForDoc).not.toHaveBeenCalled()
    })

    it('still loads help when the section backfill throws', async () => {
      const content = '# Aurora\n\nBody.'
      givenHelpDirContains({ 'aurora.md': content })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update(content).digest('hex')
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow({ contentHash: hash })])
      mockHelpDocChunks.count.mockRejectedValue(new Error('no such table'))

      await expect(ensureHelpDocsSynced()).resolves.toBeUndefined()
    })

    it('syncs when a row has no file on disk, so the prune is reachable', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      const { createHash } = await import('node:crypto')
      const hash = createHash('sha256').update('# Aurora').digest('hex')
      // Every file on disk already has a row, so only the deleted direction
      // can trigger this sync.
      mockHelpDocs.findAll.mockResolvedValue([
        helpDocRow({ contentHash: hash }),
        helpDocRow({ id: 'gone-id', path: 'help/retired.md' }),
      ])

      await ensureHelpDocsSynced()

      expect(mockHelpDocs.delete).toHaveBeenCalledWith('gone-id')
    })

    it('does not sync when disk and database agree', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAll.mockResolvedValue([helpDocRow()])
      // Sections already present too, so there is genuinely nothing to do —
      // an empty chunk table is its own reason to act (see the backfill tests).
      mockHelpDocChunks.count.mockResolvedValue(12)

      await ensureHelpDocsSynced()

      expect(mockHelpDocs.upsertByPath).not.toHaveBeenCalled()
      expect(mockHelpDocs.delete).not.toHaveBeenCalled()
      expect(mockedEnqueue).not.toHaveBeenCalled()
    })

    it('syncs when the table is empty', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })

      await ensureHelpDocsSynced()

      expect(mockHelpDocs.upsertByPath).toHaveBeenCalledWith(
        'help/aurora.md',
        expect.objectContaining({ title: 'Aurora' })
      )
    })

    it('enqueues embedding jobs for docs that have no embedding', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAllNeedingEmbedding.mockResolvedValue([{ id: 'doc-needs-embedding' }])

      await ensureHelpDocsSynced()

      expect(mockedEnqueue).toHaveBeenCalledWith('user-1', {
        entityType: 'HELP_DOC',
        entityId: 'doc-needs-embedding',
        profileId: 'profile-1',
      })
    })

    it('still completes when no embedding profile is configured', async () => {
      givenHelpDirContains({ 'aurora.md': '# Aurora' })
      mockHelpDocs.findAllNeedingEmbedding.mockResolvedValue([{ id: 'doc-needs-embedding' }])
      mockedGetRepositories().embeddingProfiles.findAll.mockResolvedValue([])

      await expect(ensureHelpDocsSynced()).resolves.toBeUndefined()
      expect(mockedEnqueue).not.toHaveBeenCalled()
    })
  })
})
