/**
 * The shared GET / PUT / POST(?action=rename) / DELETE bodies behind the group
 * and project single-scenario endpoints.
 *
 * Two route files collapsed into one factory, so the thing worth pinning is
 * that the *shared* body still behaves per-tier where it must (labels, log
 * tags, folder constants) and identically where it must not vary. The four
 * behaviours below are the ones a caller can actually get hurt by:
 *
 *   - **Path resolution runs before anything else.** `..` and nested paths are
 *     refused with a 400 before a store is even looked up, which is what keeps
 *     a crafted `[scenarioPath]` from reading outside `Scenarios/`.
 *   - **PUT preserves an unmentioned archived flag.** The serializer rewrites
 *     the whole file, so an omitted `archived` would silently un-archive the
 *     scenario — a tombstone quietly resurrected.
 *   - **Rename refuses to clobber.** A colliding name is a 400, not a move that
 *     eats the destination.
 *   - **`?includeArchived` is honoured on every list that comes back**, or the
 *     dialog's view flips depending on which verb last ran.
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
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
}));

import { createScenarioItemHandlers } from '@/lib/mount-index/scenario-item-route-factory';
import {
  deleteDatabaseDocument,
  moveDatabaseDocument,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { isScenarioContentArchived } from '@/lib/mount-index/scenarios-common';

const mockWrite = jest.mocked(writeDatabaseDocument);
const mockDelete = jest.mocked(deleteDatabaseDocument);
const mockMove = jest.mocked(moveDatabaseDocument);

const FOLDER = 'Scenarios';

let findOwner: jest.Mock;
let ensureFolders: jest.Mock;
let listScenarios: jest.Mock;
let readScenario: jest.Mock;
let setScenarioDefault: jest.Mock;
let findByMountPointAndPath: jest.Mock;

function handlers() {
  return createScenarioItemHandlers({
    ownerLabel: 'Project',
    logTag: '[Projects v1]',
    logIdKey: 'projectId',
    scenariosFolder: FOLDER,
    findOwner: findOwner as never,
    ensureFolders: ensureFolders as never,
    listScenarios: listScenarios as never,
    readScenario: readScenario as never,
    setScenarioDefault: setScenarioDefault as never,
  });
}

/** The request shape the handlers actually read: `url` and `json()`. */
function req(url: string, body?: unknown) {
  return { url, json: async () => body } as never;
}

function ctx() {
  return {
    user: { id: 'user-1' },
    repos: { docMountDocuments: { findByMountPointAndPath } },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  findOwner = jest.fn().mockResolvedValue({ officialMountPointId: 'mount-1' });
  ensureFolders = jest.fn().mockResolvedValue(undefined);
  listScenarios = jest.fn().mockResolvedValue({ scenarios: [], warnings: [] });
  readScenario = jest.fn().mockResolvedValue({ path: 'Scenarios/tea.md', filename: 'tea', name: 'Tea' });
  setScenarioDefault = jest.fn().mockResolvedValue(undefined);
  findByMountPointAndPath = jest.fn().mockResolvedValue({ content: '---\nname: Tea\n---\n\nbody' });
  mockWrite.mockResolvedValue(undefined as never);
  mockDelete.mockResolvedValue(true as never);
  mockMove.mockResolvedValue(undefined as never);
});

describe('path resolution runs before the store is touched', () => {
  it.each([
    ['a traversal', 'Scenarios/../../secrets.md'],
    ['a nested path', 'Scenarios/sub/deep.md'],
    ['an empty path', '   '],
  ])('400s on %s without looking up the owner', async (_label, scenarioPath) => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath });

    expect(res.status).toBe(400);
    expect(findOwner).not.toHaveBeenCalled();
  });

  it('accepts a bare filename and prefixes the folder', async () => {
    const { GET } = handlers();

    await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(readScenario).toHaveBeenCalledWith('mount-1', 'Scenarios/tea.md');
  });

  it('accepts a URL-encoded filename', async () => {
    const { GET } = handlers();

    await GET(req('https://x.test/'), ctx(), {
      id: 'proj-1',
      scenarioPath: encodeURIComponent('a tea party.md'),
    });

    expect(readScenario).toHaveBeenCalledWith('mount-1', 'Scenarios/a tea party.md');
  });
});

describe('owner and store lookup', () => {
  it('404s when the owner does not exist', async () => {
    findOwner.mockResolvedValue(null);
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Project not found' });
  });

  it('404s with the remedy when the owner has no store yet', async () => {
    findOwner.mockResolvedValue({ officialMountPointId: null });
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error:
        'Project has no official document store yet — restart the server or call GET /scenarios first not found',
    });
  });

  it('ensures the tier\'s folders once the store is known', async () => {
    const { GET } = handlers();

    await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(ensureFolders).toHaveBeenCalledWith('mount-1');
  });

  it('404s when the file itself is absent', async () => {
    readScenario.mockResolvedValue(null);
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
  });

  it('answers the scenario on the happy path', async () => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      scenario: { path: 'Scenarios/tea.md', filename: 'tea', name: 'Tea' },
    });
  });
})

