/**
 * Unit tests for lib/mount-index/embedding-scheduler.ts
 *
 * Tests that enqueueEmbeddingJobsForMountPoint correctly identifies
 * un-embedded chunks and enqueues jobs for them.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingGenerate: jest.fn(),
}))

import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockEnqueueEmbeddingGenerate = enqueueEmbeddingGenerate as jest.MockedFunction<typeof enqueueEmbeddingGenerate>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(id: string, hasEmbedding: boolean, linkId = 'link-1') {
  return {
    id,
    mountPointId: 'mp-1',
    fileId: 'file-1',
    linkId,
    chunkIndex: 0,
    content: 'Some content.',
    embedding: hasEmbedding ? [0.1, 0.2, 0.3] : null,
  }
}

/** A link row with just the fields the scheduler reads. */
function makeLink(id: string, allowEmbed: boolean) {
  return { id, allowEmbed }
}

function makeRepos(
  chunks: ReturnType<typeof makeChunk>[],
  profiles: { id: string; name: string; isDefault: boolean }[] = [
    { id: 'profile-1', name: 'Default', isDefault: true },
  ],
  users: { id: string }[] = [{ id: 'user-1' }],
  links: ReturnType<typeof makeLink>[] = []
) {
  return {
    docMountChunks: {
      findByMountPointId: jest.fn().mockResolvedValue(chunks),
      clearEmbeddingsByLinkId: jest.fn().mockResolvedValue(0),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue(links),
    },
    embeddingProfiles: {
      findAll: jest.fn().mockResolvedValue(profiles),
    },
    users: {
      findAll: jest.fn().mockResolvedValue(users),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueueEmbeddingJobsForMountPoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueueEmbeddingGenerate.mockResolvedValue({ isNew: true })
  })

  it('returns 0 when all chunks already have embeddings', async () => {
    const repos = makeRepos([makeChunk('chunk-1', true), makeChunk('chunk-2', true)])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('returns 0 when there are no chunks at all', async () => {
    const repos = makeRepos([])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('returns 0 and skips enqueueing when no embedding profile exists', async () => {
    const repos = makeRepos([makeChunk('chunk-1', false)], [])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('returns 0 and skips enqueueing when no user exists', async () => {
    const repos = makeRepos(
      [makeChunk('chunk-1', false)],
      [{ id: 'profile-1', name: 'Default', isDefault: true }],
      []
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('enqueues jobs for each un-embedded chunk', async () => {
    const repos = makeRepos([
      makeChunk('chunk-1', false),
      makeChunk('chunk-2', false),
      makeChunk('chunk-3', false),
    ])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(3)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(3)
  })

  it('only enqueues jobs for un-embedded chunks, skipping already-embedded ones', async () => {
    const repos = makeRepos([
      makeChunk('chunk-1', true),   // already embedded
      makeChunk('chunk-2', false),  // needs embedding
      makeChunk('chunk-3', true),   // already embedded
      makeChunk('chunk-4', false),  // needs embedding
    ])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(2)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2)
  })

  it('passes the correct payload to enqueueEmbeddingGenerate', async () => {
    const repos = makeRepos([makeChunk('chunk-abc', false)])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        entityType: 'MOUNT_CHUNK',
        entityId: 'chunk-abc',
        profileId: 'profile-1',
      })
    )
  })

  it('uses the default embedding profile', async () => {
    const profiles = [
      { id: 'non-default', name: 'Other', isDefault: false },
      { id: 'default-profile', name: 'Default', isDefault: true },
    ]
    const repos = makeRepos([makeChunk('chunk-1', false)], profiles)
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ profileId: 'default-profile' })
    )
  })

  it('skips enqueueing when no profile is marked default — never an arbitrary one', async () => {
    // Everything embedded must use the same (default) profile; embedding
    // under whichever profile happens to sort first would silently mix
    // vector spaces. With no default, chunks wait for the startup reconcile.
    const profiles = [
      { id: 'first-profile', name: 'First', isDefault: false },
      { id: 'second-profile', name: 'Second', isDefault: false },
    ]
    const repos = makeRepos([makeChunk('chunk-1', false)], profiles)
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const enqueued = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(enqueued).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('does not count already-enqueued jobs (isNew: false)', async () => {
    mockEnqueueEmbeddingGenerate.mockResolvedValue({ isNew: false })

    const repos = makeRepos([makeChunk('chunk-1', false), makeChunk('chunk-2', false)])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    // count reflects only NEW jobs enqueued
    expect(count).toBe(0)
    // But enqueueing was still attempted
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2)
  })

  it('continues processing remaining chunks when one enqueue call fails', async () => {
    mockEnqueueEmbeddingGenerate
      .mockRejectedValueOnce(new Error('Queue service unavailable'))
      .mockResolvedValueOnce({ isNew: true })

    const repos = makeRepos([makeChunk('chunk-1', false), makeChunk('chunk-2', false)])
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    // One succeeded
    expect(count).toBe(1)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------------
  // Per-document `embed:false` policy (allowEmbed === false on the link row)
  // -------------------------------------------------------------------------

  it('does not enqueue chunks whose link is embed:false', async () => {
    const repos = makeRepos(
      [
        makeChunk('blocked-1', false, 'link-blocked'),
        makeChunk('blocked-2', false, 'link-blocked'),
      ],
      undefined,
      undefined,
      [makeLink('link-blocked', false)]
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(0)
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled()
  })

  it('erases existing embeddings for an embed:false link', async () => {
    const repos = makeRepos(
      [makeChunk('embedded-1', true, 'link-blocked')],
      undefined,
      undefined,
      [makeLink('link-blocked', false)]
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(repos.docMountChunks.clearEmbeddingsByLinkId).toHaveBeenCalledWith('link-blocked')
  })

  it('enqueues allowed-link chunks while skipping blocked-link chunks (mixed)', async () => {
    const repos = makeRepos(
      [
        makeChunk('ok-1', false, 'link-ok'),
        makeChunk('blocked-1', false, 'link-blocked'),
        makeChunk('ok-2', false, 'link-ok'),
      ],
      undefined,
      undefined,
      [makeLink('link-ok', true), makeLink('link-blocked', false)]
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const count = await enqueueEmbeddingJobsForMountPoint('mp-1')

    expect(count).toBe(2)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ entityId: 'ok-1' })
    )
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ entityId: 'ok-2' })
    )
    // The blocked link's vectors are scrubbed even though its chunks weren't enqueued.
    expect(repos.docMountChunks.clearEmbeddingsByLinkId).toHaveBeenCalledWith('link-blocked')
  })
})
