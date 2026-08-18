'use client'

/**
 * FileBrowser Component
 *
 * File explorer UI for browsing files within a project or general files.
 *
 * Dual-mode:
 * - Legacy mode: reads/writes via /api/v1/files and /api/v1/projects/{id}/files.
 *   Used for the general-files page and any project that doesn't have a linked
 *   database-backed Scriptorium document store.
 * - Mount mode: reads/writes directly against /api/v1/mount-points/{id}/files
 *   and /api/v1/mount-points/{id}/blobs. Selected automatically when the
 *   project has a linked database-backed documents store, or when the caller
 *   supplies a `mountPoint` prop with `mountType: 'database'`.
 *
 * Supports grid and list view modes with sorting.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import FileBrowserGrid from './FileBrowserGrid'
import FileBrowserList from './FileBrowserList'
import { FilePreviewModal } from './FilePreview'
import { CreateFolderModal } from './FolderManagement'
import MoveToProjectModal from './MoveToProjectModal'
import FileDeleteConfirmation from './FileDeleteConfirmation'
import OrphanCleanupModal from './OrphanCleanupModal'
import { useProjectFileUpload } from './useProjectFileUpload'
import { useMountPointBlobUpload } from './useMountPointBlobUpload'
import { buildMountBlobUrl, buildMountFileItemUrl } from './mountBlobUrl'
import { FileInfo, FolderInfo, SortState, sortFiles } from './types'
import { pickPrimaryProjectStore } from '@/lib/mount-index/project-store-naming'

// Re-export FileInfo for backwards compatibility
export type { FileInfo }

type DocumentStoreFileType = 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl' | 'blob'

interface DocumentStoreFileRow {
  id: string
  mountPointId: string
  relativePath: string
  fileName: string
  fileType: DocumentStoreFileType
  fileSizeBytes: number
  lastModified: string
  createdAt: string
  updatedAt: string
}

export interface FileBrowserMountPoint {
  id: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType?: 'documents' | 'character'
  name?: string
}

interface FileBrowserProps {
  /** Project ID to browse (null for general files) */
  projectId: string | null
  /**
   * Optional pre-resolved mount point. When provided and mountType is
   * 'database', the browser reads/writes through the mount-point APIs
   * instead of the legacy files table. If omitted and a projectId is
   * supplied, the component will try to resolve a linked mount point
   * itself by calling /api/v1/projects/{id}/mount-points.
   */
  mountPoint?: FileBrowserMountPoint | null
  /** Optional title override */
  title?: string
  /** Called when a file is clicked */
  onFileClick?: (file: FileInfo) => void
  /** Whether to show upload functionality */
  showUpload?: boolean
  /** Called when files are added/removed (for parent refresh) */
  onFilesChange?: () => void
  /** Optional class name */
  className?: string
}

/** Database folder type from API (legacy mode only) */
interface DbFolder {
  id: string
  path: string
  name: string
  parentFolderId: string | null
  projectId: string | null
}

function deriveMimeTypeFromName(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  switch (ext) {
    case 'webp': return 'image/webp'
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'svg': return 'image/svg+xml'
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    case 'avif': return 'image/avif'
    case 'tiff':
    case 'tif': return 'image/tiff'
    case 'mp4': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'ogg': return 'audio/ogg'
    case 'txt': return 'text/plain'
    case 'md':
    case 'markdown': return 'text/markdown'
    case 'html':
    case 'htm': return 'text/html'
    case 'json': return 'application/json'
    case 'jsonl':
    case 'ndjson': return 'application/jsonl'
    case 'csv': return 'text/csv'
    case 'zip': return 'application/zip'
    default: return 'application/octet-stream'
  }
}

function mimeTypeForDocumentStoreFile(row: DocumentStoreFileRow): string {
  switch (row.fileType) {
    case 'pdf': return 'application/pdf'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'markdown': return 'text/markdown'
    case 'txt': return 'text/plain'
    case 'json': return 'application/json'
    case 'jsonl': return 'application/jsonl'
    case 'blob': return deriveMimeTypeFromName(row.fileName)
  }
}

/**
 * Translate a mount-point relativePath (e.g. "images/foo.webp") into the
 * legacy folderPath convention used by FileBrowserGrid/List (e.g. "/images/").
 */
function folderPathFromRelativePath(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf('/')
  if (lastSlash < 0) return '/'
  return `/${relativePath.slice(0, lastSlash)}/`
}

