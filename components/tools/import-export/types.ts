import type {
  ExportEntityType,
  QuilltapExport,
  ConflictStrategy,
} from '@/lib/export/types'

// Extended import preview for UI (more detailed than lib version)
export interface ImportPreviewUI {
  manifest: {
    format: string
    version: string
    exportType: ExportEntityType
    createdAt: string
    appVersion: string
  }
  entities: Record<
    string,
    Array<{
      id: string
      name?: string
      title?: string
      exists: boolean
    }>
  >
}

// Extended import result for UI
export interface ImportResultUI {
  success: boolean
  imported: Record<string, number>
  skipped: Record<string, number>
  warnings: string[]
}

// Export dialog steps
export type ExportStep = 'type' | 'select' | 'options' | 'exporting' | 'complete' | 'error'

// Import dialog steps
export type ImportStep = 'file' | 'preview' | 'options' | 'importing' | 'complete' | 'error'

// Entity type labels for UI
export const ENTITY_TYPE_LABELS: Record<ExportEntityType, string> = {
  characters: 'Characters',
  chats: 'Chats',
  'roleplay-templates': 'Roleplay Templates',
  'prompt-templates': 'Prompt Templates',
  'connection-profiles': 'Connection Profiles',
  'image-profiles': 'Image Profiles',
  'embedding-profiles': 'Embedding Profiles',
  tags: 'Tags',
  projects: 'Projects',
  groups: 'Groups',
  'document-stores': 'Document Stores',
  files: 'Files & Folders',
  'provider-models': 'Provider Models',
  'plugin-configs': 'Plugin Settings',
  'instance-settings': 'Instance Settings',
}

// Available entity with optional memory count
export interface AvailableEntity {
  id: string
  name: string
  memoryCount?: number
}

// Export state
export interface ExportState {
  step: ExportStep
  entityType: ExportEntityType | null
  scope: 'all' | 'selected'
  selectedIds: string[]
  availableEntities: AvailableEntity[]
  loadingEntities: boolean
  includeMemories: boolean
  memoryCount: number
  exporting: boolean
  error: string | null
}

// Import state
export interface ImportState {
  step: ImportStep
  selectedFile: File | null
  exportData: QuilltapExport | null
  preview: ImportPreviewUI | null
  loadingPreview: boolean
  conflictStrategy: ConflictStrategy
  importMemories: boolean
  selectedEntityIds: Record<string, string[]>
  importing: boolean
  importResult: ImportResultUI | null
  error: string | null
}
