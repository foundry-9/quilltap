/**
 * Equipped Outfit Resolution
 *
 * Helper for the read side of the wardrobe model. Equipped slots store arrays
 * of item IDs (which may be composites referencing other items). Most callers
 * want the same thing: a per-slot list of leaf items and their titles, ready
 * to feed into `describeOutfit` or to render in a prompt block.
 *
 * This helper:
 *   1. Loads every wardrobe item belonging to the character (so the
 *      `itemsById` map can resolve composite components transitively).
 *   2. Falls back to `wardrobe.findByIdsForCharacter` for any equipped IDs not
 *      found in the character's own wardrobe (archetype items, etc.).
 *   2a. Hydrates composite components that are still missing — a shared
 *      composite's parts live in the shared tiers, not the character's vault —
 *      one bulk query per nesting level.
 *   3. Expands each input slot's array via `expandComposites`, then routes
 *      each resulting leaf into every output slot the leaf's own `types`
 *      declares — dedup'd across input slots. That way an atomic dress with
 *      `types=[top,bottom]` shows up in both rendered slots even if it was
 *      only equipped to one, and a composite outfit whose components have
 *      heterogeneous types distributes those components correctly.
 *   4. Returns per-slot leaf items, the title-array `OutfitSlotValues` for
 *      `describeOutfit`, and the underlying `itemsById` map for callers that
 *      still want to inspect items themselves.
 *
 * @module wardrobe/resolve-equipped
 */
import { logger } from '@/lib/logger';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { hydrateComponentGraph } from '@/lib/wardrobe/hydrate-components';
import type { OutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import type { SharedWardrobeTiers } from '@/lib/wardrobe/shared-tiers';
import {
  WARDROBE_SLOT_TYPES,
  allEquippedItemIds,
} from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/** Minimal repository surface needed to resolve equipped items. */
export interface ResolveEquippedRepos {
  wardrobe: {
    findByCharacterId(characterId: string, includeArchived?: boolean): Promise<WardrobeItem[]>;
    findByIdsForCharacter(
      characterId: string,
      ids: string[],
      opts?: SharedWardrobeTiers,
    ): Promise<WardrobeItem[]>;
  };
}

/**
 * Options for multi-tier equipped resolution. Equipped items not found in the
 * character's own vault are resolved against these group/project stores plus
 * Quilltap General. Omit when there is no chat context (General alone).
 */
export type ResolveEquippedOptions = SharedWardrobeTiers;

export interface ResolvedEquippedOutfit {
  /** Per-slot title arrays, ready for `describeOutfit`. */
  outfitValues: OutfitSlotValues;
  /** Per-slot leaf items (composites expanded), in the order they appear in equipped state. */
  leafItemsBySlot: Record<WardrobeItemType, WardrobeItem[]>;
  /** Map of every item id encountered during resolution (composites + leaves). */
  itemsById: Map<string, WardrobeItem>;
}

/** Fresh per-slot record with an empty array in every slot. */
function emptyBySlot<T>(): Record<WardrobeItemType, T[]> {
  return Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((slot) => [slot, [] as T[]]),
  ) as Record<WardrobeItemType, T[]>;
}

function emptyResolved(): ResolvedEquippedOutfit {
  return {
    outfitValues: emptyBySlot<string>(),
    leafItemsBySlot: emptyBySlot<WardrobeItem>(),
    itemsById: new Map(),
  };
}

/**
 * Resolve a character's equipped slots into per-slot leaf items and a
 * `describeOutfit`-ready `OutfitSlotValues`. Composites are expanded
 * transitively via `expandComposites`.
 *
 * Pass the character's own id when known — that lets us load the full
 * character wardrobe (honouring the document-store overlay) and resolve
 * composite components even when they're not equipped themselves.
 */
export async function resolveEquippedOutfitForCharacter(
  repos: ResolveEquippedRepos,
  characterId: string,
  slots: EquippedSlots,
  opts?: ResolveEquippedOptions,
): Promise<ResolvedEquippedOutfit> {
  const equippedItemIds = allEquippedItemIds(slots);

  if (equippedItemIds.length === 0) {
    return emptyResolved();
  }

  // Pull everything in the character's wardrobe so transitive composite
  // components resolve. Include archived: an item that's been archived after
  // the chat last loaded should still resolve to its title for display.
  let charItems: WardrobeItem[] = [];
  try {
    charItems = await repos.wardrobe.findByCharacterId(characterId, true);
  } catch (error) {
    logger.warn('[resolveEquippedOutfitForCharacter] findByCharacterId failed; proceeding with findByIds only', {
      context: 'wardrobe',
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const itemsById = new Map<string, WardrobeItem>(charItems.map((i) => [i.id, i]));

  // Fill in any equipped ids the character wardrobe didn't supply (archetype
  // items, items from another character if the chat permits, etc.).
  const missing = equippedItemIds.filter((id) => !itemsById.has(id));
  if (missing.length > 0) {
    try {
      // Resolve via the character scope so archetypes (Quilltap General, the
      // character's groups, the chat's project) and the character's own vault
      // items both surface — there's no global wardrobe table to hit
      // post-cutover.
      const fallback = await repos.wardrobe.findByIdsForCharacter(characterId, missing, opts);
      for (const item of fallback) {
        itemsById.set(item.id, item);
      }
    } catch (error) {
      logger.warn('[resolveEquippedOutfitForCharacter] findByIds fallback failed', {
        context: 'wardrobe',
        characterId,
        missingCount: missing.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // A composite may bundle components the character doesn't own and that aren't
  // equipped in their own right. Hydrating them is shared with the write side
  // (see `hydrate-components`) so both ends see the same component graph.
  await hydrateComponentGraph(repos, characterId, itemsById, opts);

  // First pass: expand each input slot's composites, dedupe by leaf id across
  // the whole equipped set, and remember the order leaves were first seen.
  // Second pass: route each leaf into every output slot its own `types`
  // declares. That spreads atomic multi-slot items (a dress with
  // `types=[top,bottom]` lands in both rendered slots) and routes composite
  // components to the slots their own `types` say (a "casual outfit"
  // composite whose components are blouse(top)/slacks(bottom)/loafers(footwear)
  // distributes correctly even if the composite itself was equipped to one
  // slot).
  const leafItemsBySlot: ResolvedEquippedOutfit['leafItemsBySlot'] = emptyBySlot<WardrobeItem>();
  const outfitValues: OutfitSlotValues = emptyBySlot<string>();

  const seenLeafIds = new Set<string>();
  const orderedLeaves: WardrobeItem[] = [];
  for (const slot of WARDROBE_SLOT_TYPES) {
    const expanded = expandComposites(slots[slot], itemsById);
    for (const id of expanded.leafIds) {
      if (seenLeafIds.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;
      seenLeafIds.add(id);
      orderedLeaves.push(item);
    }
  }

  for (const item of orderedLeaves) {
    // A leaf's `types` declare which slots it covers. Route into each.
    // If `types` is somehow empty (shouldn't happen — the schema requires
    // min(1)), fall back to no-op rather than guessing.
    for (const slot of item.types) {
      if (!WARDROBE_SLOT_TYPES.includes(slot)) continue;
      leafItemsBySlot[slot].push(item);
      outfitValues[slot].push(item.title);
    }
  }

  return { outfitValues, leafItemsBySlot, itemsById };
}

