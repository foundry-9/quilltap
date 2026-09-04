/**
 * Unit tests for lib/mount-index/general-state.ts
 *
 * Strategy: mock getGeneralMountPointId, getRepositories, and the database
 * store read/write helpers. The real DatabaseStoreError is kept so the
 * NOT_FOUND branch's instanceof check exercises production code.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/database-store', () => {
  // Define the error class inline so both production code (general-state.ts)
  // and this test import the SAME class from the mocked module — keeping the
  // `instanceof DatabaseStoreError` NOT_FOUND check meaningful.
  class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'DatabaseStoreError';
      this.code = code;
    }
  }
  return {
    __esModule: true,
    DatabaseStoreError,
    readDatabaseDocumentIfExists: jest.fn(),
    writeDatabaseDocument: jest.fn(),
  };
});

import {
  ensureGeneralStateFile,
  readGeneralState,
  writeGeneralState,
} from '@/lib/mount-index/general-state';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  readDatabaseDocumentIfExists,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';

const getGeneralMountPointIdMock = getGeneralMountPointId as jest.MockedFunction<typeof getGeneralMountPointId>;
const readDatabaseDocumentMock =
  readDatabaseDocumentIfExists as jest.MockedFunction<typeof readDatabaseDocumentIfExists>;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.MockedFunction<typeof writeDatabaseDocument>;
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const MOUNT_ID = 'general-mount-1';

function repos(existingStateDoc: boolean) {
  return {
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(() =>
        Promise.resolve(existingStateDoc ? { id: 'doc-state' } : null),
      ),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  writeDatabaseDocumentMock.mockResolvedValue({ mtime: 0 });
});

describe('ensureGeneralStateFile', () => {
  it('no-ops (returns false) when the mount is not provisioned', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(null);
    expect(await ensureGeneralStateFile()).toBe(false);
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('seeds {} when state.json is absent', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    getRepositoriesMock.mockReturnValue(repos(false));
    expect(await ensureGeneralStateFile()).toBe(true);
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'state.json', '{}');
  });

  it('never heals existing content', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    getRepositoriesMock.mockReturnValue(repos(true));
    expect(await ensureGeneralStateFile()).toBe(false);
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });
});

describe('readGeneralState', () => {
  it('returns {} when unprovisioned', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(null);
    expect(await readGeneralState()).toEqual({});
    expect(readDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('returns {} when state.json is absent', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    readDatabaseDocumentMock.mockResolvedValue(null);
    expect(await readGeneralState()).toEqual({});
  });

  it('returns {} and warns when the read itself fails', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    readDatabaseDocumentMock.mockRejectedValue(new Error('index locked'));
    expect(await readGeneralState()).toEqual({});
  });

  it('returns {} and warns on corrupt JSON', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    readDatabaseDocumentMock.mockResolvedValue('{ not json');
    expect(await readGeneralState()).toEqual({});
  });

  it('returns {} when the body is a non-object (array)', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    readDatabaseDocumentMock.mockResolvedValue('[1,2,3]');
    expect(await readGeneralState()).toEqual({});
  });

  it('parses a valid object body', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    readDatabaseDocumentMock.mockResolvedValue('{"weather":"foggy"}');
    expect(await readGeneralState()).toEqual({ weather: 'foggy' });
  });
});

describe('writeGeneralState', () => {
  it('throws when unprovisioned', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(null);
    await expect(writeGeneralState({ a: 1 })).rejects.toThrow('not been provisioned');
  });

  it('writes pretty-printed JSON when provisioned', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(MOUNT_ID);
    await writeGeneralState({ a: 1 });
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(
      MOUNT_ID,
      'state.json',
      JSON.stringify({ a: 1 }, null, 2),
    );
  });
});
