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
  docMountBlobs: {
    deleteByMountPointId: jest.fn(),
    create: jest.fn(),
    updateExtractedText: jest.fn(),
  },
  docMountChunks: { deleteByMountPointId: jest.fn() },
  docMountFiles: { deleteByMountPointId: jest.fn() },
  docMountFolders: { deleteByMountPointId: jest.fn(), create: jest.fn() },
  docMountFileLinks: { linkDocumentContent: jest.fn(), bindLinkGroup: jest.fn() },
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
    mountPoints: new Map(), docMountFileLinks: new Map(),
    characterVaultMounts: new Map(), skippedCharacterVaults: new Set(),
    preserveIdsSkips: new Set(),
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
  let folderSeq = 0;
  globalRepos.docMountFolders.create.mockImplementation(async (data: any, options?: { id?: string }) => ({
    id: options?.id ?? `fresh-folder-${++folderSeq}`,
    ...data,
  }));
  globalRepos.docMountFileLinks.linkDocumentContent.mockImplementation(async (input: any) => ({
    link: { id: input.linkId ?? 'fresh-link-id' },
    file: { id: input.fileId ?? 'fresh-file-id' },
    documentId: input.documentId ?? 'fresh-document-id',
    groupSiblings: [],
  }));
  globalRepos.docMountFileLinks.bindLinkGroup.mockResolvedValue(undefined);
  globalRepos.docMountBlobs.create.mockImplementation(async (input: any) => ({
    id: input.blobId ?? 'fresh-blob-id',
    linkId: input.linkId ?? 'fresh-blob-link-id',
    fileId: input.fileId ?? 'fresh-blob-file-id',
  }));
  globalRepos.docMountBlobs.updateExtractedText.mockResolvedValue(undefined);
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

// ============================================================================
// F4 — preserveIds reaches vault internals (folders, documents, blobs)
// ============================================================================

const folderRec = (over: Record<string, unknown> = {}) => ({
  id: 'folder-mail',
  mountPointId: 'store-X',
  parentId: null,
  name: 'Mail',
  path: 'Mail',
  ...over,
});

const docRec = (over: Record<string, unknown> = {}) => ({
  mountPointId: 'store-X',
  relativePath: 'Mail/letter.md',
  fileName: 'letter.md',
  fileType: 'markdown' as const,
  content: 'Dear reader,',
  contentSha256: 'sha-doc-1',
  plainTextLength: 12,
  lastModified: '2026-08-10T00:00:00.000Z',
  folderId: 'folder-mail',
  fileId: 'file-1',
  linkId: 'link-1',
  ...over,
});

const blobRec = (over: Record<string, unknown> = {}) => ({
  mountPointId: 'store-X',
  relativePath: 'photos/portrait.webp',
  originalFileName: 'portrait.webp',
  originalMimeType: 'image/webp',
  storedMimeType: 'image/webp',
  sizeBytes: 3,
  sha256: 'sha-blob-1',
  description: '',
  fileId: 'file-2',
  linkId: 'link-2',
  blobId: 'blob-1',
  dataBase64: Buffer.from('abc').toString('base64'),
  ...over,
});

const runFull = (
  payload: { folders?: any[]; documents?: any[]; blobs?: any[] },
  options: ImportOptions,
  idMaps: IdMappingState
) =>
  importDocumentStores(
    [store()],
    payload.folders ?? [],
    payload.documents ?? [],
    payload.blobs ?? [],
    [],
    options,
    {} as never,
    idMaps,
    []
  );

