/**
 * @jest-environment node
 *
 * Round-trip regression test for the LIVE export/import path.
 *
 * Exports a chat that carries a conversation annotation and a chat document
 * through `createNdjsonStream`, feeds the emitted NDJSON back through
 * `assembleExportFromStream`, and asserts both survive. This guards the path
 * that actually ships — the legacy in-memory `exportChats` builder (deleted
 * with the rest of the dead export code) used to silently drop these two
 * arrays, so a regression test pins the behaviour down.
 *
 * Node environment (not jsdom): ReadableStream is a Node global but not a
 * jsdom global.
 */

import { createMockChat, createMockMessage } from '../fixtures/test-factories';

// Mock the repository factory before importing the modules under test.
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

// Mock the logger so we don't print noise. Covers both the writer and the
// importer (same module path).
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

// The new export types reach outside the repositories: file bytes come from
// the storage manager, plugin-config redaction needs the plugin registry, and
// instance settings come from their own module (which owns the
// non-portable-key exclusion list).
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}));

jest.mock('@/lib/plugins/registry', () => ({
  getPlugin: jest.fn(),
}));

jest.mock('@/lib/instance-settings', () => ({
  listPortableInstanceSettings: jest.fn(),
}));

import { createNdjsonStream } from '@/lib/export/ndjson-writer';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getPlugin } from '@/lib/plugins/registry';
import { listPortableInstanceSettings } from '@/lib/instance-settings';

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
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

/** Turn NDJSON text into the async-iterable of parsed records the importer wants. */
function ndjsonToRecords(text: string): AsyncIterable<unknown> {
  const records = text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
  return (async function* () {
    for (const r of records) yield r;
  })();
}

describe('NDJSON export → import round-trip', () => {
  const testUserId = 'user-roundtrip';
  const chatId = 'chat-roundtrip-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves conversation annotations and chat documents through the live path', async () => {
    const chat = {
      ...createMockChat({ id: chatId, title: 'Round Trip', userId: testUserId }),
      participants: [],
      tags: [],
    };
    const message = createMockMessage({ role: 'USER', content: 'Hello there' });
    const annotation = {
      id: 'anno-1',
      chatId,
      sourceMessageId: 'msg-1',
      note: 'A marginal scribble',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const chatDocument = {
      id: 'cd-1',
      chatId,
      title: 'Working Draft',
      content: 'Once upon a time…',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const userRepos = {
      chats: {
        findById: jest.fn(async (id: string) => (id === chatId ? chat : null)),
        findAll: jest.fn(async () => [chat]),
        getMessages: jest.fn(async () => [message]),
      },
      characters: {
        findById: jest.fn(async () => null),
        findAll: jest.fn(async () => []),
      },
      tags: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      memories: { findByCharacterId: jest.fn(async () => []) },
    };

    const globalRepos = {
      conversationAnnotations: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? [annotation] : [])),
      },
      chatDocuments: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? [chatDocument] : [])),
      },
    };

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);

    // Export → bytes → records → reassembled export.
    const stream = createNdjsonStream(testUserId, {
      type: 'chats',
      scope: 'selected',
      selectedIds: [chatId],
      includeMemories: false,
    });
    const text = await readAllText(stream);
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    expect(result.manifest.exportType).toBe('chats');

    // The chat itself survives, with its single message.
    const data = result.data as {
      chats: Array<{ id: string; messages: unknown[] }>;
      conversationAnnotations?: Array<{ id: string }>;
      chatDocuments?: Array<{ id: string }>;
    };
    expect(data.chats).toHaveLength(1);
    expect(data.chats[0].id).toBe(chatId);
    expect(data.chats[0].messages).toHaveLength(1);

    // The two arrays the dead builder used to drop survive the round-trip.
    expect(data.conversationAnnotations).toBeDefined();
    expect(data.conversationAnnotations).toHaveLength(1);
    expect(data.conversationAnnotations![0]).toMatchObject({ id: 'anno-1', note: 'A marginal scribble' });

    expect(data.chatDocuments).toBeDefined();
    expect(data.chatDocuments).toHaveLength(1);
    expect(data.chatDocuments![0]).toMatchObject({ id: 'cd-1', title: 'Working Draft' });
  });
});

// ============================================================================
// Embeddings never leave the instance
// ============================================================================

