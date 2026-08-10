'use client'

/**
 * Post-rehydrate bundle disposal — spec §6 step 6. A successful rehydration
 * deliberately leaves the archive bundle on the shelf as cheap insurance;
 * this dialog is where the user decides whether it stays.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface RehydrateBundleDialogProps {
  characterName: string
  /** The ARCHIVE file left behind by the rehydration. */
  bundleFileId: string
  onClose: () => void
  /** Called after a successful delete, in addition to onClose. */
  onDeleted?: () => void
}

export function RehydrateBundleDialog({
  characterName,
  bundleFileId,
  onClose,
  onDeleted,
}: RehydrateBundleDialogProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDiscard = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/files/${bundleFileId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to discard the bundle')
      }
      onDeleted?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard the bundle')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border qt-border-default qt-bg-card shadow-2xl">
        <div className="px-6 py-4 border-b qt-border-default flex items-center gap-3 flex-shrink-0">
          <Icon name="folder" className="w-6 h-6 qt-text-secondary" />
          <h3 className="qt-dialog-title text-foreground">
            The empty bundle remains on the shelf
          </h3>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <p className="qt-text-small">
            {characterName} is fully unpacked — memories, correspondence and
            photographs all back where they belong. The sealed bundle they
            travelled in still sits in the file library, and keeping it costs
            nothing but shelf space: it is a spare copy of everything the
            archive held, exactly as it was.
          </p>
          <p className="qt-text-small qt-text-secondary">
            Discard it and the spare copy is gone for good — though of course
            you can always archive {characterName} afresh, which packs a new
            bundle from their current state.
          </p>
          {error && <p className="qt-text-small qt-text-danger">{error}</p>}
        </div>

        <div className="px-6 py-4 qt-bg-muted border-t qt-border-default flex gap-3 justify-end flex-shrink-0 rounded-b-2xl">
          <button
            onClick={handleDiscard}
            disabled={working}
            className="qt-button qt-button-secondary"
          >
            {working ? 'Clearing the shelf…' : 'Discard the Bundle'}
          </button>
          <button onClick={onClose} disabled={working} className="qt-button qt-button-primary">
            Keep It
          </button>
        </div>
      </div>
    </div>
  )
}
