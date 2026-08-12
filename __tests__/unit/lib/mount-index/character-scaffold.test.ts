/**
 * Unit tests for lib/mount-index/character-scaffold.ts
 *
 * Tests cover the preset structure that is materialized when a
 * database-backed character store is created or flipped to 'character'.
 *
 * Strategy: Mock getRepositories, ensureFolderPath, and writeDatabaseDocument.
 * No real database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn().mockResolvedValue({ mtime: 0 }),
}));

import { scaffoldCharacterMount, ensureCharacterMetadataFile } from '@/lib/mount-index/character-scaffold';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const ensureFolderPathMock = ensureFolderPath as jest.MockedFunction<typeof ensureFolderPath>;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.MockedFunction<typeof writeDatabaseDocument>;

const MOUNT_ID = 'mount-abc';

function makeRepos(overrides: {
  mountPoint?: Partial<{ mountType: string; storeType: string; name: string }> | null;
  existingDocuments?: string[];
  existingFolders?: string[];
} = {}) {
  const mp = overrides.mountPoint === null ? null : {
    id: MOUNT_ID,
    name: 'Char Store',
    mountType: 'database',
    storeType: 'character',
    ...overrides.mountPoint,
  };
  const existingDocs = new Set(overrides.existingDocuments ?? []);
  const existingFolders = new Set(overrides.existingFolders ?? []);

  return {
    docMountPoints: {
      findById: jest.fn().mockResolvedValue(mp),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn((_mountId: string, relPath: string) =>
        Promise.resolve(existingDocs.has(relPath) ? { id: `doc-${relPath}`, relativePath: relPath } : null),
      ),
    },
    docMountFolders: {
      findByMountPointAndPath: jest.fn((_mountId: string, path: string) =>
        Promise.resolve(existingFolders.has(path) ? { id: `folder-${path}`, path } : null),
      ),
    },
  };
}

describe('scaffoldCharacterMount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureFolderPathMock.mockResolvedValue('folder-id');
    writeDatabaseDocumentMock.mockResolvedValue({ mtime: 0 });
  });

  it('scaffolds the seeded files and seven folders on a fresh database-backed character mount', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 9, filesSkipped: 0, foldersCreated: 7 });
    expect(ensureFolderPathMock).toHaveBeenCalledTimes(7);
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Prompts');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Scenarios');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Wardrobe');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Outfits');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'lore');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'images');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'files');

    expect(writeDatabaseDocumentMock).toHaveBeenCalledTimes(9);
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'identity.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'description.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'manifesto.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'personality.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'physical-description.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'example-dialogues.md', '');
  });

  it('writes physical-prompts.json with null short/medium/long/complete for a fresh scaffold', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const call = writeDatabaseDocumentMock.mock.calls.find(c => c[1] === 'physical-prompts.json');
    expect(call).toBeDefined();
    const parsed = JSON.parse(call![2] as string);
    expect(parsed).toEqual({ short: null, medium: null, long: null, complete: null });
  });

  it('writes properties.json with pronouns, aliases, title, firstMessage, talkativeness, canChooseOutfit', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const propertiesCall = writeDatabaseDocumentMock.mock.calls.find(c => c[1] === 'properties.json');
    expect(propertiesCall).toBeDefined();
    const parsed = JSON.parse(propertiesCall![2] as string);
    expect(parsed).toEqual({
      pronouns: null,
      aliases: [],
      title: '',
      firstMessage: '',
      talkativeness: 0.5,
      canChooseOutfit: false,
    });
  });

  it('seeds metadata.json as an empty fact sheet — the keys are the user\'s to invent', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const call = writeDatabaseDocumentMock.mock.calls.find(c => c[1] === 'metadata.json');
    expect(call).toBeDefined();
    expect(JSON.parse(call![2] as string)).toEqual({});
  });

  it('never overwrites a fact sheet the user has already written', async () => {
    // The scaffold re-runs whenever a store is flipped to 'character', and
    // `ensureCharacterVault` re-runs it on adoption paths. A populated
    // metadata.json is user data; seeding over it would silently destroy it.
    const repos = makeRepos({ existingDocuments: ['metadata.json'] });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(writeDatabaseDocumentMock.mock.calls.map(c => c[1])).not.toContain('metadata.json');
    expect(result.filesSkipped).toBe(1);
  });

  it('does not seed a wardrobe.json — items live in Wardrobe/, presets in Outfits/', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(c => c[1]);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Wardrobe');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Outfits');
  });

  it('no-op when mountType is not database', async () => {
    const repos = makeRepos({ mountPoint: { mountType: 'filesystem' } });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(ensureFolderPathMock).not.toHaveBeenCalled();
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('no-op when storeType is not character', async () => {
    const repos = makeRepos({ mountPoint: { storeType: 'documents' } });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(ensureFolderPathMock).not.toHaveBeenCalled();
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('no-op when mount point does not exist', async () => {
    const repos = makeRepos({ mountPoint: null });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('is idempotent — pre-existing files are skipped, missing ones are still created', async () => {
    const repos = makeRepos({
      existingDocuments: ['identity.md', 'properties.json'],
      existingFolders: ['Prompts', 'lore'],
    });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result.filesCreated).toBe(7);
    expect(result.filesSkipped).toBe(2);
    expect(result.foldersCreated).toBe(5);

    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(c => c[1]);
    expect(writtenPaths).not.toContain('identity.md');
    expect(writtenPaths).not.toContain('properties.json');
    expect(writtenPaths).toContain('metadata.json');
    expect(writtenPaths).toContain('description.md');
    expect(writtenPaths).toContain('personality.md');
    expect(writtenPaths).toContain('physical-description.md');
    expect(writtenPaths).toContain('example-dialogues.md');
    expect(writtenPaths).not.toContain('wardrobe.json');
  });
});

/**
 * The startup backfill's entry point for healing vaults provisioned before the
 * fact sheet existed. Every character on an established roster is in exactly
 * that position, and with no file there is nothing for the file manager — the
 * only editing surface — to open.
 */
