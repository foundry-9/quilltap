/**
 * @jest-environment node
 *
 * The archive service imports the character-vault module chain, which reaches
 * the real better-sqlite3 binding; under jsdom that binding segfaults at
 * worker teardown (established convention: real-binding suites run in node).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'crypto';

if (typeof globalThis.ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  globalThis.ReadableStream = ReadableStream as typeof ReadableStream;
}

/**
 * Load the *real* user-scoped chats wrapper with a stub base-repository
 * container, so the mock below can key off method names that actually exist.
 * Constructing the wrappers only stores references — no database is touched.
 */
function loadRealUserScopedChats(): Record<string, unknown> {
  jest.resetModules();
  const stubBaseRepos = new Proxy({}, { get: () => ({}) });
  jest.doMock('@/lib/repositories/factory', () => ({
    __esModule: true,
    getRepositories: () => stubBaseRepos,
    getRepositoriesSafe: () => stubBaseRepos,
  }));
  const { getUserRepositories, clearUserRepositoryCache } = require('@/lib/repositories/user-scoped');
  clearUserRepositoryCache();
  return getUserRepositories('surface-probe-user').chats as Record<string, unknown>;
}

function realChatsMethod(chats: Record<string, unknown>, name: string): string {
  if (typeof chats[name] !== 'function') {
    throw new Error(
      `The user-scoped chats repository has no ${name}() — the archive-service mock is out of date`
    );
  }
  return name;
}

const realChats = loadRealUserScopedChats();
const CHATS_FIND_BY_CHARACTER_ID = realChatsMethod(realChats, 'findByCharacterId');
const CHATS_SET_PARTICIPANT_STATUS = realChatsMethod(realChats, 'setParticipantStatus');

const mockFindById = jest.fn();
const mockFindByIdRaw = jest.fn();
const mockUpdate = jest.fn();
const mockFilesCreate = jest.fn();
const mockFilesUpdate = jest.fn();
const mockFilesDelete = jest.fn();
const mockMemoriesFindByCharacterId = jest.fn();
const mockFindChatsByCharacterId = jest.fn();
const mockSetParticipantStatus = jest.fn();
const mockCreateNdjsonStream = jest.fn();
const mockAssembleExportFromStream = jest.fn();
const mockUploadRaw = jest.fn();
const mockResolveArchivePassphrase = jest.fn();
const mockEncryptArchive = jest.fn();
const mockDecryptArchive = jest.fn();
const mockDeleteMemoriesWithUnlinkBatch = jest.fn();
const mockDeleteVectorStore = jest.fn();
const mockDocsByMountPoint = jest.fn();
const mockBlobsByMountPoint = jest.fn();
const mockLinksByMountPoint = jest.fn();
const mockDeleteWithGC = jest.fn();
const mockChunksByLinkId = jest.fn();
const mockFoldersByMountPoint = jest.fn();
const mockFolderDelete = jest.fn();
const mockEmbeddingStatusDeleteByEntity = jest.fn();
const mockFilesFindById = jest.fn();
const mockDownloadFile = jest.fn();
const mockIsEncryptedArchive = jest.fn();
const mockExecuteImport = jest.fn();
const mockReindexLinks = jest.fn();
const mockEnqueueEmbeddingJobs = jest.fn();
const mockMountPointFindById = jest.fn();
const mockRefreshStats = jest.fn();

const CHARACTER_ID = 'character-1';
const MOUNT_ID = 'mount-1';
const AVATAR_LINK_ID = 'link-avatar';
const OVERRIDE_LINK_ID = 'link-avatar-override';

interface FixtureLink {
  id: string;
  relativePath: string;
  fileId: string;
}

/**
 * The default vault: the keep-set (a managed document, wardrobe content, the
 * avatar and an override image — both living under photos/) plus prunable
 * material (mail, a conversation summary, a spare photograph).
 */
function defaultVaultLinks(): FixtureLink[] {
  return [
    { id: 'link-props', relativePath: 'properties.json', fileId: 'file-props' },
    { id: 'link-wardrobe-json', relativePath: 'wardrobe.json', fileId: 'file-wardrobe-json' },
    { id: 'link-hat', relativePath: 'Wardrobe/top-hat.md', fileId: 'file-hat' },
    { id: AVATAR_LINK_ID, relativePath: 'photos/avatar.webp', fileId: 'file-avatar' },
    { id: OVERRIDE_LINK_ID, relativePath: 'photos/alternate.webp', fileId: 'file-override' },
    { id: 'link-mail', relativePath: 'Mail/letter.md', fileId: 'file-mail' },
    { id: 'link-summary', relativePath: 'Conversation Summaries/chat-1.md', fileId: 'file-summary' },
    { id: 'link-photo', relativePath: 'photos/beach.webp', fileId: 'file-photo' },
  ];
}

