/**
 * Regression test for `triggerReindexIfNeeded` in doc-edit-handler.
 *
 * The handler's reindex/embed pass used to gate on
 * `resolved.scope === 'document_store'`. That meant
 * `doc_write_file(scope: 'project')` writes into a project's
 * `officialMountPointId` mount silently skipped chunking and embedding,
 * even though those writes really do land in a database-backed mount —
 * the file would only become searchable after the next periodic mount
 * scan. Friday/Amy hit this on 2026-05-11 when a project-knowledge test
 * file refused to surface in the search tool right after writing.
 *
 * The gate is now `resolved.mountPointId`, regardless of scope label.
 * This test pins:
 *   - scope: 'project' WITH mountPointId  → reindex + embed enqueue fire.
 *   - scope: 'character' WITH mountPointId → reindex + embed enqueue fire.
 *   - scope: 'project' WITHOUT mountPointId (legacy fs) → no-op.
 *   - scope: 'document_store' WITH mountPointId → reindex + embed fire (regression).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must precede the handler import.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/doc-edit', () => {
  class PathResolutionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PathResolutionError';
      this.code = code;
    }
  }
  return {
    resolveDocEditPath: jest.fn(),
    readFileWithMtime: jest.fn(),
    writeFileWithMtimeCheck: jest.fn().mockResolvedValue({ mtime: 1700000000000 }),
    getAccessibleMountPoints: jest.fn(),
    isTextFile: jest.fn().mockReturnValue(true),
    PathResolutionError,
    findUniqueMatch: jest.fn(),
    findAllMatches: jest.fn(),
    reindexSingleFile: jest.fn().mockResolvedValue(undefined),
    parseFrontmatter: jest.fn(),
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
    generateUnifiedDiff: jest.fn().mockReturnValue('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'),
  };
});

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn().mockReturnValue('text/markdown'),
  isJsonFamily: jest.fn().mockReturnValue(false),
  isJsonMime: jest.fn().mockReturnValue(false),
  isJsonlMime: jest.fn().mockReturnValue(false),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn().mockResolvedValue(false),
  databaseFolderExists: jest.fn().mockResolvedValue(false),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn(),
  listDatabaseFiles: jest.fn(),
}));

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn().mockReturnValue({
    chats: { findById: jest.fn().mockResolvedValue(null) },
    characters: { findById: jest.fn().mockResolvedValue(null) },
    docMountPoints: { findById: jest.fn().mockResolvedValue(null), refreshStats: jest.fn().mockResolvedValue(undefined) },
    docMountFileLinks: { findByMountPointAndPath: jest.fn().mockResolvedValue(null), findByMountPointId: jest.fn().mockResolvedValue([]) },
    projectDocMountLinks: { findByProjectId: jest.fn().mockResolvedValue([]) },
  }),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn(),
}));

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn(),
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianFolderCreatedAnnouncement: jest.fn(),
  postLibrarianFolderDeletedAnnouncement: jest.fn(),
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianMoveAnnouncement: jest.fn(),
  postLibrarianCopyAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { executeDocEditTool } from '@/lib/tools/handlers/doc-edit-handler';
import { resolveDocEditPath, reindexSingleFile } from '@/lib/doc-edit';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';

const mockResolveDocEditPath = resolveDocEditPath as jest.Mock;
const mockReindexSingleFile = reindexSingleFile as jest.Mock;
const mockEnqueueEmbeddingJobsForMountPoint = enqueueEmbeddingJobsForMountPoint as jest.Mock;

const context = {
  chatId: 'chat-1',
  userId: 'user-1',
  projectId: 'project-1',
  characterId: 'char-1',
};

// `triggerReindexIfNeeded` is fire-and-forget — it does its work after the
// tool response resolves. Drain the microtask queue and a setImmediate tick
// before asserting on reindex/embed calls.
async function flushMicrotasks() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

describe('doc_write_file → triggerReindexIfNeeded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The doc-edit handlers (and the policy gates) read getRepositories from
    // the factory; point it at the same mock object this suite configures.
    const { getRepositories } = jest.requireMock('@/lib/database/repositories');
    jest.requireMock('@/lib/repositories/factory').getRepositories.mockReturnValue(getRepositories());
  });

  it('reindexes and enqueues embeddings for scope:"project" writes into an official project mount', async () => {
    mockResolveDocEditPath.mockResolvedValue({
      absolutePath: '',
      scope: 'project',
      mountPointId: 'mp-project-official-1',
      mountPointName: 'Project Files: Test',
      mountType: 'database',
      basePath: '',
      relativePath: 'Knowledge/test.md',
    });

    const result = await executeDocEditTool(
      'doc_write_file',
      {
        scope: 'project',
        path: 'Knowledge/test.md',
        content: '# Test\n\nA fresh project-knowledge entry.\n',
      },
      context,
    );

    expect(result.success).toBe(true);

    await flushMicrotasks();

    expect(mockReindexSingleFile).toHaveBeenCalledTimes(1);
    expect(mockReindexSingleFile).toHaveBeenCalledWith(
      'mp-project-official-1',
      'Knowledge/test.md',
      '',
    );
    expect(mockEnqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith('mp-project-official-1');
  });

  it('reindexes and enqueues embeddings for scope:"character" writes into a vault mount', async () => {
    mockResolveDocEditPath.mockResolvedValue({
      absolutePath: '',
      scope: 'character',
      mountPointId: 'mp-vault-1',
      mountPointName: 'Robin Character Vault',
      mountType: 'database',
      basePath: '',
      relativePath: 'Knowledge/notes.md',
    });

    const result = await executeDocEditTool(
      'doc_write_file',
      {
        scope: 'character',
        path: 'Knowledge/notes.md',
        content: '# Private notes\n',
      },
      context,
    );

    expect(result.success).toBe(true);

    await flushMicrotasks();

    expect(mockReindexSingleFile).toHaveBeenCalledWith(
      'mp-vault-1',
      'Knowledge/notes.md',
      '',
    );
    expect(mockEnqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith('mp-vault-1');
  });

  it('skips reindex when scope:"project" resolves to a legacy filesystem path with no mountPointId', async () => {
    mockResolveDocEditPath.mockResolvedValue({
      absolutePath: '/tmp/files/project-1/Knowledge/legacy.md',
      scope: 'project',
      basePath: '/tmp/files/project-1',
      relativePath: 'Knowledge/legacy.md',
      // No mountPointId — this is the un-migrated legacy branch.
    });

    const result = await executeDocEditTool(
      'doc_write_file',
      {
        scope: 'project',
        path: 'Knowledge/legacy.md',
        content: 'legacy body',
      },
      context,
    );

    expect(result.success).toBe(true);

    await flushMicrotasks();

    expect(mockReindexSingleFile).not.toHaveBeenCalled();
    expect(mockEnqueueEmbeddingJobsForMountPoint).not.toHaveBeenCalled();
  });

  it('still reindexes scope:"document_store" writes (regression)', async () => {
    mockResolveDocEditPath.mockResolvedValue({
      absolutePath: '/mnt/store/notes.md',
      scope: 'document_store',
      mountPointId: 'mp-store-1',
      mountPointName: 'Lore Store',
      mountType: 'filesystem',
      basePath: '/mnt/store',
      relativePath: 'notes.md',
    });

    const result = await executeDocEditTool(
      'doc_write_file',
      {
        scope: 'document_store',
        mount_point: 'Lore Store',
        path: 'notes.md',
        content: 'a single line',
      },
      context,
    );

    expect(result.success).toBe(true);

    await flushMicrotasks();

    expect(mockReindexSingleFile).toHaveBeenCalledWith('mp-store-1', 'notes.md', '/mnt/store/notes.md');
    expect(mockEnqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith('mp-store-1');
  });
});
