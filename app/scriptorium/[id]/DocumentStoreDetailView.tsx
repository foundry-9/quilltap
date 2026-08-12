'use client'

/**
 * Document Store Detail — the body of a single store's page, as a props-driven
 * view so it can render either at the `/scriptorium/[id]` route (page wrapper
 * supplies a router-based `onBack`) or in place inside the Scriptorium workspace
 * tab (the list view supplies a state-based `onBack`), keeping the workspace
 * mounted so a streaming Salon in the other pane survives.
 *
 * @module app/scriptorium/[id]/DocumentStoreDetailView
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useDocumentStoreDetail } from './hooks/useDocumentStoreDetail'
import { FileTable } from './components'
import { EditDocumentStoreDialog } from '../components/EditDocumentStoreDialog'
import { formatBytes } from '@/lib/utils/format-bytes'
import { Icon } from '@/components/ui/icon'
import dynamic from 'next/dynamic'
import { deriveMountCapabilities } from '@/lib/mount-index/capabilities'
import type { DocMountPoint } from '@/lib/schemas/mount-index.types'
import type { UpdateDocumentStoreData } from '../types'

// Heavy SVAR file manager (Phase 3) — lazy + client-only so the default
// FileTable path never loads the SVAR runtime. Opt-in via the toggle below;
// FileTable stays the default until parity is confirmed.
const SvarFileManager = dynamic(
  () => import('@/components/files/svar/SvarFileManager').then((m) => m.SvarFileManager),
  { ssr: false, loading: () => <p className="qt-section-title p-6">Summoning the file manager…</p> }
)

export interface DocumentStoreDetailViewProps {
  storeId: string
  onBack: () => void
  /** Background style for the standalone route. In-tab, the tab owns the
      arbitrated workspace backdrop, so this is omitted there. */
  style?: CSSProperties
}