const DOOMED_LINK_IDS = ['link-mail', 'link-summary', 'link-photo'];
const KEPT_LINK_IDS = defaultVaultLinks()
  .map((l) => l.id)
  .filter((id) => !DOOMED_LINK_IDS.includes(id));

/** Mutable live view of the vault, so re-listing after the prune is honest. */
let liveLinks: FixtureLink[] = [];

function installMocks() {
  jest.resetModules();
  jest.clearAllMocks();

  jest.doMock('@/lib/repositories/factory', () => ({
    __esModule: true,
    getUserRepositories: jest.fn(),
    getRepositories: jest.fn(),
  }));

  jest.doMock('@/lib/export/ndjson-writer', () => ({
    __esModule: true,
    createNdjsonStream: mockCreateNdjsonStream,
  }));

  jest.doMock('@/lib/import/quilltap-import-stream', () => ({
    __esModule: true,
    assembleExportFromStream: mockAssembleExportFromStream,
  }));

  jest.doMock('@/lib/file-storage/manager', () => ({
    __esModule: true,
    fileStorageManager: { uploadRaw: mockUploadRaw, downloadFile: mockDownloadFile },
  }));

  jest.doMock('@/lib/import/quilltap-import/execute', () => ({
    __esModule: true,
    executeImport: mockExecuteImport,
  }));

  jest.doMock('@/lib/mount-index/reindex', () => ({
    __esModule: true,
    reindexLinks: mockReindexLinks,
  }));

  jest.doMock('@/lib/mount-index/embedding-scheduler', () => ({
    __esModule: true,
    enqueueEmbeddingJobsForMountPoint: mockEnqueueEmbeddingJobs,
  }));

  jest.doMock('@/lib/memory/memory-gate', () => ({
    __esModule: true,
    deleteMemoriesWithUnlinkBatch: mockDeleteMemoriesWithUnlinkBatch,
  }));

  jest.doMock('@/lib/embedding/vector-store', () => ({
    __esModule: true,
    getVectorStoreManager: () => ({ deleteStore: mockDeleteVectorStore }),
  }));

  jest.doMock('@/lib/characters/archive-crypto', () => ({
    __esModule: true,
    resolveArchivePassphrase: mockResolveArchivePassphrase,
    encryptArchive: mockEncryptArchive,
    decryptArchive: mockDecryptArchive,
    isEncryptedArchive: mockIsEncryptedArchive,
  }));
}

/** The fake cipher: a visible prefix, trivially reversible for the tests. */
const ENC_PREFIX = Buffer.from('ENC!');

/** The rehydrate fixture bundle: bytes on the shelf and their true digest. */
const BUNDLE_PLAINTEXT = Buffer.from('{"kind":"__envelope__","format":"qtap-ndjson"}\n', 'utf8');
const BUNDLE_SHA = createHash('sha256').update(BUNDLE_PLAINTEXT).digest('hex');
const ENCRYPTED_BUNDLE = Buffer.concat([ENC_PREFIX, BUNDLE_PLAINTEXT]);

function archiveFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'archive-file',
    sha256: BUNDLE_SHA,
    storageKey: 'archive-file/character-archive.qtap',
    category: 'ARCHIVE',
    ...overrides,
  };
}

/**
 * What `assembleExportFromStream` yields for a valid archive bundle: a
 * preserve-ids characters manifest carrying exactly this character.
 */
function rehydratableBundle(overrides: { manifest?: Record<string, unknown>; data?: Record<string, unknown> } = {}) {
  return {
    manifest: {
      format: 'quilltap-export',
      settings: { preserveIds: true },
      counts: {},
      ...overrides.manifest,
    },
    data: {
      characters: [{ id: CHARACTER_ID }],
      memories: [{ id: 'memory-1', characterId: CHARACTER_ID }],
      mountPoints: [{ id: MOUNT_ID }],
      ...overrides.data,
    },
  };
}

function successfulImportResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    imported: { memories: 1, documentStoreDocuments: 2, documentStoreBlobs: 1 },
    skipped: {},
    warnings: [],
    importedCharacterIds: [CHARACTER_ID],
    ...overrides,
  };
}

