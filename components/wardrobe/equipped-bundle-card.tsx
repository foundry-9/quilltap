'use client'

/**
 * Equipped Bundle Card
 *
 * Renders a multi-slot composite ("bundle") as a single card above the slot
 * rows in the wardrobe dialog and the chat-start outfit composer. Replaces
 * the previous one-chip-per-slot duplication so a multi-slot composite shows
 * up once.
 *
 * The card is presentational — it calls out to `onTakeOff` and `onBreakApart`
 * callbacks. The parent decides whether to commit via the equip API (Live
 * outfit) or mutate staged React state (Outfit Builder), and whether to hide
 * the action row entirely (chat-start embedded composer).
 */

import { WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'

interface EquippedBundleCardProps {
  bundle: EquippedBundle
  /** Lookup for resolving the composite's title (and its leaves, if needed). */
  itemsById: Map<string, WardrobeItem>
  onTakeOff: (bundle: EquippedBundle) => void
  onBreakApart: (bundle: EquippedBundle) => void
  /** When false, hide Take off / Break apart (used in the embedded composer). */
  showActions?: boolean
}

export function EquippedBundleCard({
  bundle,
  itemsById,
  onTakeOff,
  onBreakApart,
  showActions = true,
}: EquippedBundleCardProps) {
  const composite = itemsById.get(bundle.compositeId)
  const title = composite?.title ?? 'Unknown bundle'

  return (
    <div className="qt-card py-2 px-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground break-words">
              {title}
            </span>
            <span className="qt-text-xs qt-text-secondary">· bundle</span>
            {!bundle.allOccupied && (
              <span className="qt-badge qt-badge-warning">
                partially worn
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {bundle.occupiedSlots.map((slot) => (
              <span
                key={slot}
                className={`qt-badge ${WARDROBE_SLOT_META[slot].badgeClass} uppercase`}
              >
                {WARDROBE_SLOT_META[slot].label}
              </span>
            ))}
          </div>
        </div>
        {showActions && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onBreakApart(bundle)}
              className="qt-button-ghost qt-button-sm"
              title="Replace this bundle with its individual items"
            >
              Break apart
            </button>
            <button
              type="button"
              onClick={() => onTakeOff(bundle)}
              className="qt-button-ghost qt-button-sm"
              title="Take this bundle off"
            >
              Take off bundle
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
