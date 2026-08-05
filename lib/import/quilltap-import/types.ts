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

export interface ImportOptions extends ExportImportOptions {
  /** Which entity IDs to import (empty = import all) */
  selectedIds?: Record<string, string[]>;
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
