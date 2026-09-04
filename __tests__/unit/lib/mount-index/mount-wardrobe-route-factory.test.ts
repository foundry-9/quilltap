/**
 * The shared bodies behind the group and project wardrobe endpoints.
 *
 * Four route files collapsed into one factory. The behaviours worth pinning are
 * the ones whose failure is quiet:
 *
 *   - **`?action=instructions` must not fall through to the item CRUD.** A
 *     dispatch that misses would POST the instructions body at the create
 *     handler, where `createWardrobeSchema` rejects it — an instructions save
 *     that 400s for reasons naming a field the user never saw.
 *   - **The collection GET honours `?includeArchived`; the *create* response
 *     never does.** After a create the client re-renders from the list that
 *     comes back, and asking for the archived-free list there would blank the
 *     archived rows the dialog was showing a moment earlier.
 *   - **Archiving is idempotent.** Re-archiving must keep the original stamp,
 *     because `archivedAt` is what the UI dates the tombstone by.
 *   - **A component cycle is a 400, not a 500.** The vault writer throws a
 *     plain `Error`, and only the message distinguishes user error from a
 *     broken store.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler:
    (handler: (req: never, ctx: never, params: never) => Promise<unknown>) => handler,
  withActionDispatch: jest.requireActual('@/lib/api/middleware/actions').withActionDispatch,
}));

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  createProjectWardrobeItem: jest.fn(),
  updateProjectWardrobeItem: jest.fn(),
  deleteProjectWardrobeItem: jest.fn(),
}));

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}));

import {
  createMountWardrobeHandlers,
  createMountWardrobeItemHandlers,
} from '@/lib/mount-index/mount-wardrobe-route-factory';
import {
  createProjectWardrobeItem,
  deleteProjectWardrobeItem,
  updateProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';

const mockCreate = jest.mocked(createProjectWardrobeItem);
const mockUpdate = jest.mocked(updateProjectWardrobeItem);
const mockDelete = jest.mocked(deleteProjectWardrobeItem);
const mockReadInstructions = jest.mocked(readWardrobeInstructionsFile);
const mockWriteInstructions = jest.mocked(writeWardrobeInstructionsFile);

let findOwner: jest.Mock;
let ensureOfficialStore: jest.Mock;
let readWardrobe: jest.Mock;
let ensureWardrobeFolder: jest.Mock;
let removeEquippedItemFromAllChats: jest.Mock;

const BASE = {
  ownerLabel: 'Project' as const,
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
};

function collection(extra: { logListedItems?: jest.Mock } = {}) {
  return createMountWardrobeHandlers({
    ...BASE,
    findOwner: findOwner as never,
    ensureOfficialStore: ensureOfficialStore as never,
    readWardrobe: readWardrobe as never,
    ensureWardrobeFolder: ensureWardrobeFolder as never,
    ...extra,
  });
}

function item() {
  return createMountWardrobeItemHandlers({
    ...BASE,
    findOwner: findOwner as never,
    ensureOfficialStore: ensureOfficialStore as never,
    readWardrobe: readWardrobe as never,
  });
}

/**
 * The request shape these handlers read: `url` for `readIncludeArchived`,
 * `nextUrl` for the action dispatcher, `method` for its log line, `json()` for
 * the body.
 */
function req(url: string, body?: unknown, method = 'GET') {
  return { url, nextUrl: new URL(url), method, json: async () => body } as never;
}

function ctx() {
  return {
    user: { id: 'user-1' },
    repos: { chats: { removeEquippedItemFromAllChats } },
  } as never;
}

function wardrobeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    characterId: null,
    title: 'Greatcoat',
    description: null,
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findOwner = jest.fn().mockResolvedValue({ id: 'proj-1', name: 'The Estate' });
  ensureOfficialStore = jest.fn().mockResolvedValue({ mountPointId: 'mount-1' });
  readWardrobe = jest.fn().mockResolvedValue([wardrobeItem()]);
  ensureWardrobeFolder = jest.fn().mockResolvedValue(undefined);
  removeEquippedItemFromAllChats = jest.fn().mockResolvedValue(undefined);
  mockCreate.mockImplementation(async (_mount, i) => i as never);
  mockUpdate.mockResolvedValue(wardrobeItem({ title: 'Updated' }) as never);
  mockDelete.mockResolvedValue(true as never);
  mockReadInstructions.mockResolvedValue(null as never);
  mockWriteInstructions.mockResolvedValue(undefined as never);
});

