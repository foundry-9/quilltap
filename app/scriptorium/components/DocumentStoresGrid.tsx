'use client'

/**
 * Document Stores Grid
 *
 * Displays a grid of document store cards or empty state.
 */

import { useRouter } from 'next/navigation'
import { DocumentStoreCard } from './DocumentStoreCard'
import type { DocumentStore } from '../types'

interface DocumentStoresGridProps {
  stores: DocumentStore[]
  scanningIds: Set<string>
  onCreateClick: () => void
  onEditClick: (store: DocumentStore) => void
  onDeleteClick: (storeId: string) => void
  onScanClick: (storeId: string) => void
  onConvertClick: (store: DocumentStore) => void
  onDeconvertClick: (store: DocumentStore) => void
  /** When provided (workspace tab), open the store in place instead of routing. */
  onOpenStore?: (storeId: string) => void
}

export function DocumentStoresGrid({
  stores,
  scanningIds,
  onCreateClick,
  onEditClick,
  onDeleteClick,
  onScanClick,
  onConvertClick,
  onDeconvertClick,
  onOpenStore,
}: DocumentStoresGridProps) {
  const router = useRouter()

  const handleCardClick = (e: React.MouseEvent, storeId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    if (onOpenStore) onOpenStore(storeId)
    else router.push(`/scriptorium/${storeId}`)
  }

  if (stores.length === 0) {
    return (
      <div className="mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
        <p className="mb-4 text-lg qt-text-secondary">No document stores yet</p>
        <p className="mb-6 qt-text-small max-w-md mx-auto">
          Mount external document directories as searchable knowledge sources.
          Connect filesystem paths or Obsidian vaults to make their contents available to your AI conversations.
        </p>
        <button
          onClick={onCreateClick}
          className="qt-button-primary"
        >
          Add your first document store
        </button>
      </div>
    )
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {stores.map((store) => (
        <DocumentStoreCard
          key={store.id}
          store={store}
          scanning={scanningIds.has(store.id)}
          onClick={(e) => handleCardClick(e, store.id)}
          onEdit={() => onEditClick(store)}
          onDelete={() => onDeleteClick(store.id)}
          onScan={() => onScanClick(store.id)}
          onConvert={() => onConvertClick(store)}
          onDeconvert={() => onDeconvertClick(store)}
        />
      ))}
    </div>
  )
}
