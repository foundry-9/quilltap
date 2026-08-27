'use client'

/**
 * Outfit Composer
 *
 * Renders an equipped outfit (live or staged) as an outfit pull-down, then
 * bundle cards, then slot rows, with picker controls for adding/removing
 * items. Used by both the wardrobe dialog (Live outfit + Outfit Builder tabs)
 * and the chat-start outfit composer (Compose outfit mode).
 *
 * The pool is split by kind: composed outfits (composites) live in the
 * `Wear an outfit…` pull-down at the top, garments in the per-slot pickers.
 * A three-slot bundle used to appear in three separate slot menus and bury
 * the garments actually meant for the slot.
 *
 * The component is controlled — the parent owns the slots state and
 * provides callbacks for mutation. Bundle actions (Take off / Break apart)
 * can be hidden via `showBundleActions={false}` (used at chat start where
 * there's no live state to manipulate, only a target snapshot to set).
 *
 * @module components/wardrobe/outfit-composer
 */

import { useMemo } from 'react'
import {
  WARDROBE_SLOT_TYPES,
  type EquippedSlots,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'
import { groupEquippedSlots, type EquippedBundle } from '@/lib/wardrobe/group-equipped'
import { EquippedSlotRow } from './equipped-slot-row'
import { EquippedBundleCard } from './equipped-bundle-card'
import { OutfitQuickPick } from './outfit-quick-pick'

const noopBundle = (_b: EquippedBundle): void => {
  /* used when showBundleActions=false */
}

export interface OutfitComposerProps {
  /** All wardrobe items available to the character (personal + archetypes). */
  items: WardrobeItem[]
  /** Current equipped (or staged) slots. */
  slots: EquippedSlots
  /**
   * Wear an item. Every caller applies the flag-driven equip rule across
   * *every* slot the item covers (`wearItemIntoSlots`), so the `slot`
   * argument names where the gesture started rather than where the item
   * lands — which is what lets the outfit pull-down reuse this one callback.
   */
  onAddToSlot: (slot: WardrobeItemType, itemId: string) => void
  onRemoveFromSlot: (slot: WardrobeItemType, itemId: string) => void
  onClearSlot: (slot: WardrobeItemType) => void
  /**
   * When true, bundle cards expose `Take off bundle` and `Break apart`
   * actions. When false, bundle cards render as display-only.
   */
  showBundleActions: boolean
  onTakeOffBundle?: (bundle: EquippedBundle) => void
  onBreakApartBundle?: (bundle: EquippedBundle) => void
}

export function OutfitComposer({
  items,
  slots,
  onAddToSlot,
  onRemoveFromSlot,
  onClearSlot,
  showBundleActions,
  onTakeOffBundle,
  onBreakApartBundle,
}: OutfitComposerProps) {
  const grouped = useMemo(() => groupEquippedSlots(slots, items), [slots, items])
  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  )

  return (
    <div className="space-y-2 mb-3">
      <OutfitQuickPick
        items={items}
        onWear={(outfit) => onAddToSlot(outfit.types[0]!, outfit.id)}
      />
      {grouped.bundles.map((bundle) => (
        <EquippedBundleCard
          key={bundle.compositeId}
          bundle={bundle}
          itemsById={itemsById}
          onTakeOff={onTakeOffBundle ?? noopBundle}
          onBreakApart={onBreakApartBundle ?? noopBundle}
          showActions={showBundleActions}
        />
      ))}
      {WARDROBE_SLOT_TYPES.map((slot) => (
        <EquippedSlotRow
          key={slot}
          slot={slot}
          equippedIds={grouped.slotRemainders[slot]}
          allItems={items}
          onAdd={onAddToSlot}
          onRemove={onRemoveFromSlot}
          onClear={onClearSlot}
        />
      ))}
    </div>
  )
}
