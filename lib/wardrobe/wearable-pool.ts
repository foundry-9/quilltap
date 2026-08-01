/**
 * Wearable Pool Merge
 *
 * The one rule for folding the shared wardrobe tiers (Quilltap General +
 * project stores) together with a character's own vault into the single pool
 * of items that character can wear.
 *
 * Pure — no I/O. Callers fetch the tiers; this decides who wins.
 *
 * @module wardrobe/wearable-pool
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/**
 * Merge the shared tiers under a character's own wardrobe.
 *
 * Precedence is character > shared: a personal item with the same id as a
 * shared one shadows it entirely (that's how a character keeps a private
 * variant of a house garment, and how they opt *out* of a shared default by
 * holding a copy with `isDefault: false`).
 *
 * Archived items are dropped from the result — including archived personal
 * overrides, which is what lets the shared item resurface once a character
 * archives their own copy. `wardrobe_list` has always behaved this way.
 *
 * Callers who need archived items (the equip path, which wants an archived
 * item's `types` for display) should not use this helper.
 */
export function mergeWearablePool(
  shared: WardrobeItem[],
  own: WardrobeItem[],
): WardrobeItem[] {
  const byId = new Map<string, WardrobeItem>();
  for (const item of shared) byId.set(item.id, item);
  for (const item of own) byId.set(item.id, item); // character overrides shared
  return Array.from(byId.values()).filter((item) => !item.archivedAt);
}