function loadArchiveService() {
  installMocks();
  const factory = require('@/lib/repositories/factory');
  const service = require('@/lib/characters/archive-service');

  return {
    archiveCharacter: service.archiveCharacter as typeof import('@/lib/characters/archive-service').archiveCharacter,
    rehydrateCharacter: service.rehydrateCharacter as typeof import('@/lib/characters/archive-service').rehydrateCharacter,
    CharacterRehydrationError: service.CharacterRehydrationError,
    mockGetUserRepositories: factory.getUserRepositories as jest.Mock,
    mockGetRepositories: factory.getRepositories as jest.Mock,
  };
}

/**
 * A bundle that agrees with the default live fixture: one character, one
 * memory, one vault holding two text documents and one blob, with footer counts
 * that match the records.
 */
function consistentBundle(overrides: { counts?: Record<string, number>; data?: Record<string, unknown> } = {}) {
  return {
    manifest: {
      counts: {
        characters: 1,
        memories: 1,
        documentStores: 1,
        documentStoreDocuments: 2,
        documentStoreBlobs: 1,
        ...overrides.counts,
      },
    },
    data: {
      characters: [{ id: CHARACTER_ID }],
      memories: [{ id: 'memory-1', characterId: CHARACTER_ID }],
      mountPoints: [{ id: MOUNT_ID }],
      documents: [{ relativePath: 'properties.json' }, { relativePath: 'Mail/letter.md' }],
      blobs: [{ sha256: 'c'.repeat(64) }],
      ...overrides.data,
    },
  };
}

function characterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHARACTER_ID,
    archivedAt: null,
    archiveFileId: null,
    archivedAvatarFileId: null,
    defaultImageId: AVATAR_LINK_ID,
    avatarOverrides: [{ imageId: OVERRIDE_LINK_ID }],
    characterDocumentMountPointId: MOUNT_ID,
    ...overrides,
  };
}

function setCharacter(overrides: Record<string, unknown> = {}) {
  const row = characterRow(overrides);
  mockFindById.mockResolvedValue(row as never);
  mockFindByIdRaw.mockResolvedValue(row as never);
}

