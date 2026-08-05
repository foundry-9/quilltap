/**
 * Export/Import System Types
 *
 * Defines TypeScript interfaces and types for the Quilltap export/import system,
 * supporting selective entity exports with optional memory inclusion.
 */

import type {
  Character,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  MessageEvent,
  RoleplayTemplate,
  Project,
  Group,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

// ============================================================================
// EXPORT ENTITY TYPES
// ============================================================================

/**
 * Types of entities that can be exported
 * Each export contains a single entity type (no mixed exports)
 */
/**
 * Adding a member here is a cross-cutting change, not a one-liner. Every one
 * of these layers must gain a matching case or the records are written and
 * then silently evaporate on the way back in:
 *
 *   - `QuilltapExportCounts` key + `Qtap*Record` interface + `QtapRecord` union (this file)
 *   - `lib/export/ndjson-writer.ts`: `stream*` generator, `resolveExportIds`, `streamExportRecords`
 *   - `lib/export/quilltap-export-service.ts`: `previewExport` (its `default` throws)
 *   - `lib/import/quilltap-import-stream.ts`: record `switch`, `CollectedArrays`,
 *     `buildExportDataForType` (its `default` throws)
 *   - `lib/import/quilltap-import/types.ts`: `AnyExportData` field
 *   - `lib/import/quilltap-import/`: importer module, wired into `execute.ts`
 *   - `components/tools/import-export/types.ts`: `ENTITY_TYPE_LABELS`
 *   - `components/tools/import-export/steps/ExportTypeStep.tsx`: `EXPORTABLE_TYPES`
 *   - `app/api/v1/system/tools/route.ts`: `handleExportEntities`
 *   - `public/schemas/qtap-export.schema.json` + `qtap-export-ndjson.schema.json`
 *
 * Format compatibility: the NDJSON envelope stays `version: 1`. An older build
 * warns-and-skips record kinds it doesn't know, but *throws* on an unknown
 * `manifest.exportType` (`buildExportDataForType`), so it cannot consume an
 * archive of a newly-added type. That's deliberate — the thrown message names
 * the type plainly — but it means new types are forward-only.
 */
export type ExportEntityType =
  | 'characters'
  | 'chats'
  | 'roleplay-templates'
  | 'prompt-templates'
  | 'connection-profiles'
  | 'image-profiles'
  | 'embedding-profiles'
  | 'tags'
  | 'projects'
  | 'groups'
  | 'document-stores'
  | 'files'
  | 'provider-models'
  | 'plugin-configs'
  | 'instance-settings';

// ============================================================================
// EXPORT MANIFEST
// ============================================================================

/**
 * Settings for an export operation
 */
export interface QuilltapExportSettings {
  /** Whether to include memories associated with exported entities */
  includeMemories: boolean;
  /** Scope of export: 'all' for all entities of type, 'selected' for specific IDs */
  scope: 'all' | 'selected';
  /** List of entity IDs to export (only used when scope is 'selected') */
  selectedIds: string[];
}

/**
 * Entity counts included in the export
 */
export interface QuilltapExportCounts {
  characters?: number;
  chats?: number;
  messages?: number;
  roleplayTemplates?: number;
  connectionProfiles?: number;
  imageProfiles?: number;
  embeddingProfiles?: number;
  tags?: number;
  memories?: number;
  projects?: number;
  groups?: number;
  documentStores?: number;
  documentStoreFolders?: number;
  documentStoreDocuments?: number;
  documentStoreBlobs?: number;
  documentStoreProjectLinks?: number;
  conversationAnnotations?: number;
  chatDocuments?: number;
  files?: number;
  folders?: number;
  promptTemplates?: number;
  providerModels?: number;
  pluginConfigs?: number;
  instanceSettings?: number;
}

/**
 * Metadata about an export
 *
 * Included in every export to support version-aware imports and provide
 * summary information for display to users.
 */
export interface QuilltapExportManifest {
  /** Export format identifier */
  format: 'quilltap-export';
  /** Format version (currently '1.0') */
  version: '1.0';
  /** Type of entity being exported */
  exportType: ExportEntityType;
  /** ISO 8601 timestamp of when the export was created */
  createdAt: string;
  /** Application version at export time */
  appVersion: string;
  /** Export configuration settings */
  settings: QuilltapExportSettings;
  /** Counts of exported entities for validation and progress tracking */
  counts: QuilltapExportCounts;
}

// ============================================================================
// EXPORTED ENTITY TYPES WITH METADATA
// ============================================================================

/**
 * Character with resolved relationships
 */
export interface ExportedCharacter extends Character {
  _linkedPersonaNames?: string[];
  _tagNames?: string[];
  /** Wardrobe items belonging to this character, exported alongside the character */
  wardrobeItems?: WardrobeItem[];
  /** Per-plugin metadata for this character, keyed by plugin name */
  pluginData?: Record<string, unknown>;
}

/**
 * Chat with messages and resolved participant information
 */
export interface ExportedChat extends ChatMetadata {
  messages: MessageEvent[];
  _participantInfo?: Array<{
    participantId: string;
    characterName?: string;
    type: 'CHARACTER';
  }>;
  _tagNames?: string[];
}

/**
 * Roleplay template (user-created only, excludes built-in)
 */
export interface ExportedRoleplayTemplate extends RoleplayTemplate {
  _tagNames?: string[];
}

/**
 * Connection profile with sanitized API key reference
 * Actual API key is never exported for security
 */
export interface SanitizedConnectionProfile extends Omit<ConnectionProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

/**
 * Image profile with sanitized API key reference
 */
export interface SanitizedImageProfile extends Omit<ImageProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

/**
 * Embedding profile with sanitized API key reference
 */
export interface SanitizedEmbeddingProfile extends Omit<EmbeddingProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

// ============================================================================
// EXPORT DATA STRUCTURE
// ============================================================================

/**
 * Character export data
 */
export interface CharactersExportData {
  characters: ExportedCharacter[];
  memories?: Memory[];
}

/**
 * Chat export data
 */
export interface ChatsExportData {
  chats: ExportedChat[];
  memories?: Memory[];
  /**
   * Conversation annotations attached to any exported chat. Optional —
   * older .qtap files predate this field and importers should default to [].
   */
  conversationAnnotations?: import('@/lib/schemas/types').ConversationAnnotation[];
  /**
   * Document Mode pane state attached to any exported chat. Optional for the
   * same back-compat reason as conversationAnnotations.
   */
  chatDocuments?: import('@/lib/schemas/chat-document.types').ChatDocument[];
}

/**
 * Roleplay template export data
 */
export interface RoleplayTemplatesExportData {
  roleplayTemplates: ExportedRoleplayTemplate[];
}

/**
 * Connection profile export data
 */
export interface ConnectionProfilesExportData {
  connectionProfiles: SanitizedConnectionProfile[];
}

/**
 * Image profile export data
 */
export interface ImageProfilesExportData {
  imageProfiles: SanitizedImageProfile[];
}

/**
 * Embedding profile export data
 */
export interface EmbeddingProfilesExportData {
  embeddingProfiles: SanitizedEmbeddingProfile[];
}

/**
 * Tags export data
 */
export interface TagsExportData {
  tags: Tag[];
}

/**
 * Project with resolved relationships
 */
export interface ExportedProject extends Project {
  _characterRosterNames?: string[];
  _chatCount?: number;
  _fileCount?: number;
}

/**
 * Projects export data
 */
export interface ProjectsExportData {
  projects: ExportedProject[];
}

/**
 * Group with resolved relationships
 */
export interface ExportedGroup extends Group {
  _memberNames?: string[];
  _memberCharacterIds?: string[];
  _linkedStoreMountPointIds?: string[];
}

/**
 * Groups export data
 */
export interface GroupsExportData {
  groups: ExportedGroup[];
}

/**
 * Document store / Scriptorium export data
 *
 * Portable representation of a set of document stores. For database-backed
 * mount points the full content lives in `documents` (text) and `blobs`
 * (base64-encoded bytes). For filesystem/obsidian mounts only the
 * configuration round-trips — users keep the external files themselves.
 *
 * `basePath` is included as a courtesy but is instance-specific; importers
 * should prompt the user to rebind it or drop the mount if the path cannot
 * be located on the target machine.
 */
export interface ExportedDocumentStore {
  id: string;
  name: string;
  basePath: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
  storeType?: 'documents' | 'character';
  includePatterns: string[];
  excludePatterns: string[];
  enabled: boolean;
}

export interface ExportedDocumentStoreFolder {
  mountPointId: string;
  parentId?: string | null;
  name: string;
  path: string;
}

export interface ExportedDocumentStoreDocument {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  fileType: 'markdown' | 'txt' | 'json' | 'jsonl';
  content: string;
  contentSha256: string;
  plainTextLength: number;
  lastModified: string;
  folderId?: string | null;
  /**
   * Deliberate hard-link group (see doc_mount_file_links.linkGroupId). Carried
   * through so a file linked into two stores comes back linked rather than as
   * two documents that silently drift apart on the next edit. Omitted for the
   * ordinary un-linked case; a group whose other members fall outside the
   * export's scope imports as an inert group of one.
   */
  linkGroupId?: string | null;
}

export interface ExportedDocumentStoreBlob {
  mountPointId: string;
  relativePath: string;
  originalFileName: string;
  originalMimeType: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
  description: string;
  descriptionUpdatedAt?: string | null;
  /** Plain-text representation for pdf/docx uploads. Omitted for blobs with no converter. */
  extractedText?: string | null;
  extractedTextSha256?: string | null;
  extractionStatus?: 'none' | 'pending' | 'converted' | 'failed' | 'skipped';
  extractionError?: string | null;
  /** Raw bytes, base64-encoded for JSON safety. */
  dataBase64: string;
}

export interface ExportedProjectDocMountLink {
  projectId: string;
  mountPointId: string;
}

export interface DocumentStoresExportData {
  mountPoints: ExportedDocumentStore[];
  folders?: ExportedDocumentStoreFolder[];
  documents: ExportedDocumentStoreDocument[];
  blobs: ExportedDocumentStoreBlob[];
  /**
   * Project ↔ mount-point associations. Optional for backward
   * compatibility with older .qtap files that predated this field.
   */
  projectLinks?: ExportedProjectDocMountLink[];
}

// ============================================================================
// FILE LIBRARY (general files + folders)
// ============================================================================

/**
 * A general-library folder, portable form.
 *
 * `id` rides along so child folders and files can be matched to their parent
 * within the same archive; the importer re-mints IDs and resolves parents by
 * path, exactly as the document-store importer does.
 */
export interface ExportedFolder {
  id: string;
  path: string;
  name: string;
  parentFolderId?: string | null;
  projectId?: string | null;
}

/**
 * A general-library file's metadata.
 *
 * `userId` is dropped (the receiving instance owns the row) and so is
 * `storageKey`: it is instance-specific — commonly
 * `mount-blob:<mountPointId>:<blobId>`, pointing into *this* instance's
 * mount-index database — and transferring it verbatim would produce a row
 * whose bytes live nowhere. It travels as `_sourceStorageKey` provenance
 * only, and the importer discards it in favour of the key its own upload
 * bridge returns.
 */
export interface ExportedFile
  extends Omit<import('@/lib/schemas/file.types').FileEntry, 'userId' | 'storageKey'> {
  /** Where the bytes lived on the exporting instance. Provenance only. */
  _sourceStorageKey?: string | null;
  /** Set when the bytes could not be read at export time; metadata still travels. */
  _bytesMissing?: boolean;
}

/** File metadata plus its bytes, as reassembled from the chunked stream. */
export interface ExportedFileWithBytes extends ExportedFile {
  /** Raw bytes, base64-encoded. Absent when `_bytesMissing` is set. */
  dataBase64?: string;
}

export interface FilesExportData {
  files: ExportedFileWithBytes[];
  /** Optional for the same back-compat reason as the doc-store folders field. */
  folders?: ExportedFolder[];
}

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

/**
 * User-created prompt templates. Built-ins are seeded from `prompts/` on every
 * instance and never travel — mirroring the roleplay-template rule.
 */
export interface PromptTemplatesExportData {
  promptTemplates: import('@/lib/schemas/types').PromptTemplate[];
}

// ============================================================================
// PROVIDER MODELS
// ============================================================================

/**
 * The provider model catalogue.
 *
 * This table is a **regenerable cache**: it is populated by live refetch from
 * each provider (`/api/v1/models`), and a refetch supersedes anything an
 * import wrote. Exportable purely as a convenience for offline / air-gapped
 * instances that cannot reach the providers to build it themselves.
 */
export interface ProviderModelsExportData {
  providerModels: import('@/lib/schemas/types').ProviderModel[];
}

// ============================================================================
// PLUGIN CONFIGS
// ============================================================================

/**
 * A plugin's per-user configuration, with secrets removed.
 *
 * `PluginConfig.config` is an untyped bag and plugin manifests may declare
 * `password`-typed fields, which are stored in plaintext. A local backup may
 * carry those; a portable `.qtap` must not. The exporter resolves the
 * plugin's manifest and drops every `password`-typed key, listing what it
 * removed in `_redactedKeys` so the receiving user knows what to re-enter.
 * When the manifest can't be resolved the whole `config` is dropped and
 * `_redactedKeys` is `['*']` — we never guess which keys are safe.
 *
 * Same philosophy as connection profiles, where `apiKeyId` is stripped and
 * replaced by an `_apiKeyLabel` breadcrumb.
 */
export interface ExportedPluginConfig
  extends Omit<import('@/lib/schemas/plugin-config.types').PluginConfig, 'userId'> {
  /** Config keys withheld from the export. `['*']` means the whole bag. */
  _redactedKeys?: string[];
}

export interface PluginConfigsExportData {
  pluginConfigs: ExportedPluginConfig[];
}

// ============================================================================
// INSTANCE SETTINGS
// ============================================================================

/** One row of the `instance_settings` key/value table. */
export interface ExportedInstanceSetting {
  key: string;
  value: string;
}

/**
 * The "move my setup" export: configuration rather than content. Keys that are
 * meaningful only inside the exporting instance (mount-point pointers, timing
 * state, the version guard) are excluded at the writer — see
 * `NON_PORTABLE_INSTANCE_SETTING_KEYS` in `lib/instance-settings`.
 */
export interface InstanceSettingsExportData {
  instanceSettings: ExportedInstanceSetting[];
}

/**
 * Union of all possible export data structures
 */
export type QuilltapExportData =
  | CharactersExportData
  | ChatsExportData
  | RoleplayTemplatesExportData
  | ConnectionProfilesExportData
  | ImageProfilesExportData
  | EmbeddingProfilesExportData
  | TagsExportData
  | ProjectsExportData
  | GroupsExportData
  | DocumentStoresExportData
  | FilesExportData
  | PromptTemplatesExportData
  | ProviderModelsExportData
  | PluginConfigsExportData
  | InstanceSettingsExportData;

/**
 * Complete export structure with manifest and data
 *
 * This is the full structure that gets serialized to JSON and packaged
 * in the .qtap export file.
 */
export interface QuilltapExport {
  manifest: QuilltapExportManifest;
  data: QuilltapExportData;
}

// ============================================================================
// NDJSON STREAMING FORMAT (qtap-ndjson v1)
// ============================================================================

/**
 * NDJSON envelope — always the first line of a streaming .qtap file.
 *
 * Detection rule: a .qtap file whose first parseable JSON value is an object
 * with `format === 'qtap-ndjson'` is streaming NDJSON. Anything else is
 * legacy monolithic JSON and goes through the old parser.
 */
export interface QtapNdjsonEnvelope {
  kind: '__envelope__';
  format: 'qtap-ndjson';
  version: 1;
  manifest: QuilltapExportManifest;
}

/**
 * NDJSON footer — optional final line carrying actual record counts so an
 * importer can verify the stream wasn't truncated. `manifest.counts` on the
 * envelope are best-effort and may be omitted for streaming; the footer is
 * authoritative.
 */
export interface QtapNdjsonFooter {
  kind: '__footer__';
  counts: QuilltapExportCounts;
}

// One tagged record per line. `data` carries the entity payload; parent refs
// use the exporting instance's (old) IDs and are remapped at import time.

export interface QtapTagRecord {
  kind: 'tag';
  data: import('@/lib/schemas/types').Tag;
}

export interface QtapConnectionProfileRecord {
  kind: 'connection_profile';
  data: SanitizedConnectionProfile;
}

export interface QtapImageProfileRecord {
  kind: 'image_profile';
  data: SanitizedImageProfile;
}

export interface QtapEmbeddingProfileRecord {
  kind: 'embedding_profile';
  data: SanitizedEmbeddingProfile;
}

export interface QtapRoleplayTemplateRecord {
  kind: 'roleplay_template';
  data: ExportedRoleplayTemplate;
}

export interface QtapProjectRecord {
  kind: 'project';
  data: ExportedProject;
}

export interface QtapGroupRecord {
  kind: 'group';
  data: ExportedGroup;
}

/**
 * Character record carries the character row and resolved tag/persona names
 * but NOT wardrobeItems or pluginData — those stream as separate records so
 * large wardrobes don't blow up a single line.
 */
export interface QtapCharacterRecord {
  kind: 'character';
  data: Omit<ExportedCharacter, 'wardrobeItems' | 'pluginData'>;
}

export interface QtapWardrobeItemRecord {
  kind: 'wardrobe_item';
  characterId: string;
  data: import('@/lib/schemas/wardrobe.types').WardrobeItem;
}

export interface QtapCharacterPluginDataRecord {
  kind: 'character_plugin_data';
  characterId: string;
  pluginName: string;
  data: unknown;
}

/**
 * Chat record carries metadata + resolved participant info but NOT the
 * messages — those stream as separate `chat_message` records so a chat with
 * tens of thousands of messages doesn't hit the per-line ceiling.
 */
export interface QtapChatRecord {
  kind: 'chat';
  data: Omit<ExportedChat, 'messages'>;
}

export interface QtapChatMessageRecord {
  kind: 'chat_message';
  chatId: string;
  data: import('@/lib/schemas/types').MessageEvent;
}

/**
 * Memory record — deliberately `Omit<Memory, 'embedding'>`.
 *
 * Embeddings are instance-local caches, not portable data: they are enormous
 * (a serialized Float32Array is ~29.6 KB per memory) and they are only valid
 * against the model that produced them, so importing a foreign vector
 * silently corrupts semantic search whenever the dimensionality matches. The
 * importer re-embeds every memory it inserts. Re-introducing the field here
 * is a type error on purpose.
 */
export interface QtapMemoryRecord {
  kind: 'memory';
  data: Omit<import('@/lib/schemas/types').Memory, 'embedding'>;
}

/**
 * Conversation annotation streamed alongside its parent chat. Emitted after
 * every `chat_message` so importers can resolve `sourceMessageId` against
 * remapped message IDs.
 */
export interface QtapConversationAnnotationRecord {
  kind: 'conversation_annotation';
  chatId: string;
  data: import('@/lib/schemas/types').ConversationAnnotation;
}

/**
 * Chat document (Document Mode pane state) streamed alongside its parent
 * chat. Captures which doc-store / project document was open in the split
 * panel so split-pane state survives a round-trip.
 */
export interface QtapChatDocumentRecord {
  kind: 'chat_document';
  chatId: string;
  data: import('@/lib/schemas/chat-document.types').ChatDocument;
}

export interface QtapDocMountPointRecord {
  kind: 'doc_mount_point';
  data: ExportedDocumentStore;
}

export interface QtapDocMountFolderRecord {
  kind: 'doc_mount_folder';
  data: any;
}

export interface QtapDocMountDocumentRecord {
  kind: 'doc_mount_document';
  data: ExportedDocumentStoreDocument;
}

/**
 * Blob metadata record, emitted once per blob *before* any data chunks.
 * Carries the blob's identity and size so the importer can allocate /
 * validate; the actual bytes arrive in one or more `doc_mount_blob_chunk`
 * records keyed by the same (mountPointId, sha256) tuple.
 */
export interface QtapDocMountBlobRecord {
  kind: 'doc_mount_blob';
  data: Omit<ExportedDocumentStoreBlob, 'dataBase64'> & {
    /** Total number of `doc_mount_blob_chunk` records that follow. */
    chunkCount: number;
  };
}

/**
 * Blob byte chunk. Emitted in order right after its parent `doc_mount_blob`.
 * Base64-encoded bytes are capped around 4 MB per chunk so we stay well below
 * the per-line safety cap and V8 string limits on both sides.
 */
export interface QtapDocMountBlobChunkRecord {
  kind: 'doc_mount_blob_chunk';
  /** Parent blob identity (matches the preceding doc_mount_blob record). */
  mountPointId: string;
  sha256: string;
  /** 0-based chunk index. */
  index: number;
  /** Total chunks for this blob (mirrors the parent's chunkCount). */
  total: number;
  /** Base64-encoded slice of the blob bytes for this chunk. */
  dataBase64: string;
}

export interface QtapProjectDocMountLinkRecord {
  kind: 'project_doc_mount_link';
  data: ExportedProjectDocMountLink;
}

/** General-library folder. Emitted before any `file` record. */
export interface QtapFolderRecord {
  kind: 'folder';
  data: ExportedFolder;
}

/** General-library file metadata. Its bytes follow as `file_blob*` records. */
export interface QtapFileRecord {
  kind: 'file';
  data: ExportedFile;
}

/**
 * File byte header, emitted once per file *before* its chunks — the exact
 * shape of the `doc_mount_blob` / `doc_mount_blob_chunk` pair, keyed by
 * `fileId` instead of (mountPointId, sha256). Omitted entirely when the bytes
 * couldn't be read (the `file` record then carries `_bytesMissing`).
 */
export interface QtapFileBlobRecord {
  kind: 'file_blob';
  fileId: string;
  sha256: string;
  sizeBytes: number;
  /** Total number of `file_blob_chunk` records that follow. */
  chunkCount: number;
}

/**
 * File byte chunk, in order, right after its parent `file_blob`. Raw slices
 * are a multiple of 3 bytes so the base64 pieces concatenate cleanly — see
 * `BLOB_CHUNK_BYTES` in the writer.
 */
export interface QtapFileBlobChunkRecord {
  kind: 'file_blob_chunk';
  fileId: string;
  /** 0-based chunk index. */
  index: number;
  /** Total chunks for this file (mirrors the parent's chunkCount). */
  total: number;
  dataBase64: string;
}

export interface QtapPromptTemplateRecord {
  kind: 'prompt_template';
  data: import('@/lib/schemas/types').PromptTemplate;
}

export interface QtapProviderModelRecord {
  kind: 'provider_model';
  data: import('@/lib/schemas/types').ProviderModel;
}

export interface QtapPluginConfigRecord {
  kind: 'plugin_config';
  data: ExportedPluginConfig;
}

export interface QtapInstanceSettingRecord {
  kind: 'instance_setting';
  data: ExportedInstanceSetting;
}

/**
 * Discriminated union of every line that can appear in a streaming .qtap
 * file. Consumers switch on `kind` to dispatch.
 */
export type QtapRecord =
  | QtapNdjsonEnvelope
  | QtapNdjsonFooter
  | QtapTagRecord
  | QtapConnectionProfileRecord
  | QtapImageProfileRecord
  | QtapEmbeddingProfileRecord
  | QtapRoleplayTemplateRecord
  | QtapProjectRecord
  | QtapGroupRecord
  | QtapCharacterRecord
  | QtapWardrobeItemRecord
  | QtapCharacterPluginDataRecord
  | QtapChatRecord
  | QtapChatMessageRecord
  | QtapConversationAnnotationRecord
  | QtapChatDocumentRecord
  | QtapMemoryRecord
  | QtapDocMountPointRecord
  | QtapDocMountFolderRecord
  | QtapDocMountDocumentRecord
  | QtapDocMountBlobRecord
  | QtapDocMountBlobChunkRecord
  | QtapProjectDocMountLinkRecord
  | QtapFolderRecord
  | QtapFileRecord
  | QtapFileBlobRecord
  | QtapFileBlobChunkRecord
  | QtapPromptTemplateRecord
  | QtapProviderModelRecord
  | QtapPluginConfigRecord
  | QtapInstanceSettingRecord;

// ============================================================================
// EXPORT API TYPES
// ============================================================================

/**
 * Options for creating an export
 */
export interface ExportOptions {
  /** Type of entity to export */
  type: ExportEntityType;
  /** Scope of export */
  scope: 'all' | 'selected';
  /** Entity IDs to export (required if scope is 'selected') */
  selectedIds?: string[];
  /** Whether to include related memories */
  includeMemories?: boolean;
}

/**
 * Preview information for an export operation
 * Used by the UI to show what will be exported before creation
 */
export interface ExportPreview {
  /** Type of entities to be exported */
  type: ExportEntityType;
  /** List of entities with basic info */
  entities: Array<{
    id: string;
    name: string;
  }>;
  /** Number of memories that will be included (if applicable) */
  memoryCount?: number;
}

// ============================================================================
// IMPORT TYPES
// ============================================================================

/**
 * Conflict resolution strategy when importing
 */
export type ConflictStrategy = 'skip' | 'overwrite' | 'duplicate';

/**
 * Options for importing an export
 */
export interface ImportOptions {
  /** How to handle conflicting entities */
  conflictStrategy: ConflictStrategy;
  /** Whether to import memories */
  includeMemories: boolean;
  /** Whether to import related entities (profiles, templates, etc.) */
  includeRelatedEntities: boolean;
}

/**
 * Preview of an import operation
 * Shows what will be imported before confirmation
 */
export interface ImportPreview {
  /** Type of entities in the export */
  type: ExportEntityType;
  /** Number of primary entities to import */
  entityCount: number;
  /** Number of memories to import (if applicable) */
  memoryCount?: number;
  /** Number of related entities to import */
  relatedEntityCount?: number;
  /** Entities that would conflict with existing data */
  conflicts: Array<{
    id: string;
    name: string;
    existingId: string;
    existingName: string;
  }>;
}

/**
 * Result of an import operation
 */
export interface ImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** Number of entities imported */
  importedCount: number;
  /** Number of memories imported */
  memoriesImported: number;
  /** Number of related entities imported */
  relatedEntitiesImported: number;
  /** Mapping of old IDs to new IDs (for ID remapping) */
  idMapping: Record<string, string>;
  /** Any warnings that occurred during import */
  warnings: string[];
  /** Error message if import failed */
  error?: string;
}

// ============================================================================
// EXPORT UTILITY TYPES
// ============================================================================
