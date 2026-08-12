/**
 * Build a per-slot equipped snapshot from the items marked `isDefault: true`.
 *
 * Used both by the wardrobe dialog (to seed the Outfit Builder when there's
 * no chat context) and by the chat-start outfit composer (when the user
 * picks `Compose outfit`).
 *
 * @module lib/wardrobe/default-outfit
 */

import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'

/**
 * Deterministic layer order for a default outfit: oldest first, items lacking
 * `createdAt` last.
 *
 * Ordering is observable now that personal and shared defaults can occupy the
 * same slot — slot arrays are read inner-to-outer. Both sides of the wire apply
 * this so the composer's preview and the chat that opens agree.
 */
export function sortForDefaultOutfit(items: WardrobeItem[]): WardrobeItem[] {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY
    const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY
    return aTime - bTime
  })
}

export function buildDefaultOutfit(items: WardrobeItem[]): EquippedSlots {
  const next: EquippedSlots = { top: [], bottom: [], footwear: [], accessories: [] }
  for (const item of sortForDefaultOutfit(items)) {
    if (!item.isDefault || item.archivedAt) continue
    for (const slot of item.types) next[slot].push(item.id)
  }
  return next
}