function createDefaultMocks(mockGetUserRepositories: jest.Mock, mockGetRepositories: jest.Mock) {
  mockGetUserRepositories.mockReturnValue({
    characters: { findById: mockFindById, update: mockUpdate },
    files: {
      create: mockFilesCreate,
      update: mockFilesUpdate,
      delete: mockFilesDelete,
      findById: mockFilesFindById,
    },
    memories: { findByCharacterId: mockMemoriesFindByCharacterId },
    chats: {
      // Keys mirror the real repository surface — see the
      // 'mirrors the real chats repository surface' test below.
      [CHATS_FIND_BY_CHARACTER_ID]: mockFindChatsByCharacterId,
      [CHATS_SET_PARTICIPANT_STATUS]: mockSetParticipantStatus,
    },
  } as never);

  mockGetRepositories.mockReturnValue({
    characters: { findByIdRaw: mockFindByIdRaw },
    docMountDocuments: { findByMountPointId: mockDocsByMountPoint },
    docMountBlobs: { listByMountPoint: mockBlobsByMountPoint },
    docMountFileLinks: {
      findByMountPointId: mockLinksByMountPoint,
      deleteWithGC: mockDeleteWithGC,
    },
    docMountChunks: { findByLinkId: mockChunksByLinkId },
    docMountFolders: { findByMountPointId: mockFoldersByMountPoint, delete: mockFolderDelete },
    embeddingStatus: { deleteByEntity: mockEmbeddingStatusDeleteByEntity },
    docMountPoints: { findById: mockMountPointFindById, refreshStats: mockRefreshStats },
  } as never);

  // Live vault: two text documents and one blob (for bundle verification).
  mockDocsByMountPoint.mockResolvedValue([
    { fileType: 'markdown' },
    { fileType: 'json' },
  ] as never);
  mockBlobsByMountPoint.mockResolvedValue([{ id: 'blob-1' }] as never);

  // Link listing reads the mutable live view; deleteWithGC mutates it, so the
  // service's post-prune honesty re-listing sees what actually happened.
  liveLinks = defaultVaultLinks();
  mockLinksByMountPoint.mockImplementation(() => Promise.resolve(liveLinks.slice()));
  mockDeleteWithGC.mockImplementation((linkId: unknown) => {
    liveLinks = liveLinks.filter((link) => link.id !== linkId);
    return Promise.resolve({ fileId: `file-of-${linkId}`, fileGC: true });
  });
  mockChunksByLinkId.mockImplementation((linkId: unknown) =>
    Promise.resolve([{ id: `chunk-${linkId}` }])
  );
  mockFoldersByMountPoint.mockResolvedValue([
    { id: 'folder-mail', path: 'Mail' },
    { id: 'folder-summaries', path: 'Conversation Summaries' },
    { id: 'folder-wardrobe', path: 'Wardrobe' },
    { id: 'folder-photos', path: 'photos' },
  ] as never);
  mockFolderDelete.mockResolvedValue(true as never);
  mockEmbeddingStatusDeleteByEntity.mockResolvedValue(1 as never);

  setCharacter();
  mockUpdate.mockResolvedValue({ id: CHARACTER_ID } as never);
  mockMemoriesFindByCharacterId.mockResolvedValue([{ id: 'memory-1' }] as never);

  mockFilesCreate.mockImplementation((data: any) => Promise.resolve({ id: 'archive-file', ...data }));
  mockFilesUpdate.mockResolvedValue({ id: 'archive-file' } as never);
  mockFilesDelete.mockResolvedValue(true as never);
  mockFindChatsByCharacterId.mockResolvedValue([] as never);
  mockSetParticipantStatus.mockResolvedValue({ id: 'chat-1' } as never);
  mockCreateNdjsonStream.mockReturnValue(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true })));
        controller.close();
      },
    })
  );
  mockAssembleExportFromStream.mockResolvedValue(consistentBundle() as never);
  mockUploadRaw.mockResolvedValue(undefined as never);
  mockResolveArchivePassphrase.mockReturnValue('test-passphrase' as never);
  mockEncryptArchive.mockImplementation((plaintext: unknown) =>
    Buffer.concat([ENC_PREFIX, plaintext as Buffer])
  );
  mockDecryptArchive.mockImplementation((data: unknown) =>
    (data as Buffer).subarray(ENC_PREFIX.length)
  );
  mockDeleteMemoriesWithUnlinkBatch.mockResolvedValue(undefined as never);
  mockDeleteVectorStore.mockResolvedValue(undefined as never);

  // Rehydrate fixtures: an encrypted bundle on the shelf whose decrypted
  // plaintext matches the file row's recorded digest.
  mockFilesFindById.mockResolvedValue(archiveFileRow() as never);
  mockDownloadFile.mockResolvedValue(ENCRYPTED_BUNDLE as never);
  mockIsEncryptedArchive.mockImplementation((data: unknown) =>
    (data as Buffer).subarray(0, ENC_PREFIX.length).equals(ENC_PREFIX)
  );
  mockExecuteImport.mockResolvedValue(successfulImportResult() as never);
  mockReindexLinks.mockResolvedValue(
    { processed: 3, succeeded: 3, failed: 0, skipped: 5, errors: [] } as never
  );
  mockEnqueueEmbeddingJobs.mockResolvedValue(3 as never);
  mockMountPointFindById.mockResolvedValue({ id: MOUNT_ID } as never);
  mockRefreshStats.mockResolvedValue(undefined as never);
}

/** Load the service with the default fixture already installed. */
function setup() {
  const loaded = loadArchiveService();
  createDefaultMocks(loaded.mockGetUserRepositories, loaded.mockGetRepositories);
  return loaded;
}

/**
 * Mark the fixture character as already archived (post-commit state). Under
 * prune-in-place the pointer, avatar and overrides all survive the commit.
 */
function markArchived(overrides: Record<string, unknown> = {}) {
  setCharacter({
    archivedAt: '2026-08-10T00:00:00.000Z',
    archiveFileId: 'archive-file',
    ...overrides,
  });
}

