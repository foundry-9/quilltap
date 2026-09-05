/**
 * Shared helper for computing the canonical type union of a composite
 * wardrobe item from its components.
 *
 * Lifted out of the create-item handler so the editor UI and any other
 * caller can derive the same `types` array the server will compute.
 */

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Compute the union of slot types across a list of components, in canonical
 * slot order (`top → bottom → footwear → accessories → hair`). Used to derive a
 * composite item's `types` from its components.
 */
export function unionTypes(components: readonly Pick<WardrobeItem, 'types'>[]): WardrobeItemType[] {
  const set = new Set<WardrobeItemType>();
  for (const c of components) {
    for (const t of c.types) set.add(t);
  }
  return WARDROBE_SLOT_TYPES.filter((s) => set.has(s));
}
