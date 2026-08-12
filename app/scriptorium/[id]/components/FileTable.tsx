'use client'

/**
 * File Table
 *
 * Unified view of a document store's contents: native-text documents, pdf/docx
 * files with extracted-text embeddings, and arbitrary binary blobs all live in
 * the same doc_mount_files index and appear side-by-side here. For database-
 * backed stores this is also where uploads happen — dropping files or using
 * the Upload button posts to the blob endpoint, which mirrors the upload back
 * into doc_mount_files so it shows up on the next refresh.
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { formatBytes } from '@/lib/utils/format-bytes'
import { showConfirmation } from '@/lib/alert'
import { buildMountFileItemUrl } from '@/components/files/mountBlobUrl'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import type { DocumentStoreFile, DocumentStoreBlob } from '../../types'

/** Root-level custom-tool definitions get an "open in Pascal's Workbench" action. */
function isCustomToolDefinition(relativePath: string): boolean {
  return /^tools\/[^/]+\.tool\.json$/i.test(relativePath)
}

interface FileTableProps {
  files: DocumentStoreFile[]
  loading: boolean
  mountPointId: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  onRefresh: () => void | Promise<void>
}

function FileTypeBadge({ type }: { type: string }) {
  const badgeClass: Record<string, string> = {
    markdown: 'qt-badge-success',
    txt: 'qt-badge-disabled',
    json: 'qt-badge-info',
    jsonl: 'qt-badge-info',
    pdf: 'qt-badge-destructive',
    docx: 'qt-badge-info',
    blob: 'qt-badge-disabled',
  }
  return (
    <span className={`inline-flex items-center ${badgeClass[type] || 'qt-badge-disabled'}`}>
      {type.toUpperCase()}
    </span>
  )
}

