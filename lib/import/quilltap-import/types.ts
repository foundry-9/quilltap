/**
 * Shared types for the Quilltap import pipeline: the loosened "any export
 * shape" accessor, the public preview/options/result interfaces, and the
 * internal id-mapping and per-entity count structures threaded through the
 * entity importers.
 *
 * @module import/quilltap-import/types
 */

import type { Tag, Memory } from '@/lib/schemas/types';
import type {
  QuilltapExportManifest,
  QuilltapExport,
  QuilltapExportCounts,
  ImportOptions as ExportImportOptions,
  ExportedCharacter,
  ExportedChat,
  ExportedRoleplayTemplate,
  ExportedProject,
  ExportedGroup,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
  ExportedDocumentStore,
  ExportedDocumentStoreDocument,
  ExportedDocumentStoreBlob,
  ExportedProjectDocMountLink,
  ExportedFileWithBytes,
  ExportedPluginConfig,
  ExportedInstanceSetting,
} from '@/lib/export/types';

/**
 * Combined export data type for easier access
 * Allows accessing any possible property from the union
 */
export interface AnyExportData {
  characters?: ExportedCharacter[];
  chats?: ExportedChat[];
  tags?: Tag[];
  connectionProfiles?: SanitizedConnectionProfile[];
  imageProfiles?: SanitizedImageProfile[];
  embeddingProfiles?: SanitizedEmbeddingProfile[];
  roleplayTemplates?: ExportedRoleplayTemplate[];
  projects?: ExportedProject[];
  groups?: ExportedGroup[];
  memories?: Memory[];
  // Document store export payload (Scriptorium)
  mountPoints?: ExportedDocumentStore[];
  /**
   * Folder rows. Shared between two export types on purpose: a
   * `document-stores` archive puts `ExportedDocumentStoreFolder` here, a
   * `files` archive puts `ExportedFolder`. A `.qtap` carries exactly one
   * export type, and each importer is gated on its own primary array
   * (`mountPoints` vs `files`), so the two never meet.
   */
  folders?: any[];
  documents?: ExportedDocumentStoreDocument[];
  blobs?: ExportedDocumentStoreBlob[];
  projectLinks?: ExportedProjectDocMountLink[];
  // Chat sidecars (per-chat annotations + Document Mode pane state)
  conversationAnnotations?: import('@/lib/schemas/types').ConversationAnnotation[];
  chatDocuments?: import('@/lib/schemas/chat-document.types').ChatDocument[];
  // General file library (files + folders; folders share the field above)
  files?: ExportedFileWithBytes[];
  // Configuration / catalogue export types
  promptTemplates?: import('@/lib/schemas/types').PromptTemplate[];
  providerModels?: import('@/lib/schemas/types').ProviderModel[];
  pluginConfigs?: ExportedPluginConfig[];
  instanceSettings?: ExportedInstanceSetting[];
}

/**
 * Helper to get export data as the combined type for easier access
 */
export function getExportData(exportData: QuilltapExport): AnyExportData {
  return exportData.data as AnyExportData;
}

export interface ImportPreviewEntity {
  id: string;
  name: string;
  exists: boolean;
  /** When a cross-instance name match is found, this holds the existing entity's ID */
  matchedExistingId?: string;
  /**
   * Short human-readable note shown beside the entity — used to warn that a
   * plugin config arrived with its secret keys redacted and they must be
   * re-entered by hand.
   */
  detail?: string;
}

export interface ImportPreview {
  manifest: QuilltapExportManifest;
  entities: {
    characters?: ImportPreviewEntity[];
    chats?: ImportPreviewEntity[];
    roleplayTemplates?: ImportPreviewEntity[];
    connectionProfiles?: ImportPreviewEntity[];
    imageProfiles?: ImportPreviewEntity[];
    embeddingProfiles?: ImportPreviewEntity[];
    tags?: ImportPreviewEntity[];
    projects?: ImportPreviewEntity[];
    groups?: ImportPreviewEntity[];
    documentStores?: ImportPreviewEntity[];
    files?: ImportPreviewEntity[];
    promptTemplates?: ImportPreviewEntity[];
    providerModels?: ImportPreviewEntity[];
    pluginConfigs?: ImportPreviewEntity[];
    instanceSettings?: ImportPreviewEntity[];
    memories?: { count: number };
  };
  conflictCounts: Record<string, number>;
}

