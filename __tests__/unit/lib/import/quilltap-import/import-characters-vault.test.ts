/**
 * WP A2 bookkeeping: which vault a character's bundle claimed.
 *
 * `characters.create()` deliberately drops the incoming
 * `characterDocumentMountPointId` and provisions a scaffold vault of its own,
 * so after the create the row no longer remembers which store the bundle
 * meant. `importCharacters` records it on the id maps instead — that record is
 * the only thing letting reconciliation repoint the character at its imported
 * vault and tear the scaffold down.
 */

import { importCharacters } from '@/lib/import/quilltap-import/import-characters';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

function makeIdMaps(): any {
  return {
    tags: new Map(),
    characters: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
    docMountFileLinks: new Map(),
    characterVaultMounts: new Map(),
    skippedCharacterVaults: new Set(),
    preserveIdsSkips: new Set(),
  };
}

function exportedCharacter(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'source-char',
    userId: 'user-1',
    name: 'Ada',
    tags: [],
    scenarios: [],
    characterDocumentMountPointId: 'source-mount',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** @param existing a character already in the target instance, if any. */
function installRepos(existing: Record<string, unknown> | null) {
  const create = jest.fn(async () => ({ id: 'new-char', name: 'Ada' }));
  (getUserRepositories as jest.Mock).mockReturnValue({
    characters: {
      findAll: jest.fn(async () => (existing ? [existing] : [])),
      findById: jest.fn(async (id: string) =>
        existing && (existing as { id: string }).id === id ? existing : null
      ),
      create,
      delete: jest.fn(async () => true),
    },
  });
  (getRepositories as jest.Mock).mockReturnValue({
    wardrobe: { create: jest.fn() },
    characterPluginData: { setPluginData: jest.fn() },
  });
  return { create };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('importCharacters — vault bookkeeping', () => {
  it('records the vault the bundle claimed for a newly created character', async () => {
    installRepos(null);
    const idMaps = makeIdMaps();

    const counts = await importCharacters(
      'user-1',
      [exportedCharacter()],
      { conflictStrategy: 'duplicate', includeMemories: false, includeRelatedEntities: false } as any,
      idMaps,
      (getUserRepositories as jest.Mock)('user-1'),
      []
    );

    expect(counts.imported).toBe(1);
    expect(idMaps.characterVaultMounts.get('new-char')).toBe('source-mount');
    expect(idMaps.skippedCharacterVaults.size).toBe(0);
  });

  it('records nothing for a pre-A2 character that carried no vault', async () => {
    installRepos(null);
    const idMaps = makeIdMaps();

    await importCharacters(
      'user-1',
      [exportedCharacter({ characterDocumentMountPointId: null })],
      { conflictStrategy: 'duplicate', includeMemories: false, includeRelatedEntities: false } as any,
      idMaps,
      (getUserRepositories as jest.Mock)('user-1'),
      []
    );

    // Nothing recorded means reconciliation leaves the scaffold vault standing,
    // which is the correct outcome for a bundle with no store to replace it.
    expect(idMaps.characterVaultMounts.size).toBe(0);
  });

  it('marks a skipped character vault as not-to-be-imported', async () => {
    installRepos({ id: 'existing-char', name: 'Ada' });
    const idMaps = makeIdMaps();

    const counts = await importCharacters(
      'user-1',
      [exportedCharacter()],
      { conflictStrategy: 'skip', includeMemories: false, includeRelatedEntities: false } as any,
      idMaps,
      (getUserRepositories as jest.Mock)('user-1'),
      []
    );

    expect(counts.skipped).toBe(1);
    // The existing character keeps its own vault, so importing the bundle's
    // copy would strand a store nothing points at.
    expect(idMaps.skippedCharacterVaults.has('source-mount')).toBe(true);
    expect(idMaps.characterVaultMounts.size).toBe(0);
  });
});
