import { reconcileRelationships } from '@/lib/import/quilltap-import/reconcile';
import { deleteStoreCascade } from '@/lib/mount-index/delete-store-cascade';
import { getRepositories } from '@/lib/repositories/factory';

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

jest.mock('@/lib/mount-index/delete-store-cascade', () => ({
  deleteStoreCascade: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

type IdMapOverrides = Partial<Record<string, Map<string, string> | Set<string>>>;

function makeIdMaps(overrides: IdMapOverrides = {}): any {
  return {
    tags: new Map(),
    characters: new Map([['source-character-id', 'char-1']]),
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
    ...overrides,
  };
}

function makeRepos(character: Record<string, unknown>, files: Record<string, unknown> = {}) {
  const update = jest.fn().mockResolvedValue(character);
  const repos = {
    characters: {
      findById: jest.fn().mockResolvedValue(character),
      update,
    },
    chats: { findById: jest.fn().mockResolvedValue(null) },
    projects: { findById: jest.fn().mockResolvedValue(null) },
    groups: { findById: jest.fn().mockResolvedValue(null) },
    connections: { findById: jest.fn().mockResolvedValue(null) },
    imageProfiles: { findById: jest.fn().mockResolvedValue(null) },
    embeddingProfiles: { findById: jest.fn().mockResolvedValue(null) },
    files: {
      findById: jest.fn(async (id: string) => (files as Record<string, unknown>)[id] ?? null),
    },
  } as any;
  return { repos, update };
}

/**
 * Global (instance-scoped) repos: only the document-store surface is used.
 *
 * `staleReads: true` keeps a cascaded-away store visible to findAll, standing
 * in for a cache that has not caught up yet.
 */
function installGlobalRepos(
  stores: Array<{ id: string; name: string }>,
  { staleReads = false }: { staleReads?: boolean } = {}
) {
  let live = [...stores];
  if (!staleReads) {
    (deleteStoreCascade as jest.Mock).mockImplementation((id: string) => {
      live = live.filter((s) => s.id !== id);
      return {};
    });
  }
  const update = jest.fn().mockResolvedValue(null);
  (getRepositories as jest.Mock).mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) => live.find((s) => s.id === id) ?? null),
      findAll: jest.fn(async () => live),
      update,
    },
    roleplayTemplates: { findById: jest.fn().mockResolvedValue(null) },
  });
  return { docMountPointsUpdate: update };
}

beforeEach(() => {
  jest.clearAllMocks();
  installGlobalRepos([]);
});