/**
 * How a `preserveIds` import treats a claimed id that already exists.
 *
 * - `refuse-on-collision` (the default, WP B1): any collision refuses the
 *   whole import before a single write — no partial application, no silent
 *   remint. Right for importing a stranger's bundle into supposedly-empty
 *   space.
 * - `skip-if-present` (spec §6 / F4, **rehydrate only**): rehydration
 *   restores a bundle into a mount that still exists, so it collides by
 *   construction on the mount point, every surviving folder, the managed
 *   documents, the avatar blob and its link. An id already present inside
 *   the *target character's own vault* (or the target character itself, or
 *   its own memories) is skipped — the surviving row wins and the record is
 *   not imported. An id that exists anywhere else — a different mount, a
 *   different character, another character's memory — still refuses the
 *   whole import, atomically, exactly as `refuse-on-collision` would.
 *
 * The ordinary import wizard must never pass `skip-if-present`: silently
 * skipping a colliding id there is precisely the partial application the
 * refuse rule exists to prevent.
 */
export type PreserveIdsMode =
  | { mode: 'refuse-on-collision' }
  | {
      mode: 'skip-if-present';
      /** The archived character being rehydrated. */
      targetCharacterId: string;
      /** Its surviving vault mount point (null when it never had one). */
      targetVaultMountPointId: string | null;
    };

export interface ImportOptions extends ExportImportOptions {
  /** Which entity IDs to import (empty = import all) */
  selectedIds?: Record<string, string[]>;
  /** Whether to preserve source IDs and fail on collisions */
  preserveIds?: boolean;
  /**
   * Collision handling for `preserveIds` imports. Defaults to
   * `refuse-on-collision`; only the rehydrate path passes `skip-if-present`.
   * Ignored when `preserveIds` is not set.
   */
  preserveIdsMode?: PreserveIdsMode;
}

export interface ImportResult {
  success: boolean;
  imported: QuilltapExportCounts;
  skipped: QuilltapExportCounts;
  warnings: string[];
  /**
   * Destination character IDs touched by the import (the values of the
   * character id-map). For the `duplicate` conflict strategy these are the
   * newly created characters; consumers such as the Salon "Summon from Lore"
   * flow read this to find the character that was just brought into being.
   */
  importedCharacterIds: string[];
}

export interface IdMappingState {
  tags: Map<string, string>;
  characters: Map<string, string>;
  chats: Map<string, string>;
  connectionProfiles: Map<string, string>;
  imageProfiles: Map<string, string>;
  embeddingProfiles: Map<string, string>;
  roleplayTemplates: Map<string, string>;
  projects: Map<string, string>;
  groups: Map<string, string>;
  mountPoints: Map<string, string>;
  docMountFileLinks: Map<string, string>;
  /**
   * New character id → the vault mount-point id the bundle claimed in the
   * *source* instance. Populated only for characters the importer actually
   * created, because `characters.create()` drops the incoming pointer and
   * provisions a scaffold vault of its own — so the character row can no
   * longer tell reconciliation which store the bundle meant. Reconciliation
   * uses it to repoint the character at its imported vault and cascade-delete
   * the scaffold (bundle wins, whole-store).
   */
  characterVaultMounts: Map<string, string>;
  /**
   * Source vault mount-point ids belonging to characters the importer
   * *skipped*. Their store records are dropped before the document-store
   * phase: importing them would strand an orphan store no character points at.
   */
  skippedCharacterVaults: Set<string>;
  /**
   * Ids the `skip-if-present` preflight sanctioned as already-present inside
   * the rehydrate target (see {@link PreserveIdsMode}). Importers skip these
   * records — the surviving row wins — instead of re-creating them. Always
   * empty under `refuse-on-collision`, where the preflight guarantees no
   * claimed id exists at all.
   */
  preserveIdsSkips: Set<string>;
}

export interface ImportCounts {
  imported: number;
  skipped: number;
  messages?: number;
}

export interface DocumentStoreImportCounts {
  mountPoints: number;
  folders: number;
  documents: number;
  blobs: number;
  projectLinks: number;
}
