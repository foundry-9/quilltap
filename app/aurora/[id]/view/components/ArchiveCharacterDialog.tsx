'use client'

/**
 * Archive confirmation dialog — spells out precisely what archiving packs away
 * and what stays behind before the deed is done (character-archive spec §5.2).
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface ArchiveCharacterDialogProps {
  characterName: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function ArchiveCharacterDialog({
  characterName,
  onConfirm,
  onCancel,
}: ArchiveCharacterDialogProps) {
  const [working, setWorking] = useState(false)

  const handleConfirm = async () => {
    setWorking(true)
    try {
      await onConfirm()
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
            Set {characterName} resting in the archive?
          </h3>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <p className="qt-text-small">
            Archiving packs the whole of {characterName} — every last letter and
            photograph — into a single sealed bundle on the archive shelf, then
            clears the heavier effects from the working rooms. Nothing is lost;
            it is merely put away, and rehydrating unpacks it all again.
          </p>

          <div className="rounded-lg border qt-border-default qt-bg-muted/50 p-4 space-y-1.5">
            <p className="qt-text-label">Packed into the bundle and cleared away:</p>
            <ul className="qt-text-small qt-text-secondary list-disc pl-5 space-y-0.5">
              <li>Their memories (the Commonplace Book falls silent)</li>
              <li>Their correspondence — the whole of the mail folder</li>
              <li>Every photograph beyond the portrait itself</li>
              <li>Their conversation summaries</li>
            </ul>
          </div>

          <div className="rounded-lg border qt-border-default qt-bg-muted/50 p-4 space-y-1.5">
            <p className="qt-text-label">Kept in place, exactly as it stands:</p>
            <ul className="qt-text-small qt-text-secondary list-disc pl-5 space-y-0.5">
              <li>Who they are — every character field, still readable on their page</li>
              <li>Their portrait, so old conversations keep their face</li>
              <li>Their wardrobe</li>
              <li>Every chat they took part in, word for word</li>
              <li>What <em>other</em> characters remember about them — archiving silences the character, not everyone&apos;s memory of them</li>
            </ul>
          </div>

          <p className="qt-text-small qt-text-secondary">
            While archived they take no turns, receive no letters, and answer no
            queries. The bundle is sealed with your passphrase and rests at{' '}
            <span className="font-mono text-xs">files/&lt;id&gt;/character-archive.qtap</span>.
          </p>
        </div>

        <div className="px-6 py-4 qt-bg-muted border-t qt-border-default flex gap-3 justify-end flex-shrink-0 rounded-b-2xl">
          <button
            onClick={onCancel}
            disabled={working}
            className="qt-button qt-button-secondary"
          >
            Leave Them Be
          </button>
          <button
            onClick={handleConfirm}
            disabled={working}
            className="qt-button qt-button-primary"
          >
            {working ? 'Packing the bundle…' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}
