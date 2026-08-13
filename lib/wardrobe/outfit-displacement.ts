/**
 * Outfit Equip Primitives
 *
 * Every "put it on" gesture obeys a single rule, keyed on the item's `replace`
 * flag and applied to *each* slot the item's `types` designate:
 *
 *   - `replace: false` (the default for both leaf garments and additive
 *     bundles) — the item is *layered* into the slot: its id is appended,
 *     keeping whatever is already there.
 *   - `replace: true` — the item *replaces* the slot: the slot becomes just
 *     `[item.id]`. Used for full-outfit swaps and "clear everything" bundles
 *     like Naked.
 *
 * Bundles (items with `componentItemIds`) dissolve as they go on: the leaves
 * are stored in the slots their own `types` declare and the bundle's id never
 * lands in equipped state, so what you're wearing always reads as garments
 * rather than as one opaque card over four empty slot rows. The `replace` flag
 * still governs a bundle — it clears the slots the assembled outfit lands in
 * before the parts go on. Dissolution needs an item lookup; without one (or
 * when a bundle's parts can't be resolved) the bundle is stored whole, the
 * pre-4.8.1 behaviour, and read-time `expandComposites` still covers it.
 *
 * Primitives:
 *
 *   - `wearItemIntoSlots` / `equipItem(item)` — the flag-driven rule above.
 *   - `replaceItemIntoSlots` / `replaceItem(item)` — force-swap: each
 *     designated slot is cleared and set to `[item.id]`, ignoring the flag.
 *     The "clear the slot, then put this on" gesture.
 *   - `addToSlot(item, slot)` — append `item.id` to one named slot's array
 *     (granular layering — "also wear the cardigan").
 *   - `removeFromSlot(slot, itemId?)` — filter `itemId` out of the slot's
 *     array. With `itemId` omitted, clears the slot entirely.
 *
 * `wearItemIntoSlots` / `replaceItemIntoSlots` / `computeDisplacedSlots` are
 * pure (no-DB) variants for frontend optimistic updates and unit tests.
 *
 * @module wardrobe/outfit-displacement
 */

import { logger } from '@/lib/logger';
import {
  dissolveBundleToLeaves,
  isBundle,
  layLeavesIntoSlots,
} from '@/lib/wardrobe/dissolve-bundles';
import type { WearableLookup, WearableNode } from '@/lib/wardrobe/dissolve-bundles';
import { loadBundleLookup } from '@/lib/wardrobe/hydrate-components';
import type { ComponentHydrationRepos } from '@/lib/wardrobe/hydrate-components';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/** Minimal repository interfaces needed for these primitives */
export interface DisplacementRepos {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
    setEquippedOutfit(chatId: string, characterId: string, slots: EquippedSlots): Promise<EquippedSlots | null>;
  };
  /**
   * Optional — supplied, a bundle's components are resolved so it can dissolve
   * as it goes on. Absent, bundles are stored whole (the old behaviour), which
   * still renders correctly via read-time expansion.
   */
  wardrobe?: ComponentHydrationRepos['wardrobe'];
}

/** Shared options for the persisted primitives. */
export interface EquipOptions {
  /** Project document stores in scope, for tri-tier component resolution. */
  projectMountPointIds?: string[];
}

/**
 * Resolve the lookup a bundle needs to dissolve. Non-bundles and repo sets
 * without wardrobe access short-circuit to `undefined` — no query fired.
 */
async function lookupForBundle(
  repos: DisplacementRepos,
  characterId: string,
  item: WearableNode,
  opts?: EquipOptions,
): Promise<WearableLookup | undefined> {
  if (!repos.wardrobe || !isBundle(item)) return undefined;
  return loadBundleLookup({ wardrobe: repos.wardrobe }, characterId, item.componentItemIds, {
    projectMountPointIds: opts?.projectMountPointIds,
  });
}

function freshSlots(): EquippedSlots {
  return { top: [], bottom: [], footwear: [], accessories: [] };
}

function cloneSlots(slots: EquippedSlots): EquippedSlots {
  return {
    top: [...slots.top],
    bottom: [...slots.bottom],
    footwear: [...slots.footwear],
    accessories: [...slots.accessories],
  };
}

