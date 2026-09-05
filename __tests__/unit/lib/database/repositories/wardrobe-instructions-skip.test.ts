/**
 * `Wardrobe/instructions.md` must never be read as a garment.
 *
 * The single reader behind every wardrobe tier (`readCharacterVaultWardrobe`)
 * filters the file by name — silently, so it no longer logs a "no valid
 * `types` list" warning on every read — and a folder holding only the
 * instructions file still falls through to the legacy `wardrobe.json` branch.
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
    wardrobe: { findArchetypes: jest.fn(async () => []) },
  }),
}));

const readDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'DatabaseStoreError';
      this.code = code;
    }
  }
  // Mirror the real helper's contract over the mocked primitive so the
  // NOT_FOUND stubs below keep driving the reader.
  const readDatabaseDocumentIfExists = async (mountPointId: string, relativePath: string) => {
    try {
      return (await readDatabaseDocumentMock(mountPointId, relativePath)).content;
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  };
  return {
    DatabaseStoreError,
    readDatabaseDocument: (...args: unknown[]) => readDatabaseDocumentMock(...args),
    readDatabaseDocumentIfExists,
    writeDatabaseDocument: jest.fn(),
    deleteDatabaseDocument: jest.fn(),
  };
});

import { readCharacterVaultWardrobe } from '@/lib/database/repositories/vault-overlay/vault-readers';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { logger } from '@/lib/logger';

function doc(fileName: string, content: string) {
  return {
    id: `doc-${fileName}`,
    linkId: `link-${fileName}`,
    mountPointId: 'm-1',
    relativePath: `Wardrobe/${fileName}`,
    fileName,
    content,
    lastModified: '2026-01-01T00:00:00.000Z',
  };
}

const GARMENT = doc(
  'coat.md',
  ['---', 'title: Coat', 'types:', '  - top', '---', 'A fine coat.'].join('\n'),
);
const INSTRUCTIONS = doc('instructions.md', 'You prefer tweeds for fieldwork.');
const INSTRUCTIONS_CASED = doc('Instructions.MD', 'You prefer tweeds for fieldwork.');

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset();
  readDatabaseDocumentMock
    .mockReset()
    .mockRejectedValue(new DatabaseStoreError('missing', 'NOT_FOUND'));
  (logger.warn as jest.Mock).mockClear();
});

describe('readCharacterVaultWardrobe — instructions.md skip', () => {
  it('excludes instructions.md (any casing) from the item list without warning', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      INSTRUCTIONS,
      GARMENT,
      INSTRUCTIONS_CASED,
    ]);

    const vault = await readCharacterVaultWardrobe('m-1', 'char-1');
    expect(vault).not.toBeNull();
    expect(vault!.items.map((i) => i.title)).toEqual(['Coat']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('treats a folder holding only instructions.md as empty (legacy-json fallback)', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([INSTRUCTIONS]);

    const vault = await readCharacterVaultWardrobe('m-1', 'char-1');
    // The legacy wardrobe.json is also absent, so the read resolves to null —
    // the same result as a genuinely empty pre-migration vault.
    expect(vault).toBeNull();
    expect(readDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'wardrobe.json');
  });
});
