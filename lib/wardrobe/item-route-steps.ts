/**
 * The two steps every wardrobe item endpoint (character, General, project,
 * group) performs identically around its tier-specific write:
 *
 *   - PUT: translate the request's optional `archived` boolean into an
 *     `archivedAt` patch via `archivedPatch`;
 *   - DELETE: scrub equipped references to the item from every chat before
 *     the row/file goes, logging (never failing) when that clean-up hiccups.
 *
 * Server-only (logs through the app logger).
 *
 * @module lib/wardrobe/item-route-steps
 */

import { logger } from '@/lib/logger';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';

/**
 * The `archivedAt` patch a PUT body's `archived` flag implies for an item
 * currently stamped `currentArchivedAt`. `null` when the flag was omitted or
 * the item is already in the requested state — spread `?? {}` into the update.
 */
export function applyArchiveFlag(
  currentArchivedAt: string | null | undefined,
  archived: boolean | undefined,
): { archivedAt: string | null } | null {
  if (archived === undefined) return null;
  return archivedPatch(currentArchivedAt, archived, new Date().toISOString());
}

/**
 * Remove `itemId` from every chat's equipped slots ahead of deleting it.
 * Composite items that still reference the id in `componentItemIds` are left
 * alone on purpose: `expandComposites` tolerates unknown ids. A failure here
 * is logged under `logTag` with `meta` and the delete proceeds regardless.
 */
export async function cleanupEquippedRefs(
  chats: { removeEquippedItemFromAllChats(itemId: string): Promise<unknown> },
  itemId: string,
  logTag: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await chats.removeEquippedItemFromAllChats(itemId);
  } catch (cleanupError) {
    logger.warn(`${logTag} Cleanup of equipped references had issues, proceeding with delete`, {
      ...meta,
      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}