async function loadSlots(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const current = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return current ? cloneSlots(current) : freshSlots();
}

/**
 * Pure flag-driven wear: for each slot in `item.types`, replace the slot with
 * `[item.id]` when `item.replace` is true, otherwise append `item.id`
 * (layering, no-op if already present). The single rule behind every "put it
 * on" gesture — see the module doc. No DB access.
 */
export function wearItemIntoSlots(
  currentSlots: EquippedSlots,
  item: { id: string; types: WardrobeItemType[]; replace?: boolean; componentItemIds?: string[] },
  itemsById?: WearableLookup,
): EquippedSlots {
  // A bundle goes on as its parts, not as itself. `replace` still governs:
  // an assembled outfit set to replace clears the slots it lands in first.
  const leaves = dissolveBundleToLeaves(item, itemsById);
  if (leaves) {
    return layLeavesIntoSlots(currentSlots, item, leaves, {
      clearCoveredSlots: item.replace === true,
    });
  }

  const slots = cloneSlots(currentSlots);
  for (const slotType of item.types) {
    if (item.replace) {
      slots[slotType] = [item.id];
    } else if (!slots[slotType].includes(item.id)) {
      slots[slotType] = [...slots[slotType], item.id];
    }
  }
  return slots;
}

/**
 * Pure force-swap: clear each slot in `item.types` and set it to `[item.id]`,
 * regardless of the `replace` flag. The "clear the slot, then put this on"
 * gesture. No DB access.
 */
export function replaceItemIntoSlots(
  currentSlots: EquippedSlots,
  item: { id: string; types: WardrobeItemType[]; componentItemIds?: string[] },
  itemsById?: WearableLookup,
): EquippedSlots {
  const leaves = dissolveBundleToLeaves(item, itemsById);
  if (leaves) {
    return layLeavesIntoSlots(currentSlots, item, leaves, { clearCoveredSlots: true });
  }

  const slots = cloneSlots(currentSlots);
  for (const slotType of item.types) {
    slots[slotType] = [item.id];
  }
  return slots;
}

/**
 * Wear an item into the slots its `types` designate, honoring the item's
 * `replace` flag (layer when false, replace when true — see
 * `wearItemIntoSlots`). The same rule for leaf garments and bundles alike.
 *
 * Composite items are stored as their own ID — expansion to leaves happens at
 * read time via `expandComposites`.
 */
export async function equipItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[]; componentItemIds?: string[]; replace?: boolean },
  opts?: EquipOptions,
): Promise<EquippedSlots> {
  const [slots, itemsById] = await Promise.all([
    loadSlots(repos, chatId, characterId),
    lookupForBundle(repos, characterId, newItem, opts),
  ]);
  const next = wearItemIntoSlots(slots, newItem, itemsById);
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, next);
  return result ?? next;
}

/**
 * Force-swap an item into the slots its `types` designate: each is cleared and
 * set to `[item.id]`, ignoring the `replace` flag. The persisted counterpart
 * of `replaceItemIntoSlots`.
 */
export async function replaceItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[]; componentItemIds?: string[] },
  opts?: EquipOptions,
): Promise<EquippedSlots> {
  const [slots, itemsById] = await Promise.all([
    loadSlots(repos, chatId, characterId),
    lookupForBundle(repos, characterId, newItem, opts),
  ]);
  const next = replaceItemIntoSlots(slots, newItem, itemsById);
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, next);
  return result ?? next;
}

/**
 * Pure single-slot layering. A bundle contributes the parts that cover this
 * slot rather than its own id; if none of them do (the caller asked for a slot
 * the bundle claims but no part fills), the bundle's id goes in as before so
 * the gesture is never silently a no-op.
 */
export function addItemToSlot(
  currentSlots: EquippedSlots,
  slot: WardrobeItemType,
  item: { id: string; types: WardrobeItemType[]; componentItemIds?: string[] },
  itemsById?: WearableLookup,
): EquippedSlots {
  const slots = cloneSlots(currentSlots);
  const leaves = dissolveBundleToLeaves(item, itemsById);
  const forSlot = leaves?.filter((leaf) => leaf.slots.includes(slot)) ?? [];

  if (forSlot.length > 0) {
    for (const leaf of forSlot) {
      if (!slots[slot].includes(leaf.id)) slots[slot] = [...slots[slot], leaf.id];
    }
    return slots;
  }

  if (!slots[slot].includes(item.id)) {
    slots[slot] = [...slots[slot], item.id];
  }
  return slots;
}