describe('F4 — preserveIds reaches folders, documents and blobs', () => {
  beforeEach(() => {
    globalRepos.docMountPoints.findAll.mockResolvedValue([]);
  });

  it('creates folders at their carried ids with verbatim parentId, and claims document/blob row ids', async () => {
    const idMaps = makeIdMaps();
    const counts = await runFull(
      {
        folders: [
          folderRec(),
          folderRec({ id: 'folder-inbox', parentId: 'folder-mail', name: 'Inbox', path: 'Mail/Inbox' }),
        ],
        documents: [docRec({ relativePath: 'Mail/Inbox/letter.md', folderId: 'folder-inbox' })],
        blobs: [blobRec()],
      },
      { conflictStrategy: 'skip', preserveIds: true } as ImportOptions,
      idMaps
    );

    // Folders land at the bundle's ids, parentId verbatim — with original
    // folder ids the source parentId is simply correct.
    expect(globalRepos.docMountFolders.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ parentId: null, path: 'Mail' }),
      { id: 'folder-mail' }
    );
    expect(globalRepos.docMountFolders.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ parentId: 'folder-mail', path: 'Mail/Inbox' }),
      { id: 'folder-inbox' }
    );

    // Documents claim their carried file/link ids and resolve their folder.
    expect(globalRepos.docMountFileLinks.linkDocumentContent).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', linkId: 'link-1', folderId: 'folder-inbox' })
    );

    // Blobs claim file/link/blob ids.
    expect(globalRepos.docMountBlobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-2', linkId: 'link-2', blobId: 'blob-1' })
    );

    expect(idMaps.docMountFileLinks.get('link-1')).toBe('link-1');
    expect(idMaps.docMountFileLinks.get('link-2')).toBe('link-2');
    expect(counts.folders).toBe(2);
    expect(counts.documents).toBe(1);
    expect(counts.blobs).toBe(1);
  });

  it('does NOT claim carried row ids without preserveIds', async () => {
    const idMaps = makeIdMaps();
    await runFull(
      { documents: [docRec()], blobs: [blobRec()] },
      opts('skip'),
      idMaps
    );

    const docInput = globalRepos.docMountFileLinks.linkDocumentContent.mock.calls[0][0] as any;
    expect(docInput.fileId).toBeUndefined();
    expect(docInput.linkId).toBeUndefined();
    const blobInput = globalRepos.docMountBlobs.create.mock.calls[0][0] as any;
    expect(blobInput.fileId).toBeUndefined();
    expect(blobInput.linkId).toBeUndefined();
    expect(blobInput.blobId).toBeUndefined();
    // Old→new link mapping still recorded for reconciliation.
    expect(idMaps.docMountFileLinks.get('link-1')).toBe('fresh-link-id');
  });

  it('remaps folder parents and document folderIds onto the created folders without preserveIds (F4.7)', async () => {
    const idMaps = makeIdMaps();
    await runFull(
      {
        folders: [
          folderRec(),
          folderRec({ id: 'folder-inbox', parentId: 'folder-mail', name: 'Inbox', path: 'Mail/Inbox' }),
        ],
        documents: [
          docRec({ relativePath: 'Mail/Inbox/letter.md', folderId: 'folder-inbox' }),
          // A bundle that predates carried folder ids: no folderId at all —
          // the containing directory of relativePath resolves it instead.
          docRec({ relativePath: 'Mail/note.md', fileName: 'note.md', folderId: null, fileId: null, linkId: null }),
        ],
      },
      opts('skip'),
      idMaps
    );

    // Freshly-minted folder ids, parent resolved by path (not the source id).
    const [firstData, firstOptions] = globalRepos.docMountFolders.create.mock.calls[0];
    expect(firstOptions).toBeUndefined();
    expect((firstData as any).parentId).toBeNull();
    const [secondData, secondOptions] = globalRepos.docMountFolders.create.mock.calls[1];
    expect(secondOptions).toBeUndefined();
    expect((secondData as any).parentId).toBe('fresh-folder-1');

    // Document folderIds resolve to the *created* folders, not the source ids.
    const inputs = globalRepos.docMountFileLinks.linkDocumentContent.mock.calls.map((c) => c[0] as any);
    expect(inputs[0].folderId).toBe('fresh-folder-2');
    expect(inputs[1].folderId).toBe('fresh-folder-1');
  });

  it('skip-if-present: skips every record the preflight sanctioned, mapping ids to themselves', async () => {
    const idMaps = makeIdMaps();
    for (const id of ['store-X', 'folder-mail', 'link-1', 'link-2']) {
      idMaps.preserveIdsSkips.add(id);
    }

    const counts = await runFull(
      { folders: [folderRec()], documents: [docRec()], blobs: [blobRec()] },
      { conflictStrategy: 'skip', preserveIds: true } as ImportOptions,
      idMaps
    );

    // Nothing re-created: the surviving rows win.
    expect(globalRepos.docMountPoints.create).not.toHaveBeenCalled();
    expect(globalRepos.docMountFolders.create).not.toHaveBeenCalled();
    expect(globalRepos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
    expect(globalRepos.docMountBlobs.create).not.toHaveBeenCalled();

    // Source → target maps resolve as identity so later phases still work.
    expect(idMaps.mountPoints.get('store-X')).toBe('store-X');
    expect(idMaps.docMountFileLinks.get('link-1')).toBe('link-1');
    expect(idMaps.docMountFileLinks.get('link-2')).toBe('link-2');
    expect(counts.mountPoints).toBe(0);
    expect(counts.documents).toBe(0);
    expect(counts.blobs).toBe(0);
  });

  it('skip-if-present: still imports the records that were pruned (a partial keep-set)', async () => {
    const idMaps = makeIdMaps();
    // The mount and the kept folder collide; the pruned document does not.
    idMaps.preserveIdsSkips.add('store-X');
    idMaps.preserveIdsSkips.add('folder-mail');

    await runFull(
      { folders: [folderRec()], documents: [docRec()] },
      { conflictStrategy: 'skip', preserveIds: true } as ImportOptions,
      idMaps
    );

    expect(globalRepos.docMountFolders.create).not.toHaveBeenCalled();
    // The pruned document is restored at its original ids, resolving its
    // folder to the surviving row's id.
    expect(globalRepos.docMountFileLinks.linkDocumentContent).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', linkId: 'link-1', folderId: 'folder-mail' })
    );
  });
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
