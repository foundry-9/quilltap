/**
 * Composite Component Hydration
 *
 * A bundle may gather components the character doesn't own and that aren't
 * equipped in their own right — the canonical case is a shared "House Livery"
 * whose coat, waistcoat and boots all live in Quilltap General or a project
 * store. Without those components in hand, expansion emits each one as an
 * unknown leaf and the whole outfit resolves to nothing.
 *
 * This walks the component graph a level at a time, one bulk query per level,
 * bounded by the same depth `expandComposites` will walk. Bulk matters: both
 * callers sit on child-process hot paths (avatar generation, story
 * backgrounds, scene state), and the read side runs on every turn.
 *
 * Shared by `resolve-equipped` (read side) and the wear primitives in
 * `outfit-displacement` (write side), so both see the same component graph.
 *
 * @module lib/wardrobe/hydrate-components
 */

import { logger } from '@/lib/logger';
import { COMPOSITE_MAX_DEPTH } from '@/lib/wardrobe/expand-composites';
import type { SharedWardrobeTiers } from '@/lib/wardrobe/shared-tiers';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Minimal repository surface needed to hydrate components. */
export interface ComponentHydrationRepos {
  wardrobe: {
    findByIdsForCharacter(
      characterId: string,
      ids: string[],
      opts?: SharedWardrobeTiers,
    ): Promise<WardrobeItem[]>;
  };
}

/** Group + project stores in scope, for multi-tier resolution. */
export type HydrateComponentsOptions = SharedWardrobeTiers;

/**
 * Fill in every component reachable from the items already in `itemsById`,
 * mutating the map in place. Failures are logged and swallowed — a component
 * we can't fetch degrades to an unresolvable leaf, never to a thrown turn.
 */
export async function hydrateComponentGraph(
  repos: ComponentHydrationRepos,
  characterId: string,
  itemsById: Map<string, WardrobeItem>,
  opts?: HydrateComponentsOptions,
): Promise<void> {
  const requested = new Set<string>();

  for (let depth = 0; depth < COMPOSITE_MAX_DEPTH; depth += 1) {
    const wanted: string[] = [];
    for (const item of itemsById.values()) {
      for (const componentId of item.componentItemIds ?? []) {
        if (itemsById.has(componentId)) continue;
        if (requested.has(componentId)) continue;
        requested.add(componentId);
        wanted.push(componentId);
      }
    }
    if (wanted.length === 0) return;

    try {
      const components = await repos.wardrobe.findByIdsForCharacter(characterId, wanted, opts);
      if (components.length === 0) return;
      for (const item of components) {
        itemsById.set(item.id, item);
      }
    } catch (error) {
      logger.warn('[hydrateComponentGraph] Component hydration failed', {
        context: 'wardrobe',
        characterId,
        depth,
        wantedCount: wanted.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
}

/**
 * Build a lookup for one bundle's component graph, starting from its direct
 * `componentItemIds`. Returns `undefined` when there is nothing to resolve, so
 * callers can skip dissolution entirely.
 */
export async function loadBundleLookup(
  repos: ComponentHydrationRepos,
  characterId: string,
  componentItemIds: readonly string[] | undefined,
  opts?: HydrateComponentsOptions,
): Promise<Map<string, WardrobeItem> | undefined> {
  if (!componentItemIds || componentItemIds.length === 0) return undefined;

  const itemsById = new Map<string, WardrobeItem>();
  try {
    const direct = await repos.wardrobe.findByIdsForCharacter(
      characterId,
      Array.from(componentItemIds),
      opts,
    );
    for (const item of direct) itemsById.set(item.id, item);
  } catch (error) {
    logger.warn('[loadBundleLookup] Failed to load bundle components', {
      context: 'wardrobe',
      characterId,
      componentCount: componentItemIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  if (itemsById.size === 0) return undefined;

  await hydrateComponentGraph(repos, characterId, itemsById, opts);
  return itemsById;
}
