'use client'

/**
 * FolderPicker Component
 *
 * Reusable component for selecting a folder within project or general files.
 * Shows existing folders and allows creating new ones.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

interface FolderInfo {
  path: string
  name: string
  depth: number
  fileCount: number
  id?: string
  isDbFolder?: boolean
}

/** Database folder type from API */
interface DbFolder {
  id: string
  path: string
  name: string
}

/** Stable empty arrays, so the memo below isn't invalidated on every render. */
const NO_FILES: Array<{ folderPath?: string }> = []
const NO_FOLDERS: DbFolder[] = []
const NO_PATHS: string[] = []

interface FolderPickerProps {
  /** Current selected folder path */
  value: string
  /** Called when folder selection changes */
  onChange: (path: string) => void
  /** Project ID to list folders from (null for general files) */
  projectId: string | null
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Optional class name */
  className?: string
}

export default function FolderPicker({
  value,
  onChange,
  projectId,
  disabled = false,
  className = '',
}: Readonly<FolderPickerProps>) {
  const [newFolderInput, setNewFolderInput] = useState('')
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  // Folders created while the API was unreachable. Scoped to the project they
  // were created under, so switching destinations drops them rather than
  // offering a folder that belongs to somewhere else.
  const [localFolders, setLocalFolders] = useState<{ projectId: string | null; paths: string[] }>({
    projectId,
    paths: [],
  })

  // Fetch files and folders via TanStack Query. URLs are built inside the
  // queryFn from `projectId` so the key (which encodes projectId) stays the
  // single source of cache identity.
  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: projectId ? queryKeys.projects.files(projectId) : queryKeys.files.list({ filter: 'general' }),
    queryFn: ({ signal }) =>
      apiFetch<{ files: Array<{ folderPath?: string }> }>(
        projectId ? `/api/v1/projects/${projectId}/files` : '/api/v1/files?filter=general',
        { signal }
      ),
  })
  const { data: foldersData, isLoading: foldersLoading, refetch: refetchFolders } = useQuery({
    queryKey: queryKeys.files.folders(projectId ?? undefined),
    queryFn: ({ signal }) =>
      apiFetch<{ folders: DbFolder[] }>(
        projectId ? `/api/v1/files/folders?projectId=${projectId}` : '/api/v1/files/folders',
        { signal }
      ),
  })

  const loading = filesLoading || foldersLoading
  const files = filesData?.files ?? NO_FILES
  const dbFolders = foldersData?.folders ?? NO_FOLDERS

  const localPaths = localFolders.projectId === projectId ? localFolders.paths : NO_PATHS

  // Build the folder list from fetched data. This must be derived on every
  // data change -- an earlier version cached it into state behind a
  // "only if empty" guard, which latched the list to the bare Root entry
  // produced by the first (still-loading) render and never let the real
  // folders in.
  const folders = useMemo<FolderInfo[]>(() => {
    const folderMap = new Map<string, FolderInfo>()
    const countFiles = (path: string) => files.filter((f) => (f.folderPath || '/') === path).length

    // Always include root
    folderMap.set('/', {
      path: '/',
      name: 'Root',
      depth: 0,
      fileCount: countFiles('/'),
      isDbFolder: false,
    })

    // Add DB folders
    for (const dbFolder of dbFolders) {
      const depth = dbFolder.path.split('/').filter(Boolean).length
      folderMap.set(dbFolder.path, {
        path: dbFolder.path,
        name: dbFolder.name,
        depth,
        fileCount: countFiles(dbFolder.path),
        id: dbFolder.id,
        isDbFolder: true,
      })
    }

    // Extract unique folder paths from files (for backwards compatibility)
    for (const file of files) {
      const path = file.folderPath || '/'
      if (!folderMap.has(path)) {
        const parts = path.split('/').filter(Boolean)
        const name = parts.length === 0 ? 'Root' : parts[parts.length - 1]
        folderMap.set(path, { path, name, depth: parts.length, fileCount: countFiles(path), isDbFolder: false })
      }
      // Also add parent paths
      const parts = path.split('/').filter(Boolean)
      let current = '/'
      for (const part of parts) {
        current = current === '/' ? `/${part}/` : `${current}${part}/`
        if (!folderMap.has(current)) {
          const depth = current.split('/').filter(Boolean).length
          folderMap.set(current, { path: current, name: part, depth, fileCount: countFiles(current), isDbFolder: false })
        }
      }
    }

    // Folders created locally after the create call failed
    for (const path of localPaths) {
      if (!folderMap.has(path)) {
        const parts = path.split('/').filter(Boolean)
        folderMap.set(path, {
          path,
          name: parts[parts.length - 1] ?? 'Folder',
          depth: parts.length,
          fileCount: 0,
          isDbFolder: false,
        })
      }
    }

    return Array.from(folderMap.values()).sort((a, b) => a.path.localeCompare(b.path))
  }, [files, dbFolders, localPaths])

  const handleCreateFolder = async () => {
    if (!newFolderInput.trim()) return

    // Normalize the new folder path
    let newPath = newFolderInput.trim()
    if (!newPath.startsWith('/')) newPath = '/' + newPath
    if (!newPath.endsWith('/')) newPath = newPath + '/'

    try {
      // Create the folder via API
      const res = await fetch('/api/v1/files/folders?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: newPath,
          projectId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to create folder')
      }

      const data = await res.json()
      const folderPath = data.folder?.path || newPath

      // Refresh folder list to include the new folder
      await refetchFolders()

      onChange(folderPath)
      setNewFolderInput('')
      setShowNewFolderInput(false)
    } catch (error) {
      console.error('[FolderPicker] Failed to create folder', {
        path: newPath,
        error: error instanceof Error ? error.message : String(error),
      })
      // Still add to local list as fallback
      setLocalFolders((prev) => {
        const paths = prev.projectId === projectId ? prev.paths : []
        return paths.includes(newPath)
          ? { projectId, paths }
          : { projectId, paths: [...paths, newPath] }
      })
      onChange(newPath)
      setNewFolderInput('')
      setShowNewFolderInput(false)
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          className="qt-select flex-1"
        >
          {loading ? (
            <option value="/">Loading...</option>
          ) : (
            folders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {/* Non-breaking spaces: an <option> collapses ordinary whitespace, so plain
                    spaces left every depth looking identical. */}
                {'\u00a0\u00a0'.repeat(Math.max(0, folder.depth - 1))}
                {folder.depth > 0 ? '└ ' : ''}
                {folder.name === 'Root' ? '/ (Root)' : folder.name}
                {folder.fileCount > 0 && ` (${folder.fileCount} files)`}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={() => setShowNewFolderInput(!showNewFolderInput)}
          disabled={disabled}
          className="qt-button qt-button-secondary px-3"
          title="Create new folder"
        >
          +
        </button>
      </div>

      {showNewFolderInput && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder="/path/to/folder/"
            disabled={disabled}
            className="qt-input flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreateFolder()
              } else if (e.key === 'Escape') {
                setShowNewFolderInput(false)
                setNewFolderInput('')
              }
            }}
          />
          <button
            type="button"
            onClick={handleCreateFolder}
            disabled={disabled || !newFolderInput.trim()}
            className="qt-button qt-button-primary px-3"
          >
            Create
          </button>
        </div>
      )}
    </div>
  )
}