describe('ensureCharacterMetadataFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    writeDatabaseDocumentMock.mockResolvedValue({ mtime: 0 });
  });

  it('seeds an empty sheet into a vault that has none', async () => {
    getRepositoriesMock.mockReturnValue(makeRepos());

    await expect(ensureCharacterMetadataFile(MOUNT_ID)).resolves.toBe(true);

    expect(writeDatabaseDocumentMock).toHaveBeenCalledTimes(1);
    const [, path, content] = writeDatabaseDocumentMock.mock.calls[0];
    expect(path).toBe('metadata.json');
    expect(JSON.parse(content as string)).toEqual({});
  });

  it('leaves an existing sheet entirely alone', async () => {
    getRepositoriesMock.mockReturnValue(makeRepos({ existingDocuments: ['metadata.json'] }));

    await expect(ensureCharacterMetadataFile(MOUNT_ID)).resolves.toBe(false);

    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('checks for the file rather than parsing it', async () => {
    // A sheet the user has fat-fingered into invalid JSON is still their sheet.
    // Deciding by a parse would "heal" it into an empty object — destroying the
    // very hand-edit the file exists to accept.
    const repos = makeRepos({ existingDocuments: ['metadata.json'] });
    getRepositoriesMock.mockReturnValue(repos);

    await ensureCharacterMetadataFile(MOUNT_ID);

    expect(repos.docMountDocuments.findByMountPointAndPath).toHaveBeenCalledWith(MOUNT_ID, 'metadata.json');
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated boots', async () => {
    // It runs for every already-linked character on every startup.
    const seeded = new Set<string>();
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findByMountPointAndPath: jest.fn((_id: string, p: string) =>
          Promise.resolve(seeded.has(p) ? { id: 'doc', relativePath: p } : null),
        ),
      },
    });
    writeDatabaseDocumentMock.mockImplementation(async (_id: string, p: string) => {
      seeded.add(p);
      return { mtime: 0 };
    });

    expect(await ensureCharacterMetadataFile(MOUNT_ID)).toBe(true);
    expect(await ensureCharacterMetadataFile(MOUNT_ID)).toBe(false);
    expect(await ensureCharacterMetadataFile(MOUNT_ID)).toBe(false);
    expect(writeDatabaseDocumentMock).toHaveBeenCalledTimes(1);
  });
});