function ConversionBadge({ status, error }: { status: string; error: string | null }) {
  const badgeClass: Record<string, string> = {
    converted: 'qt-badge-success',
    pending: 'qt-badge-warning',
    failed: 'qt-badge-destructive',
    skipped: 'qt-badge-disabled',
  }
  return (
    <span
      className={`inline-flex items-center ${badgeClass[status] || 'qt-badge-disabled'}`}
      title={error || undefined}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function EmbeddingIndicator({ chunkCount }: { chunkCount: number }) {
  if (chunkCount === 0) {
    return <span className="text-xs qt-text-secondary">None</span>
  }
  return (
    <span className="inline-flex items-center gap-1 qt-body-sm">
      <span className="h-1.5 w-1.5 rounded-full qt-dot-success" />
      {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
    </span>
  )
}

type SortField = 'fileName' | 'fileType' | 'fileSizeBytes' | 'conversionStatus' | 'chunkCount' | 'lastModified'
type SortDir = 'asc' | 'desc'

/** File types backed by the blob store (pdf/docx/generic binary). */
function isBlobBacked(fileType: string): boolean {
  return fileType === 'blob' || fileType === 'pdf' || fileType === 'docx'
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return <Icon name="sort" className="w-3 h-3 ml-1 qt-text-secondary opacity-40" />
  }
  return <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} className="w-3 h-3 ml-1" />
}

function encodePath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

export function FileTable({ files, loading, mountPointId, mountType, onRefresh }: FileTableProps) {
  const workspace = useWorkspaceOptional()
  const router = useRouter()

  /** Open a Tools/*.tool.json on Pascal's Workbench (tab inside the workspace). */
  const openInWorkbench = useCallback(
    (relativePath: string) => {
      if (workspace) {
        workspace.openTab('custom-tools', { mountPointId, path: relativePath })
        return
      }
      const search = new URLSearchParams({ mount: mountPointId, path: relativePath })
      router.push(`/custom-tools?${search.toString()}`)
    },
    [workspace, router, mountPointId],
  )

  const [sortField, setSortField] = useState<SortField>('fileName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState('')
  const [uploading, setUploading] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [blobDetails, setBlobDetails] = useState<Record<string, DocumentStoreBlob | null>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Tracks blob IDs that have been fetched (or are being fetched) so we don't
  // issue duplicate requests when loadBlobDetail is recreated.
  const blobFetchedRef = useRef(new Set<string>())

  const canUpload = mountType === 'database'

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredAndSorted = useMemo(() => {
    let result = files
    if (filter) {
      const lower = filter.toLowerCase()
      result = result.filter(f =>
        f.fileName.toLowerCase().includes(lower) ||
        f.relativePath.toLowerCase().includes(lower) ||
        f.fileType.toLowerCase().includes(lower)
      )
    }
    return [...result].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [files, filter, sortField, sortDir])

  const totalSize = useMemo(() =>
    files.reduce((sum, f) => sum + f.fileSizeBytes, 0),
    [files]
  )

  const totalChunks = useMemo(() =>
    files.reduce((sum, f) => sum + f.chunkCount, 0),
    [files]
  )

  const conversionStats = useMemo(() => ({
    converted: files.filter(f => f.conversionStatus === 'converted').length,
    pending: files.filter(f => f.conversionStatus === 'pending').length,
    failed: files.filter(f => f.conversionStatus === 'failed').length,
    skipped: files.filter(f => f.conversionStatus === 'skipped').length,
  }), [files])

  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    if (!canUpload) {
      setOperationError('Uploads are only supported on database-backed stores.')
      return
    }
    setUploading(true)
    setOperationError(null)
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData()
        form.set('file', file)
        // Default layout: images into images/, other files at the root. The
        // user can move them later via the tree. The path is carried in the
        // item-route URL; the multipart body needs only the `file` field.
        const isImage = (file.type || '').startsWith('image/')
        const defaultPath = isImage ? `images/${file.name}` : file.name
        const res = await fetch(buildMountFileItemUrl(mountPointId, defaultPath), {
          method: 'PUT',
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || `Upload failed (${res.status})`)
        }
      }
      await onRefresh()
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [canUpload, mountPointId, onRefresh])

  const handleBlobDelete = useCallback(async (file: DocumentStoreFile) => {
    const ok = await showConfirmation(`Delete ${file.relativePath}? Markdown references to this blob will 404 until re-uploaded.`)
    if (!ok) return
    try {
      const res = await fetch(
        buildMountFileItemUrl(mountPointId, file.relativePath),
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      await onRefresh()
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : String(err))
    }
  }, [mountPointId, onRefresh])

  const loadBlobDetail = useCallback(async (file: DocumentStoreFile) => {
    // Add to the set before the first await so any concurrent call for the
    // same file sees it immediately and bails — no duplicate fetches.
    if (blobFetchedRef.current.has(file.id)) return
    blobFetchedRef.current.add(file.id)
    try {
      const res = await fetch(`/api/v1/mount-points/${mountPointId}/blobs`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const blob = (data.blobs as DocumentStoreBlob[] | undefined)?.find(
        b => b.relativePath === file.relativePath
      ) ?? null
      setBlobDetails(prev => ({ ...prev, [file.id]: blob }))
    } catch {
      setBlobDetails(prev => ({ ...prev, [file.id]: null }))
    }
  }, [mountPointId])

  const handleDescriptionSave = useCallback(async (
    file: DocumentStoreFile,
    description: string
  ) => {
    try {
      const res = await fetch(
        buildMountFileItemUrl(mountPointId, file.relativePath),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        }
      )
      if (!res.ok) throw new Error(`Update failed (${res.status})`)
      // The item route's PATCH returns metadata, not the blob row; update the
      // cached description optimistically (loadBlobDetail re-fetches the rest).
      setBlobDetails(prev => {
        const existing = prev[file.id]
        return existing ? { ...prev, [file.id]: { ...existing, description } } : prev
      })
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : String(err))
    }
  }, [mountPointId])

  const toggleExpand = useCallback((file: DocumentStoreFile) => {
    const next = expandedId === file.id ? null : file.id
    setExpandedId(next)
    if (next && isBlobBacked(file.fileType)) {
      void loadBlobDetail(file)
    }
  }, [expandedId, loadBlobDetail])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="qt-text-secondary">Loading files...</p>
      </div>
    )
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-6 qt-body">
          <span className="qt-text-secondary">
            <strong className="text-foreground">{files.length}</strong> files
          </span>
          <span className="qt-text-secondary">
            <strong className="text-foreground">{formatBytes(totalSize)}</strong> total
          </span>
          <span className="qt-text-secondary">
            <strong className="text-foreground">{totalChunks}</strong> chunks
          </span>
          {conversionStats.converted > 0 && (
            <span className="qt-text-success text-xs">{conversionStats.converted} converted</span>
          )}
          {conversionStats.pending > 0 && (
            <span className="qt-text-warning text-xs">{conversionStats.pending} pending</span>
          )}
          {conversionStats.failed > 0 && (
            <span className="qt-text-destructive text-xs">{conversionStats.failed} failed</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="qt-input text-sm py-1 px-3 w-48"
          />
          {canUpload && (
            <label className="qt-button-primary inline-flex items-center gap-1.5 cursor-pointer text-sm">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => handleUpload(e.target.files)}
                disabled={uploading}
              />
              {uploading ? 'Uploading…' : 'Upload'}
            </label>
          )}
        </div>
      </div>

      {operationError && (
        <div className="mb-4 rounded-xl qt-border-destructive/30 qt-bg-destructive/10 border p-3">
          <p className="text-sm qt-text-destructive">{operationError}</p>
        </div>
      )}

      {files.length === 0 ? (
        <div className="rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="qt-text-secondary">
            {canUpload
              ? 'No files yet. Use the Upload button above to add documents, images, or any binary file.'
              : 'No files indexed yet. Run a scan to discover files.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border qt-border-default qt-bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b qt-border-default">
                {([
                  ['fileName', 'File'],
                  ['fileType', 'Type'],
                  ['fileSizeBytes', 'Size'],
                  ['conversionStatus', 'Status'],
                  ['chunkCount', 'Embeddings'],
                  ['lastModified', 'Modified'],
                ] as [SortField, string][]).map(([field, label]) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className="px-4 py-3 text-left qt-text-secondary uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                  >
                    <span className="inline-flex items-center">
                      {label}
                      <SortIcon active={sortField === field} dir={sortDir} />
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((file) => {
                const blobUrl = isBlobBacked(file.fileType)
                  ? `/api/v1/mount-points/${mountPointId}/blobs/${encodePath(file.relativePath)}`
                  : null
                const expanded = expandedId === file.id
                const blob = blobDetails[file.id] ?? null
                return (
                  <Fragment key={file.id}>
                    <tr
                      className="border-b qt-border-default/50 hover:qt-bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => toggleExpand(file)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground truncate max-w-xs" title={file.relativePath}>
                          {file.fileName}
                        </div>
                        <div className="text-xs qt-text-secondary truncate max-w-xs" title={file.relativePath}>
                          {file.relativePath}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <FileTypeBadge type={file.fileType} />
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatBytes(file.fileSizeBytes)}
                      </td>
                      <td className="px-4 py-3">
                        <ConversionBadge status={file.conversionStatus} error={file.conversionError || null} />
                      </td>
                      <td className="px-4 py-3">
                        <EmbeddingIndicator chunkCount={file.chunkCount} />
                      </td>
                      <td className="px-4 py-3 text-xs qt-text-secondary whitespace-nowrap">
                        {new Date(file.lastModified).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-xs qt-text-secondary">
                        {expanded ? '▾' : '▸'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b qt-border-default/50">
                        <td colSpan={7} className="px-4 py-3 qt-bg-muted/30">
                          <FileDetailRow
                            key={blob?.updatedAt ?? 'loading'}
                            file={file}
                            blob={blob}
                            blobUrl={blobUrl}
                            canUpload={canUpload}
                            onDelete={() => handleBlobDelete(file)}
                            onSaveDescription={desc => handleDescriptionSave(file, desc)}
                            onOpenInWorkbench={
                              isCustomToolDefinition(file.relativePath)
                                ? () => openInWorkbench(file.relativePath)
                                : undefined
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface FileDetailRowProps {
  file: DocumentStoreFile
  blob: DocumentStoreBlob | null
  blobUrl: string | null
  canUpload: boolean
  onDelete: () => void
  onSaveDescription: (description: string) => void
  /** Present only for root-level Tools/*.tool.json files. */
  onOpenInWorkbench?: () => void
}

function FileDetailRow({ file, blob, blobUrl, canUpload, onDelete, onSaveDescription, onOpenInWorkbench }: FileDetailRowProps) {
  const [description, setDescription] = useState(blob?.description ?? '')
  const [dirty, setDirty] = useState(false)

  const isBlobBackedFile = isBlobBacked(file.fileType)
  const isImage = blob?.storedMimeType.startsWith('image/') ?? false

  const copyMarkdown = async () => {
    const markdown = isImage
      ? `![${blob?.description || blob?.originalFileName || file.fileName}](${file.relativePath})`
      : `[${blob?.originalFileName || file.fileName}](${file.relativePath})`
    try { await navigator.clipboard.writeText(markdown) } catch { /* no-op */ }
  }

  return (
    <div className="flex flex-wrap gap-4 text-xs qt-text-secondary">
      {onOpenInWorkbench && (
        <div className="w-full">
          <button type="button" onClick={onOpenInWorkbench} className="qt-button-secondary text-xs">
            Open in Pascal&apos;s Workbench
          </button>
        </div>
      )}
      {isBlobBackedFile && blob && (
        <div className="flex items-start gap-3 min-w-[16rem]">
          {isImage && blobUrl ? (
            <img
              src={blobUrl}
              alt={blob.description || blob.originalFileName}
              className="w-24 h-24 object-cover rounded qt-border-default border"
            />
          ) : (
            <div className="w-24 h-24 flex items-center justify-center rounded qt-bg-card qt-border-default border text-center px-1">
              {blob.storedMimeType}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <div>
              <strong className="text-foreground">MIME:</strong> {blob.storedMimeType}
              {blob.originalMimeType !== blob.storedMimeType && ` (from ${blob.originalMimeType})`}
            </div>
            <div>
              <strong className="text-foreground">Original name:</strong> {blob.originalFileName}
            </div>
            <div>
              <strong className="text-foreground">Extraction:</strong> {blob.extractionStatus}
              {blob.extractionError && ` — ${blob.extractionError}`}
            </div>
          </div>
        </div>
      )}
      {isBlobBackedFile && blob && (
        <div className="flex flex-col gap-2 flex-1 min-w-[18rem]">
          <textarea
            className="qt-input text-xs"
            value={description}
            placeholder="Description / transcript (searchable)"
            rows={3}
            onChange={e => {
              setDescription(e.target.value)
              setDirty(e.target.value !== (blob.description ?? ''))
            }}
          />
          <div className="flex flex-wrap gap-2">
            {blobUrl && (
              <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="qt-button-secondary text-xs">
                Open bytes
              </a>
            )}
            <button type="button" onClick={copyMarkdown} className="qt-button-secondary text-xs">
              Copy link
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => { onSaveDescription(description); setDirty(false) }}
                className="qt-button-primary text-xs"
              >
                Save
              </button>
            )}
            {canUpload && (
              <button type="button" onClick={onDelete} className="qt-button-destructive text-xs ml-auto">
                Delete
              </button>
            )}
          </div>
        </div>
      )}
      {!isBlobBackedFile && (
        <div>
          Native text document. Use the LLM&apos;s doc_read_file / doc_write_file tools to edit, or run a scan to refresh embeddings.
        </div>
      )}
    </div>
  )
}