describe('PUT', () => {
  it('preserves an archived flag the body never mentions', async () => {
    findByMountPointAndPath.mockResolvedValue({
      content: '---\nname: Tea\narchived: true\n---\n\nold body',
    });
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'new body' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    const written = mockWrite.mock.calls[0][2] as string;
    expect(isScenarioContentArchived(written)).toBe(true);
  });

  it('honours an explicit archived: false', async () => {
    findByMountPointAndPath.mockResolvedValue({
      content: '---\nname: Tea\narchived: true\n---\n\nold body',
    });
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'new body', archived: false }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    const written = mockWrite.mock.calls[0][2] as string;
    expect(isScenarioContentArchived(written)).toBe(false);
  });

  it('404s rather than creating a file that is not there', async () => {
    findByMountPointAndPath.mockResolvedValue(null);
    const { PUT } = handlers();

    const res = await PUT(req('https://x.test/', { body: 'new body' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(404);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('400s on an invalid body without writing', async () => {
    const { PUT } = handlers();

    const res = await PUT(req('https://x.test/', { body: '' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('promotes the default only when asked', async () => {
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect(setScenarioDefault).not.toHaveBeenCalled();

    await PUT(req('https://x.test/', { body: 'b', isDefault: true }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });
    expect(setScenarioDefault).toHaveBeenCalledWith('mount-1', 'Scenarios/tea.md');
  });

  it('honours ?includeArchived on the list it answers with', async () => {
    const { PUT } = handlers();

    await PUT(req('https://x.test/?includeArchived=true', { body: 'b' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });
    expect(listScenarios).toHaveBeenLastCalledWith('mount-1', { includeArchived: true });

    await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect(listScenarios).toHaveBeenLastCalledWith('mount-1', { includeArchived: false });
  });
});

describe('POST ?action=rename', () => {
  it('refuses an unknown action before doing anything', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=archive', {}), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Unknown action — supported: rename' });
    expect(findOwner).not.toHaveBeenCalled();
  });

  it('refuses a missing action', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/', {}), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(400);
  });

  it('moves the document and answers the new path', async () => {
    findByMountPointAndPath
      .mockResolvedValueOnce({ content: 'exists' }) // the source
      .mockResolvedValueOnce(null); // no conflict
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(mockMove).toHaveBeenCalledWith('mount-1', 'Scenarios/tea.md', 'Scenarios/coffee.md');
    await expect(res.json()).resolves.toMatchObject({ path: 'Scenarios/coffee.md' });
  });

  it('strips a .md the caller supplied rather than doubling it', async () => {
    findByMountPointAndPath.mockResolvedValueOnce({ content: 'exists' }).mockResolvedValueOnce(null);
    const { POST } = handlers();

    await POST(req('https://x.test/?action=rename', { newFilename: 'coffee.md' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(mockMove).toHaveBeenCalledWith('mount-1', 'Scenarios/tea.md', 'Scenarios/coffee.md');
  });

  it('refuses to clobber an existing scenario', async () => {
    findByMountPointAndPath
      .mockResolvedValueOnce({ content: 'source' })
      .mockResolvedValueOnce({ content: 'destination' });
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'A scenario named "coffee" already exists',
    });
    expect(mockMove).not.toHaveBeenCalled();
  });

  it('treats a rename to the same name as a no-op, not a self-clobber', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'tea' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(200);
    expect(mockMove).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ path: 'Scenarios/tea.md' });
  });

  it('404s when the source is gone', async () => {
    findByMountPointAndPath.mockResolvedValue(null);
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(404);
    expect(mockMove).not.toHaveBeenCalled();
  });

  it('400s on a filename that sanitises away to nothing', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: '///' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(400);
    expect(mockMove).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('deletes and answers the refreshed list', async () => {
    listScenarios.mockResolvedValue({ scenarios: [{ filename: 'other' }], warnings: [] });
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(mockDelete).toHaveBeenCalledWith('mount-1', 'Scenarios/tea.md');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      scenarios: [{ filename: 'other' }],
      warnings: [],
    });
  });

  it('404s when there was nothing to delete', async () => {
    mockDelete.mockResolvedValue(false as never);
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
  });

  it('honours ?includeArchived on the list it answers with', async () => {
    const { DELETE } = handlers();

    await DELETE(req('https://x.test/?includeArchived=true'), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(listScenarios).toHaveBeenCalledWith('mount-1', { includeArchived: true });
  });

  it('500s rather than leaking a store failure', async () => {
    mockDelete.mockRejectedValue(new Error('store unreachable'));
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to delete project scenario' });
  });
});

describe('the tier label follows the config', () => {
  it('says Group when built for the group tier', async () => {
    findOwner.mockResolvedValue(null);
    const { GET } = createScenarioItemHandlers({
      ownerLabel: 'Group',
      logTag: '[Groups v1]',
      logIdKey: 'groupId',
      scenariosFolder: FOLDER,
      findOwner: findOwner as never,
      ensureFolders: ensureFolders as never,
      listScenarios: listScenarios as never,
      readScenario: readScenario as never,
      setScenarioDefault: setScenarioDefault as never,
    });

    const res = await GET(req('https://x.test/'), ctx(), { id: 'group-1', scenarioPath: 'tea' });

    await expect(res.json()).resolves.toEqual({ error: 'Group not found' });
  });
});