function documentStoreFileToFileInfo(row: DocumentStoreFileRow): FileInfo {
  const mimeType = mimeTypeForDocumentStoreFile(row)
  return {
    id: row.id,
    originalFilename: row.fileName,
    filename: row.fileName,
    mimeType,
    size: row.fileSizeBytes,
    // Category isn't tracked in doc_mount_files. Use a harmless default.
    category: row.fileType === 'blob' ? 'binary' : 'document',
    folderPath: folderPathFromRelativePath(row.relativePath),
    createdAt: row.createdAt,
    updatedAt: row.lastModified || row.updatedAt,
    mountPointId: row.mountPointId,
    relativePath: row.relativePath,
  }
}

export default function FileBrowser({
  projectId,
  mountPoint: mountPointProp,
  title,
  onFileClick,
  showUpload = false,
  onFilesChange,
  className = '',
}: Readonly<FileBrowserProps>) {
  // When the caller supplies `mountPoint` explicitly, we use that verbatim.
  // Otherwise we resolve by calling /api/v1/projects/{id}/mount-points once.
  // `autoResolved === null` means the lookup hasn't finished yet; we track
  // the projectId it was resolved against so switching projects briefly
  // shows nothing rather than the previous project's mount.
  const [autoResolved, setAutoResolved] = useState<
    { projectId: string; value: FileBrowserMountPoint | null } | null
  >(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [dbFolders, setDbFolders] = useState<DbFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolder, setCurrentFolder] = useState('/')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  const [sort, setSort] = useState<SortState>({ field: 'name', direction: 'asc' })
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [moveModalFile, setMoveModalFile] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    fileId: string;
    filename: string;
    associations: {
      characters: { id: string; name: string; usage: string }[];
      messages: { chatId: string; chatName: string; messageId: string }[];
    };
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isCleaningUp, setIsCleaningUp] = useState(false)
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleanupStats, setCleanupStats] = useState<{
    orphanedCount: number
    rescuedCount: number
    duplicateCount: number
    uniqueCount: number
    totalSize: number
    uniqueSize: number
  } | null>(null)

  // Derived: the mount point we actually use. Prop wins; otherwise the
  // auto-resolved value — but only when it belongs to the current projectId.
  const resolvedMountPoint: FileBrowserMountPoint | null =
    mountPointProp !== undefined
      ? (mountPointProp ?? null)
      : (autoResolved && autoResolved.projectId === projectId ? autoResolved.value : null)

  // Derived: whether the mount-point lookup has settled. The prop counts as
  // "settled" immediately; otherwise we wait for the auto-resolve fetch
  // against the current projectId.
  const mountResolved =
    mountPointProp !== undefined ||
    !projectId ||
    (autoResolved !== null && autoResolved.projectId === projectId)

  // Mount-mode gate: only true for database-backed stores. Filesystem/obsidian
  // mounts still use the legacy path since their files live on disk.
  const isMountMode = !!resolvedMountPoint && resolvedMountPoint.mountType === 'database'
  const mountPointId = isMountMode ? resolvedMountPoint!.id : ''

  // Auto-resolve a linked database-backed documents store when the caller
  // supplied a projectId but no mountPoint prop. Silent failure falls back
  // to legacy mode; one missing link shouldn't take down the browser.
  useEffect(() => {
    if (mountPointProp !== undefined) return
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/mount-points`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const list = (data.mountPoints || []) as FileBrowserMountPoint[]
        // Prefer the project's auto-created "Project Files: ..." store over
        // any manually-linked stores so Browse All Files lands where uploads
        // do. pickPrimaryProjectStore falls back to the first eligible store
        // if no name-match is found (e.g. projects that were only ever linked
        // by hand, or whose auto-created store was renamed).
        const normalised = list.map(mp => ({ ...mp, name: mp.name ?? '' }))
        const first = pickPrimaryProjectStore(normalised)
        if (!cancelled) setAutoResolved({ projectId, value: first })
      } catch (error) {
        console.warn('[FileBrowser] Failed to resolve linked mount point; falling back to legacy mode', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        })
        if (!cancelled) setAutoResolved({ projectId, value: null })
      }
    })()
    return () => { cancelled = true }
  }, [projectId, mountPointProp])

  // Upload hooks. Both are instantiated unconditionally (React hook rules);
  // the UI only surfaces the one matching the active mode.
  const legacyUpload = useProjectFileUpload({
    projectId: projectId || '',
    folderPath: currentFolder,
    onSuccess: () => {
      fetchFiles()
      onFilesChange?.()
    },
  })
  const mountUpload = useMountPointBlobUpload({
    mountPointId,
    folderPath: currentFolder,
    onSuccess: () => {
      fetchFiles()
      onFilesChange?.()
    },
  })

  const uploading = isMountMode ? mountUpload.uploading : legacyUpload.uploading
  const uploadProgress = isMountMode ? mountUpload.uploadProgress : legacyUpload.uploadProgress
  const fileInputRef = isMountMode ? mountUpload.fileInputRef : legacyUpload.fileInputRef
  const handleFileSelect = isMountMode ? mountUpload.handleFileSelect : legacyUpload.handleFileSelect
  const triggerFileSelect = isMountMode ? mountUpload.triggerFileSelect : legacyUpload.triggerFileSelect

  const fetchFiles = useCallback(async (opts?: { silent?: boolean }) => {
    if (!mountResolved) return
    try {
      // A silent refresh (workspace tab re-activation) keeps the current
      // listing on screen instead of flipping back to the loading state.
      if (!opts?.silent) setLoading(true)

      if (isMountMode && resolvedMountPoint) {
        const res = await fetch(`/api/v1/mount-points/${resolvedMountPoint.id}/files`)
        if (!res.ok) throw new Error('Failed to fetch files')
        const data = await res.json()
        const rows = (data.files || []) as DocumentStoreFileRow[]
        setFiles(rows.map(documentStoreFileToFileInfo))
        // No DB folders API for mount points yet — folders come from relativePath prefixes.
        setDbFolders([])
        return
      }

      const filesUrl = projectId
        ? `/api/v1/projects/${projectId}?action=list-files`
        : '/api/v1/files?filter=general'

      const foldersUrl = projectId
        ? `/api/v1/files/folders?projectId=${projectId}`
        : '/api/v1/files/folders'

      const [filesRes, foldersRes] = await Promise.all([
        fetch(filesUrl),
        fetch(foldersUrl),
      ])

      if (filesRes.ok) {
        const data = await filesRes.json()
        setFiles(data.files || [])
      } else {
        throw new Error('Failed to fetch files')
      }

      if (foldersRes.ok) {
        const data = await foldersRes.json()
        setDbFolders(data.folders || [])
      } else {
        console.warn('[FileBrowser] Failed to fetch folders from DB, using derived folders')
        setDbFolders([])
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to fetch files', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [projectId, mountResolved, isMountMode, resolvedMountPoint])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Navigating back to the containing workspace tab (Files, or a project
  // detail hosting this browser) refreshes the listing in place.
  useOnTabActivated(() => {
    void fetchFiles({ silent: true })
  })

  // Batch thumbnail pre-generation — only useful for the legacy endpoint,
  // which drives a server-side sharp pipeline keyed by files.id. Mount-mode
  // images are served raw and scaled client-side.
  useEffect(() => {
    if (loading || files.length === 0 || isMountMode) return

    const imageFileIds = files
      .filter(f => f.mimeType?.startsWith('image/'))
      .map(f => f.id)

    if (imageFileIds.length === 0) return

    fetch('/api/v1/files?action=generate-thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: imageFileIds.slice(0, 100) }),
    }).catch(() => { /* best-effort */ })
  }, [loading, files, isMountMode])

  const orphanedCount = useMemo(() =>
    files.filter(f => f.fileStatus === 'orphaned').length,
    [files]
  )

  const filteredFiles = useMemo(() => {
    const filtered = files.filter(file => {
      const fileFolderPath = file.folderPath || '/'
      return fileFolderPath === currentFolder
    })
    return sortFiles(filtered, sort)
  }, [files, currentFolder, sort])

  const subfolders = useMemo(() => {
    const folderMap = new Map<string, FolderInfo>()

    for (const dbFolder of dbFolders) {
      const folderPath = dbFolder.path
      if (folderPath === currentFolder) continue

      const pathParts = folderPath.split('/').filter(Boolean)
      const currentParts = currentFolder.split('/').filter(Boolean)

      if (pathParts.length === currentParts.length + 1) {
        const parentPath = currentParts.length === 0 ? '/' : '/' + currentParts.join('/') + '/'
        if (parentPath === currentFolder) {
          const fileCount = files.filter(f => {
            const fp = f.folderPath || '/'
            return fp === folderPath || fp.startsWith(folderPath)
          }).length

          folderMap.set(folderPath, {
            path: folderPath,
            name: dbFolder.name,
            fileCount,
            id: dbFolder.id,
            isDbFolder: true,
          })
        }
      }
    }

    for (const file of files) {
      const fileFolderPath = file.folderPath || '/'
      if (fileFolderPath.startsWith(currentFolder) && fileFolderPath !== currentFolder) {
        const remainder = fileFolderPath.slice(currentFolder.length)
        const nextSlash = remainder.indexOf('/')
        if (nextSlash > 0) {
          const subfolder = currentFolder + remainder.slice(0, nextSlash + 1)
          const existing = folderMap.get(subfolder)

          if (existing) {
            if (!existing.isDbFolder) {
              existing.fileCount++
            }
          } else {
            const name = subfolder.split('/').filter(Boolean).pop() || subfolder
            folderMap.set(subfolder, {
              path: subfolder,
              name,
              fileCount: 1,
              isDbFolder: false,
            })
          }
        }
      }
    }

    const result: FolderInfo[] = Array.from(folderMap.values())
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [files, dbFolders, currentFolder])

  const handleFolderClick = (folder: string) => {
    setCurrentFolder(folder)
  }

  const handleFileClick = (file: FileInfo) => {
    if (onFileClick) {
      onFileClick(file)
    } else {
      setSelectedFile(file)
    }
  }

  const handleGoUp = () => {
    if (currentFolder === '/') return
    const parts = currentFolder.split('/').filter(Boolean)
    parts.pop()
    const parent = parts.length === 0 ? '/' : '/' + parts.join('/') + '/'
    setCurrentFolder(parent)
  }

  const handleDeleteFile = async (fileId: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this file? This cannot be undone.')
    if (!confirmed) return

    try {
      const target = files.find(f => f.id === fileId)

      if (isMountMode && target?.mountPointId && target?.relativePath) {
        const res = await fetch(
          buildMountFileItemUrl(target.mountPointId, target.relativePath),
          { method: 'DELETE' }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Delete failed (${res.status})`)
        }
        setFiles(files.filter(f => f.id !== fileId))
        showSuccessToast('File deleted')
        onFilesChange?.()
        return
      }

      const res = await fetch(`/api/v1/files/${fileId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setFiles(files.filter(f => f.id !== fileId))
        showSuccessToast('File deleted')
        onFilesChange?.()
      } else if (data.details?.code === 'FILE_HAS_ASSOCIATIONS') {
        const file = files.find(f => f.id === fileId)
        setDeleteConfirmation({
          fileId,
          filename: file?.originalFilename || file?.filename || 'file',
          associations: data.details.associations,
        })
      } else {
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to delete file', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete file')
    }
  }

  const handleConfirmDeleteWithDissociation = async () => {
    if (!deleteConfirmation) return

    setIsDeleting(true)
    try {
      const res = await fetch(
        `/api/v1/files/${deleteConfirmation.fileId}?dissociate=true`,
        { method: 'DELETE' }
      )

      if (res.ok) {
        setFiles(files.filter(f => f.id !== deleteConfirmation.fileId))
        showSuccessToast('File deleted')
        setDeleteConfirmation(null)
        onFilesChange?.()
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to delete file with dissociation', {
        fileId: deleteConfirmation.fileId,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete file')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleMoveToProject = useCallback((fileId: string, fileName: string) => {
    setMoveModalFile({ id: fileId, name: fileName })
  }, [])

  const handleMoveSuccess = useCallback((_targetProjectId: string | null, _targetName: string) => {
    if (moveModalFile) {
      setFiles(prev => prev.filter(f => f.id !== moveModalFile.id))
      setMoveModalFile(null)
      if (selectedFile?.id === moveModalFile.id) {
        setSelectedFile(null)
      }
      onFilesChange?.()
    }
  }, [moveModalFile, selectedFile, onFilesChange])

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await fetch('/api/v1/files?action=sync', { method: 'POST' })
      if (res.ok) {
        showSuccessToast('Filesystem sync complete')
        fetchFiles()
      } else {
        throw new Error('Sync failed')
      }
    } catch (error) {
      showErrorToast('Failed to sync filesystem')
    } finally {
      setIsSyncing(false)
    }
  }, [fetchFiles])

  const handleCleanupClick = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      if (!res.ok) throw new Error('Failed to analyze orphaned files')
      const data = await res.json()
      setCleanupStats({
        orphanedCount: data.orphanedCount,
        rescuedCount: data.rescuedCount || 0,
        duplicateCount: data.duplicateCount,
        uniqueCount: data.uniqueCount,
        totalSize: data.totalSize,
        uniqueSize: data.uniqueSize,
      })
      setShowCleanupModal(true)
    } catch (error) {
      showErrorToast('Failed to analyze orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [])

  const handleCleanupMove = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'move', dryRun: false }),
      })
      if (!res.ok) throw new Error('Cleanup failed')
      const data = await res.json()
      const parts = [`Moved ${data.moved} file${data.moved !== 1 ? 's' : ''} to /orphans/`]
      if (data.deleted > 0) parts.push(`removed ${data.deleted} duplicate${data.deleted !== 1 ? 's' : ''}`)
      if (data.rescuedCount > 0) parts.push(`rescued ${data.rescuedCount} referenced file${data.rescuedCount !== 1 ? 's' : ''}`)
      showSuccessToast(parts.join(', '))
      setShowCleanupModal(false)
      setCleanupStats(null)
      fetchFiles()
    } catch (error) {
      showErrorToast('Failed to clean up orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [fetchFiles])

  const handleCleanupDelete = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'delete', dryRun: false }),
      })
      if (!res.ok) throw new Error('Cleanup failed')
      const data = await res.json()
      const parts = [`Removed ${data.deleted} orphaned file${data.deleted !== 1 ? 's' : ''}`]
      if (data.rescuedCount > 0) parts.push(`rescued ${data.rescuedCount} referenced file${data.rescuedCount !== 1 ? 's' : ''}`)
      showSuccessToast(parts.join(', '))
      setShowCleanupModal(false)
      setCleanupStats(null)
      fetchFiles()
    } catch (error) {
      showErrorToast('Failed to delete orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [fetchFiles])

  // Move-to-project makes sense only for legacy files (the files row carries
  // the project scope). Mount-blob files live inside a specific mount point,
  // and cross-store moves aren't wired up yet — suppress the affordance.
  const moveToProjectHandler = isMountMode ? undefined : handleMoveToProject

  const displayTitle = title || (projectId ? 'Project Files' : 'General Files')

  const showNewFolderButton = !isMountMode
  const showSyncButton = !isMountMode
  const showCleanupButton = !isMountMode && orphanedCount > 0

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="qt-heading-4">{displayTitle}</h2>
        <div className="flex items-center gap-2">
          {showUpload && (
            (isMountMode || projectId) ? (
              <button
                onClick={triggerFileSelect}
                disabled={uploading}
                className="qt-button qt-button-secondary p-2"
                title={uploading ? `Uploading ${uploadProgress?.current}/${uploadProgress?.total}...` : 'Upload Files'}
              >
                {uploading ? '⏳' : '\u{1F4E4}'}
              </button>
            ) : null
          )}
          {showNewFolderButton && (
            <button
              onClick={() => setShowCreateFolder(true)}
              className="qt-button qt-button-secondary p-2"
              title="New Folder"
            >
              {'\u{1F4C1}'}+
            </button>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="qt-button qt-button-secondary p-2"
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
          >
            {viewMode === 'list' ? '▦' : '☰'}
          </button>
          {showCleanupButton && (
            <button
              onClick={handleCleanupClick}
              disabled={isCleaningUp || loading}
              className="qt-button qt-button-secondary p-2 flex items-center gap-1"
              title={`${orphanedCount} untracked file${orphanedCount !== 1 ? 's' : ''} — click to clean up`}
            >
              {isCleaningUp ? '⏳' : '\u{1F9F9}'}
              <span className="text-xs qt-text-warning">{orphanedCount}</span>
            </button>
          )}
          {showSyncButton && (
            <button
              onClick={handleSync}
              disabled={isSyncing || loading}
              className="qt-button qt-button-secondary p-2"
              title="Sync filesystem — scan disk for new or removed files"
            >
              {isSyncing ? '⏳' : '\u{1F504}'}
            </button>
          )}
          <button
            onClick={() => { void fetchFiles() }}
            disabled={loading}
            className="qt-button qt-button-secondary p-2"
            title="Refresh"
          >
            {'↻'}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <button
            onClick={() => setCurrentFolder('/')}
            className="hover:text-primary transition-colors"
          >
            Root
          </button>
          {currentFolder !== '/' && (
            <>
              {currentFolder.split('/').filter(Boolean).map((part, index, arr) => {
                const path = '/' + arr.slice(0, index + 1).join('/') + '/'
                return (
                  <span key={path} className="flex items-center gap-2">
                    <span className="qt-text-secondary">/</span>
                    <button
                      onClick={() => setCurrentFolder(path)}
                      className="hover:text-primary transition-colors"
                    >
                      {part}
                    </button>
                  </span>
                )
              })}
            </>
          )}
          {isMountMode && resolvedMountPoint && (
            <span className="qt-text-xs qt-text-secondary ml-auto" title={`Linked Scriptorium store: ${resolvedMountPoint.name || resolvedMountPoint.id}`}>
              {'\u{1F4DA}'} {resolvedMountPoint.name || 'Document Store'}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="qt-text-small qt-text-secondary">Loading files...</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'grid' ? (
            <FileBrowserGrid
              files={filteredFiles}
              folders={subfolders}
              currentFolder={currentFolder}
              onFileClick={handleFileClick}
              onFolderClick={handleFolderClick}
              onGoUp={handleGoUp}
              onDeleteFile={handleDeleteFile}
              onMoveToProject={moveToProjectHandler}
            />
          ) : (
            <FileBrowserList
              files={filteredFiles}
              folders={subfolders}
              currentFolder={currentFolder}
              sort={sort}
              onSortChange={setSort}
              onFileClick={handleFileClick}
              onFolderClick={handleFolderClick}
              onGoUp={handleGoUp}
              onDeleteFile={handleDeleteFile}
              onMoveToProject={moveToProjectHandler}
            />
          )}
        </div>
      )}

      <div className="mt-4 pt-2 border-t qt-border-default">
        <span className="qt-text-xs qt-text-secondary">
          {files.length} file{files.length !== 1 ? 's' : ''} total
          {currentFolder !== '/' && ` • ${filteredFiles.length} in current folder`}
        </span>
      </div>

      {selectedFile && (
        <FilePreviewModal
          file={selectedFile}
          files={files}
          onClose={() => setSelectedFile(null)}
          onDelete={(fileId) => {
            setFiles(files.filter(f => f.id !== fileId))
            setSelectedFile(null)
            onFilesChange?.()
          }}
          onMoveToProject={isMountMode ? undefined : (fileId) => {
            const file = files.find(f => f.id === fileId)
            if (file) {
              handleMoveToProject(fileId, file.originalFilename || file.filename || 'file')
            }
          }}
          onNavigate={(file, _heading) => {
            setSelectedFile(file)
            if (file.folderPath && file.folderPath !== currentFolder) {
              setCurrentFolder(file.folderPath)
            }
          }}
        />
      )}

      {showNewFolderButton && (
        <CreateFolderModal
          isOpen={showCreateFolder}
          onClose={() => setShowCreateFolder(false)}
          currentFolder={currentFolder}
          projectId={projectId}
          onSuccess={(folderPath) => {
            fetchFiles()
            setCurrentFolder(folderPath)
          }}
        />
      )}

      {moveModalFile && !isMountMode && (
        <MoveToProjectModal
          isOpen={!!moveModalFile}
          onClose={() => setMoveModalFile(null)}
          fileId={moveModalFile.id}
          fileName={moveModalFile.name}
          currentProjectId={projectId}
          onSuccess={handleMoveSuccess}
        />
      )}

      {deleteConfirmation && (
        <FileDeleteConfirmation
          isOpen={!!deleteConfirmation}
          filename={deleteConfirmation.filename}
          associations={deleteConfirmation.associations}
          onConfirm={handleConfirmDeleteWithDissociation}
          onCancel={() => setDeleteConfirmation(null)}
          isDeleting={isDeleting}
        />
      )}

      {showCleanupModal && cleanupStats && (
        <OrphanCleanupModal
          isOpen={showCleanupModal}
          stats={cleanupStats}
          onMove={handleCleanupMove}
          onDelete={handleCleanupDelete}
          onCancel={() => {
            setShowCleanupModal(false)
            setCleanupStats(null)
          }}
          isProcessing={isCleaningUp}
        />
      )}

      {showUpload && (isMountMode || projectId) && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />
      )}
    </div>
  )
}

// Referenced for the blob URL helper that some callers may want.
export { buildMountBlobUrl }
