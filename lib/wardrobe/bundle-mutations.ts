/**
 * Pure helpers for mutating an `EquippedSlots` snapshot in response to bundle
 * actions (take off / break apart). Shared between the wardrobe control
 * dialog's Live and Builder tabs and the chat-start outfit composer so all
 * three surfaces handle bundles the same way.
 *
 * @module lib/wardrobe/bundle-mutations
 */

import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { cloneEquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'

/** Remove a bundle's composite id from every slot it occupies. */
export function takeOffBundleFromSlots(
  slots: EquippedSlots,
  bundle: EquippedBundle,
): EquippedSlots {
  const next = cloneEquippedSlots(slots)
  for (const slot of bundle.occupiedSlots) {
    next[slot] = next[slot].filter((id) => id !== bundle.compositeId)
  }
  return next
}

/**
 * Replace a bundle's composite id with its direct component ids in every slot
 * it occupies. Multi-slot leaves go into all slots they cover.
 */
export function breakApartBundleInSlots(
  slots: EquippedSlots,
  bundle: EquippedBundle,
  itemsById: Map<string, WardrobeItem>,
): EquippedSlots {
  const composite = itemsById.get(bundle.compositeId)
  if (!composite) return slots
  const next = cloneEquippedSlots(slots)
  for (const slot of bundle.occupiedSlots) {
    const replacementIds = composite.componentItemIds.filter((leafId) => {
      const leaf = itemsById.get(leafId)
      return leaf?.types.includes(slot) ?? false
    })
    next[slot] = next[slot].flatMap((id) =>
      id === bundle.compositeId ? replacementIds : [id],
    )
  }
  return next
}
