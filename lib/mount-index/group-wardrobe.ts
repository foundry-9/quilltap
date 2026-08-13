/**
 * Group Wardrobe — read/ensure helpers for a group document store's
 * `Wardrobe/` folder.
 *
 * A group-scoped façade over `shared-wardrobe.ts`. Anything hanging in a
 * group's `Wardrobe/` folder is wearable by every character who belongs to that
 * group — the household livery, the regimental kit, the coats by the door —
 * without any of them owning it. `characterId` is coerced to `null` like every
 * other shared tier.
 *
 * The mounts to read are resolved per *character* (never per chat) by
 * `resolveGroupMountPointIdsForCharacter` in `tiered-mount-pool.ts`: a
 * character never gains a co-participant's group stores.
 *
 * @module mount-index/group-wardrobe
 */

import {
  SHARED_WARDROBE_FOLDER,
  ensureSharedWardrobeFolder,
  readSharedWardrobe,
} from '@/lib/mount-index/shared-wardrobe';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Group wardrobe lives under the same `Wardrobe/` folder name as vaults. */
export const GROUP_WARDROBE_FOLDER = SHARED_WARDROBE_FOLDER;

/**
 * Idempotent: ensure the `Wardrobe/` folder exists in the given group mount.
 * Returns `{ folderId: null }` on failure — write paths must tolerate this.
 */
export async function ensureGroupWardrobeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  return ensureSharedWardrobeFolder(mountPointId);
}

/**
 * Read all wardrobe items from a group mount's `Wardrobe/` folder. See
 * {@link readSharedWardrobe} for the parse-time composite caveat.
 */
export async function readGroupWardrobe(
  mountPointId: string,
  includeArchived = false,
): Promise<WardrobeItem[]> {
  return readSharedWardrobe(mountPointId, includeArchived);
}
