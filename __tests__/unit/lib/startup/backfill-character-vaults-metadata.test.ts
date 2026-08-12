/**
 * The startup backfill's fact-sheet seeding.
 *
 * Every character vault provisioned before `metadata.json` existed lacks the
 * file. Hydration copes — absence reads as `{}` — but the file manager is the
 * only surface on which a fact sheet can be edited, so a character with no file
 * has nothing to open and the feature is unreachable for them. This is the pass
 * that closes that gap, and it must do so without ever disturbing a sheet the
 * user has already written.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));

jest.mock('@/lib/mount-index/character-scaffold', () => ({
  ensureCharacterMetadataFile: jest.fn(),
}));

jest.mock('@/lib/database/repositories/character-properties-overlay', () => ({
  readCharacterVaultProperties: jest.fn(),
  writeCharacterVaultManagedFields: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/startup/progress', () => ({
  startupProgress: {
    setCurrent: jest.fn(),
    setSubProgress: jest.fn(),
    publish: jest.fn(),
  },
}));

import { backfillCharacterVaults } from '@/lib/startup/backfill-character-vaults';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { ensureCharacterMetadataFile } from '@/lib/mount-index/character-scaffold';
import {
  readCharacterVaultProperties,
  writeCharacterVaultManagedFields,
} from '@/lib/database/repositories/character-properties-overlay';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const ensureCharacterVaultMock = ensureCharacterVault as jest.Mock;
const ensureCharacterMetadataFileMock = ensureCharacterMetadataFile as jest.Mock;
const readCharacterVaultPropertiesMock = readCharacterVaultProperties as jest.Mock;
const writeCharacterVaultManagedFieldsMock = writeCharacterVaultManagedFields as jest.Mock;

const VALID_PROPS = { pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0.5 };

function wireRoster(characters: Array<{ id: string; name: string }>) {
  getRepositoriesMock.mockReturnValue({
    characters: { findAllRaw: jest.fn().mockResolvedValue(characters) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  readCharacterVaultPropertiesMock.mockResolvedValue(VALID_PROPS);
  ensureCharacterMetadataFileMock.mockResolvedValue(false);
  writeCharacterVaultManagedFieldsMock.mockResolvedValue(undefined);
});

describe('backfillCharacterVaults — seeding fact sheets', () => {
  it('seeds every already-linked vault that lacks a fact sheet', async () => {
    wireRoster([{ id: 'a', name: 'Bertie' }, { id: 'b', name: 'Jeeves' }]);
    ensureCharacterVaultMock.mockImplementation((c: { id: string }) =>
      Promise.resolve({ mountPointId: `mp-${c.id}`, created: false }),
    );
    ensureCharacterMetadataFileMock.mockResolvedValue(true);

    const result = await backfillCharacterVaults();

    expect(result.metadataSeeded).toBe(2);
    expect(ensureCharacterMetadataFileMock).toHaveBeenCalledWith('mp-a');
    expect(ensureCharacterMetadataFileMock).toHaveBeenCalledWith('mp-b');
  });

  it('counts only the vaults that actually needed one', async () => {
    wireRoster([{ id: 'a', name: 'Bertie' }, { id: 'b', name: 'Jeeves' }]);
    ensureCharacterVaultMock.mockImplementation((c: { id: string }) =>
      Promise.resolve({ mountPointId: `mp-${c.id}`, created: false }),
    );
    // Bertie's vault already carries a sheet; Jeeves's does not.
    ensureCharacterMetadataFileMock.mockImplementation((mp: string) => Promise.resolve(mp === 'mp-b'));

    expect((await backfillCharacterVaults()).metadataSeeded).toBe(1);
  });

  it('does not re-seed a freshly created vault', async () => {
    // ensureCharacterVault already scaffolds one; a second pass would be waste.
    wireRoster([{ id: 'a', name: 'Bertie' }]);
    ensureCharacterVaultMock.mockResolvedValue({ mountPointId: 'mp-a', created: true });

    const result = await backfillCharacterVaults();

    expect(ensureCharacterMetadataFileMock).not.toHaveBeenCalled();
    expect(result.vaultsCreated).toBe(1);
    expect(result.metadataSeeded).toBe(0);
  });

  it('seeds an adopted vault, which the scaffold never touched', async () => {
    // Adoption early-returns inside ensureCharacterVault before any scaffolding,
    // so an adopted vault can arrive here with no fact sheet at all.
    wireRoster([{ id: 'a', name: 'Bertie' }]);
    ensureCharacterVaultMock.mockResolvedValue({ mountPointId: 'mp-old', created: false, adopted: true });
    ensureCharacterMetadataFileMock.mockResolvedValue(true);

    expect((await backfillCharacterVaults()).metadataSeeded).toBe(1);
    expect(ensureCharacterMetadataFileMock).toHaveBeenCalledWith('mp-old');
  });

  it('still seeds a vault it had to repopulate', async () => {
    // The repopulate projection runs from a RAW row, which cannot carry
    // metadata — so it deliberately writes no metadata.json at all. Without the
    // seed, a healed vault would come away with no sheet.
    wireRoster([{ id: 'a', name: 'Bertie' }]);
    ensureCharacterVaultMock.mockResolvedValue({ mountPointId: 'mp-a', created: false });
    readCharacterVaultPropertiesMock.mockResolvedValue(null);
    ensureCharacterMetadataFileMock.mockResolvedValue(true);

    const result = await backfillCharacterVaults();

    expect(result.filesRepopulated).toBe(1);
    expect(result.metadataSeeded).toBe(1);
    expect(writeCharacterVaultManagedFieldsMock).toHaveBeenCalled();
  });

  it('carries on seeding the rest of the roster when one character fails', async () => {
    wireRoster([{ id: 'a', name: 'Bertie' }, { id: 'b', name: 'Jeeves' }]);
    ensureCharacterVaultMock.mockImplementation((c: { id: string }) =>
      c.id === 'a' ? Promise.reject(new Error('vault is on fire')) : Promise.resolve({ mountPointId: 'mp-b', created: false }),
    );
    ensureCharacterMetadataFileMock.mockResolvedValue(true);

    const result = await backfillCharacterVaults();

    expect(result.errors).toBe(1);
    expect(result.metadataSeeded).toBe(1);
  });
});
