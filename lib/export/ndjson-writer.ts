/**
 * NDJSON export writer (qtap-ndjson v1).
 *
 * Streams `.qtap` exports one record per line so the pipeline never holds
 * the whole payload in a single V8 string. Each entity is emitted as soon
 * as it's loaded from its repository, and large blob bytes are split into
 * 3 MB chunks (~4 MB once base64-encoded) so even a multi-gigabyte document
 * store exports without hitting string-length ceilings.
 */

import { logger as baseLogger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import packageJson from '@/package.json';
import type {
  ExportOptions,
  QuilltapExportManifest,
  QuilltapExportCounts,
  QtapRecord,
  ExportedCharacter,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  ExportedGroup,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
} from './types';
import type { MessageEvent, Memory } from '@/lib/schemas/types';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { isFileExcludedFromExport } from './excluded-files';
import { getPlugin } from '@/lib/plugins/registry';
import { listPortableInstanceSettings } from '@/lib/instance-settings';

const logger = baseLogger.child({ module: 'export:ndjson-writer' });
const APP_VERSION = packageJson.version;

/**
 * Raw bytes per blob chunk. 3 MB raw → ~4 MB base64 per line, comfortably
 * below the 128 MB per-line safety cap on the reader side and well clear of
 * V8's ~512 MB string ceiling.
 *
 * Must stay a multiple of 3: each chunk is base64-encoded *separately* and the
 * reader rejoins the encoded strings, so only the final chunk may carry
 * padding. Any other size would splice `=` characters into the middle of the
 * joined payload and corrupt every multi-chunk blob.
 */
const BLOB_CHUNK_BYTES = 3 * 1024 * 1024;

// ============================================================================
// HELPERS (profile sanitization + tag/API-key label resolution for export)
// ============================================================================

async function resolveTagNames(
  repos: ReturnType<typeof getUserRepositories>,
  tagIds: string[] | undefined
): Promise<string[]> {
  if (!tagIds || tagIds.length === 0) return [];
  const names: string[] = [];
  for (const tagId of tagIds) {
    try {
      const tag = await repos.tags.findById(tagId);
      if (tag) names.push(tag.name);
    } catch {
      // swallow — tag not found is non-fatal
    }
  }
  return names;
}

async function resolveApiKeyLabel(
  repos: ReturnType<typeof getUserRepositories>,
  apiKeyId?: string | null
): Promise<string | undefined> {
  if (!apiKeyId) return undefined;
  try {
    const apiKey = await repos.connections.findApiKeyById(apiKeyId);
    return apiKey?.label;
  } catch {
    return undefined;
  }
}

function sanitizeProfile<T extends { apiKeyId?: string | null }>(
  profile: T,
  apiKeyLabel?: string
): Omit<T, 'apiKeyId'> & { _apiKeyLabel?: string } {
  const { apiKeyId: _omit, ...rest } = profile;
  return {
    ...rest,
    ...(apiKeyLabel && { _apiKeyLabel: apiKeyLabel }),
  } as Omit<T, 'apiKeyId'> & { _apiKeyLabel?: string };
}

/**
 * Drop the hydrated vector off a memory before it leaves the instance.
 *
 * Two reasons, both load-bearing:
 *
 *  1. **Size.** `Memory.embedding` is a `Float32Array`, and `JSON.stringify`
 *     turns a typed array into an index-keyed object — ~29.6 KB per memory.
 *     A real corpus made embeddings 99.7% of the export (791 MB → ~2.5 MB
 *     once stripped).
 *  2. **Correctness.** A vector is only meaningful against the model that
 *     produced it. Shipping one into an instance governed by a different
 *     embedding standard silently poisons the corpus whenever the
 *     dimensionality happens to match, and nothing downstream can detect it.
 *
 * The importer re-embeds what it inserts (see `executeImport`), so no
 * information is lost — only a cache that must be rebuilt locally anyway.
 */
function stripEmbedding(memory: Memory): Omit<Memory, 'embedding'> {
  const { embedding: _embedding, ...rest } = memory;
  return rest;
}

function buildManifest(
  options: ExportOptions,
  counts: QuilltapExportCounts
): QuilltapExportManifest {
  return {
    format: 'quilltap-export',
    version: '1.0',
    exportType: options.type,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    settings: {
      includeMemories: options.includeMemories ?? false,
      scope: options.scope,
      selectedIds: options.selectedIds ?? [],
      preserveIds: options.preserveIds ?? false,
    },
    counts,
  };
}

/** Yield and bump the matching counter in one place. */
function bump(counts: QuilltapExportCounts, key: keyof QuilltapExportCounts, delta = 1): void {
  counts[key] = (counts[key] ?? 0) + delta;
}

// ============================================================================
// PER-ENTITY ASYNC GENERATORS
// ============================================================================

async function* streamCharacters(
  userId: string,
  ids: string[],
  includeMemories: boolean,
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  for (const id of ids) {
    // Use the vault-aware lookup so managed fields (identity, description,
    // manifesto, personality, etc.) land in the export. The raw lookup would
    // skip the overlay and emit the empty DB columns left behind by the 4.6
    // cutover, producing a hollow record.
    const character = await repos.characters.findById(id);
    if (!character) continue;

    const tagNames = await resolveTagNames(repos, character.tags);
    const record: ExportedCharacter = {
      ...character,
      ...(tagNames.length > 0 && { _tagNames: tagNames }),
    };

    // Emit the character row first (without wardrobe/pluginData nested).
    const { wardrobeItems: _w, pluginData: _p, ...charOnly } = record;
    yield { kind: 'character', data: charOnly };
    bump(counts, 'characters');

    // Wardrobe items — one record each. Read through the overlay: post-cutover
    // the character vault is the authoritative store, not the wardrobe_items table.
    try {
      const wardrobeItems = await globalRepos.wardrobe.findByCharacterId(id);
      for (const item of wardrobeItems) {
        yield { kind: 'wardrobe_item', characterId: id, data: item };
      }
      if (wardrobeItems.length > 0) {
      }
    } catch (error) {
      logger.warn('Failed to load wardrobe items for character export', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Plugin data — one record per plugin.
    try {
      const pluginData = await globalRepos.characterPluginData.getPluginDataMap(id);
      const pluginNames = Object.keys(pluginData);
      for (const pluginName of pluginNames) {
        yield {
          kind: 'character_plugin_data',
          characterId: id,
          pluginName,
          data: pluginData[pluginName],
        };
      }
      if (pluginNames.length > 0) {
      }
    } catch (error) {
      logger.warn('Failed to load plugin data for character export', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // The character's vault travels with the character (WP A2). Without it a
    // cross-instance import lands a faceless, mail-less, photo-less character:
    // `defaultImageId` and every `avatarOverrides[].imageId` are
    // `doc_mount_file_links.id` values in *this* instance's vault, so with no
    // store records to remap through they dangle (Bug 52).
    //
    // Doc-store records are parented by `mountPointId`, not `characterId`, so
    // their position relative to the `character` line is free; they sit here
    // for readability. `skipProjectLinks` because a character vault never has
    // any — the flag just keeps the bundle clean.
    if (character.characterDocumentMountPointId) {
      try {
        yield* streamOneStore(globalRepos, character.characterDocumentMountPointId, counts, {
          skipProjectLinks: true,
        });
      } catch (error) {
        logger.warn('Failed to export character vault', {
          characterId: id,
          mountPointId: character.characterDocumentMountPointId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Memories for this character — emitted right after, so the importer
    // can remap characterId from idMap without buffering.
    if (includeMemories) {
      try {
        const memories = await repos.memories.findByCharacterId(id);
        for (const memory of memories) {
          // Embeddings never travel (see stripEmbedding).
          yield { kind: 'memory', data: stripEmbedding(memory) };
          bump(counts, 'memories');
        }
      } catch (error) {
        logger.warn('Failed to load memories for character export', {
          characterId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

async function* streamChats(
  userId: string,
  ids: string[],
  includeMemories: boolean,
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);

  // For chat-memory collection we filter all characters' memories by chatId.
  // Load the character list once up front so we're not doing it per chat.
  const allCharacters = includeMemories ? await repos.characters.findAll() : [];

  for (const id of ids) {
    const chat = await repos.chats.findById(id);
    if (!chat) continue;

    const tagNames = await resolveTagNames(repos, chat.tags);

    const participantInfo = await Promise.all(
      chat.participants.map(async (p) => {
        let characterName: string | undefined;
        if (p.type === 'CHARACTER' && p.characterId) {
          const char = await repos.characters.findById(p.characterId);
          characterName = char?.name;
        }
        return { participantId: p.id, characterName, type: p.type };
      })
    );

    // Ephemeral per-chat UX state that must not ride the portable .qtap file
    // into another instance:
    //   - commonplaceRecallHistory: the Commonplace Book recall anti-repetition
    //     ring buffer (its ChatMetadataSchema contract declares it out of scope).
    //   - commonplaceSceneCache: the per-target scene-state emission cache used
    //     to collapse unchanged wardrobe prose; instance-local and regenerable.
    // Both are dropped here so only durable chat data leaves the instance.
    const {
      commonplaceRecallHistory: _ephemeralRecallHistory,
      commonplaceSceneCache: _ephemeralSceneCache,
      ...chatForExport
    } = chat;
    const chatRecord: Omit<ExportedChat, 'messages'> = {
      ...chatForExport,
      ...(tagNames.length > 0 && { _tagNames: tagNames }),
      ...(participantInfo.length > 0 && { _participantInfo: participantInfo }),
    };
    yield { kind: 'chat', data: chatRecord };
    bump(counts, 'chats');

    // Stream messages one at a time.
    try {
      const events = await repos.chats.getMessages(id);
      for (const event of events) {
        if (event.type !== 'message') continue;
        yield { kind: 'chat_message', chatId: id, data: event as MessageEvent };
        bump(counts, 'messages');
      }
    } catch (error) {
      logger.warn('Failed to load chat messages for export', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Conversation annotations and chat documents come after the messages so
    // importers can resolve sourceMessageId / chatId against IDs they have
    // already seen in this same stream.
    try {
      const annotations = await getRepositories().conversationAnnotations.findByChatId(id);
      for (const annotation of annotations) {
        yield { kind: 'conversation_annotation', chatId: id, data: annotation };
        bump(counts, 'conversationAnnotations');
      }
    } catch (error) {
      logger.warn('Failed to load conversation annotations for export', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const chatDocs = await getRepositories().chatDocuments.findByChatId(id);
      for (const cd of chatDocs) {
        yield { kind: 'chat_document', chatId: id, data: cd };
        bump(counts, 'chatDocuments');
      }
    } catch (error) {
      logger.warn('Failed to load chat documents for export', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Memories scoped to this chat.
    if (includeMemories) {
      for (const char of allCharacters) {
        try {
          const memories = await repos.memories.findByCharacterId(char.id);
          for (const memory of memories) {
            if (memory.chatId !== id) continue;
            // Embeddings never travel (see stripEmbedding).
            yield { kind: 'memory', data: stripEmbedding(memory) };
            bump(counts, 'memories');
          }
        } catch {
          // continue — non-fatal per character
        }
      }
    }
  }
}

async function* streamRoleplayTemplates(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  for (const id of ids) {
    const template = await globalRepos.roleplayTemplates.findById(id);
    if (!template || template.isBuiltIn || template.userId !== userId) continue;
    const tagNames = await resolveTagNames(repos, template.tags);
    const data: ExportedRoleplayTemplate = {
      ...template,
      ...(tagNames.length > 0 && { _tagNames: tagNames }),
    };
    yield { kind: 'roleplay_template', data };
    bump(counts, 'roleplayTemplates');
  }
}

async function* streamConnectionProfiles(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const profile = await repos.connections.findById(id);
    if (!profile) continue;
    const label = await resolveApiKeyLabel(repos, profile.apiKeyId);
    yield {
      kind: 'connection_profile',
      data: sanitizeProfile(profile, label) as SanitizedConnectionProfile,
    };
    bump(counts, 'connectionProfiles');
  }
}

async function* streamImageProfiles(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const profile = await repos.imageProfiles.findById(id);
    if (!profile) continue;
    const label = await resolveApiKeyLabel(repos, profile.apiKeyId);
    yield {
      kind: 'image_profile',
      data: sanitizeProfile(profile, label) as SanitizedImageProfile,
    };
    bump(counts, 'imageProfiles');
  }
}

async function* streamEmbeddingProfiles(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const profile = await repos.embeddingProfiles.findById(id);
    if (!profile) continue;
    const label = await resolveApiKeyLabel(repos, profile.apiKeyId);
    yield {
      kind: 'embedding_profile',
      data: sanitizeProfile(profile, label) as SanitizedEmbeddingProfile,
    };
    bump(counts, 'embeddingProfiles');
  }
}

async function* streamTags(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const tag = await repos.tags.findById(id);
    if (!tag) continue;
    yield { kind: 'tag', data: tag };
    bump(counts, 'tags');
  }
}

async function* streamProjects(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const project = await repos.projects.findById(id);
    if (!project) continue;

    const characterRosterNames: string[] = [];
    for (const characterId of project.characterRoster ?? []) {
      const character = await repos.characters.findById(characterId);
      if (character) characterRosterNames.push(character.name);
    }

    const allChats = await repos.chats.findAll();
    const chatCount = allChats.filter((c) => c.projectId === id).length;

    const allFiles = await repos.files.findAll();
    const fileCount = allFiles.filter((f) => f.linkedTo?.includes(id)).length;

    const data: ExportedProject = {
      ...project,
      ...(characterRosterNames.length > 0 && { _characterRosterNames: characterRosterNames }),
      _chatCount: chatCount,
      _fileCount: fileCount,
    };
    yield { kind: 'project', data };
    bump(counts, 'projects');
  }
}

async function* streamGroups(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  for (const id of ids) {
    const group = await repos.groups.findById(id);
    if (!group) continue;

    const memberCharacterIds: string[] = [];
    const memberNames: string[] = [];
    try {
      const members = await repos.groupCharacterMembers.findByGroupId(id);
      for (const member of members) {
        memberCharacterIds.push(member.characterId);
        const character = await repos.characters.findById(member.characterId);
        if (character) memberNames.push(character.name);
      }
    } catch (error) {
      logger.warn('Failed to load group members for export', {
        groupId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const linkedStoreMountPointIds: string[] = [];
    try {
      const links = await repos.groupDocMountLinks.findByGroupId(id);
      for (const link of links) {
        linkedStoreMountPointIds.push(link.mountPointId);
      }
    } catch (error) {
      logger.warn('Failed to load group linked stores for export', {
        groupId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const data: ExportedGroup = {
      ...group,
      ...(memberNames.length > 0 && { _memberNames: memberNames }),
      ...(memberCharacterIds.length > 0 && { _memberCharacterIds: memberCharacterIds }),
      ...(linkedStoreMountPointIds.length > 0 && { _linkedStoreMountPointIds: linkedStoreMountPointIds }),
    };
    yield { kind: 'group', data };
    bump(counts, 'groups');
  }
}

/**
 * Emit one document store in full: the mount-point row, then — for
 * database-backed mounts — parent-first folders and text documents, then every
 * blob header with its ordered chunks, and finally the store's project links.
 *
 * Extracted from `streamDocumentStores` so a character vault can be emitted
 * inline by `streamCharacters` (WP A2). The body closes over nothing but its
 * arguments, so both callers get identical records.
 *
 * Chunking invariants live with `BLOB_CHUNK_BYTES` and must not be disturbed:
 * each chunk is base64-encoded separately, the reader rejoins the *encoded*
 * strings and detects completion by counting chunks, and a `doc_mount_blob`
 * always precedes its chunks.
 *
 * @param opts.skipProjectLinks omit `project_doc_mount_link` records. Character
 * vaults never carry project links, so the characters path passes this to keep
 * bundles clean.
 */
async function* streamOneStore(
  repos: ReturnType<typeof getRepositories>,
  mountPointId: string,
  counts: QuilltapExportCounts,
  opts?: { skipProjectLinks?: boolean }
): AsyncGenerator<QtapRecord> {
  {
    const mp = await repos.docMountPoints.findById(mountPointId);
    if (!mp) return;

    yield {
      kind: 'doc_mount_point',
      data: {
        id: mp.id,
        name: mp.name,
        basePath: mp.basePath,
        mountType: mp.mountType,
        storeType: mp.storeType,
        includePatterns: mp.includePatterns,
        excludePatterns: mp.excludePatterns,
        enabled: mp.enabled,
      },
    };
    bump(counts, 'documentStores');

    if (mp.mountType === 'database') {
      // Emit folder rows before documents so import can resolve folderId FKs
      const folders = await repos.docMountFolders.findByMountPointId(mp.id);
      // Sort by path length to ensure parents before children
      const sortedFolders = folders.sort((a, b) => a.path.length - b.path.length);
      for (const folder of sortedFolders) {
        yield {
          kind: 'doc_mount_folder',
          data: {
            id: folder.id,
            mountPointId: folder.mountPointId,
            parentId: folder.parentId,
            name: folder.name,
            path: folder.path,
          },
        };
        bump(counts, 'documentStoreFolders');
      }

      const docs = await repos.docMountDocuments.findByMountPointId(mp.id);
      for (const d of docs) {
        // doc_mount_documents row only ever holds text content — skip
        // links that point at blob-type content (they're exported as blobs).
        if (
          d.fileType !== 'markdown' &&
          d.fileType !== 'txt' &&
          d.fileType !== 'json' &&
          d.fileType !== 'jsonl'
        ) {
          continue;
        }
        yield {
          kind: 'doc_mount_document',
          data: {
            mountPointId: d.mountPointId,
            relativePath: d.relativePath,
            fileName: d.fileName,
            fileType: d.fileType,
            content: d.content,
            contentSha256: d.contentSha256,
            plainTextLength: d.plainTextLength,
            lastModified: d.lastModified,
            folderId: d.folderId,
            fileId: d.fileId,
            linkId: d.linkId,
            linkGroupId: d.linkGroupId ?? null,
          },
        };
        bump(counts, 'documentStoreDocuments');
      }
    }

    const blobMetas = await repos.docMountBlobs.listByMountPoint(mp.id);
    for (const meta of blobMetas) {
      const data = await repos.docMountBlobs.readData(meta.id);
      if (!data) continue;

      const chunkCount = Math.max(1, Math.ceil(data.length / BLOB_CHUNK_BYTES));

      yield {
        kind: 'doc_mount_blob',
        data: {
          mountPointId: meta.mountPointId,
          relativePath: meta.relativePath,
          originalFileName: meta.originalFileName,
          originalMimeType: meta.originalMimeType,
          storedMimeType: meta.storedMimeType,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
          description: meta.description,
          descriptionUpdatedAt: meta.descriptionUpdatedAt ?? null,
          fileId: meta.fileId,
          linkId: meta.linkId,
          blobId: meta.id,
          extractedText: meta.extractedText ?? null,
          extractedTextSha256: meta.extractedTextSha256 ?? null,
          extractionStatus: meta.extractionStatus ?? 'none',
          extractionError: meta.extractionError ?? null,
          chunkCount,
        },
      };
      bump(counts, 'documentStoreBlobs');

      for (let index = 0; index < chunkCount; index++) {
        const start = index * BLOB_CHUNK_BYTES;
        const end = Math.min(start + BLOB_CHUNK_BYTES, data.length);
        const slice = data.subarray(start, end);
        yield {
          kind: 'doc_mount_blob_chunk',
          mountPointId: meta.mountPointId,
          sha256: meta.sha256,
          index,
          total: chunkCount,
          dataBase64: slice.toString('base64'),
        };
      }
    }

    if (!opts?.skipProjectLinks) {
      const links = await repos.projectDocMountLinks.findByMountPointId(mp.id);
      for (const link of links) {
        yield {
          kind: 'project_doc_mount_link',
          data: { projectId: link.projectId, mountPointId: link.mountPointId },
        };
        bump(counts, 'documentStoreProjectLinks');
      }
    }
  }
}

async function* streamDocumentStores(
  _userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  // Document stores are instance-scoped — use global repos on purpose.
  const repos = getRepositories();

  for (const id of ids) {
    yield* streamOneStore(repos, id, counts);
  }
}

/**
 * General file library: folders first (so the importer can build the tree
 * before anything references it), then each file's metadata followed by its
 * bytes as a `file_blob` header plus ordered `file_blob_chunk` records —
 * the same shape as the document-store blob pair.
 */
async function* streamFiles(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Folders are cheap metadata and the whole tree is emitted regardless of
  // which files were selected: a file whose folder is missing would import
  // into a flat root, and re-creating the tree later is not possible.
  try {
    const folders = await globalRepos.folders.findByUserId(userId);
    // Parents before children — the importer resolves parentFolderId by path.
    const sorted = [...folders].sort((a, b) => a.path.length - b.path.length);
    for (const folder of sorted) {
      yield {
        kind: 'folder',
        data: {
          id: folder.id,
          path: folder.path,
          name: folder.name,
          parentFolderId: folder.parentFolderId ?? null,
          projectId: folder.projectId ?? null,
        },
      };
      bump(counts, 'folders');
    }
  } catch (error) {
    logger.warn('Failed to load folders for file export', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const idSet = new Set(ids);
  const allFiles = await repos.files.findAll();

  for (const file of allFiles) {
    if (!idSet.has(file.id)) continue;

    // Backups and character-archive bundles are both `.qtap` files in their
    // own right; neither rides inside another export.
    if (isFileExcludedFromExport(file)) {
      logger.debug('Skipping excluded file in export', {
        fileId: file.id,
        category: file.category,
      });
      continue;
    }

    let bytes: Buffer | null = null;
    try {
      bytes = await fileStorageManager.downloadFile(file);
    } catch (error) {
      logger.warn('Failed to read file bytes for export — exporting metadata only', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // storageKey never travels verbatim: it points into this instance's
    // storage (commonly `mount-blob:<mountPointId>:<blobId>`). It rides as
    // provenance only and the importer discards it.
    const { userId: _ownerId, storageKey, ...fileRest } = file;
    yield {
      kind: 'file',
      data: {
        ...fileRest,
        _sourceStorageKey: storageKey ?? null,
        ...(bytes === null && { _bytesMissing: true }),
      },
    };
    bump(counts, 'files');

    if (!bytes) continue;

    const chunkCount = Math.max(1, Math.ceil(bytes.length / BLOB_CHUNK_BYTES));
    yield {
      kind: 'file_blob',
      fileId: file.id,
      sha256: file.sha256,
      sizeBytes: bytes.length,
      chunkCount,
    };
    for (let index = 0; index < chunkCount; index++) {
      const start = index * BLOB_CHUNK_BYTES;
      const end = Math.min(start + BLOB_CHUNK_BYTES, bytes.length);
      yield {
        kind: 'file_blob_chunk',
        fileId: file.id,
        index,
        total: chunkCount,
        dataBase64: bytes.subarray(start, end).toString('base64'),
      };
    }
  }
}

async function* streamPromptTemplates(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const globalRepos = getRepositories();
  for (const id of ids) {
    const template = await globalRepos.promptTemplates.findById(id);
    // Built-ins are seeded from `prompts/` on every instance — they never
    // travel, exactly as with roleplay templates.
    if (!template || template.isBuiltIn || template.userId !== userId) continue;
    yield { kind: 'prompt_template', data: template };
    bump(counts, 'promptTemplates');
  }
}

async function* streamProviderModels(
  _userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  // The model catalogue is instance-global, not user-scoped.
  const globalRepos = getRepositories();
  const idSet = new Set(ids);
  const models = await globalRepos.providerModels.findAll();
  for (const model of models) {
    if (!idSet.has(model.id)) continue;
    yield { kind: 'provider_model', data: model };
    bump(counts, 'providerModels');
  }
}

/**
 * Resolve a plugin's manifest and return the set of config keys it declares as
 * `password`-typed. Returns `null` when the manifest can't be resolved — the
 * caller then withholds the whole config rather than guessing.
 */
function resolveSecretConfigKeys(pluginName: string): Set<string> | null {
  const plugin = getPlugin(pluginName);
  if (!plugin) return null;
  const schema = plugin.manifest.configSchema ?? [];
  return new Set(schema.filter((field) => field.type === 'password').map((field) => field.key));
}

async function* streamPluginConfigs(
  userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const globalRepos = getRepositories();
  const idSet = new Set(ids);
  const configs = await globalRepos.pluginConfigs.findByUserId(userId);

  for (const config of configs) {
    if (!idSet.has(config.id)) continue;

    // Redaction is mandatory. `config` is an untyped bag and manifests may
    // declare password-typed fields, which are stored in plaintext — fine in
    // a local backup, never in a portable .qtap.
    const secretKeys = resolveSecretConfigKeys(config.pluginName);
    let redactedKeys: string[];
    let safeConfig: Record<string, unknown>;

    if (secretKeys === null) {
      // Plugin isn't installed here, so we cannot tell which keys are secret.
      // Withhold everything rather than leak by omission of knowledge.
      redactedKeys = ['*'];
      safeConfig = {};
      logger.warn('Plugin manifest unavailable during export — withholding entire config', {
        pluginName: config.pluginName,
      });
    } else {
      redactedKeys = Object.keys(config.config).filter((key) => secretKeys.has(key));
      safeConfig = Object.fromEntries(
        Object.entries(config.config).filter(([key]) => !secretKeys.has(key))
      );
    }

    const { userId: _ownerId, ...rest } = config;
    yield {
      kind: 'plugin_config',
      data: {
        ...rest,
        config: safeConfig,
        ...(redactedKeys.length > 0 && { _redactedKeys: redactedKeys }),
      },
    };
    bump(counts, 'pluginConfigs');
  }
}

async function* streamInstanceSettings(
  _userId: string,
  ids: string[],
  counts: QuilltapExportCounts
): AsyncGenerator<QtapRecord> {
  const idSet = new Set(ids);
  // The exclusion of instance-local keys lives with the key constants in
  // lib/instance-settings so a new setting is a conscious decision.
  const settings = await listPortableInstanceSettings();
  for (const setting of settings) {
    if (!idSet.has(setting.key)) continue;
    yield { kind: 'instance_setting', data: setting };
    bump(counts, 'instanceSettings');
  }
}

// ============================================================================
// TOP-LEVEL STREAMER
// ============================================================================

/**
 * Resolve the list of entity IDs to export based on scope + type, without
 * materializing any of the heavy payload. Returns an array of IDs only.
 */
async function resolveExportIds(
  userId: string,
  options: ExportOptions
): Promise<string[]> {
  if (options.scope === 'selected') return options.selectedIds ?? [];

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  switch (options.type) {
    case 'characters':
      return (await repos.characters.findAll()).map((c) => c.id);
    case 'chats':
      return (await repos.chats.findAll()).map((c) => c.id);
    case 'roleplay-templates':
      return (await globalRepos.roleplayTemplates.findAll())
        .filter((t) => !t.isBuiltIn && t.userId === userId)
        .map((t) => t.id);
    case 'connection-profiles':
      return (await repos.connections.findAll()).map((p) => p.id);
    case 'image-profiles':
      return (await repos.imageProfiles.findAll()).map((p) => p.id);
    case 'embedding-profiles':
      return (await repos.embeddingProfiles.findAll()).map((p) => p.id);
    case 'tags':
      return (await repos.tags.findAll()).map((t) => t.id);
    case 'projects':
      return (await repos.projects.findAll()).map((p) => p.id);
    case 'groups':
      return (await repos.groups.findAll()).map((g) => g.id);
    case 'document-stores':
      return (await globalRepos.docMountPoints.findAll()).map((s) => s.id);
    case 'files':
      return (await repos.files.findAll())
        .filter((f) => !isFileExcludedFromExport(f))
        .map((f) => f.id);
    case 'prompt-templates':
      return (await globalRepos.promptTemplates.findAll())
        .filter((t) => !t.isBuiltIn && t.userId === userId)
        .map((t) => t.id);
    case 'provider-models':
      return (await globalRepos.providerModels.findAll()).map((m) => m.id);
    case 'plugin-configs':
      return (await globalRepos.pluginConfigs.findByUserId(userId)).map((c) => c.id);
    case 'instance-settings':
      // Keyed by setting key rather than a UUID — the table has no id column.
      return (await listPortableInstanceSettings()).map((s) => s.key);
    default:
      throw new Error(`Unknown export type: ${options.type}`);
  }
}

/**
 * Async generator over every line of the streaming export, envelope first,
 * footer last.
 */
export async function* streamExportRecords(
  userId: string,
  options: ExportOptions
): AsyncGenerator<QtapRecord> {
  logger.info('Creating NDJSON export', {
    userId,
    type: options.type,
    scope: options.scope,
  });

  const counts: QuilltapExportCounts = {};
  const ids = await resolveExportIds(userId, options);

  // Envelope with an empty counts object — footer carries the authoritative
  // counts once we've actually emitted every record.
  yield {
    kind: '__envelope__',
    format: 'qtap-ndjson',
    version: 1,
    manifest: buildManifest(options, {}),
  };

  const includeMemories = options.includeMemories ?? false;

  switch (options.type) {
    case 'characters':
      yield* streamCharacters(userId, ids, includeMemories, counts);
      break;
    case 'chats':
      yield* streamChats(userId, ids, includeMemories, counts);
      break;
    case 'roleplay-templates':
      yield* streamRoleplayTemplates(userId, ids, counts);
      break;
    case 'connection-profiles':
      yield* streamConnectionProfiles(userId, ids, counts);
      break;
    case 'image-profiles':
      yield* streamImageProfiles(userId, ids, counts);
      break;
    case 'embedding-profiles':
      yield* streamEmbeddingProfiles(userId, ids, counts);
      break;
    case 'tags':
      yield* streamTags(userId, ids, counts);
      break;
    case 'projects':
      yield* streamProjects(userId, ids, counts);
      break;
    case 'groups':
      yield* streamGroups(userId, ids, counts);
      break;
    case 'document-stores':
      yield* streamDocumentStores(userId, ids, counts);
      break;
    case 'files':
      yield* streamFiles(userId, ids, counts);
      break;
    case 'prompt-templates':
      yield* streamPromptTemplates(userId, ids, counts);
      break;
    case 'provider-models':
      yield* streamProviderModels(userId, ids, counts);
      break;
    case 'plugin-configs':
      yield* streamPluginConfigs(userId, ids, counts);
      break;
    case 'instance-settings':
      yield* streamInstanceSettings(userId, ids, counts);
      break;
    default:
      throw new Error(`Unknown export type: ${options.type}`);
  }

  yield { kind: '__footer__', counts };

  logger.info('NDJSON export stream complete', {
    userId,
    type: options.type,
    counts,
  });
}

/**
 * Wrap {@link streamExportRecords} in a Web `ReadableStream<Uint8Array>`
 * suitable for a `NextResponse` body. One newline-terminated JSON record per
 * enqueue — we never build a string larger than a single record.
 */
export function createNdjsonStream(
  userId: string,
  options: ExportOptions
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncGenerator<QtapRecord> | null = null;

  return new ReadableStream<Uint8Array>({
    async start() {
      iterator = streamExportRecords(userId, options);
    },
    async pull(controller) {
      if (!iterator) {
        controller.close();
        return;
      }
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      } catch (err) {
        logger.error(
          'NDJSON export stream failed',
          { userId, type: options.type },
          err instanceof Error ? err : undefined
        );
        controller.error(err);
      }
    },
    async cancel(reason) {
      logger.warn('NDJSON export stream cancelled', {
        userId,
        type: options.type,
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      if (iterator && typeof iterator.return === 'function') {
        try {
          await iterator.return(undefined);
        } catch {
          // best-effort cleanup
        }
      }
    },
  });
}

/**
 * Content-Type for streaming `.qtap` responses. Matches the de facto NDJSON
 * MIME type used by JSON-lines tooling.
 */
export const QTAP_NDJSON_CONTENT_TYPE = 'application/x-ndjson';
