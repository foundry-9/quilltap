/**
 * Sweep exemption in `projectArrayIntoVaultFolder`.
 *
 * The wardrobe projection rewrites the whole `Wardrobe/` folder and deletes
 * anything it didn't write — which would destroy a hand-kept
 * `instructions.md` on the very next wardrobe create/update/archive. The
 * `preserveFileNames` option must (a) shield the file from the sweep,
 * case-insensitively, and (b) pre-claim the name so a garment titled
 * "Instructions" lands on a `-1` suffix instead of overwriting the file.
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
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

import { projectArrayIntoVaultFolder } from '@/lib/database/repositories/vault-overlay/vault-projection';

function existingDoc(relativePath: string) {
  return { id: `doc-${relativePath}`, relativePath };
}

const PRESERVE = { preserveFileNames: ['instructions.md'] };

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
});

describe('projectArrayIntoVaultFolder — preserveFileNames', () => {
  it('keeps a preserved file through an empty projection, case-insensitively', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Instructions.MD'),
      existingDoc('Wardrobe/stale-garment.md'),
    ]);

    await projectArrayIntoVaultFolder('m-1', 'Wardrobe', [], () => {
      throw new Error('no items to map');
    }, 'char-1', PRESERVE);

    expect(deleteDatabaseDocumentMock).toHaveBeenCalledTimes(1);
    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Wardrobe/stale-garment.md');
  });

  it('routes an item mapping to a preserved name onto a suffix instead of overwriting', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/instructions.md'),
    ]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [{ name: 'Instructions' }],
      () => ({ fileName: 'instructions.md', content: 'garment body' }),
      'char-1',
      PRESERVE,
    );

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(
      'm-1',
      'Wardrobe/instructions-1.md',
      'garment body',
    );
    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('still sweeps stale files normally when no preserve list is given', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/instructions.md'),
    ]);

    await projectArrayIntoVaultFolder('m-1', 'Wardrobe', [], () => {
      throw new Error('no items to map');
    }, 'char-1');

    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Wardrobe/instructions.md');
  });
});