describe('archiveCharacter — bundle verification', () => {
  it('refuses to archive when the bundle is missing memories', async () => {
    const { archiveCharacter } = setup();
    mockMemoriesFindByCharacterId.mockResolvedValue([
      { id: 'memory-1' },
      { id: 'memory-2' },
    ] as never);

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/memory count mismatch/);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDeleteWithGC).not.toHaveBeenCalled();
  });

  it('refuses when the bundle carries fewer vault documents than the live vault', async () => {
    const { archiveCharacter } = setup();
    mockDocsByMountPoint.mockResolvedValue([
      { fileType: 'markdown' },
      { fileType: 'json' },
      { fileType: 'txt' },
    ] as never);

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow(
      /vault document count mismatch/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the bundle drops a vault blob', async () => {
    const { archiveCharacter } = setup();
    mockBlobsByMountPoint.mockResolvedValue([{ id: 'blob-1' }, { id: 'blob-2' }] as never);

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow(
      /vault blob count mismatch/
    );
  });

  it('refuses when the footer under-reports what the bundle carries', async () => {
    const { archiveCharacter } = setup();
    mockAssembleExportFromStream.mockResolvedValue(
      consistentBundle({ counts: { documentStoreBlobs: 0 } }) as never
    );

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/footer count/);
  });

  it('refuses when the bundle holds the wrong character', async () => {
    const { archiveCharacter } = setup();
    mockAssembleExportFromStream.mockResolvedValue(
      consistentBundle({ data: { characters: [{ id: 'someone-else' }] } }) as never
    );

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/expected exactly/);
  });

  it('ignores the vault checks for a character that has none', async () => {
    const { archiveCharacter } = setup();
    setCharacter({
      defaultImageId: null,
      avatarOverrides: [],
      characterDocumentMountPointId: null,
    });
    mockAssembleExportFromStream.mockResolvedValue(
      consistentBundle({
        counts: { documentStores: 0, documentStoreDocuments: 0, documentStoreBlobs: 0 },
        data: { mountPoints: [], documents: [], blobs: [] },
      }) as never
    );

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.archived).toBe(true);
    expect(mockDeleteWithGC).not.toHaveBeenCalled();
  });

  it('deletes the bundle it wrote when the tombstone commit fails', async () => {
    const { archiveCharacter } = setup();
    mockUpdate.mockRejectedValue(new Error('main DB locked') as never);

    await expect(archiveCharacter('user-1', CHARACTER_ID)).rejects.toThrow('main DB locked');

    // The bundle file must not survive as an orphan in the library.
    expect(mockFilesDelete).toHaveBeenCalledWith('archive-file');
    expect(mockDeleteWithGC).not.toHaveBeenCalled();
  });
});

describe('archiveCharacter — the commit', () => {
  it('persists the encrypted bundle with the plaintext digest', async () => {
    const { archiveCharacter } = setup();
    const plaintext = Buffer.from(JSON.stringify({ ok: true }));

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.archived).toBe(true);
    expect(mockFilesCreate).toHaveBeenCalledTimes(1);
    const archiveCall = mockFilesCreate.mock.calls[0] as any[];
    expect(archiveCall[0].category).toBe('ARCHIVE');

    // The sha256 is the PLAINTEXT digest (§4.2d step 1): it is what
    // rehydration verifies after decrypting, and a ciphertext digest would
    // change on every passphrase-change re-encryption while verifying nothing.
    const expectedSha = require('crypto').createHash('sha256').update(plaintext).digest('hex');
    expect(archiveCall[0].sha256).toBe(expectedSha);
    expect(archiveCall[0].folderPath).toBe('/archives');

    // What lands on disk is the ciphertext (§4.2c), and `size` tracks it.
    const uploaded = mockUploadRaw.mock.calls[0][0] as { content: Buffer };
    expect(uploaded.content.subarray(0, ENC_PREFIX.length).equals(ENC_PREFIX)).toBe(true);
    expect(archiveCall[0].size).toBe(plaintext.length + ENC_PREFIX.length);
    expect(mockEncryptArchive).toHaveBeenCalledWith(expect.any(Buffer), 'test-passphrase');
    // Verification parsed the decrypted ciphertext, not the pre-encryption
    // buffer — the round trip is part of the hard gate.
    expect(mockDecryptArchive).toHaveBeenCalled();
  });

  it('keeps the vault pointer and the avatar fields through the commit', async () => {
    const { archiveCharacter } = setup();

    await archiveCharacter('user-1', CHARACTER_ID);

    // One write, the commit — the prune never touches the character row.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const commit = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(commit).toMatchObject({
      archivedAt: expect.any(String),
      archiveFileId: 'archive-file',
      defaultPartnerId: null,
      defaultConnectionProfileId: null,
      defaultImageProfileId: null,
      defaultRoleplayTemplateId: null,
    });
    // The vault survives archiving (§4.2a); nulling the pointer is what used
    // to strand it. And the avatar ids point at blobs the prune keeps —
    // nulling them is what took the face off old messages.
    expect(commit).not.toHaveProperty('characterDocumentMountPointId');
    expect(commit).not.toHaveProperty('defaultImageId');
    expect(commit).not.toHaveProperty('avatarOverrides');
    // Retired by §4.2a: the avatar never leaves, so no thumbnail copy is made.
    expect(commit).not.toHaveProperty('archivedAvatarFileId');
  });

  it('flips chat participants to an absent status', async () => {
    const { archiveCharacter } = setup();
    mockFindChatsByCharacterId.mockResolvedValue([
      {
        id: 'chat-1',
        participants: [
          { id: 'participant-1', characterId: CHARACTER_ID, type: 'CHARACTER' },
          { id: 'participant-2', characterId: 'character-2', type: 'CHARACTER' },
          { id: 'participant-3', characterId: CHARACTER_ID, type: 'NARRATOR' },
        ],
      },
      { id: 'chat-2', participants: [{ id: 'participant-4', characterId: CHARACTER_ID, type: 'CHARACTER' }] },
    ] as never);

    await archiveCharacter('user-1', CHARACTER_ID);

    expect(mockSetParticipantStatus).toHaveBeenCalledWith('chat-1', 'participant-1', 'absent');
    expect(mockSetParticipantStatus).toHaveBeenCalledWith('chat-2', 'participant-4', 'absent');
    expect(mockSetParticipantStatus).toHaveBeenCalledTimes(2);
  });

  it('mirrors the real chats repository surface', () => {
    const chats = loadRealUserScopedChats();

    expect(typeof chats[CHATS_FIND_BY_CHARACTER_ID]).toBe('function');
    expect(typeof chats[CHATS_SET_PARTICIPANT_STATUS]).toBe('function');
  });
});