describe('reconcileRelationships avatar remapping', () => {
  it('remaps character avatar link ids through the document-store link map', async () => {
    const character = {
      id: 'char-1',
      name: 'Ada',
      userId: 'user-1',
      tags: [],
      defaultImageId: 'source-link-id',
      avatarOverrides: [{ chatId: 'chat-1', imageId: 'source-link-id' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { repos, update } = makeRepos(character);

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({ docMountFileLinks: new Map([['source-link-id', 'imported-link-id']]) }),
      []
    );

    expect(update).toHaveBeenCalledWith(
      'char-1',
      expect.objectContaining({
        defaultImageId: 'imported-link-id',
        avatarOverrides: [{ chatId: 'chat-1', imageId: 'imported-link-id' }],
      })
    );
  });

  it('leaves a legacy files.id avatar alone', async () => {
    const character = {
      id: 'char-1',
      name: 'Ada',
      userId: 'user-1',
      tags: [],
      defaultImageId: 'legacy-file-id',
      avatarOverrides: [{ chatId: 'chat-1', imageId: 'legacy-file-id' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // The dual-shape avatar: an id that resolves in the files table, not the vault.
    const { repos, update } = makeRepos(character, { 'legacy-file-id': { id: 'legacy-file-id' } });
    const warnings: string[] = [];

    await reconcileRelationships('user-1', repos, makeIdMaps(), warnings);

    expect(warnings).toEqual([]);
    // Nothing moved, so nothing is written.
    expect(update).not.toHaveBeenCalled();
  });

  it('drops an unmappable avatar override instead of nulling its imageId', async () => {
    const character = {
      id: 'char-1',
      name: 'Ada',
      userId: 'user-1',
      tags: [],
      avatarOverrides: [
        { chatId: 'chat-1', imageId: 'source-link-id' },
        { chatId: 'chat-2', imageId: 'vanished-link-id' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { repos, update } = makeRepos(character);
    const warnings: string[] = [];

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({ docMountFileLinks: new Map([['source-link-id', 'imported-link-id']]) }),
      warnings
    );

    // A null imageId would violate the schema on the next validated read, so
    // the entry goes rather than the id.
    expect(update).toHaveBeenCalledWith(
      'char-1',
      expect.objectContaining({
        avatarOverrides: [{ chatId: 'chat-1', imageId: 'imported-link-id' }],
      })
    );
    const written = update.mock.calls[0][1].avatarOverrides;
    expect(written.some((o: { imageId: string | null }) => o.imageId === null)).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('does not write when overrides exist but nothing changed', async () => {
    const character = {
      id: 'char-1',
      name: 'Ada',
      userId: 'user-1',
      tags: [],
      avatarOverrides: [{ chatId: 'chat-1', imageId: 'legacy-file-id' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { repos, update } = makeRepos(character, { 'legacy-file-id': { id: 'legacy-file-id' } });

    await reconcileRelationships('user-1', repos, makeIdMaps(), []);

    expect(update).not.toHaveBeenCalled();
  });
});

describe('reconcileRelationships scaffold-vault replacement', () => {
  const character = () => ({
    id: 'char-1',
    name: 'Ada',
    userId: 'user-1',
    tags: [],
    // What `characters.create()` left behind: a freshly provisioned empty vault.
    characterDocumentMountPointId: 'scaffold-mount',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('repoints the character at the imported vault and deletes the scaffold', async () => {
    const { repos, update } = makeRepos(character());
    installGlobalRepos([
      { id: 'scaffold-mount', name: 'Ada Character Vault' },
      { id: 'imported-mount', name: 'Ada Character Vault (2)' },
    ]);

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({
        characterVaultMounts: new Map([['char-1', 'source-mount']]),
        mountPoints: new Map([['source-mount', 'imported-mount']]),
      }),
      []
    );

    expect(update).toHaveBeenCalledWith(
      'char-1',
      expect.objectContaining({ characterDocumentMountPointId: 'imported-mount' })
    );
    expect(deleteStoreCascade).toHaveBeenCalledWith('scaffold-mount');
  });

  it('repoints before deleting, never the other way round', async () => {
    const order: string[] = [];
    const { repos, update } = makeRepos(character());
    installGlobalRepos([
      { id: 'scaffold-mount', name: 'Ada Character Vault' },
      { id: 'imported-mount', name: 'Ada Character Vault (2)' },
    ]);

    update.mockImplementation(async () => {
      order.push('update');
      return null;
    });
    // Keep installGlobalRepos' bookkeeping, just note when it runs.
    const cascade = (deleteStoreCascade as jest.Mock).getMockImplementation()!;
    (deleteStoreCascade as jest.Mock).mockImplementation((id: string) => {
      order.push('cascade');
      return cascade(id);
    });

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({
        characterVaultMounts: new Map([['char-1', 'source-mount']]),
        mountPoints: new Map([['source-mount', 'imported-mount']]),
      }),
      []
    );

    // Reversed, the row would briefly point at a store that no longer exists
    // and any overlay read in that window throws.
    expect(order).toEqual(['update', 'cascade']);
  });

  it('hands the canonical vault name back once the scaffold is gone', async () => {
    const { repos } = makeRepos(character());
    const { docMountPointsUpdate } = installGlobalRepos([
      { id: 'scaffold-mount', name: 'Ada Character Vault' },
      { id: 'imported-mount', name: 'Ada Character Vault (2)' },
    ]);

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({
        characterVaultMounts: new Map([['char-1', 'source-mount']]),
        mountPoints: new Map([['source-mount', 'imported-mount']]),
      }),
      []
    );

    expect(docMountPointsUpdate).toHaveBeenCalledWith('imported-mount', {
      name: 'Ada Character Vault',
    });
  });

  it('renames even when the store list has not yet noticed the deletion', async () => {
    const { repos } = makeRepos(character());
    const { docMountPointsUpdate } = installGlobalRepos(
      [
        { id: 'scaffold-mount', name: 'Ada Character Vault' },
        { id: 'imported-mount', name: 'Ada Character Vault (2)' },
      ],
      { staleReads: true }
    );

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({
        characterVaultMounts: new Map([['char-1', 'source-mount']]),
        mountPoints: new Map([['source-mount', 'imported-mount']]),
      }),
      []
    );

    // The scaffold must not count as holding its own name after we deleted it.
    expect(docMountPointsUpdate).toHaveBeenCalledWith('imported-mount', {
      name: 'Ada Character Vault',
    });
  });

  it('leaves the scaffold alone for a pre-A2 bundle that carried no vault', async () => {
    const { repos, update } = makeRepos(character());
    installGlobalRepos([{ id: 'scaffold-mount', name: 'Ada Character Vault' }]);

    await reconcileRelationships('user-1', repos, makeIdMaps(), []);

    expect(deleteStoreCascade).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the scaffold when the bundle vault failed to import', async () => {
    const { repos } = makeRepos(character());
    installGlobalRepos([{ id: 'scaffold-mount', name: 'Ada Character Vault' }]);

    await reconcileRelationships(
      'user-1',
      repos,
      makeIdMaps({
        characterVaultMounts: new Map([['char-1', 'source-mount']]),
        // mountPoints has no entry: the store import failed or was skipped.
      }),
      []
    );

    expect(deleteStoreCascade).not.toHaveBeenCalled();
  });
});
