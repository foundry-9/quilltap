/**
 * Verifies that the change-effecting doc_* tool handlers post the matching
 * Librarian announcement, attributed to the acting character, carrying the
 * canonical qtap:// URI, and — for content writes — the new file's contents
 * (creation) or a unified diff (edit).
 *
 * The announcement *content* logic (kind labels, empty-diff skip, truncation)
 * is pinned separately in librarian-notifications-doc-changes.test.ts; here we
 * pin the handler → poster wiring and the arguments handed across.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must precede the handler import.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/logger', () => ({
  logger: { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
    getAccessibleMountPoints: jest.fn().mockResolvedValue([]),
    resolveMountPointRef: jest.fn(),
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
    parseQtapUri: jest.fn(),
    generateUnifiedDiff: jest.fn().mockReturnValue('DIFF-SENTINEL'),
  };
});

jest.mock('@/lib/doc-edit/uri-producers', () => ({
  uriForResolvedPath: jest.fn(async (resolved: { relativePath: string }) => `qtap://test/${resolved.relativePath}`),
  docStoreUriFor: jest.fn(async ({ relativePath }: { relativePath: string }) => `qtap://test/${relativePath}`),
  buildDocStoreUriResolver: jest.fn(),
}));

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
  databaseDocumentExists: jest.fn(),
  databaseFolderExists: jest.fn().mockResolvedValue(false),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn().mockResolvedValue(undefined),
  listDatabaseFiles: jest.fn(),
}));

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn().mockResolvedValue({ storedMimeType: 'image/webp', sha256: 'abc', data: Buffer.from([1, 2, 3]) }),
  normaliseBlobRelativePath: jest.fn((p: string) => p),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/repositories/factory', () => {
  const characters = { findById: jest.fn() };
  const chats = { findById: jest.fn() };
  const docMountBlobs = { create: jest.fn(), deleteByMountPointAndPath: jest.fn() };
  const docMountPoints = { findById: jest.fn(), refreshStats: jest.fn().mockResolvedValue(undefined) };
  const docMountFileLinks = { findByMountPointAndPath: jest.fn().mockResolvedValue(null), findByMountPointId: jest.fn().mockResolvedValue([]) };
  return { getRepositories: () => ({ characters, chats, docMountBlobs, docMountPoints, docMountFileLinks }) };
});

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
  stat: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  readdir: jest.fn(),
  rmdir: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { executeDocEditTool } from '@/lib/tools/handlers/doc-edit-handler';
import { resolveDocEditPath, readFileWithMtime, findUniqueMatch, resolveMountPointRef, getAccessibleMountPoints } from '@/lib/doc-edit';
import { databaseDocumentExists } from '@/lib/mount-index/database-store';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postLibrarianWriteAnnouncement,
  postLibrarianMoveAnnouncement,
  postLibrarianCopyAnnouncement,
  postLibrarianBlobWriteAnnouncement,
  postLibrarianDeleteAnnouncement,
} from '@/lib/services/librarian-notifications/writer';

const announce = {
  postLibrarianWriteAnnouncement: postLibrarianWriteAnnouncement as jest.Mock,
  postLibrarianMoveAnnouncement: postLibrarianMoveAnnouncement as jest.Mock,
  postLibrarianCopyAnnouncement: postLibrarianCopyAnnouncement as jest.Mock,
  postLibrarianBlobWriteAnnouncement: postLibrarianBlobWriteAnnouncement as jest.Mock,
  postLibrarianDeleteAnnouncement: postLibrarianDeleteAnnouncement as jest.Mock,
};

const mockResolve = resolveDocEditPath as jest.Mock;
const mockRead = readFileWithMtime as jest.Mock;
const mockFindUnique = findUniqueMatch as jest.Mock;
const mockResolveMountRef = resolveMountPointRef as jest.Mock;
const mockAccessibleMounts = getAccessibleMountPoints as jest.Mock;
const mockDbDocExists = databaseDocumentExists as jest.Mock;
const repos = getRepositories();
const charsFindById = repos.characters.findById as jest.Mock;
const chatsFindById = repos.chats.findById as jest.Mock;
const blobCreate = repos.docMountBlobs.create as jest.Mock;
const blobDelete = repos.docMountBlobs.deleteByMountPointAndPath as jest.Mock;

const context = { chatId: 'chat-1', userId: 'user-1', projectId: 'project-1', characterId: 'char-1' };

function dbResolved(relativePath: string, mountPointId = 'mp-1', mountPointName = 'My Vault') {
  return { absolutePath: '', scope: 'document_store', mountPointId, mountPointName, mountType: 'database', basePath: '', relativePath };
}

describe('doc_* change handlers → Librarian announcements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    charsFindById.mockResolvedValue({ id: 'char-1', name: 'Beatrice', systemTransparency: true });
    chatsFindById.mockResolvedValue({ id: 'chat-1', allowCrossCharacterVaultReads: false, participants: [] });
  });

  it('doc_write_file (new path) announces a creation reporting the body', async () => {
    mockResolve.mockResolvedValue(dbResolved('Notes.md'));
    mockRead.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); // no pre-image → created

    const res = await executeDocEditTool('doc_write_file', { mount_point: 'self', path: 'Notes.md', content: 'hello world' }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianWriteAnnouncement).toHaveBeenCalledTimes(1);
    const arg = announce.postLibrarianWriteAnnouncement.mock.calls[0][0];
    expect(arg.change).toEqual({ kind: 'created', body: 'hello world' });
    expect(arg.uri).toBe('qtap://test/Notes.md');
    expect(arg.origin).toEqual({ kind: 'by-character', characterName: 'Beatrice' });
  });

  it('doc_write_file (existing path) announces an edit carrying a diff', async () => {
    mockResolve.mockResolvedValue(dbResolved('Notes.md'));
    mockRead.mockResolvedValue({ content: 'old contents', mtime: 1, size: 12 }); // pre-image exists → edited

    const res = await executeDocEditTool('doc_write_file', { mount_point: 'self', path: 'Notes.md', content: 'new contents' }, context);
    expect(res.success).toBe(true);
    const arg = announce.postLibrarianWriteAnnouncement.mock.calls[0][0];
    expect(arg.change).toEqual({ kind: 'edited', diff: 'DIFF-SENTINEL' });
  });

  it('doc_str_replace announces an edit with a diff', async () => {
    mockResolve.mockResolvedValue(dbResolved('Notes.md'));
    mockRead.mockResolvedValue({ content: 'the quick brown fox', mtime: 1, size: 19 });
    mockFindUnique.mockReturnValue({ found: true, index: 4, length: 5, count: 1 });

    const res = await executeDocEditTool('doc_str_replace', { mount_point: 'self', path: 'Notes.md', find: 'quick', replace: 'slow' }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianWriteAnnouncement).toHaveBeenCalledTimes(1);
    expect(announce.postLibrarianWriteAnnouncement.mock.calls[0][0].change.kind).toBe('edited');
  });

  it('doc_move_file announces a move with both addresses', async () => {
    mockResolve.mockImplementation(async (_scope: string, p: string) => dbResolved(p));
    mockDbDocExists.mockImplementation(async (_mp: string, p: string) => p === 'old.md'); // source exists, dest does not

    const res = await executeDocEditTool('doc_move_file', { mount_point: 'self', path: 'old.md', new_path: 'sub/new.md' }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianMoveAnnouncement).toHaveBeenCalledTimes(1);
    const arg = announce.postLibrarianMoveAnnouncement.mock.calls[0][0];
    expect(arg.isFolder).toBe(false);
    expect(arg.oldUri).toBe('qtap://test/old.md');
    expect(arg.newUri).toBe('qtap://test/sub/new.md');
    expect(arg.origin).toEqual({ kind: 'by-character', characterName: 'Beatrice' });
  });

  it('doc_copy_file announces a copy naming source/dest stores', async () => {
    mockResolve.mockImplementation(async (_scope: string, p: string, ctx: { mountPoint?: string }) =>
      dbResolved(p, ctx?.mountPoint === 'Archive' ? 'mp-2' : 'mp-1', ctx?.mountPoint ?? 'Library'));
    mockDbDocExists.mockImplementation(async (mpId: string) => mpId === 'mp-1'); // source exists, dest (mp-2) does not
    mockRead.mockResolvedValue({ content: 'body', mtime: 1, size: 4 });

    const res = await executeDocEditTool('doc_copy_file', {
      source_mount_point: 'Library', source_path: 'a.md', dest_mount_point: 'Archive', dest_path: 'b.md',
    }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianCopyAnnouncement).toHaveBeenCalledTimes(1);
    const arg = announce.postLibrarianCopyAnnouncement.mock.calls[0][0];
    expect(arg.sourceMountPoint).toBe('Library');
    expect(arg.destMountPoint).toBe('Archive');
  });

  it('doc_write_blob announces the new asset', async () => {
    mockResolveMountRef.mockResolvedValue('mp-vault');
    mockAccessibleMounts.mockResolvedValue([{ id: 'mp-vault', name: 'My Vault', mountType: 'database', basePath: '' }]);
    blobCreate.mockResolvedValue({ relativePath: 'photos/sketch.webp', storedMimeType: 'image/webp', sizeBytes: 4096, sha256: 'abc' });

    const res = await executeDocEditTool('doc_write_blob', {
      mount_point: 'self', path: 'photos/sketch.png', data_base64: Buffer.from('hi').toString('base64'), mime_type: 'image/png',
    }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianBlobWriteAnnouncement).toHaveBeenCalledTimes(1);
    const arg = announce.postLibrarianBlobWriteAnnouncement.mock.calls[0][0];
    expect(arg.displayTitle).toBe('sketch.webp');
    expect(arg.mimeType).toBe('image/webp');
    expect(arg.uri).toBe('qtap://test/photos/sketch.webp');
  });

  it('doc_delete_blob announces a deletion', async () => {
    mockResolveMountRef.mockResolvedValue('mp-vault');
    mockAccessibleMounts.mockResolvedValue([{ id: 'mp-vault', name: 'My Vault', mountType: 'database', basePath: '' }]);
    blobDelete.mockResolvedValue(true);

    const res = await executeDocEditTool('doc_delete_blob', { mount_point: 'self', path: 'photos/old.webp' }, context);
    expect(res.success).toBe(true);
    expect(announce.postLibrarianDeleteAnnouncement).toHaveBeenCalledTimes(1);
    const arg = announce.postLibrarianDeleteAnnouncement.mock.calls[0][0];
    expect(arg.scope).toBe('document_store');
    expect(arg.displayTitle).toBe('old.webp');
  });
});