describe('NDJSON export — memory embeddings', () => {
  const testUserId = 'user-vectors';
  const characterId = 'char-vector-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never writes an embedding, in any form, into the archive', async () => {
    const character = {
      id: characterId,
      name: 'Wexford',
      userId: testUserId,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // A hydrated memory as the repository actually returns it: the embedding
    // is a Float32Array, which JSON.stringify turns into an index-keyed
    // object ({"0":0.1,"1":0.2,…}) — ~29.6 KB of it per memory in production.
    const memory = {
      id: 'mem-1',
      characterId,
      content: 'He never did trust the barometer.',
      summary: 'Distrusts barometers',
      keywords: [],
      tags: [],
      importance: 0.5,
      embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const userRepos = {
      characters: {
        findById: jest.fn(async (id: string) => (id === characterId ? character : null)),
        findAll: jest.fn(async () => [character]),
      },
      tags: { findById: jest.fn(async () => null) },
      memories: { findByCharacterId: jest.fn(async () => [memory]) },
    };
    const globalRepos = {
      wardrobe: { findByCharacterId: jest.fn(async () => []) },
      characterPluginData: { getPluginDataMap: jest.fn(async () => ({})) },
    };

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);

    const text = await readAllText(
      createNdjsonStream(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [characterId],
        includeMemories: true,
      })
    );

    // The blunt assertion is the valuable one: the word must not appear
    // anywhere in the archive text, in any encoding.
    expect(text).not.toContain('embedding');

    const result = await assembleExportFromStream(ndjsonToRecords(text));
    const data = result.data as { memories?: Array<Record<string, unknown>> };
    expect(data.memories).toHaveLength(1);
    expect(data.memories![0]).not.toHaveProperty('embedding');
    // The memory itself is entirely intact — only the vector is gone.
    expect(data.memories![0]).toMatchObject({
      id: 'mem-1',
      content: 'He never did trust the barometer.',
      summary: 'Distrusts barometers',
    });
  });

  it('drops embeddings arriving from older archives, in both serialized forms', async () => {
    // Hand-built archive of the kind already in the wild: one memory carries
    // the plain-array form, the other the index-keyed-object form a
    // JSON.stringify'd Float32Array produces. Both must be discarded — a
    // foreign vector in a corpus governed by a different embedding standard
    // corrupts search silently whenever the dimensionality matches.
    const lines = [
      {
        kind: '__envelope__',
        format: 'qtap-ndjson',
        version: 1,
        manifest: {
          format: 'quilltap-export',
          version: '1.0',
          exportType: 'characters',
          createdAt: new Date().toISOString(),
          appVersion: '4.7.0',
          settings: { includeMemories: true, scope: 'all', selectedIds: [] },
          counts: {},
        },
      },
      {
        kind: 'character',
        data: { id: 'char-legacy', name: 'Prendergast', tags: [] },
      },
      {
        kind: 'memory',
        data: {
          id: 'mem-array-form',
          characterId: 'char-legacy',
          content: 'Array-form embedding',
          summary: 'array',
          embedding: [0.1, 0.2, 0.3],
        },
      },
      {
        kind: 'memory',
        data: {
          id: 'mem-object-form',
          characterId: 'char-legacy',
          content: 'Index-keyed-object embedding',
          summary: 'object',
          embedding: { '0': 0.1, '1': 0.2, '2': 0.3 },
        },
      },
    ];

    const result = await assembleExportFromStream(
      (async function* () {
        for (const line of lines) yield line;
      })()
    );

    const data = result.data as { memories?: Array<Record<string, unknown>> };
    expect(data.memories).toHaveLength(2);
    for (const memory of data.memories!) {
      expect(memory).not.toHaveProperty('embedding');
    }
    // Content still arrives — we drop the vector, not the memory.
    expect(data.memories!.map((m) => m.id).sort()).toEqual([
      'mem-array-form',
      'mem-object-form',
    ]);
  });
});

// ============================================================================
// The types that were unreachable from the picker (Phase 2)
// ============================================================================

