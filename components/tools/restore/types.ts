import type { RestoreSummary } from '@/lib/backup/types'

export type RestoreStep = 'source' | 'preview' | 'mode' | 'progress'
export type RestoreMode = 'replace' | 'import'

export interface RestoreDialogProps {
  isOpen: boolean
  onClose: () => void
  onRestoreComplete: () => void
}

export interface RestorePreview {
  characters: number
  personas: number
  chats: number
  messages: number
  tags: number
  files: number
  memories: number
}

export interface RestoreState {
  step: RestoreStep
  selectedFile: File | null
  preview: RestorePreview | null
  loadingPreview: boolean
  restoreMode: RestoreMode
  confirmReplace: boolean
  /** Replace mode: spare archived-character bundles from the pre-restore wipe. */
  keepArchiveBundles: boolean
  restoring: boolean
  restoreSummary: RestoreSummary | null
  error: string | null
  uploadId: string | null
  uploadProgress: number
  uploading: boolean
}

