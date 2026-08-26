/**
 * Dressing-instructions cascade and file helpers.
 *
 * The cascade must probe nearest-tier-first (character > group > project >
 * general), stop at the first non-blank `Wardrobe/instructions.md`, treat a
 * blank file as absent, and stay deterministic when a tier has several
 * mounts. The write helper must clear by deleting (tolerating NOT_FOUND) and
 * write trimmed content otherwise.
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

const readVaultTextFileMock = jest.fn<(mountPointId: string, path: string) => Promise<string | null>>();
jest.mock('@/lib/database/repositories/vault-overlay/vault-readers', () => ({
  readVaultTextFile: (...args: [string, string]) => readVaultTextFileMock(...args),
}));

const getGeneralMountPointIdMock = jest.fn<() => Promise<string | null>>();
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: () => getGeneralMountPointIdMock(),
}));

const writeDatabaseDocumentMock = jest.fn();
const deleteDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'DatabaseStoreError';
      this.code = code;
    }
  }
  return {
    DatabaseStoreError,
    writeDatabaseDocument: (...args: unknown[]) => writeDatabaseDocumentMock(...args),
    deleteDatabaseDocument: (...args: unknown[]) => deleteDatabaseDocumentMock(...args),
  };
});

const ensureFolderPathMock = jest.fn();
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (...args: unknown[]) => ensureFolderPathMock(...args),
}));

import {
  resolveWardrobeInstructions,
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';

const PATH = 'Wardrobe/instructions.md';

/** Configure per-mount file contents; unlisted mounts read as missing. */
function filesByMount(map: Record<string, string | null>) {
  readVaultTextFileMock.mockImplementation(async (mountPointId: string, path: string) => {
    expect(path).toBe(PATH);
    return map[mountPointId] ?? null;
  });
}

beforeEach(() => {
  readVaultTextFileMock.mockReset();
  getGeneralMountPointIdMock.mockReset().mockResolvedValue('m-general');
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
  ensureFolderPathMock.mockReset().mockResolvedValue('folder-id');
});

describe('resolveWardrobeInstructions', () => {
  it('lets the character tier win and stops probing there', async () => {
    filesByMount({ 'm-char': 'You wear tweed.', 'm-group': 'group text', 'm-general': 'general text' });
    const result = await resolveWardrobeInstructions({
      characterMountPointId: 'm-char',
      groupMountPointIds: ['m-group'],
      projectMountPointIds: ['m-project'],
    });
    expect(result).toEqual({ content: 'You wear tweed.', tier: 'character', mountPointId: 'm-char' });
    expect(readVaultTextFileMock).toHaveBeenCalledTimes(1);
  });

  it('cascades character → group → project → general and continues past blanks', async () => {
    filesByMount({ 'm-char': '   \n', 'm-group': null, 'm-project': '  You dress plainly.  ' });
    const result = await resolveWardrobeInstructions({
      characterMountPointId: 'm-char',
      groupMountPointIds: ['m-group'],
      projectMountPointIds: ['m-project'],
    });
    expect(result).toEqual({ content: 'You dress plainly.', tier: 'project', mountPointId: 'm-project' });
    const probedMounts = readVaultTextFileMock.mock.calls.map((c) => c[0]);
    expect(probedMounts).toEqual(['m-char', 'm-group', 'm-project']);
  });

  it('falls through to the general tier and returns null when nothing is found', async () => {
    filesByMount({ 'm-general': 'General guidance.' });
    const hit = await resolveWardrobeInstructions({
      characterMountPointId: null,
      groupMountPointIds: [],
      projectMountPointIds: [],
    });
    expect(hit).toEqual({ content: 'General guidance.', tier: 'general', mountPointId: 'm-general' });

    filesByMount({});
    const miss = await resolveWardrobeInstructions({
      characterMountPointId: 'm-char',
      groupMountPointIds: ['m-group'],
      projectMountPointIds: [],
    });
    expect(miss).toBeNull();
  });

  it('skips the general tier when the General mount is unprovisioned', async () => {
    getGeneralMountPointIdMock.mockResolvedValue(null);
    filesByMount({ 'm-general': 'should never be read' });
    const result = await resolveWardrobeInstructions({
      characterMountPointId: null,
      groupMountPointIds: [],
      projectMountPointIds: [],
    });
    expect(result).toBeNull();
    expect(readVaultTextFileMock).not.toHaveBeenCalled();
  });

  it('probes multi-mount tiers deduped and in sorted order for determinism', async () => {
    filesByMount({});
    await resolveWardrobeInstructions({
      characterMountPointId: null,
      groupMountPointIds: ['m-b', 'm-a', 'm-b'],
      projectMountPointIds: ['m-z', 'm-y'],
    });
    const probedMounts = readVaultTextFileMock.mock.calls.map((c) => c[0]);
    expect(probedMounts).toEqual(['m-a', 'm-b', 'm-y', 'm-z', 'm-general']);
  });
});

describe('readWardrobeInstructionsFile', () => {
  it('returns trimmed content, and null for blank or missing files', async () => {
    filesByMount({ 'm-1': '  hello  ' });
    await expect(readWardrobeInstructionsFile('m-1')).resolves.toBe('hello');
    filesByMount({ 'm-1': '   ' });
    await expect(readWardrobeInstructionsFile('m-1')).resolves.toBeNull();
    filesByMount({});
    await expect(readWardrobeInstructionsFile('m-1')).resolves.toBeNull();
  });
});

describe('writeWardrobeInstructionsFile', () => {
  it('writes trimmed content after ensuring the Wardrobe folder', async () => {
    await writeWardrobeInstructionsFile('m-1', '  You wear tweed.  ');
    expect(ensureFolderPathMock).toHaveBeenCalledWith('m-1', 'Wardrobe');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', PATH, 'You wear tweed.');
    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('clears by deleting, tolerating a missing file', async () => {
    deleteDatabaseDocumentMock.mockRejectedValue(new DatabaseStoreError('nope', 'NOT_FOUND'));
    await expect(writeWardrobeInstructionsFile('m-1', null)).resolves.toBeUndefined();
    await expect(writeWardrobeInstructionsFile('m-1', '   ')).resolves.toBeUndefined();
    expect(deleteDatabaseDocumentMock).toHaveBeenCalledTimes(2);
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('rethrows non-NOT_FOUND delete failures', async () => {
    deleteDatabaseDocumentMock.mockRejectedValue(new DatabaseStoreError('locked', 'IO_ERROR'));
    await expect(writeWardrobeInstructionsFile('m-1', null)).rejects.toThrow('locked');
  });
});
