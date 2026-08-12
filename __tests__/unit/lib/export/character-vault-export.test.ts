/**
 * @jest-environment node
 *
 * WP A2: a `characters` export carries each character's vault.
 *
 * Before this, `streamCharacters` emitted the row, wardrobe, plugin data and
 * memories — and nothing else. Since `characters.defaultImageId` is a
 * `doc_mount_file_links.id` into the *source* instance's vault, a character
 * imported elsewhere arrived faceless, mail-less and photo-less (Bug 52).
 *
 * These tests drive the live writer and feed its bytes back through the live
 * reader, so they fail if either half of the round-trip stops carrying the
 * store.
 *
 * Node environment (not jsdom): ReadableStream is a Node global.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

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

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}));

jest.mock('@/lib/plugins/registry', () => ({ getPlugin: jest.fn() }));

jest.mock('@/lib/instance-settings', () => ({
  listPortableInstanceSettings: jest.fn(),
}));

import { createNdjsonStream } from '@/lib/export/ndjson-writer';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

/** Raw bytes per blob chunk in the writer. Must stay a multiple of 3. */
const BLOB_CHUNK_BYTES = 3 * 1024 * 1024;

const USER_ID = 'user-vault';
const CHARACTER_ID = 'char-vault-1';
const MOUNT_ID = 'mount-vault-1';
const AVATAR_LINK_ID = 'link-avatar-1';
const OVERRIDE_LINK_ID = 'link-override-1';

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

