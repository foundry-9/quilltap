'use client'

/**
 * OutfitSlotsPreview — read-only per-slot render of a decided outfit.
 *
 * Used by the chat-creation status dialog to show what an LLM-run character
 * chose to wear. Deliberately presentational: no add/remove/clear controls (the
 * interactive `EquippedSlotRow` is for the wardrobe editor). Reuses the same
 * slot labels and `qt-badge-wardrobe-*` classes so it reads as one system.
 *
 * @module components/wardrobe/OutfitSlotsPreview
 */

import type { OutfitPreviewSlots } from '@/lib/chat/creation-progress'
import { WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'

const SLOTS = WARDROBE_SLOT_TYPES.map((key) => ({
  key,
  label: WARDROBE_SLOT_META[key].label,
  badge: WARDROBE_SLOT_META[key].badgeClass,
}))

export function OutfitSlotsPreview({ slots }: { slots: OutfitPreviewSlots }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {SLOTS.map(({ key, label, badge }) => {
        const entries = slots[key] ?? []
        return (
          <div key={key} className="qt-card p-2">
            <div className="qt-text-secondary mb-1 text-xs uppercase tracking-wide">{label}</div>
            {entries.length === 0 ? (
              <div className="qt-text-muted text-xs italic">nothing</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {entries.map((e) => (
                  <span key={e.id} className={`qt-badge ${badge} text-xs`}>
                    {e.title}
                    {e.isComposite ? ' · set' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default OutfitSlotsPreview
