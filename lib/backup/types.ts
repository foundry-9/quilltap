/**
 * Backup and Restore System Types
 *
 * Defines TypeScript interfaces and types for the backup/restore system,
 * supporting full user data exports and imports with version management.
 */

import type {
  Character,
  ChatMetadata,
  ChatSettings,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  Folder,
  MessageEvent,
  PromptTemplate,
  RoleplayTemplate,
  ProviderModel,
  Project,
  Group,
  LLMLog,
  PluginConfig,
  CharacterPluginData,
  ConversationAnnotation,
  ConversationChunk,
  VectorIndexMeta,
  VectorEntryRow,
  TfidfVocabulary,
  EmbeddingStatus,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types';
import type {
  DocMountPoint,
  DocMountFolder,
  DocMountFile,
  DocMountFileLink,
  DocMountChunk,
  DocMountDocument,
  DocMountBlobMetadata,
  ProjectDocMountLink,
  GroupDocMountLink,
  GroupCharacterMember,
} from '@/lib/schemas/mount-index.types';

/**
 * One instance_settings row, captured as a key/value pair. Backup serialisation
 * normalises the table contents into this shape — the underlying table has no
 * other columns worth preserving.
 */
export interface InstanceSettingRow {
  key: string;
  value: string;
}

/**
 * A vector entry whose Float32 embedding has been encoded as a plain number
 * array so it can survive JSON serialisation. The repository accepts number[]
 * on the way back in and rehydrates it as Float32Array.
 */
export interface SerializedVectorEntry {
  id: string;
  characterId: string;
  embedding: number[];
  createdAt: string;
}

/**
 * A conversation chunk whose embedding has been encoded as a plain number
 * array so it can survive JSON serialisation. Other fields match
 * ConversationChunk verbatim.
 */
export interface SerializedConversationChunk {
  id: string;
  chatId: string;
  interchangeIndex: number;
  content: string;
  participantNames: string[];
  messageIds: string[];
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A doc-mount chunk whose embedding has been encoded as a plain number array.
 * Mirrors DocMountChunk with the embedding field swapped to number[] | null.
 */
export interface SerializedDocMountChunk {
  id: string;
  linkId: string;
  mountPointId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  headingContext?: string | null;
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// BACKUP MANIFEST
// ============================================================================

/**
 * Metadata about a backup
 *
 * Contains version information, timestamps, and counts of all backed-up entities.
 * This manifest is included in every backup to support version-aware restoration
 * and to provide summary information for display to users.
 */
export interface BackupManifest {
  /** Backup format version (currently '1.0') */
  version: '1.0';

  /**
   * Backup format generation:
   * - 1 = legacy (files by category in `files/{CATEGORY}/...`)
   * - 2 = files keyed by storageKey
   * - 3 = adds doc-mount tables, chat_documents, instance_settings,
   *       conversation_chunks, vector indices, embedding_status, tfidf
   *       vocabularies, and `mount-blobs/` for binary doc-store assets
   * - 4 = adds groups and their join tables (group_character_members,
   *       group_doc_mount_links). Older restorers simply skip the new files.
   */
  backupFormat?: number;

  /** ISO 8601 timestamp of when the backup was created */
  createdAt: string;

  /** UUID of the user who created this backup */
  userId: string;

  /** Application version at the time of backup creation (e.g., '2.0.0') */
  appVersion: string;

  /**
   * Set when the backup was made in compact mode: memory embeddings are NULL
   * and the derived embedding collections (conversation chunks, vector
   * entries/metas, TF-IDF vocabularies, embedding status, doc-mount chunks)
   * were omitted entirely.
   *
   * Restore keys off this to queue a full re-index — the ordinary embedding
   * reconcile deliberately ignores absent chunk rows, so without the flag a
   * compact restore would come back with search quietly cold.
   */
  compact?: boolean;

  /** Counts of all backed-up entities for validation and progress tracking */
  counts: {
    /** Number of Character entities */
    characters: number;
    /** Number of Chat entities */
    chats: number;
    /** Total number of messages across all chats */
    messages: number;
    /** Number of Tag entities */
    tags: number;
    /** Number of ConnectionProfile entities (includes API keys) */
    connectionProfiles: number;
    /** Number of ImageProfile entities */
    imageProfiles: number;
    /** Number of EmbeddingProfile entities */
    embeddingProfiles: number;
    /** Number of Memory entities */
    memories: number;
    /** Number of FileEntry entities (file metadata, not the actual files) */
    files: number;
    /** Number of PromptTemplate entities (user-created only) */
    promptTemplates: number;
    /** Number of RoleplayTemplate entities (user-created only) */
    roleplayTemplates: number;
    /** Number of ProviderModel entities */
    providerModels: number;
    /** Number of Project entities */
    projects: number;
    /** Number of Group entities */
    groups?: number;
    /** Number of LLMLog entities */
    llmLogs: number;
    /** Number of PluginConfig entities (user plugin configurations) */
    pluginConfigs?: number;
    /** Number of ChatSettings entities (user chat/display settings) */
    chatSettings?: number;
    /** Number of Folder entities (user-created file folders) */
    folders?: number;
    /** Number of WardrobeItem entities (character wardrobe items) */
    wardrobeItems?: number;
    /** Number of npm-installed plugins backed up */
    npmPlugins?: number;
    /** Number of CharacterPluginData entities (per-character plugin metadata) */
    characterPluginData?: number;
    /** Number of ConversationAnnotation entities (per-chat message annotations) */
    conversationAnnotations?: number;
    /** Number of user-installed theme bundles backed up */
    userInstalledThemes?: number;
    /** Number of ChatDocument entities (Document Mode pane state) */
    chatDocuments?: number;
    /** Number of instance_settings key/value rows */
    instanceSettings?: number;
    /** Number of EmbeddingStatus entities */
    embeddingStatus?: number;
    /** Number of ConversationChunk entities (with embeddings) */
    conversationChunks?: number;
    /** Number of TfidfVocabulary entities */
    tfidfVocabularies?: number;
    /** Number of VectorIndexMeta entities (one per character with embeddings) */
    vectorIndexMetas?: number;
    /** Number of vector entries (per-memory Float32 embeddings) */
    vectorEntries?: number;
    /** Number of DocMountPoint entities (document stores) */
    docMountPoints?: number;
    /** Number of DocMountFolder entities */
    docMountFolders?: number;
    /** Number of DocMountFile entities */
    docMountFiles?: number;
    /** Number of DocMountFileLink entities */
    docMountFileLinks?: number;
    /** Number of DocMountChunk entities (with embeddings) */
    docMountChunks?: number;
    /** Number of DocMountDocument entities (database-backed text content) */
    docMountDocuments?: number;
    /** Number of DocMountBlobMetadata entities (with bytes staged on disk) */
    docMountBlobs?: number;
    /** Number of ProjectDocMountLink entities */
    projectDocMountLinks?: number;
    /** Number of GroupDocMountLink entities (group → additional doc stores) */
    groupDocMountLinks?: number;
    /** Number of GroupCharacterMember entities (group ↔ character membership) */
    groupCharacterMembers?: number;
    /** Number of TextReplacementRule entities (global find→replace rules) */
    textReplacementRules?: number;
  };
}

// ============================================================================
// BACKUP DATA
// ============================================================================

/**
 * Complete backup data structure
 *
 * Contains all user data in a structured format suitable for JSON serialization
 * and S3 storage. The manifest provides version information for restoration logic.
 * All arrays are present but may be empty if no entities of that type exist.
 */
export interface BackupData {
  /** Backup manifest with version and metadata */
  manifest: BackupManifest;

  /** Array of Character entities */
  characters: Character[];

  /** Array of Chat entities with all messages included */
  chats: ChatWithMessages[];

  /** Array of Tag entities */
  tags: Tag[];

  /** Array of ConnectionProfile entities */
  connectionProfiles: ConnectionProfile[];

  /** Array of ImageProfile entities */
  imageProfiles: ImageProfile[];

  /** Array of EmbeddingProfile entities */
  embeddingProfiles: EmbeddingProfile[];

  /** Array of Memory entities */
  memories: Memory[];

  /** Array of FileEntry entities (metadata only, not actual file contents) */
  files: FileEntry[];

  /** Array of user-created PromptTemplate entities (excludes built-in templates) */
  promptTemplates: PromptTemplate[];

  /** Array of user-created RoleplayTemplate entities (excludes built-in templates) */
  roleplayTemplates: RoleplayTemplate[];

  /** Array of ProviderModel entities */
  providerModels: ProviderModel[];

  /** Array of Project entities */
  projects: Project[];

  /**
   * Array of Group entities (hydrated from each group's official document
   * store, mirroring projects). The group's store *content* rides along in the
   * doc-mount tables; these slim rows + the join tables below carry the group
   * identity, membership, and additional-store links that would otherwise be
   * lost on restore.
   */
  groups?: Group[];

  /** Array of LLMLog entities */
  llmLogs: LLMLog[];

  /** Array of PluginConfig entities (user plugin configurations) */
  pluginConfigs?: PluginConfig[];

  /** Array of ChatSettings entities (user chat/display settings) */
  chatSettings?: ChatSettings[];

  /** Array of Folder entities (user-created file/project folders) */
  folders?: Folder[];

  /** Array of WardrobeItem entities (character wardrobe items) */
  wardrobeItems?: WardrobeItem[];

  /** Array of CharacterPluginData entities (per-character plugin metadata) */
  characterPluginData?: CharacterPluginData[];

  /** Array of ConversationAnnotation entities (per-chat message annotations) */
  conversationAnnotations?: ConversationAnnotation[];

  /** Array of ChatDocument entities (Document Mode pane state per chat) */
  chatDocuments?: ChatDocument[];

  /**
   * Array of instance_settings key/value pairs. Includes references to
   * mount-point UUIDs (Lantern / Quilltap Uploads / General) that drive
   * runtime routing decisions; must be remapped alongside doc_mount_points
   * in new-account mode.
   */
  instanceSettings?: InstanceSettingRow[];

  /**
   * Per-entity embedding sync flags. Regenerable but losing them forces a
   * full re-embed of every memory/file/etc., which is expensive on a fresh
   * restore.
   */
  embeddingStatus?: EmbeddingStatus[];

  /**
   * Semantically-chunked conversation segments with embeddings encoded as
   * number[] for JSON survival. Used by the Scriptorium renderer / context
   * compression. Regenerable, but storing them avoids re-embedding cost.
   */
  conversationChunks?: SerializedConversationChunk[];

  /** TF-IDF vocabularies for BUILTIN embedding profiles. */
  tfidfVocabularies?: TfidfVocabulary[];

  /** Per-character vector-index metadata (one row per indexed character). */
  vectorIndexMetas?: VectorIndexMeta[];

  /**
   * Per-memory vector embeddings (Float32Array serialised to number[]).
   * Skipping this would force every restored memory to be re-embedded.
   */
  vectorEntries?: SerializedVectorEntry[];

  /** Document store definitions (mount points). */
  docMountPoints?: DocMountPoint[];

  /** Folder hierarchy inside database-backed document stores. */
  docMountFolders?: DocMountFolder[];

  /** Content rows for files in document stores (content-addressed by sha256). */
  docMountFiles?: DocMountFile[];

  /** Hard links from a (mount, path) to a content row in doc_mount_files. */
  docMountFileLinks?: DocMountFileLink[];

  /** Embedded text chunks for document-store files (with embeddings). */
  docMountChunks?: SerializedDocMountChunk[];

  /** Database-backed document text content (matches doc_mount_documents). */
  docMountDocuments?: DocMountDocument[];

  /**
   * Metadata for binary blobs stored in the mount-index database. The actual
   * bytes are staged on disk in the backup under `mount-blobs/<blobId>` so
   * large images/PDFs don't get base64-bloated into JSON.
   */
  docMountBlobs?: DocMountBlobMetadata[];

  /** Project ↔ document store associations. */
  projectDocMountLinks?: ProjectDocMountLink[];

  /** Group ↔ additional document store associations (mount-index join table). */
  groupDocMountLinks?: GroupDocMountLink[];

  /** Group ↔ character membership (mount-index join table). */
  groupCharacterMembers?: GroupCharacterMember[];

  /**
   * Global find→replace rules (no userId). Ordinary user content, not a
   * secret. Backed up so a restore doesn't bring the feature back enabled
   * with zero rules — the master switch (chat_settings.textReplacementsEnabled)
   * is already backed up.
   */
  textReplacementRules?: TextReplacementRule[];
}

// ============================================================================
// CHAT WITH MESSAGES
// ============================================================================

/**
 * Chat metadata extended with message history
 *
 * This combines the ChatMetadata with an array of all MessageEvent objects
 * that belong to the chat. Used primarily during backup/restore operations.
 */
export interface ChatWithMessages extends ChatMetadata {
  /** Array of message events for this chat in chronological order */
  messages: MessageEvent[];
}

// ============================================================================
// RESTORE OPTIONS
// ============================================================================

/**
 * Configuration options for restore operations
 *
 * Specifies how the backup data should be imported into the system.
 * Different modes support different use cases (complete replacement vs. new account).
 */
export interface RestoreOptions {
  /**
   * Restore mode:
   * - 'replace': Clear existing user data and replace with backup (destructive)
   * - 'new-account': Create a new account and import backup data into it
   */
  mode: 'replace' | 'new-account';

  /** UUID of the target user for restoration */
  targetUserId: string;

  /**
   * Replace mode only: when true (the default), archived-character `.qtap`
   * bundles (`files` rows of category `ARCHIVE` and their on-disk bytes)
   * survive the pre-restore wipe as loose bundles — importable, not
   * rehydratable, since the tombstone character rows are replaced like any
   * others. Pass `false` to wipe them with everything else.
   */
  keepArchivedCharacterBundles?: boolean;
}

// ============================================================================
// RESTORE SUMMARY
// ============================================================================

/**
 * Summary of a completed restore operation
 *
 * Provides detailed information about what was restored, including counts
 * of each entity type and any warnings that occurred during the process.
 * Used to inform the user about the restore result.
 */
export interface RestoreSummary {
  /** Number of Character entities restored */
  characters: number;

  /** Number of Chat entities restored */
  chats: number;

  /** Total number of messages restored across all chats */
  messages: number;

  /** Number of Tag entities restored */
  tags: number;

  /** Number of FileEntry entities restored (metadata only) */
  files: number;

  /** Number of Memory entities restored */
  memories: number;

  /** Counts for different types of profiles */
  profiles: {
    /** Number of ConnectionProfile entities restored */
    connection: number;
    /** Number of ImageProfile entities restored */
    image: number;
    /** Number of EmbeddingProfile entities restored */
    embedding: number;
  };

  /** Counts for template types */
  templates: {
    /** Number of PromptTemplate entities restored */
    prompt: number;
    /** Number of RoleplayTemplate entities restored */
    roleplay: number;
  };

  /** Number of ProviderModel entities restored */
  providerModels: number;

  /** Number of Project entities restored */
  projects: number;

  /** Number of Group entities restored */
  groups?: number;

  /** Number of LLMLog entities restored */
  llmLogs: number;

  /** Number of PluginConfig entities restored */
  pluginConfigs?: number;

  /** Number of ChatSettings entities restored */
  chatSettings?: number;

  /** Number of Folder entities restored */
  folders?: number;

  /** Number of WardrobeItem entities restored */
  wardrobeItems?: number;

  /** Number of npm plugins restored */
  npmPlugins?: number;

  /** Number of CharacterPluginData entities restored */
  characterPluginData?: number;

  /** Number of ConversationAnnotation entities restored */
  conversationAnnotations?: number;

  /** Number of user-installed theme bundles restored */
  userInstalledThemes?: number;

  /** Number of ChatDocument entities restored */
  chatDocuments?: number;

  /** Number of instance_settings rows restored */
  instanceSettings?: number;

  /** Number of EmbeddingStatus entities restored */
  embeddingStatus?: number;

  /** Number of ConversationChunk entities restored */
  conversationChunks?: number;

  /** Number of TfidfVocabulary entities restored */
  tfidfVocabularies?: number;

  /** Number of VectorIndexMeta entities restored */
  vectorIndexMetas?: number;

  /** Number of vector entries restored */
  vectorEntries?: number;

  /** Number of DocMountPoint entities restored */
  docMountPoints?: number;

  /** Number of DocMountFolder entities restored */
  docMountFolders?: number;

  /** Number of DocMountFile entities restored */
  docMountFiles?: number;

  /** Number of DocMountFileLink entities restored */
  docMountFileLinks?: number;

  /** Number of DocMountChunk entities restored */
  docMountChunks?: number;

  /** Number of DocMountDocument entities restored */
  docMountDocuments?: number;

  /** Number of DocMountBlobMetadata entities restored (with their bytes) */
  docMountBlobs?: number;

  /** Number of ProjectDocMountLink entities restored */
  projectDocMountLinks?: number;

  /** Number of GroupDocMountLink entities restored */
  groupDocMountLinks?: number;

  /** Number of GroupCharacterMember entities restored */
  groupCharacterMembers?: number;

  /** Number of TextReplacementRule entities restored */
  textReplacementRules?: number;

  /**
   * Outcome of the post-restore embedding reconcile. A restore can land a
   * corpus whose vectors were produced by a different embedding standard than
   * the receiving instance's default profile (new-account mode, or a machine
   * configured differently), which nothing else would notice until the next
   * boot. `skippedReason` explains a no-op pass; `reindexEnqueued` says
   * whether a repair job was scheduled.
   */
  embeddingReconcile?: {
    targetDimensions: number | null;
    skippedReason: string | null;
    vectorEntriesDeleted: number;
    vectorIndexMetaFixed: number;
    reindexEnqueued: boolean;
  };

  /**
   * Array of warning messages for issues that occurred during restore
   * (e.g., skipped duplicate tags, missing referenced profiles)
   * Warnings do not prevent successful restoration
   */
  warnings: string[];
}

// ============================================================================
// BACKUP INFO
// ============================================================================

/**
 * Information about a backup stored in S3
 *
 * Used when listing available backups for display in the UI.
 * Provides essential metadata without downloading the full backup file.
 */
export interface BackupInfo {
  /** S3 object key (full path) for this backup file */
  key: string;

  /** User-friendly filename (e.g., 'backup-2025-12-07-14-30-00.json') */
  filename: string;

  /** Date when the backup was created */
  createdAt: Date;

  /** File size in bytes */
  size: number;
}