describe('collection GET — listing', () => {
  it('ensures the store and folder, then answers the list with its mount', async () => {
    const res = await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(ensureOfficialStore).toHaveBeenCalledWith('proj-1', 'The Estate');
    expect(ensureWardrobeFolder).toHaveBeenCalledWith('mount-1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      mountPointId: 'mount-1',
      wardrobeItems: [wardrobeItem()],
    });
  });

  it('honours ?includeArchived', async () => {
    await collection().GET(req('https://x.test/?includeArchived=true'), ctx(), { id: 'proj-1' });
    expect(readWardrobe).toHaveBeenLastCalledWith('mount-1', true);

    await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' });
    expect(readWardrobe).toHaveBeenLastCalledWith('mount-1', false);
  });

  it('404s when the owner is gone', async () => {
    findOwner.mockResolvedValue(null);

    const res = await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(res.status).toBe(404);
    expect(ensureOfficialStore).not.toHaveBeenCalled();
  });

  it('500s when the store cannot be ensured', async () => {
    ensureOfficialStore.mockResolvedValue(null);

    const res = await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to ensure project document store',
    });
  });

  it('fires the optional listed-items hook only when the tier supplies one', async () => {
    const logListedItems = jest.fn();

    await collection({ logListedItems }).GET(req('https://x.test/'), ctx(), { id: 'proj-1' });
    expect(logListedItems).toHaveBeenCalledWith({
      ownerId: 'proj-1',
      mountPointId: 'mount-1',
      count: 1,
    });

    await expect(
      collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' })
    ).resolves.toBeDefined()
  });
});

describe('collection POST — create', () => {
  it('creates the item and answers the ARCHIVE-INCLUSIVE list', async () => {
    const res = await collection().POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(res.status).toBe(201);
    // The client re-renders from this list; asking for the archived-free one
    // would blank rows the dialog was showing a moment earlier.
    expect(readWardrobe).toHaveBeenCalledWith('mount-1', true);
    await expect(res.json()).resolves.toMatchObject({
      mountPointId: 'mount-1',
      wardrobeItem: expect.objectContaining({ title: 'Greatcoat' }),
    });
  });

  it('stamps a fresh id and timestamps rather than trusting the body', async () => {
    await collection().POST(
      req('https://x.test/', { id: 'attacker-chosen', title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: 'proj-1' }
    );

    const stored = mockCreate.mock.calls[0][1] as { id: string; createdAt: string };
    expect(stored.id).not.toBe('attacker-chosen');
    expect(stored.createdAt).toEqual(expect.any(String));
  });

  it('turns a component cycle into a 400, not a 500', async () => {
    mockCreate.mockRejectedValue(new Error('Refusing the write: component cycle detected'));

    const res = await collection().POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Refusing the write: component cycle detected',
    });
  });

  it('lets any other writer failure propagate', async () => {
    mockCreate.mockRejectedValue(new Error('store unreachable'));

    await expect(
      collection().POST(
        req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
        ctx(),
        { id: 'proj-1' }
      )
    ).rejects.toThrow('store unreachable');
  });
});