export function DocumentStoreDetailView({ storeId, onBack, style }: DocumentStoreDetailViewProps) {
  const {
    store,
    files,
    loading,
    filesLoading,
    error,
    scanning,
    fetchStore,
    fetchFiles,
    updateStore,
    scanStore,
  } = useDocumentStoreDetail(storeId)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [useSvarFileManager, setUseSvarFileManager] = useState(false)

  useEffect(() => {
    fetchStore()
    fetchFiles()
  }, [fetchStore, fetchFiles])

  const handleUpdate = async (id: string, data: UpdateDocumentStoreData) => {
    const result = await updateStore(data)
    if (result) {
      setEditDialogOpen(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="qt-section-title">Loading document store...</p>
      </div>
    )
  }

  if (error || !store) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">{error || 'Document store not found'}</p>
          <button onClick={onBack} className="qt-button-secondary">
            Back to The Scriptorium
          </button>
        </div>
      </div>
    )
  }

  const lastScanned = store.lastScannedAt
    ? new Date(store.lastScannedAt).toLocaleString()
    : 'Never'

  return (
    <div className="qt-page-container text-foreground" style={style}>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm qt-text-secondary hover:text-foreground mb-4 transition-colors"
        >
          <Icon name="chevron-left" className="w-4 h-4" />
          Back to The Scriptorium
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="qt-page-title">{store.name}</h1>
              {!store.enabled && (
                <span className="qt-badge-disabled inline-flex items-center">
                  Disabled
                </span>
              )}
              {store.mountType === 'database' && (
                <span className="qt-badge inline-flex items-center">
                  Database-backed
                </span>
              )}
            </div>
            {store.mountType === 'database' ? (
              <p className="mt-1 qt-text-small text-xs italic">Stored encrypted in the mount-index database.</p>
            ) : (
              <p className="mt-1 qt-text-small font-mono text-xs">{store.basePath}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={scanStore}
              disabled={scanning || store.scanStatus === 'scanning'}
              className={`qt-button-secondary inline-flex items-center gap-1.5 ${scanning || store.scanStatus === 'scanning' ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={store.mountType === 'database' ? 'Rechunk all documents in this database-backed store' : undefined}
            >
              <Icon name="refresh" className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : store.mountType === 'database' ? 'Re-chunk' : 'Scan Now'}
            </button>
            <button
              onClick={() => setEditDialogOpen(true)}
              className="qt-button-secondary inline-flex items-center gap-1.5"
            >
              <Icon name="pencil" className="w-4 h-4" />
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="qt-heading-2 text-foreground">{store.fileCount}</div>
          <div className="text-xs qt-text-secondary">Indexed Files</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="qt-heading-2 text-foreground">{formatBytes(store.totalSizeBytes)}</div>
          <div className="text-xs qt-text-secondary">Total Size</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="qt-label">{lastScanned}</div>
          <div className="text-xs qt-text-secondary">Last Scanned</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          {store.chunkCount === 0 ? (
            <>
              <div className="qt-label qt-text-secondary">No chunks</div>
              <div className="text-xs qt-text-secondary">Embedding Status</div>
            </>
          ) : store.embeddedChunkCount === store.chunkCount ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full qt-dot-success" />
                <span className="qt-label qt-text-success">Complete</span>
              </div>
              <div className="text-xs qt-text-secondary">{store.embeddedChunkCount}/{store.chunkCount} chunks embedded</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full qt-dot-warning" />
                <span className="qt-label qt-text-warning">{Math.round((store.embeddedChunkCount / store.chunkCount) * 100)}%</span>
              </div>
              <div className="text-xs qt-text-secondary">{store.embeddedChunkCount}/{store.chunkCount} chunks embedded</div>
            </>
          )}
        </div>
      </div>

      {/* Scan error display */}
      {store.scanStatus === 'error' && store.lastScanError && (
        <div className="mb-6 rounded-xl qt-border-destructive/30 qt-bg-destructive/10 border p-4">
          <h3 className="text-sm font-semibold qt-text-destructive mb-1">Last Scan Error</h3>
          <p className="text-sm qt-text-destructive">{store.lastScanError}</p>
        </div>
      )}

      {/* Pattern info (hidden for database-backed stores — they accept any path) */}
      {store.mountType !== 'database' && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl qt-bg-card border qt-border-default p-4">
            <h3 className="qt-text-secondary uppercase tracking-wider mb-2">Include Patterns</h3>
            <div className="flex flex-wrap gap-1.5">
              {store.includePatterns.map((p, i) => (
                <span key={i} className="inline-flex rounded qt-bg-success/10 qt-text-success px-2 py-0.5 text-xs font-mono">
                  {p}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl qt-bg-card border qt-border-default p-4">
            <h3 className="qt-text-secondary uppercase tracking-wider mb-2">Exclude Patterns</h3>
            <div className="flex flex-wrap gap-1.5">
              {store.excludePatterns.map((p, i) => (
                <span key={i} className="inline-flex rounded qt-bg-destructive/10 qt-text-destructive px-2 py-0.5 text-xs font-mono">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Files section — unified tree: text documents, pdf/docx extracts, and
          arbitrary binary blobs all show here. Database-backed stores expose
          an Upload button in this table; filesystem stores get populated by
          scans. */}
      <div className="border-t qt-border-default/60 pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="qt-heading-3">Indexed Files</h2>
          <button
            onClick={() => setUseSvarFileManager((v) => !v)}
            className="qt-button-ghost inline-flex items-center gap-1.5 text-sm"
            title="Preview the new SVAR-powered file manager"
          >
            <Icon name="layers" className="w-4 h-4" />
            {useSvarFileManager ? 'Classic view' : 'New file manager (beta)'}
          </button>
        </div>
        {useSvarFileManager ? (
          <SvarFileManager
            mountId={store.id}
            capabilities={deriveMountCapabilities(store as unknown as DocMountPoint)}
          />
        ) : (
          <FileTable
            files={files}
            loading={filesLoading}
            mountPointId={store.id}
            mountType={store.mountType}
            onRefresh={fetchFiles}
          />
        )}
      </div>

      {/* Edit dialog */}
      {editDialogOpen && (
        <EditDocumentStoreDialog
          store={store}
          onClose={() => setEditDialogOpen(false)}
          onSubmit={handleUpdate}
        />
      )}
    </div>
  )
}
