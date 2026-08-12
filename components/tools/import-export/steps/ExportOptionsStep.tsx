'use client'

import { formatBytes } from '@/lib/utils/format-bytes'
import type { VaultPreview } from '../types'

interface ExportOptionsStepProps {
  includeMemories: boolean
  onIncludeMemoriesChange: (include: boolean) => void
  memoryCount: number
  /** Vault contents riding along with a characters export; null elsewhere. */
  vaultPreview?: VaultPreview | null
}

/** Pluralize a count without the bare "1 items" indignity. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Step 3: Configure export options (e.g., include memories)
 */
export function ExportOptionsStep({
  includeMemories,
  onIncludeMemoriesChange,
  memoryCount,
  vaultPreview,
}: ExportOptionsStepProps) {
  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-secondary">
        Configure export options
      </p>
      <label className="flex items-start gap-3 p-4 border qt-border-default rounded-lg cursor-pointer hover:qt-bg-muted/50">
        <input
          type="checkbox"
          checked={includeMemories}
          onChange={(e) => onIncludeMemoriesChange(e.target.checked)}
          className="w-4 h-4 mt-1"
        />
        <div className="flex-1">
          <p className="font-medium text-foreground">
            Include associated memories
          </p>
          {memoryCount > 0 && (
            <p className="qt-text-small qt-text-secondary mt-1">
              {memoryCount} memories will be included
            </p>
          )}
        </div>
      </label>

      {vaultPreview && vaultPreview.stores > 0 && (
        <div className="p-4 border qt-border-default rounded-lg">
          <p className="font-medium text-foreground">
            Every character travels with their vault
          </p>
          <p className="qt-text-small qt-text-secondary mt-1">
            {count(vaultPreview.stores, 'vault', 'vaults')} packed and labelled
            {vaultPreview.documents > 0 || vaultPreview.blobs > 0 ? ': ' : '. '}
            {[
              vaultPreview.documents > 0 && count(vaultPreview.documents, 'paper', 'papers'),
              vaultPreview.blobs > 0 && count(vaultPreview.blobs, 'photograph', 'photographs'),
            ]
              .filter(Boolean)
              .join(' and ')}
            {vaultPreview.documents > 0 || vaultPreview.blobs > 0 ? '. ' : ''}
            Expect a trunk of roughly {formatBytes(vaultPreview.estimatedBytes)} — the
            photographs, as ever, are the heavy luggage.
          </p>
        </div>
      )}
    </div>
  )
}
