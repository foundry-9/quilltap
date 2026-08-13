/**
 * Project Wardrobe — read/ensure helpers for a project document store's
 * `Wardrobe/` folder.
 *
 * A project-scoped façade over `shared-wardrobe.ts`, so wardrobe is multi-tier
 * (character vault + group stores + project stores + Quilltap General) the same
 * way knowledge and scenarios already are. Project wardrobe items are shared
 * within the project — `characterId` is coerced to `null` like every other
 * shared tier — but they live in the project's mount rather than Quilltap
 * General.
 *
 * @module mount-index/project-wardrobe
 */

import {
  SHARED_WARDROBE_FOLDER,
  ensureSharedWardrobeFolder,
  readSharedWardrobe,
} from '@/lib/mount-index/shared-wardrobe';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Project wardrobe lives under the same `Wardrobe/` folder name as vaults. */
export const PROJECT_WARDROBE_FOLDER = SHARED_WARDROBE_FOLDER;

/**
 * Idempotent: ensure the `Wardrobe/` folder exists in the given project mount.
 * Returns `{ folderId: null }` on failure — write paths must tolerate this.
 */
export async function ensureProjectWardrobeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  return ensureSharedWardrobeFolder(mountPointId);
}

/**
 * Read all wardrobe items from a project mount's `Wardrobe/` folder. See
 * {@link readSharedWardrobe} for the parse-time composite caveat.
 */
export async function readProjectWardrobe(
  mountPointId: string,
  includeArchived = false,
): Promise<WardrobeItem[]> {
  return readSharedWardrobe(mountPointId, includeArchived);
}