function parseRecords(text: string): Array<Record<string, any>> {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function toAsyncRecords(records: Array<Record<string, any>>): AsyncIterable<unknown> {
  return (async function* () {
    for (const r of records) yield r;
  })();
}

/**
 * Wire up a character that owns a vault holding one photograph (a blob of the
 * given size), one letter and one properties document.
 */
function installRepos(options: {
  blobBytes: number;
  characterOverrides?: Record<string, unknown>;
  mountPointMissing?: boolean;
}) {
  const blobData = Buffer.alloc(options.blobBytes, 7);

  const character = {
    id: CHARACTER_ID,
    userId: USER_ID,
    name: 'Ada',
    tags: [],
    characterDocumentMountPointId: MOUNT_ID,
    defaultImageId: AVATAR_LINK_ID,
    avatarOverrides: [{ chatId: 'chat-1', imageId: OVERRIDE_LINK_ID }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...options.characterOverrides,
  };

  const userRepos = {
    characters: {
      findById: jest.fn(async (id: string) => (id === CHARACTER_ID ? character : null)),
      findAll: jest.fn(async () => [character]),
    },
    chats: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
    tags: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
    memories: { findByCharacterId: jest.fn(async () => []) },
  };

  const globalRepos = {
    wardrobe: { findByCharacterId: jest.fn(async () => []) },
    characterPluginData: { getPluginDataMap: jest.fn(async () => ({})) },
    docMountPoints: {
      findById: jest.fn(async (id: string) =>
        options.mountPointMissing || id !== MOUNT_ID
          ? null
          : {
              id: MOUNT_ID,
              name: 'Ada Character Vault',
              basePath: '',
              mountType: 'database',
              storeType: 'character',
              includePatterns: [],
              excludePatterns: [],
              enabled: true,
            }
      ),
    },
    docMountFolders: {
      findByMountPointId: jest.fn(async () => [
        { mountPointId: MOUNT_ID, parentId: null, name: 'Mail', path: '/Mail' },
        { mountPointId: MOUNT_ID, parentId: null, name: 'photos', path: '/photos' },
      ]),
    },
    docMountDocuments: {
      findByMountPointId: jest.fn(async () => [
        {
          mountPointId: MOUNT_ID,
          relativePath: 'properties.json',
          fileName: 'properties.json',
          fileType: 'json',
          content: '{"name":"Ada"}',
          contentSha256: 'a'.repeat(64),
          plainTextLength: 14,
          lastModified: new Date().toISOString(),
          folderId: null,
          fileId: 'file-props',
          linkId: 'link-props',
          linkGroupId: null,
        },
        {
          mountPointId: MOUNT_ID,
          relativePath: 'Mail/letter.md',
          fileName: 'letter.md',
          fileType: 'markdown',
          content: 'Dearest Ada,',
          contentSha256: 'b'.repeat(64),
          plainTextLength: 12,
          lastModified: new Date().toISOString(),
          folderId: 'folder-mail',
          fileId: 'file-letter',
          linkId: 'link-letter',
          linkGroupId: null,
        },
      ]),
    },
    docMountBlobs: {
      listByMountPoint: jest.fn(async () => [
        {
          id: 'blob-avatar',
          mountPointId: MOUNT_ID,
          relativePath: 'photos/avatar.webp',
          originalFileName: 'avatar.webp',
          originalMimeType: 'image/webp',
          storedMimeType: 'image/webp',
          sizeBytes: blobData.length,
          sha256: 'c'.repeat(64),
          description: 'A studious portrait',
          descriptionUpdatedAt: null,
          fileId: 'file-avatar',
          linkId: AVATAR_LINK_ID,
          extractedText: null,
          extractedTextSha256: null,
          extractionStatus: 'none',
          extractionError: null,
        },
      ]),
      readData: jest.fn(async () => blobData),
    },
    projectDocMountLinks: {
      findByMountPointId: jest.fn(async () => [
        { projectId: 'project-1', mountPointId: MOUNT_ID },
      ]),
    },
  };

  (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
  (getRepositories as jest.Mock).mockReturnValue(globalRepos);

  return { character, globalRepos, userRepos, blobData };
}

async function exportCharacter(): Promise<Array<Record<string, any>>> {
  const stream = createNdjsonStream(USER_ID, {
    type: 'characters',
    scope: 'selected',
    selectedIds: [CHARACTER_ID],
    includeMemories: false,
  });
  return parseRecords(await readAllText(stream));
}

describe('characters export — the vault travels with the character', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the mount point, folders, documents and blob chunks', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    const kinds = records.map((r) => r.kind);

    expect(kinds).toContain('doc_mount_point');
    expect(kinds.filter((k) => k === 'doc_mount_folder')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'doc_mount_document')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'doc_mount_blob')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'doc_mount_blob_chunk')).toHaveLength(1);
  });

  it('carries the link ids the avatar pointers resolve through', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    const blob = records.find((r) => r.kind === 'doc_mount_blob');

    // Without linkId the importer has nothing to remap defaultImageId through,
    // which is Bug 52 exactly.
    expect(blob?.data.linkId).toBe(AVATAR_LINK_ID);
    expect(blob?.data.fileId).toBe('file-avatar');
    expect(blob?.data.blobId).toBe('blob-avatar');

    const documents = records.filter((r) => r.kind === 'doc_mount_document');
    expect(documents.map((d) => d.data.linkId)).toEqual(['link-props', 'link-letter']);
  });

  it('omits project links — a character vault has none', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();

    expect(records.some((r) => r.kind === 'project_doc_mount_link')).toBe(false);
  });

  it('emits the store after the character row and before its memories', async () => {
    installRepos({ blobBytes: 64 });

    const kinds = (await exportCharacter()).map((r) => r.kind);

    expect(kinds.indexOf('character')).toBeLessThan(kinds.indexOf('doc_mount_point'));
    // A blob header always precedes its chunks, or the reader cannot reassemble.
    expect(kinds.indexOf('doc_mount_blob')).toBeLessThan(kinds.indexOf('doc_mount_blob_chunk'));
  });

  it('survives the round-trip back through the reader', async () => {
    const { blobData } = installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    const result = await assembleExportFromStream(toAsyncRecords(records));

    expect(result.manifest.exportType).toBe('characters');
    const data = result.data as {
      characters: Array<{ id: string }>;
      mountPoints?: Array<{ id: string }>;
      folders?: unknown[];
      documents?: Array<{ relativePath: string; linkId?: string }>;
      blobs?: Array<{ sha256: string; dataBase64: string; linkId?: string }>;
    };

    expect(data.characters).toHaveLength(1);
    expect(data.mountPoints?.map((mp) => mp.id)).toEqual([MOUNT_ID]);
    expect(data.folders).toHaveLength(2);
    expect(data.documents?.map((d) => d.relativePath)).toEqual([
      'properties.json',
      'Mail/letter.md',
    ]);
    expect(data.blobs).toHaveLength(1);
    expect(data.blobs?.[0].linkId).toBe(AVATAR_LINK_ID);
    // The bytes come back whole.
    expect(Buffer.from(data.blobs![0].dataBase64, 'base64').equals(blobData)).toBe(true);
  });

  it('reports the vault in the manifest counts', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    const footer = records.find((r) => r.kind === '__footer__');

    expect(footer?.counts.documentStores).toBe(1);
    expect(footer?.counts.documentStoreFolders).toBe(2);
    expect(footer?.counts.documentStoreDocuments).toBe(2);
    expect(footer?.counts.documentStoreBlobs).toBe(1);
    expect(footer?.counts.documentStoreProjectLinks ?? 0).toBe(0);
  });

  it('exports a character with no vault exactly as before', async () => {
    installRepos({ blobBytes: 64, characterOverrides: { characterDocumentMountPointId: null } });

    const kinds = (await exportCharacter()).map((r) => r.kind);

    expect(kinds).toContain('character');
    expect(kinds).not.toContain('doc_mount_point');
  });

  it('still exports the character when its vault has gone missing', async () => {
    installRepos({ blobBytes: 64, mountPointMissing: true });

    const kinds = (await exportCharacter()).map((r) => r.kind);

    expect(kinds).toContain('character');
    expect(kinds).not.toContain('doc_mount_point');
  });
});

