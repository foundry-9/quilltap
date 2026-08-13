/**
 * Bundle Dissolution
 *
 * A "bundle" is a wardrobe item with `componentItemIds` — Man in Black, the
 * House Livery, a three-piece suit. Equipped state used to keep the bundle's
 * own id in every slot it covered, expanding to leaf garments only at read
 * time. That made the wardrobe dialog read badly: the bundle showed as one
 * card and all four slot rows underneath said *Empty*, so nothing on screen
 * told you which shirt you actually had on.
 *
 * Putting a bundle on now dissolves it in the same gesture: the leaves go into
 * the slots their own `types` declare and the bundle's id is never stored.
 * There is no separate "Break apart" step for anything worn from here on (the
 * button survives for outfits equipped before this change, which still carry a
 * composite id).
 *
 * Dissolution is deliberately *total* — `expandComposites` walks to leaves, so
 * a bundle nested inside a bundle dissolves too and no bundle card can come
 * back. It is also fail-safe: an unresolvable bundle (components live in a
 * store this caller can't see) returns `null`, and callers fall back to
 * storing the bundle whole, exactly as before. Wearing something is never
 * allowed to resolve to wearing nothing.
 *
 * @module lib/wardrobe/dissolve-bundles
 */

import { logger } from '@/lib/logger';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * The minimum an item has to expose to be dissolved or worn. Stated
 * structurally so the server's full `WardrobeItem` and the client's lighter
 * `WardrobeItemSummary` both satisfy it without conversion.
 */
export interface WearableNode {
  id: string;
  types: readonly string[];
  componentItemIds?: readonly string[];
}

/** Item lookup used to resolve a bundle's components. */
export type WearableLookup = ReadonlyMap<string, WearableNode>;

/** A dissolved leaf: the id to store, and the slots it occupies. */
export interface DissolvedLeaf {
  id: string;
  slots: WardrobeItemType[];
}

const SLOT_SET = new Set<string>(WARDROBE_SLOT_TYPES);

/** The recognized slots an item covers, filtering out anything unknown. */
export function slotsCoveredBy(item: WearableNode): WardrobeItemType[] {
  return item.types.filter((t): t is WardrobeItemType => SLOT_SET.has(t));
}

/** True when the item bundles other items. */
export function isBundle(item: WearableNode): boolean {
  return (item.componentItemIds?.length ?? 0) > 0;
}

/**
 * Expand a bundle into the leaf garments that should be worn in its place.
 *
 * Returns `null` — meaning "wear this item as its own id, the way we always
 * did" — when the item isn't a bundle, when no lookup was supplied, or when
 * not one component resolved to something wearable. That last case is the
 * important one: a shared bundle whose parts live in a store the caller can't
 * read must still put *something* on.
 */
export function dissolveBundleToLeaves(
  item: WearableNode,
  itemsById?: WearableLookup,
): DissolvedLeaf[] | null {
  if (!itemsById || !isBundle(item)) return null;

  const { leafIds, cycles, truncated } = expandComposites(
    item.componentItemIds ?? [],
    itemsById,
  );

  const leaves: DissolvedLeaf[] = [];
  for (const leafId of leafIds) {
    // A component pointing back at its own bundle would have the bundle wear
    // itself. `expandComposites` truncates the cycle; drop the echo here.
    if (leafId === item.id) continue;
    const leaf = itemsById.get(leafId);
    if (!leaf) continue;
    const slots = slotsCoveredBy(leaf);
    if (slots.length === 0) continue;
    leaves.push({ id: leafId, slots });
  }

  if (cycles.length > 0 || truncated) {
    logger.warn('[dissolveBundleToLeaves] Malformed bundle graph; expansion truncated', {
      context: 'wardrobe',
      itemId: item.id,
      cycles: cycles.length,
      truncated,
    });
  }

  if (leaves.length === 0) {
    logger.warn('[dissolveBundleToLeaves] Bundle resolved to no wearable parts; wearing it whole', {
      context: 'wardrobe',
      itemId: item.id,
      componentCount: item.componentItemIds?.length ?? 0,
    });
    return null;
  }

  return leaves;
}

/**
 * Lay a dissolved bundle's leaves into a slots snapshot.
 *
 * Each leaf lands in every slot its *own* `types` declare — which is what read
 * time already did, so an outfit whose components are blouse(top) /
 * slacks(bottom) / loafers(footwear) distributes correctly no matter which
 * slot the bundle nominally claimed.
 *
 * `clearCoveredSlots` is the bundle's `replace` gesture, and it clears the
 * union of the bundle's own `types` and every slot its leaves occupy. The
 * union matters: an assembled outfit that brings boots should swap the boots
 * that were already on, not layer over them.
 */
export function layLeavesIntoSlots(
  currentSlots: EquippedSlots,
  bundle: WearableNode,
  leaves: readonly DissolvedLeaf[],
  options: { clearCoveredSlots: boolean },
): EquippedSlots {
  const slots: EquippedSlots = {
    top: [...currentSlots.top],
    bottom: [...currentSlots.bottom],
    footwear: [...currentSlots.footwear],
    accessories: [...currentSlots.accessories],
  };

  if (options.clearCoveredSlots) {
    const covered = new Set<WardrobeItemType>(slotsCoveredBy(bundle));
    for (const leaf of leaves) {
      for (const slot of leaf.slots) covered.add(slot);
    }
    for (const slot of covered) slots[slot] = [];
  }

  for (const leaf of leaves) {
    for (const slot of leaf.slots) {
      if (!slots[slot].includes(leaf.id)) slots[slot] = [...slots[slot], leaf.id];
    }
  }

  return slots;
}

/**
 * Dissolve every bundle already sitting in a slots snapshot.
 *
 * For the snapshot builders — the default outfit, and the cheap LLM's
 * chat-start outfit pick — which compose slots directly instead of going
 * through the wear primitives. Layer order is preserved: a bundle's leaves are
 * substituted where the bundle's id sat. Leaves covering a slot the bundle
 * never occupied are appended to that slot, matching read-time routing.
 *
 * Bundles that can't be resolved are left in place untouched.
 */
export function dissolveBundlesInSlots(
  currentSlots: EquippedSlots,
  itemsById: WearableLookup,
): EquippedSlots {
  const dissolved = new Map<string, DissolvedLeaf[]>();
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const id of currentSlots[slot] ?? []) {
      if (dissolved.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;
      const leaves = dissolveBundleToLeaves(item, itemsById);
      if (leaves) dissolved.set(id, leaves);
    }
  }

  if (dissolved.size === 0) return currentSlots;

  const next: EquippedSlots = { top: [], bottom: [], footwear: [], accessories: [] };

  // Substitute in place, so a bundle's parts inherit its position in the
  // layering order rather than jumping to the end of the slot.
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const id of currentSlots[slot] ?? []) {
      const leaves = dissolved.get(id);
      if (!leaves) {
        if (!next[slot].includes(id)) next[slot].push(id);
        continue;
      }
      for (const leaf of leaves) {
        if (leaf.slots.includes(slot) && !next[slot].includes(leaf.id)) {
          next[slot].push(leaf.id);
        }
      }
    }
  }

  // Second pass: a leaf whose slot the bundle never claimed still belongs in
  // that slot (a bundle equipped to top/bottom whose parts include a hat).
  for (const leaves of dissolved.values()) {
    for (const leaf of leaves) {
      for (const slot of leaf.slots) {
        if (!next[slot].includes(leaf.id)) next[slot].push(leaf.id);
      }
    }
  }

  return next;
}
