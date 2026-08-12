/**
 * Unit tests for doc_copy_file handler behavior.
 *
 * Covers:
 * - Registration (name is in DOC_EDIT_TOOL_NAMES)
 * - Happy path: cross-store copy between two filesystem mounts
 * - Destination-is-directory: source basename is appended
 * - Empty dest_path → copy to dest root under source basename
 * - Same-store rejection (identical mountPointIds)
 * - Destination already exists → refused
 * - Source file not found → refused
 * - Non-text source → refused
 * - Input validator
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
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
    writeFileWithMtimeCheck: jest.fn(),
    getAccessibleMountPoints: jest.fn(),
    isTextFile: jest.fn(),
    PathResolutionError,
    findUniqueMatch: jest.fn(),
    findAllMatches: jest.fn(),
    reindexSingleFile: jest.fn().mockResolvedValue(undefined),
    parseFrontmatter: jest.fn(),
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
  };
});

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn(),
  isJsonFamily: jest.fn(),
  isJsonMime: jest.fn(),
  isJsonlMime: jest.fn(),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn(),
  databaseFolderExists: jest.fn(),
  databaseFolderHasContents: jest.fn(),
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
    docMountPoints: { findById: jest.fn().mockResolvedValue(null), refreshStats: jest.fn() },
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
  stat: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test and its mocked deps
// ---------------------------------------------------------------------------

import {
  DOC_EDIT_TOOL_NAMES,
  isDocEditTool,
  executeDocEditTool,
} from '@/lib/tools/handlers/doc-edit-handler';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  isTextFile,
} from '@/lib/doc-edit';
import {
  databaseDocumentExists,
  databaseFolderExists,
} from '@/lib/mount-index/database-store';
import * as fsPromises from 'fs/promises';
import { validateDocCopyFileInput } from '@/lib/tools/doc-copy-file-tool';

const mockResolveDocEditPath = resolveDocEditPath as jest.Mock;
const mockReadFileWithMtime = readFileWithMtime as jest.Mock;
const mockWriteFileWithMtimeCheck = writeFileWithMtimeCheck as jest.Mock;
const mockIsTextFile = isTextFile as jest.Mock;
const mockDatabaseDocumentExists = databaseDocumentExists as jest.Mock;
const mockDatabaseFolderExists = databaseFolderExists as jest.Mock;
const mockStat = fsPromises.stat as jest.Mock;

// Helpers for building a minimal filesystem-mount ResolvedPath.
function fsResolved(opts: {
  mountPointId: string;
  mountPointName?: string;
  relativePath: string;
  basePath?: string;
}) {
  const basePath = opts.basePath ?? `/mnt/${opts.mountPointId}`;
  return {
    absolutePath: `${basePath}/${opts.relativePath}`.replace(/\/+/g, '/'),
    scope: 'document_store' as const,
    mountPointId: opts.mountPointId,
    mountPointName: opts.mountPointName ?? opts.mountPointId,
    mountType: 'filesystem' as const,
    basePath,
    relativePath: opts.relativePath,
  };
}

const context = {
  chatId: 'chat-1',
  userId: 'user-1',
  projectId: 'project-1',
  characterId: 'char-1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('doc_copy_file handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The doc-edit handlers (and the policy gates) read getRepositories from
    // the factory; point it at the same mock object this suite configures.
    const { getRepositories } = jest.requireMock('@/lib/database/repositories');
    jest.requireMock('@/lib/repositories/factory').getRepositories.mockReturnValue(getRepositories());
    // Default: path looks text-y.
    mockIsTextFile.mockReturnValue(true);
    // Default: no filesystem stat succeeds (nothing exists) unless a test overrides.
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // Default: no DB rows exist.
    mockDatabaseDocumentExists.mockResolvedValue(false);
    mockDatabaseFolderExists.mockResolvedValue(false);
  });

  describe('registration', () => {
    it('is listed in DOC_EDIT_TOOL_NAMES', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_copy_file')).toBe(true);
    });

    it('is recognized by isDocEditTool', () => {
      expect(isDocEditTool('doc_copy_file')).toBe(true);
    });
  });

  describe('input validator', () => {
    it('accepts well-formed input', () => {
      expect(
        validateDocCopyFileInput({
          source_mount_point: 'alpha',
          source_path: 'notes.md',
          dest_mount_point: 'beta',
          dest_path: 'notes.md',
        }),
      ).not.toBeNull();
    });

    it('allows empty dest_path (means "dest root")', () => {
      expect(
        validateDocCopyFileInput({
          source_mount_point: 'alpha',
          source_path: 'notes.md',
          dest_mount_point: 'beta',
          dest_path: '',
        }),
      ).not.toBeNull();
    });

    it('rejects missing source_mount_point', () => {
      expect(
        validateDocCopyFileInput({
          source_path: 'notes.md',
          dest_mount_point: 'beta',
          dest_path: '',
        }),
      ).toBeNull();
    });

    it('rejects non-string source_path', () => {
      expect(
        validateDocCopyFileInput({
          source_mount_point: 'alpha',
          source_path: 42,
          dest_mount_point: 'beta',
          dest_path: '',
        }),
      ).toBeNull();
    });
  });

  describe('happy path: cross-store copy between filesystem mounts', () => {
    it('reads from source and writes to dest at the specified path', async () => {
      const source = fsResolved({ mountPointId: 'mp-source', relativePath: 'notes.md' });
      const dest = fsResolved({ mountPointId: 'mp-dest', relativePath: 'archive/notes.md' });

      // Two resolveDocEditPath calls: initial source, initial dest; handler may re-resolve dest.
      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(dest)
        .mockResolvedValueOnce(dest);

      // Source exists as a file.
      mockStat.mockImplementation((p: string) => {
        if (p === source.absolutePath) {
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      mockReadFileWithMtime.mockResolvedValue({ content: 'hello world', mtime: 111, size: 11 });
      mockWriteFileWithMtimeCheck.mockResolvedValue({ mtime: 222 });

      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'notes.md',
          dest_mount_point: 'dest',
          dest_path: 'archive/notes.md',
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(mockReadFileWithMtime).toHaveBeenCalledWith(source);
      expect(mockWriteFileWithMtimeCheck).toHaveBeenCalledWith(dest, 'hello world');
      const out = result.result as { dest_path: string; mtime: number };
      expect(out.dest_path).toBe('archive/notes.md');
      expect(out.mtime).toBe(222);
    });

    it('appends source basename when dest_path is an existing directory', async () => {
      const source = fsResolved({ mountPointId: 'mp-source', relativePath: 'notes.md' });
      const destDir = fsResolved({ mountPointId: 'mp-dest', relativePath: 'archive' });
      const destFile = fsResolved({ mountPointId: 'mp-dest', relativePath: 'archive/notes.md' });

      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(destDir)
        .mockResolvedValueOnce(destFile);

      mockStat.mockImplementation((p: string) => {
        if (p === source.absolutePath) {
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        if (p === destDir.absolutePath) {
          return Promise.resolve({ isFile: () => false, isDirectory: () => true });
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      mockReadFileWithMtime.mockResolvedValue({ content: 'hi', mtime: 1, size: 2 });
      mockWriteFileWithMtimeCheck.mockResolvedValue({ mtime: 2 });

      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'notes.md',
          dest_mount_point: 'dest',
          dest_path: 'archive',
        },
        context,
      );

      expect(result.success).toBe(true);
      // Third resolve should be for the appended path.
      const thirdCall = mockResolveDocEditPath.mock.calls[2];
      expect(thirdCall[1]).toBe('archive/notes.md');
      expect(mockWriteFileWithMtimeCheck).toHaveBeenCalledWith(destFile, 'hi');
    });

    it('uses source basename at dest root when dest_path is empty', async () => {
      const source = fsResolved({ mountPointId: 'mp-source', relativePath: 'sub/notes.md' });
      // Initial resolve uses "." as a safe proxy for empty input.
      const destRoot = fsResolved({ mountPointId: 'mp-dest', relativePath: '.' });
      const destFile = fsResolved({ mountPointId: 'mp-dest', relativePath: 'notes.md' });

      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(destRoot)
        .mockResolvedValueOnce(destFile);

      mockStat.mockImplementation((p: string) => {
        if (p === source.absolutePath) {
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      mockReadFileWithMtime.mockResolvedValue({ content: 'x', mtime: 1, size: 1 });
      mockWriteFileWithMtimeCheck.mockResolvedValue({ mtime: 2 });

      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'sub/notes.md',
          dest_mount_point: 'dest',
          dest_path: '',
        },
        context,
      );

      expect(result.success).toBe(true);
      const thirdCall = mockResolveDocEditPath.mock.calls[2];
      expect(thirdCall[1]).toBe('notes.md');
    });
  });

  describe('rejections', () => {
    it('rejects non-text source files', async () => {
      mockIsTextFile.mockReturnValue(false);
      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'picture.webp',
          dest_mount_point: 'dest',
          dest_path: 'picture.webp',
        },
        context,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/text files only/i);
      expect(mockResolveDocEditPath).not.toHaveBeenCalled();
    });

    it('rejects when source and destination resolve to the same mountPointId', async () => {
      const source = fsResolved({ mountPointId: 'mp-same', mountPointName: 'Alpha', relativePath: 'a.md' });
      const dest = fsResolved({ mountPointId: 'mp-same', mountPointName: 'Alpha', relativePath: 'b.md' });

      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(dest);

      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'Alpha',
          source_path: 'a.md',
          dest_mount_point: 'alpha',
          dest_path: 'b.md',
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/different document stores/i);
      expect(mockReadFileWithMtime).not.toHaveBeenCalled();
      expect(mockWriteFileWithMtimeCheck).not.toHaveBeenCalled();
    });

    it('refuses when destination file already exists', async () => {
      const source = fsResolved({ mountPointId: 'mp-source', relativePath: 'notes.md' });
      const dest = fsResolved({ mountPointId: 'mp-dest', relativePath: 'notes.md' });

      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(dest)
        .mockResolvedValueOnce(dest);

      mockStat.mockImplementation((p: string) => {
        if (p === source.absolutePath) {
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        if (p === dest.absolutePath) {
          // First call during dest-directory detection — returns file (not dir).
          // Second call during pre-existence check — returns file.
          return Promise.resolve({ isFile: () => true, isDirectory: () => false });
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'notes.md',
          dest_mount_point: 'dest',
          dest_path: 'notes.md',
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
      expect(mockWriteFileWithMtimeCheck).not.toHaveBeenCalled();
    });

    it('refuses when source file does not exist', async () => {
      const source = fsResolved({ mountPointId: 'mp-source', relativePath: 'missing.md' });
      const dest = fsResolved({ mountPointId: 'mp-dest', relativePath: 'missing.md' });

      mockResolveDocEditPath
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(dest)
        .mockResolvedValueOnce(dest);

      // Nothing stats successfully — source is missing.
      const result = await executeDocEditTool(
        'doc_copy_file',
        {
          source_mount_point: 'source',
          source_path: 'missing.md',
          dest_mount_point: 'dest',
          dest_path: 'missing.md',
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/source file not found/i);
      expect(mockWriteFileWithMtimeCheck).not.toHaveBeenCalled();
    });
  });
});