/**
 * Append `item.id` to the given slot's array. Validates that
 * `slot ∈ item.types`. No-op if the item is already in the slot.
 */
export async function addToSlot(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  slot: WardrobeItemType,
  item: { id: string; types: WardrobeItemType[]; componentItemIds?: string[] },
  opts?: EquipOptions,
): Promise<EquippedSlots> {
  if (!item.types.includes(slot)) {
    throw new Error(
      `Item ${item.id} (types=[${item.types.join(',')}]) cannot occupy slot '${slot}'`,
    );
  }

  const [current, itemsById] = await Promise.all([
    loadSlots(repos, chatId, characterId),
    lookupForBundle(repos, characterId, item, opts),
  ]);
  const slots = addItemToSlot(current, slot, item, itemsById);

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);
  return result ?? slots;
}

/**
 * Remove a specific item from the given slot's array. If `itemId` is
 * omitted, clears the slot entirely.
 */
export async function removeFromSlot(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  slot: WardrobeItemType,
  itemId?: string,
): Promise<EquippedSlots> {
  const slots = await loadSlots(repos, chatId, characterId);

  if (!itemId) {
    slots[slot] = [];
  } else {
    slots[slot] = slots[slot].filter((id) => id !== itemId);
  }

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);
  return result ?? slots;
}

/** Pure-function variants for frontend optimistic updates. */

export type DisplacementMode = 'wear' | 'replace' | 'add_to_slot' | 'remove_from_slot' | 'clear_slot';

export interface ComputeDisplacedOptions {
  mode: DisplacementMode;
  /** Required for `wear`, `replace`, and `add_to_slot`. `replace` (the flag)
   *  drives `wear`'s layer-vs-replace behaviour (see `wearItemIntoSlots`). */
  item?: { id: string; types: string[]; componentItemIds?: string[]; replace?: boolean };
  /** Required for `add_to_slot`, `remove_from_slot`, `clear_slot`. */
  slot?: WardrobeItemType;
  /** Filter target for `remove_from_slot`; omit to clear the slot. */
  itemId?: string;
  /**
   * Item lookup used to dissolve a bundle as it goes on. Omit and bundles are
   * stored whole — correct, just less legible in the slot rows.
   */
  itemsById?: WearableLookup;
}

export function computeDisplacedSlots(
  currentSlots: EquippedSlots,
  options: ComputeDisplacedOptions,
): EquippedSlots {
  const slots = cloneSlots(currentSlots);

  if (options.mode === 'wear') {
    if (!options.item) return slots;
    return wearItemIntoSlots(
      slots,
      {
        id: options.item.id,
        types: options.item.types as WardrobeItemType[],
        componentItemIds: options.item.componentItemIds,
        replace: options.item.replace,
      },
      options.itemsById,
    );
  }

  if (options.mode === 'replace') {
    if (!options.item) return slots;
    return replaceItemIntoSlots(
      slots,
      {
        id: options.item.id,
        types: options.item.types as WardrobeItemType[],
        componentItemIds: options.item.componentItemIds,
      },
      options.itemsById,
    );
  }

  if (options.mode === 'add_to_slot') {
    if (!options.item || !options.slot) return slots;
    return addItemToSlot(
      slots,
      options.slot,
      {
        id: options.item.id,
        types: options.item.types as WardrobeItemType[],
        componentItemIds: options.item.componentItemIds,
      },
      options.itemsById,
    );
  }

  if (options.mode === 'remove_from_slot') {
    if (!options.slot) return slots;
    if (!options.itemId) {
      slots[options.slot] = [];
    } else {
      const target = options.itemId;
      slots[options.slot] = slots[options.slot].filter((id) => id !== target);
    }
    return slots;
  }

  if (options.mode === 'clear_slot') {
    if (!options.slot) return slots;
    slots[options.slot] = [];
    return slots;
  }

  return slots;
}
