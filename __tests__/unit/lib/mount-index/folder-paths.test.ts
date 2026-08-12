/**
 * Unit tests for lib/mount-index/folder-paths.ts utilities
 *
 * Tests cover:
 * - resolvePath: path resolution to folder ID and leaf name
 * - buildPath: building full path from folder ID
 * - ensureFolderPath: idempotent folder creation
 * - folderHasContents: checking for child folders, documents, blobs
 * - Concurrent safety of ensureFolderPath
 *
 * Strategy: Mock getRepositories() to return a mock repo with controlled
 * folder/document/file state. No real database or filesystem.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock logger first
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock getRepositories - must be declared before mock
jest.mock('@/lib/repositories/factory');

// Get the mock after declaration
const mockGetRepositories = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

import {
  resolvePath,
  buildPath,
  ensureFolderPath,
  folderHasContents,
} from '@/lib/mount-index/folder-paths';

// Setup the mock after imports
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const MOUNT_ID = 'mount-001';

interface MockRepos {
  docMountFolders: {
    findByMountPointAndPath: jest.Mock;
    findById: jest.Mock;
    findChildren: jest.Mock;
    create: jest.Mock;
  };
  docMountDocuments: {
    findByMountPointId: jest.Mock;
  };
  docMountFiles: {
    findByMountPointId: jest.Mock;
  };
  docMountFileLinks: {
    findByMountPointId: jest.Mock;
  };
}

function createMockRepos(): MockRepos {
  return {
    docMountFolders: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      findChildren: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    docMountDocuments: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
    },
    docMountFiles: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('folder-paths utilities', () => {
  let repos: MockRepos;

  beforeEach(() => {
    repos = createMockRepos();
    getRepositoriesMock.mockReturnValue(repos);
  });

  // =========================================================================
  // resolvePath
  // =========================================================================

  describe('resolvePath', () => {
    it('resolves root-level file to null folder', async () => {
      const result = await resolvePath(MOUNT_ID, 'note.md');

      expect(result).toEqual({
        folderId: null,
        leafName: 'note.md',
        folderPath: '',
      });
    });

    it('resolves nested file to folder ID', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'foo/bar',
        mountPointId: MOUNT_ID,
        parentId: 'folder-000',
        name: 'bar',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);

      const result = await resolvePath(MOUNT_ID, 'foo/bar/note.md');

      expect(result).toEqual({
        folderId: 'folder-001',
        leafName: 'note.md',
        folderPath: 'foo/bar',
      });

      expect(repos.docMountFolders.findByMountPointAndPath).toHaveBeenCalledWith(
        MOUNT_ID,
        'foo/bar'
      );
    });

    it('throws when ancestor folder does not exist', async () => {
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);

      await expect(resolvePath(MOUNT_ID, 'missing/path/note.md')).rejects.toThrow(
        /Ancestor folder does not exist/
      );
    });

    it('normalizes paths (backslashes, trailing slashes)', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'foo/bar',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'bar',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);

      const result = await resolvePath(MOUNT_ID, 'foo\\bar\\note.md');

      expect(result.folderPath).toBe('foo/bar');
    });
  });

  // =========================================================================
  // buildPath
  // =========================================================================

  describe('buildPath', () => {
    it('returns empty string for null folder ID', async () => {
      const result = await buildPath(null);
      expect(result).toBe('');
    });

    it('returns denormalised path from folder', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'a/b/c',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'c',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findById.mockResolvedValue(mockFolder);

      const result = await buildPath('folder-001');
      expect(result).toBe('a/b/c');
    });

    it('throws when folder is not found', async () => {
      repos.docMountFolders.findById.mockResolvedValue(null);

      await expect(buildPath('missing-folder')).rejects.toThrow(/Folder not found/);
    });
  });

  // =========================================================================
  // ensureFolderPath
  // =========================================================================

  describe('ensureFolderPath', () => {
    it('returns null for empty path (root)', async () => {
      const result = await ensureFolderPath(MOUNT_ID, '');
      expect(result).toBeNull();
    });

    it('creates missing folder segments', async () => {
      let callCount = 0;
      repos.docMountFolders.findByMountPointAndPath.mockImplementation(async (mpId, path) => {
        // First call: looking for 'a' — not found
        // Second call: looking for 'a/b' — not found
        // After creates: both found on subsequent lookups
        if (callCount < 2) {
          callCount++;
          return null;
        }
        // Return created folders on second pass
        if (path === 'a') {
          return {
            id: 'folder-a',
            path: 'a',
            mountPointId: MOUNT_ID,
            parentId: null,
            name: 'a',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        if (path === 'a/b') {
          return {
            id: 'folder-ab',
            path: 'a/b',
            mountPointId: MOUNT_ID,
            parentId: 'folder-a',
            name: 'b',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      });

      repos.docMountFolders.create.mockImplementation(async (data) => ({
        id: data.path === 'a' ? 'folder-a' : 'folder-ab',
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const result = await ensureFolderPath(MOUNT_ID, 'a/b');

      expect(result).toBe('folder-ab');
      expect(repos.docMountFolders.create).toHaveBeenCalledTimes(2);
    });

    it('is idempotent on subsequent calls', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'a/b',
        mountPointId: MOUNT_ID,
        parentId: 'folder-a',
        name: 'b',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);

      const result1 = await ensureFolderPath(MOUNT_ID, 'a/b');
      const result2 = await ensureFolderPath(MOUNT_ID, 'a/b');

      expect(result1).toBe('folder-001');
      expect(result2).toBe('folder-001');
      expect(repos.docMountFolders.create).not.toHaveBeenCalled();
    });

    it('reuses a case-variant folder and continues under its stored casing', async () => {
      // Store holds 'Lore'; the caller asks for 'lore/maps'. The existing
      // folder must be reused (no sibling case-collision minted) and the new
      // child created under the STORED prefix 'Lore/maps'.
      const loreFolder = {
        id: 'folder-lore',
        path: 'Lore',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'Lore',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(async (mpId, path) => {
        // The repository layer matches case-insensitively.
        if (path.toLowerCase() === 'lore') return loreFolder;
        return null;
      });

      repos.docMountFolders.create.mockImplementation(async (data) => ({
        id: 'folder-maps',
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      const result = await ensureFolderPath(MOUNT_ID, 'lore/maps');

      expect(result).toBe('folder-maps');
      expect(repos.docMountFolders.create).toHaveBeenCalledTimes(1);
      expect(repos.docMountFolders.create).toHaveBeenCalledWith({
        mountPointId: MOUNT_ID,
        parentId: 'folder-lore',
        name: 'maps',
        path: 'Lore/maps',
      });
    });

    it('handles concurrent creation via conflict resolution', async () => {
      let createCount = 0;

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(async (mpId, path) => {
        // On second lookup after failed create, return the existing folder
        // (simulating another process created it)
        if (path === 'concurrent') {
          return {
            id: 'folder-concurrent',
            path: 'concurrent',
            mountPointId: MOUNT_ID,
            parentId: null,
            name: 'concurrent',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      });

      repos.docMountFolders.create.mockImplementation(async () => {
        createCount++;
        if (createCount === 1) {
          // First attempt fails (simulating unique constraint violation)
          const error = new Error('UNIQUE constraint failed');
          throw error;
        }
        // Second attempt (after the fallback lookup) would not happen
        // because we already found it
        return {
          id: 'folder-concurrent',
          path: 'concurrent',
          mountPointId: MOUNT_ID,
          parentId: null,
          name: 'concurrent',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      const result = await ensureFolderPath(MOUNT_ID, 'concurrent');
      expect(result).toBe('folder-concurrent');
    });
  });

  // =========================================================================
  // folderHasContents
  // =========================================================================

  describe('folderHasContents', () => {
    it('returns false for empty folder', async () => {
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);

      const result = await folderHasContents(MOUNT_ID, 'folder-001');
      expect(result).toBe(false);
    });

    it('returns true when folder has child folders', async () => {
      repos.docMountFolders.findChildren.mockResolvedValue([
        {
          id: 'child-folder',
          path: 'parent/child',
          mountPointId: MOUNT_ID,
          parentId: 'folder-001',
          name: 'child',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await folderHasContents(MOUNT_ID, 'folder-001');
      expect(result).toBe(true);
    });

    it('returns true when folder contains a document', async () => {
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountFileLinks.findByMountPointId.mockResolvedValue([
        {
          id: 'link-001',
          fileId: 'file-001',
          folderId: 'folder-001',
          relativePath: 'parent/note.md',
          mountPointId: MOUNT_ID,
          fileName: 'note.md',
          fileType: 'markdown',
          sha256: 'abc123',
        },
      ]);

      const result = await folderHasContents(MOUNT_ID, 'folder-001');
      expect(result).toBe(true);
    });

    it('returns true when folder contains a file', async () => {
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountFileLinks.findByMountPointId.mockResolvedValue([
        {
          id: 'link-001',
          fileId: 'file-001',
          folderId: 'folder-001',
          relativePath: 'parent/file.txt',
          mountPointId: MOUNT_ID,
          fileName: 'file.txt',
          fileType: 'txt',
          sha256: 'def456',
        },
      ]);

      const result = await folderHasContents(MOUNT_ID, 'folder-001');
      expect(result).toBe(true);
    });

    it('ignores documents and files in other folders', async () => {
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountFileLinks.findByMountPointId.mockResolvedValue([
        {
          id: 'link-002',
          fileId: 'file-002',
          folderId: 'folder-other',
          relativePath: 'other/note.md',
          mountPointId: MOUNT_ID,
          fileName: 'note.md',
          fileType: 'markdown',
          sha256: 'abc123',
        },
      ]);

      const result = await folderHasContents(MOUNT_ID, 'folder-001');
      expect(result).toBe(false);
    });
  });
});
