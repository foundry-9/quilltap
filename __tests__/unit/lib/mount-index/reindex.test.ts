/**
 * Unit tests for lib/mount-index/reindex.ts
 *
 * Covers the path-scope filtering and force semantics for both
 * `enqueueEmbeddingJobsScoped` and `reindexLinks`.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingGenerate: jest.fn(),
}));

jest.mock('@/lib/mount-index/converters', () => ({
  convertBufferToPlainText: jest.fn(),
}));

jest.mock('@/lib/mount-index/chunker', () => ({
  chunkDocument: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

import { reindexLinks, enqueueEmbeddingJobsScoped } from '@/lib/mount-index/reindex';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';
import { convertBufferToPlainText } from '@/lib/mount-index/converters';
import { chunkDocument } from '@/lib/mount-index/chunker';

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockEnqueueEmbeddingGenerate = enqueueEmbeddingGenerate as jest.MockedFunction<typeof enqueueEmbeddingGenerate>;
const mockConvertBufferToPlainText = convertBufferToPlainText as jest.MockedFunction<typeof convertBufferToPlainText>;
const mockChunkDocument = chunkDocument as jest.MockedFunction<typeof chunkDocument>;

function mp() {
  return {
    id: 'mp-1',
    name: 'Test mount',
    mountType: 'database' as const,
    basePath: '',
  };
}

function link(over: Partial<{
  id: string;
  relativePath: string;
  fileType: string;
  source: string;
  extractionStatus: string;
  chunkCount: number;
  fileId: string;
}>) {
  return {
    id: over.id || 'l-1',
    fileId: over.fileId || 'f-1',
    mountPointId: 'mp-1',
    relativePath: over.relativePath || 'doc.pdf',
    fileName: (over.relativePath || 'doc.pdf').split('/').pop() || 'doc.pdf',
    folderId: null,
    description: '',
    descriptionUpdatedAt: null,
    conversionStatus: 'converted',
    conversionError: null,
    plainTextLength: null,
    extractedText: null,
    extractedTextSha256: null,
    extractionStatus: over.extractionStatus || 'pending',
    extractionError: null,
    chunkCount: over.chunkCount ?? 0,
    lastModified: '2026-05-01T00:00:00Z',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    source: over.source || 'database',
    fileType: over.fileType || 'pdf',
    sha256: 'abc',
    fileSizeBytes: 100,
  };
}

function chunk(id: string, linkId: string, embedded: boolean) {
  return {
    id,
    linkId,
    mountPointId: 'mp-1',
    fileId: 'f-1',
    chunkIndex: 0,
    content: 'x',
    tokenCount: 1,
    headingContext: null,
    embedding: embedded ? [0.1] : null,
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function makeRepos(over: Partial<{
  links: ReturnType<typeof link>[];
  chunks: ReturnType<typeof chunk>[];
  profiles: { id: string; name: string; isDefault: boolean }[];
  users: { id: string }[];
}> = {}) {
  const links = over.links || [];
  const chunks = over.chunks || [];
  return {
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue(links),
      update: jest.fn().mockResolvedValue(null),
    },
    docMountChunks: {
      findByMountPointId: jest.fn().mockResolvedValue(chunks),
      deleteByLinkId: jest.fn().mockResolvedValue(0),
      bulkInsert: jest.fn().mockResolvedValue(undefined),
    },
    docMountBlobs: {
      readDataByFileId: jest.fn().mockResolvedValue(Buffer.from('fake bytes')),
    },
    docMountDocuments: {
      findByFileId: jest.fn().mockResolvedValue({ content: 'fake content' }),
    },
    embeddingProfiles: {
      findAll: jest.fn().mockResolvedValue(over.profiles ?? [{ id: 'p-1', name: 'Default', isDefault: true }]),
    },
    users: {
      findAll: jest.fn().mockResolvedValue(over.users ?? [{ id: 'u-1' }]),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueueEmbeddingGenerate.mockResolvedValue({ jobId: 'job-x', isNew: true });
  mockConvertBufferToPlainText.mockResolvedValue('extracted plaintext');
  mockChunkDocument.mockReturnValue([
    { chunkIndex: 0, content: 'extracted plaintext', tokenCount: 2, headingContext: null },
  ]);
});

// ---------------------------------------------------------------------------
// reindexLinks
// ---------------------------------------------------------------------------

describe('reindexLinks', () => {
  it('processes pending PDF links and updates extraction state', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf', extractionStatus: 'pending' })],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp());

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(repos.docMountChunks.deleteByLinkId).toHaveBeenCalledWith('l-1');
    expect(repos.docMountChunks.bulkInsert).toHaveBeenCalled();
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ extractionStatus: 'converted', chunkCount: 1 }),
    );
  });

  it('skips already-converted PDFs without --force', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf', extractionStatus: 'converted' })],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp());

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(repos.docMountChunks.bulkInsert).not.toHaveBeenCalled();
  });

  it('includes already-converted PDFs when --force is set', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf', extractionStatus: 'converted' })],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp(), { force: true });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('narrows to a single file via exact-path scope', async () => {
    const repos = makeRepos({
      links: [
        link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf' }),
        link({ id: 'l-2', relativePath: 'b.pdf', fileType: 'pdf' }),
      ],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp(), { path: 'a.pdf' });

    expect(result.processed).toBe(1);
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      'l-1',
      expect.any(Object),
    );
    expect(repos.docMountFileLinks.update).not.toHaveBeenCalledWith(
      'l-2',
      expect.any(Object),
    );
  });

  it('narrows to a folder prefix scope', async () => {
    const repos = makeRepos({
      links: [
        link({ id: 'l-1', relativePath: 'Knowledge/a.pdf', fileType: 'pdf' }),
        link({ id: 'l-2', relativePath: 'Knowledge/sub/b.pdf', fileType: 'pdf' }),
        link({ id: 'l-3', relativePath: 'Other/c.pdf', fileType: 'pdf' }),
      ],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp(), { path: 'Knowledge' });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
  });

  it('records failures with their messages and continues', async () => {
    mockConvertBufferToPlainText.mockRejectedValueOnce(new Error('boom'));
    const repos = makeRepos({
      links: [
        link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf' }),
        link({ id: 'l-2', relativePath: 'b.pdf', fileType: 'pdf' }),
      ],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp());

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.errors).toEqual([{ relativePath: 'a.pdf', error: 'boom' }]);
  });

  it('marks empty-extraction PDFs as failed and clears chunks', async () => {
    mockConvertBufferToPlainText.mockResolvedValueOnce('   \n  \n');
    const repos = makeRepos({
      links: [link({ id: 'l-1', relativePath: 'a.pdf', fileType: 'pdf' })],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await reindexLinks(mp());

    expect(result.failed).toBe(1);
    expect(repos.docMountChunks.deleteByLinkId).toHaveBeenCalledWith('l-1');
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ extractionStatus: 'failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// enqueueEmbeddingJobsScoped
// ---------------------------------------------------------------------------

describe('enqueueEmbeddingJobsScoped', () => {
  it('enqueues jobs for un-embedded chunks under all links by default', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1' }), link({ id: 'l-2' })],
      chunks: [
        chunk('c-1', 'l-1', false),
        chunk('c-2', 'l-1', true),
        chunk('c-3', 'l-2', false),
      ],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await enqueueEmbeddingJobsScoped(mp());

    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.jobs).toHaveLength(2);
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2);
  });

  it('narrows to chunks under a path prefix', async () => {
    const repos = makeRepos({
      links: [
        link({ id: 'l-1', relativePath: 'Knowledge/a.md' }),
        link({ id: 'l-2', relativePath: 'Other/b.md' }),
      ],
      chunks: [
        chunk('c-1', 'l-1', false),
        chunk('c-2', 'l-2', false),
      ],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await enqueueEmbeddingJobsScoped(mp(), { path: 'Knowledge' });

    expect(result.queued).toBe(1);
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ entityId: 'c-1' }),
    );
  });

  it('with --force, includes chunks that already have embeddings', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1' })],
      chunks: [chunk('c-1', 'l-1', true), chunk('c-2', 'l-1', true)],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await enqueueEmbeddingJobsScoped(mp(), { force: true });

    expect(result.queued).toBe(2);
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2);
  });

  it('throws if no embedding profile is configured', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1' })],
      chunks: [chunk('c-1', 'l-1', false)],
      profiles: [],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    await expect(enqueueEmbeddingJobsScoped(mp())).rejects.toThrow(/No default embedding profile/);
  });

  it('returns zero queued (all-skipped) when there are no unembedded chunks', async () => {
    const repos = makeRepos({
      links: [link({ id: 'l-1' })],
      chunks: [chunk('c-1', 'l-1', true)],
    });
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>);

    const result = await enqueueEmbeddingJobsScoped(mp());

    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockEnqueueEmbeddingGenerate).not.toHaveBeenCalled();
  });
});
