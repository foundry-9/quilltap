/**
 * Bug 11 — `.qtap` import overwrite must handle store identity correctly:
 *  1. an overwrite clears folders too (no stale husks / UNIQUE warnings),
 *  2. the target store is matched by *id*, not name (a renamed store is not
 *     silently redirected onto an unrelated store that inherited the old name),
 *  3. a create preserves the archive's store id (so a re-import is recognised).
 *
 * The mount-point identity logic is exercised directly with mocked repos.
 */

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});

const globalRepos = {
  docMountPoints: {
    findAll: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  docMountDocuments: { deleteByMountPointId: jest.fn() },
  docMountBlobs: { deleteByMountPointId: jest.fn() },
  docMountChunks: { deleteByMountPointId: jest.fn() },
  docMountFiles: { deleteByMountPointId: jest.fn() },
  docMountFolders: { deleteByMountPointId: jest.fn() },
};

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => globalRepos),
  getUserRepositories: jest.fn(() => ({})),
}));

import { importDocumentStores } from '../import-document-stores';
import type { ExportedDocumentStore } from '@/lib/export/types';
import type { ImportOptions, IdMappingState } from '../types';

function makeIdMaps(): IdMappingState {
  return {
    tags: new Map(), characters: new Map(), chats: new Map(),
    connectionProfiles: new Map(), imageProfiles: new Map(), embeddingProfiles: new Map(),
    roleplayTemplates: new Map(), projects: new Map(), groups: new Map(),
    mountPoints: new Map(),
  };
}

function store(overrides: Partial<ExportedDocumentStore> = {}): ExportedDocumentStore {
  return {
    id: 'store-X',
    name: 'Lore',
    basePath: '',
    mountType: 'database',
    storeType: 'documents',
    includePatterns: [],
    excludePatterns: [],
    enabled: true,
    ...overrides,
  };
}

const opts = (conflictStrategy: 'skip' | 'overwrite' | 'duplicate'): ImportOptions =>
  ({ conflictStrategy } as ImportOptions);

const run = (mountPoints: ExportedDocumentStore[], options: ImportOptions, idMaps: IdMappingState) =>
  importDocumentStores(mountPoints, [], [], [], [], options, {} as never, idMaps, []);

beforeEach(() => {
  jest.clearAllMocks();
  globalRepos.docMountPoints.update.mockResolvedValue({});
  globalRepos.docMountPoints.create.mockImplementation(async (data, options) => ({
    id: options?.id ?? 'freshly-minted-id',
    ...data,
  }));
  for (const child of ['docMountDocuments', 'docMountBlobs', 'docMountChunks', 'docMountFiles', 'docMountFolders'] as const) {
    (globalRepos as any)[child].deleteByMountPointId.mockResolvedValue(0);
  }
});

it('preserves the archive store id on create (fix 3)', async () => {
  globalRepos.docMountPoints.findAll.mockResolvedValue([]);
  const idMaps = makeIdMaps();

  const counts = await run([store({ id: 'store-X', name: 'Lore' })], opts('overwrite'), idMaps);

  expect(globalRepos.docMountPoints.create).toHaveBeenCalledTimes(1);
  const [, createOptions] = globalRepos.docMountPoints.create.mock.calls[0];
  expect(createOptions).toEqual({ id: 'store-X' });
  expect(idMaps.mountPoints.get('store-X')).toBe('store-X');
  expect(counts.mountPoints).toBe(1);
});

it('overwrites the store matched by id — even after an in-app rename — and clears its folders (fixes 1 & 2)', async () => {
  // The store was renamed in-app: same id, different name than the archive.
  globalRepos.docMountPoints.findAll.mockResolvedValue([
    { id: 'store-X', name: 'NewName', mountType: 'database', storeType: 'documents' },
  ]);
  const idMaps = makeIdMaps();

  await run([store({ id: 'store-X', name: 'Lore' })], opts('overwrite'), idMaps);

  // Matched by id → update the renamed store, not create a stranger.
  expect(globalRepos.docMountPoints.update).toHaveBeenCalledWith('store-X', expect.objectContaining({ name: 'Lore' }));
  expect(globalRepos.docMountPoints.create).not.toHaveBeenCalled();
  // Folders are cleared on overwrite (fix 1) alongside documents/blobs/files/chunks.
  expect(globalRepos.docMountFolders.deleteByMountPointId).toHaveBeenCalledWith('store-X');
  expect(globalRepos.docMountDocuments.deleteByMountPointId).toHaveBeenCalledWith('store-X');
  expect(idMaps.mountPoints.get('store-X')).toBe('store-X');
});

it('does NOT redirect an overwrite onto an unrelated store that inherited the old name (fix 2)', async () => {
  // A different store (id Y) now holds the name the archive's store (id X) once had.
  globalRepos.docMountPoints.findAll.mockResolvedValue([
    { id: 'store-Y', name: 'Lore', mountType: 'database', storeType: 'documents' },
  ]);
  const idMaps = makeIdMaps();

  await run([store({ id: 'store-X', name: 'Lore' })], opts('overwrite'), idMaps);

  // Store Y is untouched; the archive's store is created fresh (id preserved).
  expect(globalRepos.docMountPoints.update).not.toHaveBeenCalled();
  expect(globalRepos.docMountPoints.create).toHaveBeenCalledTimes(1);
  const [createData, createOptions] = globalRepos.docMountPoints.create.mock.calls[0];
  expect(createOptions).toEqual({ id: 'store-X' });
  // Name is unique-ified against the taken 'Lore'.
  expect(createData.name).not.toBe('Lore');
});

it('mints a fresh id under the duplicate strategy when the archive id already exists', async () => {
  globalRepos.docMountPoints.findAll.mockResolvedValue([
    { id: 'store-X', name: 'Lore', mountType: 'database', storeType: 'documents' },
  ]);
  const idMaps = makeIdMaps();

  await run([store({ id: 'store-X', name: 'Lore' })], opts('duplicate'), idMaps);

  expect(globalRepos.docMountPoints.update).not.toHaveBeenCalled();
  const [, createOptions] = globalRepos.docMountPoints.create.mock.calls[0];
  // The archive id is taken, so create must NOT preserve it.
  expect(createOptions).toBeUndefined();
  expect(idMaps.mountPoints.get('store-X')).toBe('freshly-minted-id');
});