describe('archiveCharacter — the prune', () => {
  it('deletes everything outside the keep-set, through the GC delete path', async () => {
    const { archiveCharacter } = setup();

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.pruneComplete).toBe(true);
    for (const doomedId of DOOMED_LINK_IDS) {
      expect(mockDeleteWithGC).toHaveBeenCalledWith(doomedId);
    }
    expect(mockDeleteWithGC).toHaveBeenCalledTimes(DOOMED_LINK_IDS.length);
    // The keep-set is never a candidate: managed documents, wardrobe content,
    // the avatar link and the override link all survive.
    for (const keptId of KEPT_LINK_IDS) {
      expect(mockDeleteWithGC).not.toHaveBeenCalledWith(keptId);
    }
    expect(liveLinks.map((link) => link.id).sort()).toEqual(KEPT_LINK_IDS.slice().sort());
  });

  it('deletes the character-owned memories through the gate', async () => {
    const { archiveCharacter } = setup();

    await archiveCharacter('user-1', CHARACTER_ID);

    expect(mockDeleteMemoriesWithUnlinkBatch).toHaveBeenCalledWith(['memory-1']);
    expect(mockDeleteVectorStore).toHaveBeenCalledWith(CHARACTER_ID);
  });

  it('sweeps the embedding_status rows of what it deleted, and nothing else', async () => {
    const { archiveCharacter } = setup();

    await archiveCharacter('user-1', CHARACTER_ID);

    expect(mockEmbeddingStatusDeleteByEntity).toHaveBeenCalledWith('MEMORY', 'memory-1');
    for (const doomedId of DOOMED_LINK_IDS) {
      expect(mockEmbeddingStatusDeleteByEntity).toHaveBeenCalledWith('MOUNT_CHUNK', `chunk-${doomedId}`);
    }
    // Surviving documents keep their chunks — and their status rows.
    for (const keptId of KEPT_LINK_IDS) {
      expect(mockEmbeddingStatusDeleteByEntity).not.toHaveBeenCalledWith(
        'MOUNT_CHUNK',
        `chunk-${keptId}`
      );
    }
  });

  it('removes emptied folders but keeps Wardrobe and any folder sheltering kept content', async () => {
    const { archiveCharacter } = setup();

    await archiveCharacter('user-1', CHARACTER_ID);

    expect(mockFolderDelete).toHaveBeenCalledWith('folder-mail');
    expect(mockFolderDelete).toHaveBeenCalledWith('folder-summaries');
    // Wardrobe is in the keep-set explicitly; photos/ still holds the avatar.
    expect(mockFolderDelete).not.toHaveBeenCalledWith('folder-wardrobe');
    expect(mockFolderDelete).not.toHaveBeenCalledWith('folder-photos');
  });

  it('reports pruneComplete: false when a doomed link survives the delete', async () => {
    const { archiveCharacter } = setup();
    // deleteWithGC swallows backend errors into a no-op — the honesty
    // re-listing has to catch the survivor.
    mockDeleteWithGC.mockImplementation((linkId: unknown) => {
      if (linkId === 'link-mail') return Promise.resolve({ fileId: null, fileGC: false });
      liveLinks = liveLinks.filter((link) => link.id !== linkId);
      return Promise.resolve({ fileId: `file-of-${linkId}`, fileGC: true });
    });

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.archived).toBe(true);
    expect(result.pruneComplete).toBe(false);
  });

  it('reports pruneComplete: false when memory deletion fails, without aborting the vault prune', async () => {
    const { archiveCharacter } = setup();
    mockDeleteMemoriesWithUnlinkBatch.mockRejectedValue(new Error('gate refused') as never);

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.pruneComplete).toBe(false);
    // One failing step must not abort the others.
    expect(mockDeleteWithGC).toHaveBeenCalledWith('link-mail');
  });

  it('reports pruneComplete: false when the vector store will not drop', async () => {
    const { archiveCharacter } = setup();
    mockDeleteVectorStore.mockRejectedValue(new Error('no such store') as never);

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.pruneComplete).toBe(false);
  });
});

