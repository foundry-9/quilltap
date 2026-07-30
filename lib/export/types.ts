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
export type ExportEntityType =
  | 'characters'
  | 'chats'
  | 'roleplay-templates'
  | 'connection-profiles'
  | 'image-profiles'
  | 'embedding-profiles'
  | 'tags'
  | 'projects'
  | 'groups'
  | 'document-stores';

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
  | DocumentStoresExportData;

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

export interface QtapMemoryRecord {
  kind: 'memory';
  data: import('@/lib/schemas/types').Memory;
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
  | QtapProjectDocMountLinkRecord;

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