describe('NDJSON export → import round-trip — groups and document stores', () => {
  const testUserId = 'user-phase2';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('round-trips a group with its members and linked stores', async () => {
    const group = {
      id: 'group-1',
      name: 'The Drones Club',
      description: 'A fellowship',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const userRepos = {
      groups: { findById: jest.fn(async () => group), findAll: jest.fn(async () => [group]) },
      groupCharacterMembers: {
        findByGroupId: jest.fn(async () => [{ characterId: 'char-a' }, { characterId: 'char-b' }]),
      },
      groupDocMountLinks: {
        findByGroupId: jest.fn(async () => [{ mountPointId: 'mp-1' }]),
      },
      characters: {
        findById: jest.fn(async (id: string) => ({ id, name: id === 'char-a' ? 'Bertie' : 'Jeeves' })),
      },
    };

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue({});

    const text = await readAllText(
      createNdjsonStream(testUserId, {
        type: 'groups',
        scope: 'selected',
        selectedIds: ['group-1'],
      })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    expect(result.manifest.exportType).toBe('groups');
    const data = result.data as {
      groups: Array<{
        id: string;
        name: string;
        _memberCharacterIds?: string[];
        _memberNames?: string[];
        _linkedStoreMountPointIds?: string[];
      }>;
    };
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]).toMatchObject({ id: 'group-1', name: 'The Drones Club' });
    // Membership and linked stores are what the import-order fix depends on.
    expect(data.groups[0]._memberCharacterIds).toEqual(['char-a', 'char-b']);
    expect(data.groups[0]._memberNames).toEqual(['Bertie', 'Jeeves']);
    expect(data.groups[0]._linkedStoreMountPointIds).toEqual(['mp-1']);
  });

  it('round-trips a database-backed document store with folders, documents, and blobs', async () => {
    const mountPoint = {
      id: 'mp-1',
      name: 'The Scriptorium',
      basePath: '',
      mountType: 'database' as const,
      storeType: 'documents' as const,
      includePatterns: ['**/*.md'],
      excludePatterns: [],
      enabled: true,
    };
    const blobBytes = Buffer.from('a small attachment');

    const globalRepos = {
      docMountPoints: {
        findById: jest.fn(async () => mountPoint),
        findAll: jest.fn(async () => [mountPoint]),
      },
      docMountFolders: {
        findByMountPointId: jest.fn(async () => [
          { mountPointId: 'mp-1', parentId: null, name: 'Notes', path: 'Notes' },
        ]),
      },
      docMountDocuments: {
        findByMountPointId: jest.fn(async () => [
          {
            mountPointId: 'mp-1',
            relativePath: 'Notes/one.md',
            fileName: 'one.md',
            fileType: 'markdown',
            content: '# One',
            contentSha256: 'a'.repeat(64),
            plainTextLength: 5,
            lastModified: new Date().toISOString(),
            folderId: 'folder-1',
            linkGroupId: null,
          },
        ]),
      },
      docMountBlobs: {
        listByMountPoint: jest.fn(async () => [
          {
            id: 'blob-1',
            mountPointId: 'mp-1',
            relativePath: 'Notes/pic.png',
            originalFileName: 'pic.png',
            originalMimeType: 'image/png',
            storedMimeType: 'image/webp',
            sizeBytes: blobBytes.length,
            sha256: 'b'.repeat(64),
            description: '',
          },
        ]),
        readData: jest.fn(async () => blobBytes),
      },
      projectDocMountLinks: {
        findByMountPointId: jest.fn(async () => [{ projectId: 'proj-1', mountPointId: 'mp-1' }]),
      },
    };

    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);

    const text = await readAllText(
      createNdjsonStream(testUserId, {
        type: 'document-stores',
        scope: 'selected',
        selectedIds: ['mp-1'],
      })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    const data = result.data as {
      mountPoints: Array<{ id: string; name: string }>;
      folders?: Array<{ path: string }>;
      documents: Array<{ relativePath: string; content: string }>;
      blobs: Array<{ sha256: string; dataBase64: string }>;
      projectLinks?: Array<{ projectId: string }>;
    };
    expect(data.mountPoints).toHaveLength(1);
    expect(data.folders).toHaveLength(1);
    expect(data.documents[0]).toMatchObject({ relativePath: 'Notes/one.md', content: '# One' });
    expect(data.blobs).toHaveLength(1);
    expect(Buffer.from(data.blobs[0].dataBase64, 'base64').toString()).toBe('a small attachment');
    expect(data.projectLinks).toEqual([{ projectId: 'proj-1', mountPointId: 'mp-1' }]);
  });
});

