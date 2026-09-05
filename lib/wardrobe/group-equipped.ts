/**
 * Group equipped slots into bundle cards plus per-slot remainder lists.
 *
 * The wardrobe dialog and the chat-start outfit composer both render an
 * equipped outfit as: a few bundle cards above the slot rows, then the slot
 * rows themselves. A "bundle" is a composite wardrobe item that occupies two
 * or more slots in the current snapshot. Single-slot composites stay inline
 * in the slot row (rendering them as a separate card adds visual weight
 * without information).
 *
 * @module lib/wardrobe/group-equipped
 */

import type {
  EquippedSlots,
  WardrobeItem,
  WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types'

export interface EquippedBundle {
  /** The composite item's id. */
  compositeId: string
  /** Slots this composite occupies in the current snapshot, in canonical order. */
  occupiedSlots: WardrobeItemType[]
  /**
   * Whether the composite's id appears in every slot it claims via `types`.
   * Useful for surfacing "partially worn" bundles where a slot was removed
   * after the bundle was put on.
   */
  allOccupied: boolean
}

export interface GroupedEquipped {
  bundles: EquippedBundle[]
  /**
   * Per-slot ids that should still be rendered as chips in slot rows. Bundle
   * composite ids are removed from this list when the bundle has fully claimed
   * the slot — but layered leaves alongside a bundle remain.
   */
  slotRemainders: EquippedSlots
}

/**
 * Group an equipped-slots snapshot into bundles + remainders.
 *
 * Rules:
 *  - A composite enters `bundles` when it occupies ≥ 2 slots in the snapshot.
 *  - Bundle composite ids are removed from `slotRemainders`. Layered leaves
 *    that share a slot with a bundle composite remain in `slotRemainders`,
 *    so the slot row still renders them.
 *  - Single-slot composites stay inline in `slotRemainders` (the renderer
 *    decorates them with a `· bundle` note).
 *  - Items not present in `items` (orphaned ids) are passed through as-is in
 *    `slotRemainders` and never enter `bundles`.
 *
 * @param slots Equipped slots snapshot.
 * @param items Wardrobe items that may be referenced by the snapshot — items
 *   missing from this list are treated as opaque ids.
 */
export function groupEquippedSlots(
  slots: EquippedSlots,
  items: WardrobeItem[],
): GroupedEquipped {
  const itemsById = new Map<string, WardrobeItem>(items.map((i) => [i.id, i]))

  // Pass 1: collect every composite's per-snapshot occupied-slot list.
  const compositeSlots = new Map<string, WardrobeItemType[]>()
  for (const slot of WARDROBE_SLOT_TYPES) {
    const ids = slots[slot] ?? []
    for (const id of ids) {
      const item = itemsById.get(id)
      if (!item || item.componentItemIds.length === 0) continue
      const list = compositeSlots.get(id) ?? []
      if (!list.includes(slot)) list.push(slot)
      compositeSlots.set(id, list)
    }
  }

  // Pass 2: promote composites that occupy ≥ 2 slots into bundles. Track
  // which ids became bundles so we can strip them from slot remainders.
  const bundles: EquippedBundle[] = []
  const bundleIds = new Set<string>()
  for (const [compositeId, occupied] of compositeSlots) {
    if (occupied.length < 2) continue
    bundleIds.add(compositeId)
    const composite = itemsById.get(compositeId)!
    const allOccupied = composite.types.every((t) => occupied.includes(t))
    bundles.push({ compositeId, occupiedSlots: occupied, allOccupied })
  }

  // Sort bundles by their first occupied slot for stable rendering order.
  bundles.sort((a, b) => {
    const ia = WARDROBE_SLOT_TYPES.indexOf(a.occupiedSlots[0]!)
    const ib = WARDROBE_SLOT_TYPES.indexOf(b.occupiedSlots[0]!)
    return ia - ib
  })

  // Pass 3: build slot remainders. Drop bundle composite ids from each slot;
  // anything else (including layered leaves and single-slot composites) stays.
  const slotRemainders: EquippedSlots = makeEmptyEquippedSlots()
  for (const slot of WARDROBE_SLOT_TYPES) {
    const ids = slots[slot] ?? []
    slotRemainders[slot] = ids.filter((id) => !bundleIds.has(id))
  }

  return { bundles, slotRemainders }
}
