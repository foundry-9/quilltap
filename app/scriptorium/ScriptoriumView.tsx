'use client'

/**
 * Document Stores List Page
 *
 * Displays all document stores (mount points) with CRUD and scan actions.
 */

import { useEffect, useState } from 'react'
import { useDocumentStores } from './hooks/useDocumentStores'
import {
  DocumentStoresGrid,
  CreateDocumentStoreDialog,
  EditDocumentStoreDialog,
  DeleteDocumentStoreDialog,
  ConvertToDatabaseDialog,
  DeconvertToFilesystemDialog,
} from './components'
import type { DocumentStore, CreateDocumentStoreData, UpdateDocumentStoreData } from './types'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import dynamic from 'next/dynamic'

// Lazy so the list bundle doesn't pull in the detail (and its file-manager deps)
// until a store is actually opened in place.
const DocumentStoreDetailView = dynamic(
  () => import('./[id]/DocumentStoreDetailView').then((m) => m.DocumentStoreDetailView),
  { ssr: false, loading: () => <p className="qt-section-title p-6">Loading document store…</p> }
)

export interface ScriptoriumViewProps {
  /** Deep-link target: open with this store's detail shown (workspace tab only). */
  initialStoreId?: string
}

export function ScriptoriumView({ initialStoreId }: ScriptoriumViewProps = {}) {
  const {
    stores,
    loading,
    error,
    fetchStores,
    createStore,
    updateStore,
    deleteStore,
    scanStore,
    convertStore,
    deconvertStore,
  } = useDocumentStores()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editStore, setEditStore] = useState<DocumentStore | null>(null)
  const [deleteStoreId, setDeleteStoreId] = useState<string | null>(null)
  const [convertStoreTarget, setConvertStoreTarget] = useState<DocumentStore | null>(null)
  const [deconvertStoreTarget, setDeconvertStoreTarget] = useState<DocumentStore | null>(null)
  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set())
  // Inside a workspace tab, drilling into a store renders in place (keep-alive)
  // rather than navigating to /scriptorium/[id]. Outside the workspace the grid
  // routes as before.
  const inTab = useWorkspaceTabId() != null
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(initialStoreId ?? null)
  const bgStyle = useSubsystemBackgroundStyle('scriptorium')

  useEffect(() => {
    fetchStores()
  }, [fetchStores])

  // A deep-link re-open refreshes the tab payload; follow it into the store.
  // Adjusting state during render is React's sanctioned derive-from-prop-change
  // pattern (re-renders immediately, nothing committed in between).
  const [prevInitialStoreId, setPrevInitialStoreId] = useState(initialStoreId)
  if (initialStoreId !== prevInitialStoreId) {
    setPrevInitialStoreId(initialStoreId)
    if (initialStoreId) setSelectedStoreId(initialStoreId)
  }

  const handleCreate = async (data: CreateDocumentStoreData) => {
    const result = await createStore(data)
    if (result) {
      setCreateDialogOpen(false)
    }
  }

  const handleUpdate = async (id: string, data: UpdateDocumentStoreData) => {
    const result = await updateStore(id, data)
    if (result) {
      setEditStore(null)
    }
  }

  const handleDelete = async () => {
    if (deleteStoreId) {
      const success = await deleteStore(deleteStoreId)
      if (success) {
        setDeleteStoreId(null)
      }
    }
  }

  const handleScan = async (storeId: string) => {
    setScanningIds(prev => new Set(prev).add(storeId))
    await scanStore(storeId)
    setScanningIds(prev => {
      const next = new Set(prev)
      next.delete(storeId)
      return next
    })
  }

  const handleConvertConfirm = async () => {
    if (!convertStoreTarget) return
    const targetId = convertStoreTarget.id
    setConvertStoreTarget(null)
    await convertStore(targetId)
  }

  const handleDeconvertConfirm = async (targetPath: string) => {
    if (!deconvertStoreTarget) return
    const targetId = deconvertStoreTarget.id
    setDeconvertStoreTarget(null)
    await deconvertStore(targetId, targetPath)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="qt-section-title">Loading document stores...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  // Workspace tab, drilled into a store: render its detail in place.
  if (inTab && selectedStoreId) {
    return (
      <DocumentStoreDetailView
        storeId={selectedStoreId}
        onBack={() => setSelectedStoreId(null)}
      />
    )
  }

  return (
    <div className="qt-page-container text-foreground" style={bgStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <div>
          <h1 className="qt-page-title">The Scriptorium</h1>
          <p className="mt-1 qt-text-small">Mount external document directories as searchable knowledge sources</p>
        </div>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="qt-button-primary"
        >
          Add Document Store
        </button>
      </div>

      <DocumentStoresGrid
        stores={stores}
        scanningIds={scanningIds}
        onCreateClick={() => setCreateDialogOpen(true)}
        onEditClick={setEditStore}
        onDeleteClick={setDeleteStoreId}
        onScanClick={handleScan}
        onConvertClick={setConvertStoreTarget}
        onDeconvertClick={setDeconvertStoreTarget}
        onOpenStore={inTab ? setSelectedStoreId : undefined}
      />

      <CreateDocumentStoreDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <EditDocumentStoreDialog
        store={editStore}
        onClose={() => setEditStore(null)}
        onSubmit={handleUpdate}
      />

      <DeleteDocumentStoreDialog
        open={deleteStoreId !== null}
        onClose={() => setDeleteStoreId(null)}
        onConfirm={handleDelete}
      />

      <ConvertToDatabaseDialog
        store={convertStoreTarget}
        onClose={() => setConvertStoreTarget(null)}
        onConfirm={handleConvertConfirm}
      />

      <DeconvertToFilesystemDialog
        store={deconvertStoreTarget}
        onClose={() => setDeconvertStoreTarget(null)}
        onConfirm={handleDeconvertConfirm}
      />
    </div>
  )
}