describe('?action=instructions does not fall through to item CRUD', () => {
  it('GET reads the tier\'s own file', async () => {
    mockReadInstructions.mockResolvedValue('Dress for the season.' as never);

    const res = await collection().GET(
      req('https://x.test/?action=instructions'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(mockReadInstructions).toHaveBeenCalledWith('mount-1');
    expect(readWardrobe).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ instructions: 'Dress for the season.' });
  });

  it('POST writes it — createWardrobeSchema never sees the body', async () => {
    const res = await collection().POST(
      req('https://x.test/?action=instructions', { instructions: 'Wear the greatcoat.' }, 'POST'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(mockWriteInstructions).toHaveBeenCalledWith('mount-1', 'Wear the greatcoat.');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ instructions: 'Wear the greatcoat.' })
  });

  it('POST ensures the folder before writing — the file lives inside it', async () => {
    await collection().POST(
      req('https://x.test/?action=instructions', { instructions: 'x' }, 'POST'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(ensureWardrobeFolder).toHaveBeenCalledWith('mount-1');
  });

  it('404s on a missing owner before reading a file', async () => {
    findOwner.mockResolvedValue(null);

    const res = await collection().GET(
      req('https://x.test/?action=instructions'),
      ctx(),
      { id: 'proj-1' }
    );

    expect(res.status).toBe(404);
    expect(mockReadInstructions).not.toHaveBeenCalled();
  });
});

describe('item GET', () => {
  it('finds the item in the archive-inclusive list', async () => {
    const res = await item().GET(req('https://x.test/'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(readWardrobe).toHaveBeenCalledWith('mount-1', true);
    await expect(res.json()).resolves.toEqual({ wardrobeItem: wardrobeItem() });
  });

  it('404s on an unknown item', async () => {
    const res = await item().GET(req('https://x.test/'), ctx(), {
      id: 'proj-1',
      itemId: 'nope',
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Project wardrobe item not found' });
  });

  it('404s when the owner has no store', async () => {
    ensureOfficialStore.mockResolvedValue(null);

    const res = await item().GET(req('https://x.test/'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(404);
  });
});

describe('item PUT — archiving', () => {
  it('stamps archivedAt when archiving a live item', async () => {
    const res = await item().PUT(req('https://x.test/', { archived: true }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(200);
    const patch = mockUpdate.mock.calls[0][2] as { archivedAt?: string | null };
    expect(patch.archivedAt).toEqual(expect.any(String));
  });

  it('is idempotent — re-archiving keeps the original stamp', async () => {
    readWardrobe.mockResolvedValue([wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' })]);

    await item().PUT(req('https://x.test/', { archived: true }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    const patch = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('archivedAt');
  });

  it('clears the stamp when restoring', async () => {
    readWardrobe.mockResolvedValue([wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' })]);

    await item().PUT(req('https://x.test/', { archived: false }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    const patch = mockUpdate.mock.calls[0][2] as { archivedAt?: string | null };
    expect(patch.archivedAt).toBeNull();
  });

  it('never touches archivedAt when the body does not mention it', async () => {
    await item().PUT(req('https://x.test/', { title: 'Overcoat' }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    const patch = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('archivedAt');
    expect(patch).toMatchObject({ title: 'Overcoat' });
  });

  it('404s on an unknown item before writing', async () => {
    const res = await item().PUT(req('https://x.test/', { archived: true }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'nope',
    });

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('turns a component cycle into a 400', async () => {
    mockUpdate.mockRejectedValue(new Error('component cycle detected'));

    const res = await item().PUT(
      req('https://x.test/', { componentItemIds: ['item-1'] }, 'PUT'),
      ctx(),
      { id: 'proj-1', itemId: 'item-1' }
    );

    expect(res.status).toBe(400);
  });

  it('404s when the writer reports the item vanished mid-flight', async () => {
    mockUpdate.mockResolvedValue(null as never);

    const res = await item().PUT(req('https://x.test/', { title: 'Overcoat' }, 'PUT'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(404);
  });
});

describe('item DELETE', () => {
  it('clears equipped references before deleting', async () => {
    const order: string[] = [];
    removeEquippedItemFromAllChats.mockImplementation(async () => {
      order.push('cleanup');
    });
    mockDelete.mockImplementation(async () => {
      order.push('delete');
      return true as never;
    });

    const res = await item().DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(order).toEqual(['cleanup', 'delete']);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it('deletes anyway when the cleanup fails — a dangling reference is harmless', async () => {
    removeEquippedItemFromAllChats.mockRejectedValue(new Error('chats db busy'));

    const res = await item().DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(mockDelete).toHaveBeenCalledWith('mount-1', 'item-1');
    expect(res.status).toBe(200);
  });

  it('404s when there was nothing to delete', async () => {
    mockDelete.mockResolvedValue(false as never);

    const res = await item().DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(404);
  });
});

describe('the tier label follows the config', () => {
  it('says Group when built for the group tier', async () => {
    findOwner.mockResolvedValue(null);
    const { GET } = createMountWardrobeItemHandlers({
      ownerLabel: 'Group',
      logTag: '[Groups v1]',
      logIdKey: 'groupId',
      findOwner: findOwner as never,
      ensureOfficialStore: ensureOfficialStore as never,
      readWardrobe: readWardrobe as never,
    });

    const res = await GET(req('https://x.test/'), ctx(), { id: 'group-1', itemId: 'item-1' });

    await expect(res.json()).resolves.toEqual({ error: 'Group not found' });
  });
});