describe('archiveCharacter — re-running after a failed prune', () => {
  it('finishes the prune instead of throwing', async () => {
    const { archiveCharacter } = setup();
    // The crash window: tombstone committed, prune unfinished.
    markArchived();

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.archived).toBe(true);
    expect(result.pruneComplete).toBe(true);
    expect(mockDeleteWithGC).toHaveBeenCalledWith('link-mail');
    // The bundle is never rewritten and the character row is never touched —
    // the prune has no finalization patch to apply.
    expect(mockFilesCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.archiveFileId).toBe('archive-file');
  });

  it('is idempotent once the prune has already finished', async () => {
    const { archiveCharacter } = setup();
    markArchived();
    liveLinks = defaultVaultLinks().filter((link) => !DOOMED_LINK_IDS.includes(link.id));
    mockMemoriesFindByCharacterId.mockResolvedValue([] as never);

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.pruneComplete).toBe(true);
    expect(mockDeleteWithGC).not.toHaveBeenCalled();
    expect(mockDeleteMemoriesWithUnlinkBatch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('treats a pre-revision tombstone (vault already gone) as fully pruned', async () => {
    const { archiveCharacter } = setup();
    markArchived({ characterDocumentMountPointId: null });
    mockMemoriesFindByCharacterId.mockResolvedValue([] as never);

    const result = await archiveCharacter('user-1', CHARACTER_ID);

    expect(result.pruneComplete).toBe(true);
    expect(mockDeleteWithGC).not.toHaveBeenCalled();
    expect(mockFolderDelete).not.toHaveBeenCalled();
  });
});

/** Fixture state for a full rehydrate: archived character + valid bundle. */
function setupRehydrate() {
  const loaded = setup();
  markArchived();
  mockAssembleExportFromStream.mockResolvedValue(rehydratableBundle() as never);
  return loaded;
}

describe('rehydrateCharacter — the restore (§6)', () => {
  it('imports the bundle in skip-if-present mode, then clears the tombstone', async () => {
    const { rehydrateCharacter } = setupRehydrate();

    const result = await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(mockExecuteImport).toHaveBeenCalledWith(
      'user-1',
      rehydratableBundle(),
      expect.objectContaining({
        preserveIds: true,
        includeMemories: true,
        preserveIdsMode: {
          mode: 'skip-if-present',
          targetCharacterId: CHARACTER_ID,
          targetVaultMountPointId: MOUNT_ID,
        },
      })
    );

    // The §4.4 guard sanctions exactly { archivedAt: null }; the pointer
    // cleanup must ride a second patch on the now-live row.
    expect(mockUpdate).toHaveBeenNthCalledWith(1, CHARACTER_ID, { archivedAt: null });
    expect(mockUpdate).toHaveBeenNthCalledWith(2, CHARACTER_ID, { archiveFileId: null });

    // Restore before clear: a failure mid-import must leave the tombstone.
    const importOrder = mockExecuteImport.mock.invocationCallOrder[0];
    const clearOrder = mockUpdate.mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(clearOrder);

    expect(result).toEqual({
      rehydrated: true,
      archived: false,
      archiveBundleFileId: 'archive-file',
      restored: { memories: 1, documents: 2, blobs: 1 },
      warnings: [],
    });
  });

  it('re-chunks and re-embeds the restored vault content', async () => {
    const { rehydrateCharacter } = setupRehydrate();

    await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(mockReindexLinks).toHaveBeenCalledWith({ id: MOUNT_ID }, {});
    expect(mockEnqueueEmbeddingJobs).toHaveBeenCalledWith(MOUNT_ID);
    expect(mockRefreshStats).toHaveBeenCalledWith(MOUNT_ID);
  });

  it('flips absent character seats back to active, leaving removed ones alone', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockFindChatsByCharacterId.mockResolvedValue([
      {
        id: 'chat-1',
        participants: [
          { id: 'seat-absent', characterId: CHARACTER_ID, type: 'CHARACTER', status: 'absent' },
          { id: 'seat-removed', characterId: CHARACTER_ID, type: 'CHARACTER', status: 'removed' },
          { id: 'seat-other', characterId: 'someone-else', type: 'CHARACTER', status: 'absent' },
          { id: 'seat-user', characterId: CHARACTER_ID, type: 'USER', status: 'absent' },
        ],
      },
    ] as never);

    await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(mockSetParticipantStatus).toHaveBeenCalledTimes(1);
    expect(mockSetParticipantStatus).toHaveBeenCalledWith('chat-1', 'seat-absent', 'active');
  });

  it('passes a plaintext pre-encryption bundle straight through', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockDownloadFile.mockResolvedValue(BUNDLE_PLAINTEXT as never);

    const result = await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(mockDecryptArchive).not.toHaveBeenCalled();
    expect(result.rehydrated).toBe(true);
  });

  it('deletes a pre-revision avatar thumbnail and nulls the column', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    markArchived({ archivedAvatarFileId: 'thumb-1' });

    await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(mockUpdate).toHaveBeenNthCalledWith(2, CHARACTER_ID, {
      archiveFileId: null,
      archivedAvatarFileId: null,
    });
    expect(mockFilesDelete).toHaveBeenCalledWith('thumb-1');
  });

  it('clears the flag on a tombstone that has no bundle, without importing', async () => {
    const { rehydrateCharacter } = setup();
    markArchived({ archiveFileId: null });

    const result = await rehydrateCharacter('user-1', CHARACTER_ID);

    expect(result).toEqual({
      rehydrated: true,
      archived: false,
      archiveBundleFileId: null,
      warnings: [],
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(CHARACTER_ID, { archivedAt: null });
    expect(mockExecuteImport).not.toHaveBeenCalled();
  });
});

