/**
 * Document Stores Page Types
 *
 * Shared types for the document stores list and detail page components.
 */

export interface DocumentStore {
  id: string
  name: string
  basePath: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType: 'documents' | 'character'
  includePatterns: string[]
  excludePatterns: string[]
  enabled: boolean
  lastScannedAt: string | null
  scanStatus: 'idle' | 'scanning' | 'error'
  lastScanError: string | null
  conversionStatus: 'idle' | 'converting' | 'deconverting' | 'error'
  conversionError: string | null
  fileCount: number
  chunkCount: number
  totalSizeBytes: number
  embeddedChunkCount: number
  createdAt: string
  updatedAt: string
}

export interface ConvertResult {
  mountPointId: string
  filesMigrated: number
  documentsWritten: number
  blobsWritten: number
  filesSkipped: number
  errors: Array<{ relativePath: string; error: string }>
}

export interface DeconvertResult {
  mountPointId: string
  filesWritten: number
  blobsWritten: number
  bytesWritten: number
  errors: Array<{ relativePath: string; error: string }>
}

export interface DocumentStoreFile {
  id: string
  mountPointId: string
  relativePath: string
  fileName: string
  fileType: 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl' | 'blob'
  sha256: string
  fileSizeBytes: number
  lastModified: string
  conversionStatus: 'pending' | 'converted' | 'failed' | 'skipped'
  conversionError: string | null
  plainTextLength: number | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface ScanResult {
  filesScanned: number
  filesNew: number
  filesModified: number
  filesDeleted: number
  chunksCreated: number
  errors: Array<{ file: string; error: string }>
}

export interface UseDocumentStoresReturn {
  stores: DocumentStore[]
  loading: boolean
  error: string | null
  /** `silent` refreshes in place without flipping `loading` (tab re-activation). */
  fetchStores: (opts?: { silent?: boolean }) => Promise<void>
  createStore: (data: CreateDocumentStoreData) => Promise<DocumentStore | null>
  updateStore: (id: string, data: UpdateDocumentStoreData) => Promise<DocumentStore | null>
  deleteStore: (id: string) => Promise<boolean>
  scanStore: (id: string) => Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null>
  convertStore: (id: string) => Promise<ConvertResult | null>
  deconvertStore: (id: string, targetPath: string) => Promise<DeconvertResult | null>
}

export interface CreateDocumentStoreData {
  name: string
  /** Absolute path for filesystem/obsidian mounts; empty string for database. */
  basePath: string
  mountType?: 'filesystem' | 'obsidian' | 'database'
  storeType?: 'documents' | 'character'
  includePatterns?: string[]
  excludePatterns?: string[]
  enabled?: boolean
}

export interface UpdateDocumentStoreData {
  name?: string
  basePath?: string
  mountType?: 'filesystem' | 'obsidian' | 'database'
  storeType?: 'documents' | 'character'
  includePatterns?: string[]
  excludePatterns?: string[]
  enabled?: boolean
}

export interface DocumentStoreBlob {
  id: string
  mountPointId: string
  relativePath: string
  originalFileName: string
  originalMimeType: string
  storedMimeType: string
  sizeBytes: number
  sha256: string
  description: string
  descriptionUpdatedAt: string | null
  extractedText: string | null
  extractedTextSha256: string | null
  extractionStatus: 'none' | 'pending' | 'converted' | 'failed' | 'skipped'
  extractionError: string | null
  createdAt: string
  updatedAt: string
}
