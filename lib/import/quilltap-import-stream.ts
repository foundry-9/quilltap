/**
 * NDJSON → QuilltapExport reassembler.
 *
 * Phase 2 of the streaming-import work: we read records off an NDJSON stream
 * one line at a time (no V8 string-limit crash) and hand back a
 * fully-assembled `QuilltapExport` for the existing `previewImport` /
 * `executeImport` service to consume. Heap usage is still O(export size) —
 * phase 3 will refactor the service to consume the stream directly and
 * drop that requirement — but the critical JSON.stringify / JSON.parse
 * ceilings no longer fire.
 *
 * Blob chunk reassembly: records arrive as `doc_mount_blob` followed by
 * `chunkCount` ordered `doc_mount_blob_chunk` records keyed by the same
 * (mountPointId, sha256). We concatenate the base64 slices back into the
 * legacy `dataBase64` string so the existing import service sees the same
 * shape it's always seen.
 */

import { logger as baseLogger } from '@/lib/logger';
import type {
  QuilltapExport,
  QuilltapExportManifest,
  QuilltapExportCounts,
  QtapRecord,
  ExportedCharacter,
  ExportedChat,
  ExportedDocumentStore,
  ExportedDocumentStoreDocument,
  ExportedDocumentStoreBlob,
  ExportedProjectDocMountLink,
  ExportedProject,
  ExportedGroup,
  ExportedRoleplayTemplate,
  ExportedFolder,
  ExportedFileWithBytes,
  ExportedPluginConfig,
  ExportedInstanceSetting,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
} from '@/lib/export/types';
import type {
  Tag,
  Memory,
  MessageEvent,
  ConversationAnnotation,
  PromptTemplate,
  ProviderModel,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';

const logger = baseLogger.child({ module: 'import:quilltap-import-stream' });

/**
 * Reassembles one blob's base64 chunk records in index order.
 *
 * Arrivals are counted rather than checked with `every`: the slots are a
 * pre-sized sparse array, and `every` skips holes, so it would answer true the
 * moment the first chunk landed however many were still outstanding — which
 * truncated any blob over `BLOB_CHUNK_BYTES` and left the follow-on chunks
 * with no accumulator to join.
 */
class ChunkAccumulator {
  private readonly received: string[];
  private count = 0;

  /**
   * @param chunkCount how many chunks the parent record promised
   * @param kind the chunk record kind, for error messages
   * @param identity `sha256=…` / `fileId=…`, for error messages
   */
  constructor(
    readonly chunkCount: number,
    private readonly kind: 'doc_mount_blob_chunk' | 'file_blob_chunk',
    private readonly identity: string
  ) {
    this.received = new Array(chunkCount);
  }

  /** Chunks received so far. */
  get receivedCount(): number {
    return this.count;
  }

  /**
   * Record one chunk. Returns true when this was the last outstanding one.
   * Throws on an index outside `chunkCount` or a second arrival at one index.
   */
  add(index: number, dataBase64: string): boolean {
    if (index < 0 || index >= this.chunkCount) {
      throw new Error(
        `${this.kind} index ${index} out of range (chunkCount=${this.chunkCount}, ${this.identity})`
      );
    }
    if (this.received[index] !== undefined) {
      throw new Error(`Duplicate ${this.kind} at index ${index} for ${this.identity}`);
    }
    this.received[index] = dataBase64;
    this.count++;
    return this.count === this.chunkCount;
  }

  /** The reassembled base64 payload; only meaningful once `add` returned true. */
  join(): string {
    return this.received.join('');
  }
}

interface BlobAccumulator {
  meta: Omit<ExportedDocumentStoreBlob, 'dataBase64'>;
  chunks: ChunkAccumulator;
}

/**
 * Consume an async iterator of NDJSON records (as parsed by the reader) and
 * reassemble a legacy-shape `QuilltapExport`. Throws on missing envelope,
 * unknown record kinds (logged as warnings and skipped), or inconsistent
 * blob chunk sequences.
 */
export async function assembleExportFromStream(
  records: AsyncIterable<unknown>
): Promise<QuilltapExport> {
  let manifest: QuilltapExportManifest | null = null;
  let footerCounts: QuilltapExportCounts | null = null;

  const tags: Tag[] = [];
  const connectionProfiles: SanitizedConnectionProfile[] = [];
  const imageProfiles: SanitizedImageProfile[] = [];
  const embeddingProfiles: SanitizedEmbeddingProfile[] = [];
  const roleplayTemplates: ExportedRoleplayTemplate[] = [];
  const projects: ExportedProject[] = [];
  const groups: ExportedGroup[] = [];
  const memories: Memory[] = [];

  const charactersById = new Map<string, ExportedCharacter>();
  const characterOrder: string[] = [];
  const chatsById = new Map<string, ExportedChat>();
  const chatOrder: string[] = [];

  const mountPoints: ExportedDocumentStore[] = [];
  const folders: any[] = [];
  const documents: ExportedDocumentStoreDocument[] = [];
  const blobs: ExportedDocumentStoreBlob[] = [];
  const projectLinks: ExportedProjectDocMountLink[] = [];

  const conversationAnnotations: ConversationAnnotation[] = [];
  const chatDocuments: ChatDocument[] = [];

  const folderRecords: ExportedFolder[] = [];
  const filesById = new Map<string, ExportedFileWithBytes>();
  const fileOrder: string[] = [];
  const promptTemplates: PromptTemplate[] = [];
  const providerModels: ProviderModel[] = [];
  const pluginConfigs: ExportedPluginConfig[] = [];
  const instanceSettings: ExportedInstanceSetting[] = [];

  /** Same chunk-reassembly contract as the doc-store blobs, keyed by fileId. */
  const fileBlobAccumulators = new Map<string, ChunkAccumulator>();

  const blobAccumulators = new Map<string, BlobAccumulator>();
  const blobKey = (mountPointId: string, sha256: string) =>
    `${mountPointId}:${sha256}`;

  let unknownKindCount = 0;

  for await (const raw of records) {
    if (!raw || typeof raw !== 'object') {
      logger.warn('Skipping non-object NDJSON record');
      continue;
    }
    const record = raw as QtapRecord & { kind?: string };
    const kind = record.kind;

    switch (kind) {
      case '__envelope__': {
        if (manifest) {
          logger.warn('Second envelope line ignored — only the first is used');
          break;
        }
        const env = record as QtapRecord & { kind: '__envelope__' };
        if (env.format !== 'qtap-ndjson') {
          throw new Error(
            `Unexpected envelope format: ${String(env.format)} (expected 'qtap-ndjson')`
          );
        }
        if (env.version !== 1) {
          throw new Error(
            `Unsupported NDJSON version: ${String(env.version)} (expected 1)`
          );
        }
        manifest = env.manifest;
        break;
      }

      case '__footer__': {
        const footer = record as QtapRecord & { kind: '__footer__' };
        footerCounts = footer.counts;
        break;
      }

      case 'tag':
        tags.push((record as { data: Tag }).data);
        break;

      case 'connection_profile':
        connectionProfiles.push((record as { data: SanitizedConnectionProfile }).data);
        break;

      case 'image_profile':
        imageProfiles.push((record as { data: SanitizedImageProfile }).data);
        break;

      case 'embedding_profile':
        embeddingProfiles.push((record as { data: SanitizedEmbeddingProfile }).data);
        break;

      case 'roleplay_template':
        roleplayTemplates.push((record as { data: ExportedRoleplayTemplate }).data);
        break;

      case 'project':
        projects.push((record as { data: ExportedProject }).data);
        break;

      case 'group':
        groups.push((record as { data: ExportedGroup }).data);
        break;

      case 'character': {
        const charRec = record as QtapRecord & { kind: 'character' };
        const exported: ExportedCharacter = { ...charRec.data };
        charactersById.set(exported.id, exported);
        characterOrder.push(exported.id);
        break;
      }

      case 'wardrobe_item': {
        const wi = record as QtapRecord & { kind: 'wardrobe_item' };
        const parent = charactersById.get(wi.characterId);
        if (!parent) {
          logger.warn('wardrobe_item record with unknown parent character — skipping', {
            characterId: wi.characterId,
          });
          break;
        }
        if (!parent.wardrobeItems) parent.wardrobeItems = [];
        parent.wardrobeItems.push(wi.data as WardrobeItem);
        break;
      }

      case 'character_plugin_data': {
        const pd = record as QtapRecord & { kind: 'character_plugin_data' };
        const parent = charactersById.get(pd.characterId);
        if (!parent) {
          logger.warn('character_plugin_data with unknown parent character — skipping', {
            characterId: pd.characterId,
          });
          break;
        }
        if (!parent.pluginData) parent.pluginData = {};
        parent.pluginData[pd.pluginName] = pd.data;
        break;
      }

      case 'chat': {
        const chatRec = record as QtapRecord & { kind: 'chat' };
        const exported: ExportedChat = { ...chatRec.data, messages: [] };
        chatsById.set(exported.id, exported);
        chatOrder.push(exported.id);
        break;
      }

      case 'chat_message': {
        const msg = record as QtapRecord & { kind: 'chat_message' };
        const parent = chatsById.get(msg.chatId);
        if (!parent) {
          logger.warn('chat_message with unknown parent chat — skipping', {
            chatId: msg.chatId,
          });
          break;
        }
        parent.messages.push(msg.data as MessageEvent);
        break;
      }

      case 'memory': {
        // Embeddings never cross an instance boundary. Current exports don't
        // emit the field at all, but archives written before that change carry
        // it, and a foreign vector landing in a corpus governed by a different
        // embedding standard corrupts semantic search silently whenever the
        // dimensionality happens to match. Drop it here; `importMemories`
        // drops it again for the legacy monolithic path, which never passes
        // through this reassembler.
        const { embedding: _embedding, ...memoryData } = (record as { data: Memory }).data;
        memories.push(memoryData);
        break;
      }

      case 'conversation_annotation':
        conversationAnnotations.push(
          (record as { data: ConversationAnnotation }).data
        );
        break;

      case 'chat_document':
        chatDocuments.push((record as { data: ChatDocument }).data);
        break;

      case 'doc_mount_point':
        mountPoints.push((record as { data: ExportedDocumentStore }).data);
        break;

      case 'doc_mount_folder':
        folders.push((record as { data: any }).data);
        break;

      case 'doc_mount_document':
        documents.push((record as { data: ExportedDocumentStoreDocument }).data);
        break;

      case 'doc_mount_blob': {
        const blobRec = record as QtapRecord & { kind: 'doc_mount_blob' };
        const key = blobKey(blobRec.data.mountPointId, blobRec.data.sha256);
        blobAccumulators.set(key, {
          meta: {
            mountPointId: blobRec.data.mountPointId,
            relativePath: blobRec.data.relativePath,
            originalFileName: blobRec.data.originalFileName,
            originalMimeType: blobRec.data.originalMimeType,
            storedMimeType: blobRec.data.storedMimeType,
            sizeBytes: blobRec.data.sizeBytes,
            sha256: blobRec.data.sha256,
            description: blobRec.data.description,
            descriptionUpdatedAt: blobRec.data.descriptionUpdatedAt ?? null,
            fileId: blobRec.data.fileId ?? null,
            linkId: blobRec.data.linkId ?? null,
            blobId: blobRec.data.blobId ?? null,
            extractedText: blobRec.data.extractedText ?? null,
            extractedTextSha256: blobRec.data.extractedTextSha256 ?? null,
            extractionStatus: blobRec.data.extractionStatus ?? 'none',
            extractionError: blobRec.data.extractionError ?? null,
          },
          chunks: new ChunkAccumulator(
            blobRec.data.chunkCount,
            'doc_mount_blob_chunk',
            `sha256=${blobRec.data.sha256}`
          ),
        });
        break;
      }

      case 'doc_mount_blob_chunk': {
        const chunk = record as QtapRecord & { kind: 'doc_mount_blob_chunk' };
        const key = blobKey(chunk.mountPointId, chunk.sha256);
        const accum = blobAccumulators.get(key);
        if (!accum) {
          throw new Error(
            `doc_mount_blob_chunk received without preceding doc_mount_blob (sha256=${chunk.sha256})`
          );
        }
        // If this was the last chunk, finalize the blob.
        if (accum.chunks.add(chunk.index, chunk.dataBase64)) {
          blobs.push({
            ...accum.meta,
            dataBase64: accum.chunks.join(),
          });
          blobAccumulators.delete(key);
        }
        break;
      }

      case 'project_doc_mount_link':
        projectLinks.push((record as { data: ExportedProjectDocMountLink }).data);
        break;

      case 'folder':
        folderRecords.push((record as { data: ExportedFolder }).data);
        break;

      case 'file': {
        const fileRec = record as QtapRecord & { kind: 'file' };
        filesById.set(fileRec.data.id, { ...fileRec.data });
        fileOrder.push(fileRec.data.id);
        break;
      }

      case 'file_blob': {
        const blobRec = record as QtapRecord & { kind: 'file_blob' };
        fileBlobAccumulators.set(
          blobRec.fileId,
          new ChunkAccumulator(blobRec.chunkCount, 'file_blob_chunk', `fileId=${blobRec.fileId}`)
        );
        break;
      }

      case 'file_blob_chunk': {
        const chunk = record as QtapRecord & { kind: 'file_blob_chunk' };
        const accum = fileBlobAccumulators.get(chunk.fileId);
        if (!accum) {
          throw new Error(
            `file_blob_chunk received without preceding file_blob (fileId=${chunk.fileId})`
          );
        }
        if (accum.add(chunk.index, chunk.dataBase64)) {
          const target = filesById.get(chunk.fileId);
          if (target) target.dataBase64 = accum.join();
          fileBlobAccumulators.delete(chunk.fileId);
        }
        break;
      }

      case 'prompt_template':
        promptTemplates.push((record as { data: PromptTemplate }).data);
        break;

      case 'provider_model':
        providerModels.push((record as { data: ProviderModel }).data);
        break;

      case 'plugin_config':
        pluginConfigs.push((record as { data: ExportedPluginConfig }).data);
        break;

      case 'instance_setting':
        instanceSettings.push((record as { data: ExportedInstanceSetting }).data);
        break;

      default:
        unknownKindCount++;
        logger.warn('Unknown NDJSON record kind — skipping', { kind: String(kind) });
        break;
    }
  }

  if (!manifest) {
    throw new Error('NDJSON export missing envelope — first line must be a __envelope__ record');
  }

  // Any blob that never received all its chunks is an error.
  if (blobAccumulators.size > 0) {
    const pending = Array.from(blobAccumulators.values()).map((a) => ({
      sha256: a.meta.sha256,
      received: a.chunks.receivedCount,
      expected: a.chunks.chunkCount,
    }));
    throw new Error(
      `NDJSON export truncated: ${blobAccumulators.size} blob(s) missing chunks — ${JSON.stringify(pending)}`
    );
  }

  if (fileBlobAccumulators.size > 0) {
    const pending = Array.from(fileBlobAccumulators.entries()).map(([fileId, a]) => ({
      fileId,
      received: a.receivedCount,
      expected: a.chunkCount,
    }));
    throw new Error(
      `NDJSON export truncated: ${fileBlobAccumulators.size} file(s) missing byte chunks — ${JSON.stringify(pending)}`
    );
  }

  if (unknownKindCount > 0) {
    logger.info('Some NDJSON records were skipped due to unknown kind', {
      count: unknownKindCount,
    });
  }

  // Stitch wardrobe/plugin data back into the export shape the existing
  // import service expects.
  const characters: ExportedCharacter[] = characterOrder.map((id) => {
    const c = charactersById.get(id)!;
    return {
      ...c,
      ...(c.wardrobeItems && c.wardrobeItems.length > 0 && { wardrobeItems: c.wardrobeItems }),
      ...(c.pluginData && Object.keys(c.pluginData).length > 0 && { pluginData: c.pluginData }),
    };
  });

  const chats: ExportedChat[] = chatOrder.map((id) => chatsById.get(id)!);

  // If the footer carried counts, trust them over what we emitted on the
  // envelope — the writer leaves envelope counts empty on purpose.
  const counts = footerCounts ?? manifest.counts ?? {};

  const data = buildExportDataForType(manifest.exportType, {
    tags,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    roleplayTemplates,
    projects,
    groups,
    characters,
    chats,
    memories,
    mountPoints,
    folders,
    documents,
    blobs,
    projectLinks,
    conversationAnnotations,
    chatDocuments,
    fileFolders: folderRecords,
    files: fileOrder.map((id) => filesById.get(id)!),
    promptTemplates,
    providerModels,
    pluginConfigs,
    instanceSettings,
  });

  return {
    manifest: { ...manifest, counts },
    data,
  };
}

/**
 * Collected arrays from the stream, indexed by the legacy
 * `QuilltapExportData` variant field names. Only the subset matching
 * `exportType` is placed into the final `data` object so the shape matches
 * what the existing import service asserts on.
 */
interface CollectedArrays {
  tags: Tag[];
  connectionProfiles: SanitizedConnectionProfile[];
  imageProfiles: SanitizedImageProfile[];
  embeddingProfiles: SanitizedEmbeddingProfile[];
  roleplayTemplates: ExportedRoleplayTemplate[];
  projects: ExportedProject[];
  groups: ExportedGroup[];
  characters: ExportedCharacter[];
  chats: ExportedChat[];
  memories: Memory[];
  mountPoints: ExportedDocumentStore[];
  folders: any[];
  documents: ExportedDocumentStoreDocument[];
  blobs: ExportedDocumentStoreBlob[];
  projectLinks: ExportedProjectDocMountLink[];
  conversationAnnotations: ConversationAnnotation[];
  chatDocuments: ChatDocument[];
  /**
   * General file-library folders. Named `fileFolders` rather than `folders`
   * because `folders` is already taken by the document-store folder rows.
   */
  fileFolders: ExportedFolder[];
  files: ExportedFileWithBytes[];
  promptTemplates: PromptTemplate[];
  providerModels: ProviderModel[];
  pluginConfigs: ExportedPluginConfig[];
  instanceSettings: ExportedInstanceSetting[];
}

function buildExportDataForType(
  exportType: QuilltapExportManifest['exportType'],
  c: CollectedArrays
): QuilltapExport['data'] {
  switch (exportType) {
    case 'characters':
      return {
        characters: c.characters,
        ...(c.memories.length > 0 && { memories: c.memories }),
        ...(c.mountPoints.length > 0 && { mountPoints: c.mountPoints }),
        ...(c.folders.length > 0 && { folders: c.folders }),
        ...(c.documents.length > 0 && { documents: c.documents }),
        ...(c.blobs.length > 0 && { blobs: c.blobs }),
        ...(c.projectLinks.length > 0 && { projectLinks: c.projectLinks }),
      };
    case 'chats':
      return {
        chats: c.chats,
        ...(c.memories.length > 0 && { memories: c.memories }),
        ...(c.conversationAnnotations.length > 0 && { conversationAnnotations: c.conversationAnnotations }),
        ...(c.chatDocuments.length > 0 && { chatDocuments: c.chatDocuments }),
      };
    case 'roleplay-templates':
      return { roleplayTemplates: c.roleplayTemplates };
    case 'connection-profiles':
      return { connectionProfiles: c.connectionProfiles };
    case 'image-profiles':
      return { imageProfiles: c.imageProfiles };
    case 'embedding-profiles':
      return { embeddingProfiles: c.embeddingProfiles };
    case 'tags':
      return { tags: c.tags };
    case 'projects':
      return { projects: c.projects };
    case 'groups':
      return { groups: c.groups };
    case 'document-stores':
      return {
        mountPoints: c.mountPoints,
        folders: c.folders,
        documents: c.documents,
        blobs: c.blobs,
        projectLinks: c.projectLinks,
      };
    case 'files':
      // `folders` is the same field name the document-store branch uses; the
      // two never coexist because a .qtap carries exactly one export type,
      // and each importer is gated on its own primary array (`files` vs
      // `mountPoints`).
      return { files: c.files, folders: c.fileFolders };
    case 'prompt-templates':
      return { promptTemplates: c.promptTemplates };
    case 'provider-models':
      return { providerModels: c.providerModels };
    case 'plugin-configs':
      return { pluginConfigs: c.pluginConfigs };
    case 'instance-settings':
      return { instanceSettings: c.instanceSettings };
    default:
      throw new Error(`Unknown export type in manifest: ${String(exportType)}`);
  }
}