describe('rehydrateCharacter — failure leaves the character archived', () => {
  it('refuses when the bundle file is missing from the library', async () => {
    const { rehydrateCharacter, CharacterRehydrationError } = setupRehydrate();
    mockFilesFindById.mockResolvedValue(null as never);

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toBeInstanceOf(
      CharacterRehydrationError
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the decrypted plaintext does not match the recorded digest', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockFilesFindById.mockResolvedValue(archiveFileRow({ sha256: 'f'.repeat(64) }) as never);

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/digest/);
    expect(mockExecuteImport).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses a bundle written without preserveIds', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockAssembleExportFromStream.mockResolvedValue(
      rehydratableBundle({ manifest: { settings: { preserveIds: false } } }) as never
    );

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/preserveIds/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses a bundle that carries a different character', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockAssembleExportFromStream.mockResolvedValue(
      rehydratableBundle({ data: { characters: [{ id: 'somebody-else' }] } }) as never
    );

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/does not carry/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws and stays archived when the import reports failure', async () => {
    const { rehydrateCharacter, CharacterRehydrationError } = setupRehydrate();
    mockExecuteImport.mockResolvedValue(
      successfulImportResult({ success: false, warnings: ['the vault said no'] }) as never
    );

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow(/the vault said no/);
    await expect(
      rehydrateCharacter('user-1', CHARACTER_ID).catch((e) => e)
    ).resolves.toBeInstanceOf(CharacterRehydrationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('propagates a decryption failure before any write', async () => {
    const { rehydrateCharacter } = setupRehydrate();
    mockDecryptArchive.mockImplementation(() => {
      throw new Error('This archive predates your passphrase change');
    });

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow(
      /predates your passphrase change/
    );
    expect(mockExecuteImport).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when the character is not archived', async () => {
    const { rehydrateCharacter } = setup();

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow('not archived');
  });

  it('throws when the character cannot be found', async () => {
    const { rehydrateCharacter } = setup();
    mockFindById.mockResolvedValue(null as never);

    await expect(rehydrateCharacter('user-1', CHARACTER_ID)).rejects.toThrow('not found');
  });
});
