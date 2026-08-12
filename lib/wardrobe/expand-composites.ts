/**
 * Composite Wardrobe Item Expansion
 *
 * Wardrobe items can reference other items via `componentItemIds`, building
 * up layered or themed outfits ("nice jewelry" = locket + earrings + ring;
 * "rain outfit" = raincoat + jeans + boots). Equipped state stores the
 * composite's own ID; expansion to leaves happens at read time.
 *
 * Expansion is cycle-tolerant — vault files are user-editable, and a malformed
 * cycle must never break a chat. Cycles are logged and the offending branch
 * is truncated. Save-time validation (`detectComponentCycles`) is the place
 * to reject cycles before they land.
 *
 * @module wardrobe/expand-composites
 */

import { logger } from '@/lib/logger';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

export interface ExpandResult {
  /**
   * Leaf wardrobe item IDs in expansion order, deduplicated. Composites
   * themselves are NOT in this list. Unknown ids (no entry in `itemsById`)
   * are emitted as leaves so callers can see them; they'll typically be
   * filtered downstream.
   */
  leafIds: string[];
  /** Cycles detected during expansion (each is the path including the repeated id). */
  cycles: string[][];
  /** True if `maxDepth` was hit on any branch — usually indicates pathological nesting. */
  truncated: boolean;
}

export interface ExpandOptions {
  /** Max recursion depth. Defaults to 4. */
  maxDepth?: number;
}

/**
 * Default recursion bound for composite expansion. Exported so callers that
 * hydrate the component graph ahead of expansion (see `resolve-equipped`) can
 * fetch exactly as many levels as expansion will actually walk.
 */
export const COMPOSITE_MAX_DEPTH = 4;

const DEFAULT_MAX_DEPTH = COMPOSITE_MAX_DEPTH;

/**
 * Expand a list of wardrobe item IDs (some of which may be composites) into
 * their leaf components. Roots that are themselves leaves come back unchanged.
 */
export function expandComposites(
  rootIds: readonly string[],
  itemsById: ReadonlyMap<string, WardrobeItem>,
  options?: ExpandOptions,
): ExpandResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const leafIds: string[] = [];
  const seenLeaves = new Set<string>();
  const cycles: string[][] = [];
  let truncated = false;

  const emitLeaf = (id: string): void => {
    if (seenLeaves.has(id)) return;
    seenLeaves.add(id);
    leafIds.push(id);
  };

  const visit = (id: string, path: string[], depth: number): void => {
    const item = itemsById.get(id);
    if (!item) {
      // Unknown id — surface as a leaf so callers can decide how to handle it
      emitLeaf(id);
      return;
    }

    if (path.includes(id)) {
      cycles.push([...path, id]);
      return;
    }

    if (depth >= maxDepth) {
      truncated = true;
      logger.warn('[expandComposites] Max depth reached, treating as leaf', {
        context: 'wardrobe',
        itemId: id,
        depth,
        maxDepth,
      });
      emitLeaf(id);
      return;
    }

    if (item.componentItemIds.length === 0) {
      emitLeaf(id);
      return;
    }

    const nextPath = [...path, id];
    for (const childId of item.componentItemIds) {
      visit(childId, nextPath, depth + 1);
    }
  };

  for (const root of rootIds) {
    visit(root, [], 0);
  }

  return { leafIds, cycles, truncated };
}

/**
 * Save-time cycle check. Returns the cycle paths that would result if
 * `componentItemIds` were saved as the components of `selfId`. An empty
 * array means safe to save.
 */
export function detectComponentCycles(
  selfId: string,
  componentItemIds: readonly string[],
  itemsById: ReadonlyMap<string, WardrobeItem>,
): string[][] {
  const cycles: string[][] = [];

  const walk = (id: string, path: string[]): void => {
    const item = itemsById.get(id);
    if (!item) return;
    for (const grand of item.componentItemIds) {
      if (grand === selfId || path.includes(grand)) {
        cycles.push([...path, grand]);
        continue;
      }
      walk(grand, [...path, grand]);
    }
  };

  for (const childId of componentItemIds) {
    if (childId === selfId) {
      cycles.push([selfId, selfId]);
      continue;
    }
    walk(childId, [selfId, childId]);
  }
  return cycles;
}