// ============================================================================
// The five new export types (Phase 3)
// ============================================================================

describe('NDJSON export → import round-trip — new export types', () => {
  const testUserId = 'user-phase3';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('round-trips a file library, reassembling a multi-chunk blob', async () => {
    // Deliberately larger than BLOB_CHUNK_BYTES (3 MiB) so the bytes are split
    // across several base64 chunks and have to be stitched back together. The
    // pattern is non-uniform so a mis-ordered or truncated join is visible.
    const size = 3 * 1024 * 1024 + 1024;
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 251;

    const file = {
      id: 'file-1',
      userId: testUserId,
      sha256: 'c'.repeat(64),
      originalFilename: 'plate.png',
      mimeType: 'image/png',
      size,
      linkedTo: ['chat-1'],
      tags: [],
      source: 'UPLOAD',
      category: 'IMAGE',
      projectId: null,
      folderPath: '/plates/',
      storageKey: 'mount-blob:mp-local:blob-local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const backupFile = { ...file, id: 'file-backup', category: 'BACKUP', folderPath: '/backups' };
    // A character archive bundle is a `.qtap` in its own right and is excluded
    // for the same reason a backup is.
    const archiveFile = { ...file, id: 'file-archive', category: 'ARCHIVE', folderPath: '/archives' };

    (getUserRepositories as jest.Mock).mockReturnValue({
      files: { findAll: jest.fn(async () => [file, backupFile, archiveFile]) },
    });
    (getRepositories as jest.Mock).mockReturnValue({
      folders: {
        findByUserId: jest.fn(async () => [
          { id: 'folder-1', path: '/plates/', name: 'plates', parentFolderId: null, projectId: null },
        ]),
      },
    });
    (fileStorageManager.downloadFile as jest.Mock).mockResolvedValue(bytes);

    const text = await readAllText(
      createNdjsonStream(testUserId, {
        type: 'files',
        scope: 'selected',
        selectedIds: ['file-1', 'file-backup', 'file-archive'],
      })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    const data = result.data as {
      files: Array<{
        id: string;
        dataBase64?: string;
        storageKey?: string;
        _sourceStorageKey?: string | null;
        userId?: string;
      }>;
      folders?: Array<{ path: string }>;
    };

    // Neither backups nor character-archive bundles travel inside an export.
    expect(data.files).toHaveLength(1);
    expect(data.files[0].id).toBe('file-1');
    expect(data.folders).toEqual([
      { id: 'folder-1', path: '/plates/', name: 'plates', parentFolderId: null, projectId: null },
    ]);

    // Bytes survive the chunk split byte-for-byte.
    const reassembled = Buffer.from(data.files[0].dataBase64!, 'base64');
    expect(reassembled.length).toBe(size);
    expect(reassembled.equals(bytes)).toBe(true);

    // The instance-specific storage key travels as provenance only.
    expect(data.files[0]).not.toHaveProperty('storageKey');
    expect(data.files[0]).not.toHaveProperty('userId');
    expect(data.files[0]._sourceStorageKey).toBe('mount-blob:mp-local:blob-local');
  });

  it('round-trips prompt templates, excluding built-ins', async () => {
    const mine = {
      id: 'pt-1',
      userId: testUserId,
      name: 'The Interrogative',
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const builtIn = { ...mine, id: 'pt-builtin', name: 'House Standard', isBuiltIn: true };

    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue({
      promptTemplates: {
        findById: jest.fn(async (id: string) => (id === 'pt-1' ? mine : builtIn)),
        findAll: jest.fn(async () => [mine, builtIn]),
      },
    });

    const text = await readAllText(
      createNdjsonStream(testUserId, {
        type: 'prompt-templates',
        scope: 'selected',
        selectedIds: ['pt-1', 'pt-builtin'],
      })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    const data = result.data as { promptTemplates: Array<{ id: string }> };
    expect(data.promptTemplates.map((t) => t.id)).toEqual(['pt-1']);
  });

  it('round-trips the provider model catalogue', async () => {
    const model = {
      id: 'pm-1',
      provider: 'ANTHROPIC',
      modelId: 'claude-opus-5',
      modelType: 'chat',
      displayName: 'Opus 5',
      deprecated: false,
      experimental: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue({
      providerModels: { findAll: jest.fn(async () => [model]) },
    });

    const text = await readAllText(
      createNdjsonStream(testUserId, { type: 'provider-models', scope: 'all' })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    const data = result.data as { providerModels: Array<{ modelId: string }> };
    expect(data.providerModels).toHaveLength(1);
    expect(data.providerModels[0].modelId).toBe('claude-opus-5');
  });

  it('strips password-typed plugin config keys and records what it withheld', async () => {
    const config = {
      id: 'pc-1',
      userId: testUserId,
      pluginName: 'qtap-plugin-curl',
      config: {
        endpoint: 'https://example.invalid',
        apiToken: 'hunter2',
        retries: 3,
      },
      enabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue({
      pluginConfigs: { findByUserId: jest.fn(async () => [config]) },
    });
    (getPlugin as jest.Mock).mockReturnValue({
      manifest: {
        configSchema: [
          { key: 'endpoint', label: 'Endpoint', type: 'url' },
          { key: 'apiToken', label: 'API Token', type: 'password' },
          { key: 'retries', label: 'Retries', type: 'number' },
        ],
      },
    });

    const text = await readAllText(
      createNdjsonStream(testUserId, { type: 'plugin-configs', scope: 'all' })
    );

    // The secret must not survive anywhere in the archive text.
    expect(text).not.toContain('hunter2');

    const result = await assembleExportFromStream(ndjsonToRecords(text));
    const data = result.data as {
      pluginConfigs: Array<{
        pluginName: string;
        config: Record<string, unknown>;
        enabled?: boolean;
        _redactedKeys?: string[];
      }>;
    };
    expect(data.pluginConfigs).toHaveLength(1);
    expect(data.pluginConfigs[0].config).toEqual({
      endpoint: 'https://example.invalid',
      retries: 3,
    });
    expect(data.pluginConfigs[0]._redactedKeys).toEqual(['apiToken']);
    // `enabled` travels so a plugin the user switched off stays off.
    expect(data.pluginConfigs[0].enabled).toBe(false);
  });

  it('withholds the entire config when the plugin manifest cannot be resolved', async () => {
    const config = {
      id: 'pc-2',
      userId: testUserId,
      pluginName: 'qtap-plugin-absent',
      config: { anything: 'could be a secret', alsoThis: 'or this' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue({
      pluginConfigs: { findByUserId: jest.fn(async () => [config]) },
    });
    // Plugin not installed here — we cannot tell which keys are sensitive.
    (getPlugin as jest.Mock).mockReturnValue(null);

    const text = await readAllText(
      createNdjsonStream(testUserId, { type: 'plugin-configs', scope: 'all' })
    );
    expect(text).not.toContain('could be a secret');

    const result = await assembleExportFromStream(ndjsonToRecords(text));
    const data = result.data as {
      pluginConfigs: Array<{ config: Record<string, unknown>; _redactedKeys?: string[] }>;
    };
    expect(data.pluginConfigs[0].config).toEqual({});
    expect(data.pluginConfigs[0]._redactedKeys).toEqual(['*']);
  });

  it('round-trips instance settings, and never the instance-local keys', async () => {
    // listPortableInstanceSettings owns the exclusion; the writer trusts it.
    // Asserting on the mock's contract here keeps the two honest: the
    // exclusion list itself is covered where it lives.
    (listPortableInstanceSettings as jest.Mock).mockResolvedValue([
      { key: 'maxConcurrentJobs', value: '8' },
      { key: 'memoryRecall', value: '{"scopePolicy":"down-weight"}' },
    ]);
    (getUserRepositories as jest.Mock).mockReturnValue({});
    (getRepositories as jest.Mock).mockReturnValue({});

    const text = await readAllText(
      createNdjsonStream(testUserId, { type: 'instance-settings', scope: 'all' })
    );
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    const data = result.data as { instanceSettings: Array<{ key: string; value: string }> };
    expect(data.instanceSettings).toEqual([
      { key: 'maxConcurrentJobs', value: '8' },
      { key: 'memoryRecall', value: '{"scopePolicy":"down-weight"}' },
    ]);
    expect(text).not.toContain('MountPointId');
    expect(text).not.toContain('highest_app_version');
  });
});
