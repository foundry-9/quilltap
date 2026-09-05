/**
 * Composed outfits — the pool split the composer UI runs on.
 *
 * A wardrobe item is either a **garment** (a leaf: a shirt, a pair of boots,
 * or a dress covering `["top","bottom"]` — multi-slot, but still one thing you
 * put on) or a **composed outfit** (a composite: an item assembled out of
 * other items via `componentItemIds`). The distinction is `isBundle`, and this
 * module is only the sorted selection built on top of it.
 *
 * The composer surfaces the two differently: outfits hang off the single
 * "Wear an outfit" pull-down at the top, garments fill the per-slot pickers.
 * Without that split every bundle appeared once per slot it covered, three
 * rows deep, crowding out the garments actually meant for the slot.
 *
 * @module wardrobe/composed-outfits
 */

import { isBundle } from '@/lib/wardrobe/dissolve-bundles';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/**
 * The composed outfits in a wearable pool, title-sorted for the pull-down.
 *
 * Every composite qualifies, single-slot ones included — the slot pickers no
 * longer offer them, so this list is their only way onto a character.
 * Archived items are already gone from the pool the composer is handed (see
 * `mergeWearablePool`); nothing is re-filtered here.
 */
export function selectComposedOutfits(items: WardrobeItem[]): WardrobeItem[] {
  return items
    .filter((item) => isBundle(item))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The garments in a wearable pool — everything that isn't a composed outfit.
 * Order is the caller's; the slot pickers apply their own filtering.
 */
export function selectGarments(items: WardrobeItem[]): WardrobeItem[] {
  return items.filter((item) => !isBundle(item));
}
