/**
 * Unit tests for the delete service's `keepArchivedCharacterBundles` option
 * (character-archive spec §4.7).
 *
 * The default spares `files` rows of category `ARCHIVE` — archived-character
 * bundles — and their on-disk bytes from the wipe; the destructive choice is
 * the explicit one. Tombstone character rows do NOT survive, so the survivor
 * is a loose bundle: importable, not rehydratable.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

const mockDeleteFile = jest.fn();
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { deleteFile: (...args: unknown[]) => mockDeleteFile(...args) },
}));

const mockRawQuery = jest.fn();
jest.mock('@/lib/database/manager', () => ({
  rawQuery: (...args: unknown[]) => mockRawQuery(...args),
}));

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: () => null,
  isMountIndexDegraded: () => true,
}));

const mockFilesFindAll = jest.fn();
const mockFilesDelete = jest.fn();
const mockCharactersFindAll = jest.fn();
const mockMemoriesFindByCharacterId = jest.fn();
const mockMemoriesDelete = jest.fn();

const mockDeleteMemoriesBatch = jest.fn();
jest.mock('@/lib/memory/memory-gate', () => ({
  deleteMemoriesWithUnlinkBatch: (...args: unknown[]) => mockDeleteMemoriesBatch(...args),
}));

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: () => ({
    characters: {
      findAll: (...args: unknown[]) => mockCharactersFindAll(...args),
      delete: jest.fn(),
    },
    chats: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    tags: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    files: {
      findAll: (...args: unknown[]) => mockFilesFindAll(...args),
      delete: (...args: unknown[]) => mockFilesDelete(...args),
    },
    connections: {
      findAll: jest.fn().mockResolvedValue([]),
      getAllApiKeys: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      deleteApiKey: jest.fn(),
    },
    imageProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    projects: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    groups: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    llmLogs: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    memories: {
      findByCharacterId: (...args: unknown[]) => mockMemoriesFindByCharacterId(...args),
      delete: (...args: unknown[]) => mockMemoriesDelete(...args),
    },
  }),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null), delete: jest.fn() },
    folders: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    wardrobe: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  }),
}));

import {
  deleteUserData,
  deleteAllUserData,
  previewDeleteAllUserData,
} from '@/lib/backup/restore/delete-service';

const USER = 'user-1';

const archiveBundle = {
  id: 'file-archive',
  category: 'ARCHIVE',
  folderPath: '/archive/characters',
  originalFilename: 'Bertie.qtap',
  storageKey: 'archive/characters/Bertie.qtap',
};
const ordinaryFile = {
  id: 'file-plain',
  category: 'IMAGE',
  folderPath: '/uploads',
  originalFilename: 'photo.webp',
  storageKey: 'uploads/photo.webp',
};

describe('delete-service keepArchivedCharacterBundles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilesFindAll.mockResolvedValue([archiveBundle, ordinaryFile]);
    mockFilesDelete.mockResolvedValue(true);
    mockDeleteFile.mockResolvedValue(undefined);
    mockRawQuery.mockResolvedValue(undefined);
    mockCharactersFindAll.mockResolvedValue([]);
    mockMemoriesFindByCharacterId.mockResolvedValue([]);
    mockDeleteMemoriesBatch.mockResolvedValue(0);
  });

  it('routes memory deletion through the memory-gate batch chokepoint', async () => {
    mockCharactersFindAll.mockResolvedValue([{ id: 'char-1' }, { id: 'char-2' }]);
    mockMemoriesFindByCharacterId
      .mockResolvedValueOnce([{ id: 'mem-1' }, { id: 'mem-2' }])
      .mockResolvedValueOnce([{ id: 'mem-3' }]);

    await deleteUserData(USER);

    expect(mockDeleteMemoriesBatch).toHaveBeenCalledTimes(1);
    expect(mockDeleteMemoriesBatch).toHaveBeenCalledWith(['mem-1', 'mem-2', 'mem-3']);
    // The repository's per-row delete must never be hit directly.
    expect(mockMemoriesDelete).not.toHaveBeenCalled();
  });

  it('spares ARCHIVE bundles (row and bytes) by default', async () => {
    await deleteUserData(USER);

    const deletedIds = mockFilesDelete.mock.calls.map((c) => c[0]);
    expect(deletedIds).toEqual(['file-plain']);
    const storageDeleted = mockDeleteFile.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(storageDeleted).toEqual(['file-plain']);
  });

  it('wipes ARCHIVE bundles when keepArchivedCharacterBundles is false', async () => {
    await deleteUserData(USER, { keepArchivedCharacterBundles: false });

    const deletedIds = mockFilesDelete.mock.calls.map((c) => c[0]);
    expect(deletedIds).toEqual(expect.arrayContaining(['file-archive', 'file-plain']));
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
  });

  it('deleteAllUserData reports kept bundles and excludes them from the files count', async () => {
    const summary = await deleteAllUserData(USER);

    expect(summary.archiveBundles).toBe(1);
    expect(summary.archiveBundlesKept).toBe(true);
    expect(summary.files).toBe(1); // the ordinary file only
    expect(mockFilesDelete.mock.calls.map((c) => c[0])).toEqual(['file-plain']);
  });

  it('deleteAllUserData with keep=false counts every file as wiped', async () => {
    const summary = await deleteAllUserData(USER, { keepArchivedCharacterBundles: false });

    expect(summary.archiveBundles).toBe(1);
    expect(summary.archiveBundlesKept).toBe(false);
    expect(summary.files).toBe(2);
  });

  it('previewDeleteAllUserData counts bundles without deleting anything', async () => {
    const summary = await previewDeleteAllUserData(USER);

    expect(summary.archiveBundles).toBe(1);
    expect(summary.files).toBe(2);
    expect(mockFilesDelete).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
