/**
 * Archived garments must survive the next wardrobe write.
 *
 * `projectVaultWardrobe` rewrites the whole `Wardrobe/` folder and deletes
 * every file the incoming array doesn't contain. Every mutation path therefore
 * has to hand it the FULL item list, archived entries included — which is why
 * `readMountItems` reads the vault raw rather than through the archived-free
 * `readSharedWardrobe`. Filter there and archiving becomes deletion: edit one
 * garment and every archived one in the same folder is swept.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const findManyByMountPointsInFolderMock = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: (...args: unknown[]) =>
        findManyByMountPointsInFolderMock(...args),
    },
  }),
}));

const writeDatabaseDocumentMock = jest.fn();
const deleteDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => writeDatabaseDocumentMock(...args),
  deleteDatabaseDocument: (...args: unknown[]) => deleteDatabaseDocumentMock(...args),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

import { projectVaultWardrobe } from '@/lib/database/repositories/vault-overlay/wardrobe-sync';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

const MOUNT_ID = 'm-1';
const CHAR_ID = 'char-1';
const ARCHIVED_AT = '2026-02-01T00:00:00.000Z';

function item(title: string, overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id: `id-${title}`,
    characterId: CHAR_ID,
    title,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem;
}

function existingDoc(relativePath: string) {
  return { id: `doc-${relativePath}`, relativePath };
}

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
});

describe('projectVaultWardrobe — archived garments survive a resave', () => {
  it('rewrites, rather than deletes, an archived garment carried in the array', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Coat.md'),
      existingDoc('Wardrobe/Shelved hat.md'),
    ]);

    await projectVaultWardrobe(MOUNT_ID, CHAR_ID, [
      item('Coat'),
      item('Shelved hat', { archivedAt: ARCHIVED_AT }),
    ]);

    // Only the legacy wardrobe.json cleanup may delete anything.
    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(deletedPaths).not.toContain('Wardrobe/Shelved hat.md');

    const written = writeDatabaseDocumentMock.mock.calls.find(
      (c) => c[1] === 'Wardrobe/Shelved hat.md',
    );
    expect(written).toBeDefined();
    expect(written![2]).toContain('archived: true');
    expect(written![2]).toContain(`archivedAt: ${ARCHIVED_AT}`);
  });

  it('sweeps the archived file if a caller filters it out of the array first', async () => {
    // Pins the failure mode: filtering at the vault read is data loss, not a
    // hidden row. This is why `readMountItems` must not use `readSharedWardrobe`.
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Coat.md'),
      existingDoc('Wardrobe/Shelved hat.md'),
    ]);

    await projectVaultWardrobe(MOUNT_ID, CHAR_ID, [item('Coat')]);

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(deletedPaths).toContain('Wardrobe/Shelved hat.md');
  });

  it('leaves the dressing-instructions file alone either way', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/instructions.md'),
      existingDoc('Wardrobe/Shelved hat.md'),
    ]);

    await projectVaultWardrobe(MOUNT_ID, CHAR_ID, [
      item('Shelved hat', { archivedAt: ARCHIVED_AT }),
    ]);

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(deletedPaths).not.toContain('Wardrobe/instructions.md');
    expect(deletedPaths).not.toContain('Wardrobe/Shelved hat.md');
  });
});

describe('archivedPatch', () => {
  const NOW = '2026-03-01T00:00:00.000Z';

  it('stamps archivedAt when archiving an active item', () => {
    expect(archivedPatch(null, true, NOW)).toEqual({ archivedAt: NOW });
  });

  it('clears archivedAt when restoring', () => {
    expect(archivedPatch(ARCHIVED_AT, false, NOW)).toEqual({ archivedAt: null });
  });

  it('is idempotent — re-archiving keeps the original stamp', () => {
    expect(archivedPatch(ARCHIVED_AT, true, NOW)).toBeNull();
  });

  it('is idempotent — restoring an active item is a no-op', () => {
    expect(archivedPatch(null, false, NOW)).toBeNull();
    expect(archivedPatch(undefined, false, NOW)).toBeNull();
  });
});