// ============================================================================
// Chunk boundaries — the base64 rejoin is only correct at multiples of 3
// ============================================================================

describe('characters export — vault blob chunk boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const cases: Array<[string, number, number]> = [
    ['one byte under a full chunk', BLOB_CHUNK_BYTES - 1, 1],
    ['exactly one full chunk', BLOB_CHUNK_BYTES, 1],
    ['one byte over a full chunk', BLOB_CHUNK_BYTES + 1, 2],
  ];

  it.each(cases)('reassembles a blob %s', async (_label, size, expectedChunks) => {
    const { blobData } = installRepos({ blobBytes: size });

    const records = await exportCharacter();
    expect(records.filter((r) => r.kind === 'doc_mount_blob_chunk')).toHaveLength(expectedChunks);

    const result = await assembleExportFromStream(toAsyncRecords(records));
    const data = result.data as { blobs?: Array<{ dataBase64: string }> };
    const roundTripped = Buffer.from(data.blobs![0].dataBase64, 'base64');

    expect(roundTripped.length).toBe(blobData.length);
    expect(roundTripped.equals(blobData)).toBe(true);
  });

  it('throws rather than importing a truncated vault blob', async () => {
    installRepos({ blobBytes: BLOB_CHUNK_BYTES + 1 });

    const records = await exportCharacter();
    // Drop the final chunk: the reader must notice the shortfall at EOF rather
    // than quietly writing a half-image into the target vault.
    const truncated = records.filter(
      (r) => !(r.kind === 'doc_mount_blob_chunk' && r.index === 1)
    );

    await expect(assembleExportFromStream(toAsyncRecords(truncated))).rejects.toThrow(
      /truncated/i
    );
  });
});

// ============================================================================
// Back-compat: an older reader ignores what it does not know
// ============================================================================

describe('characters export — compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('degrades to a working character when the new id fields are stripped', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    // Simulate a pre-4.8 writer: same records, no carried ids.
    const stripped = records.map((r) => {
      if (r.kind !== 'doc_mount_document' && r.kind !== 'doc_mount_blob') return r;
      const { fileId, linkId, blobId, ...rest } = r.data;
      return { ...r, data: rest };
    });

    const result = await assembleExportFromStream(toAsyncRecords(stripped));
    const data = result.data as {
      characters: Array<{ id: string }>;
      documents?: Array<{ linkId?: string }>;
      blobs?: Array<{ linkId?: string }>;
    };

    // Content still lands; only identity is lost, which is the lossy-but-usable
    // outcome the optional-fields design promises.
    expect(data.characters).toHaveLength(1);
    expect(data.documents).toHaveLength(2);
    expect(data.blobs).toHaveLength(1);
    // The reader normalizes an absent id to null; either way there is nothing
    // for the importer to remap, so it mints fresh ids as it always did.
    expect(data.blobs?.[0].linkId ?? null).toBeNull();
  });

  it('reads a pre-A2 stream that carries no store records at all', async () => {
    installRepos({ blobBytes: 64 });

    const records = await exportCharacter();
    const legacy = records.filter((r) => !String(r.kind).startsWith('doc_mount_'));

    const result = await assembleExportFromStream(toAsyncRecords(legacy));
    const data = result.data as { characters: Array<{ id: string; name: string }>; mountPoints?: unknown[] };

    expect(data.characters[0].name).toBe('Ada');
    expect(data.mountPoints).toBeUndefined();
  });
});
