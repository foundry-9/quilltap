/**
 * General Wardrobe — read helpers for the instance-wide `Wardrobe/` folder
 * inside the singleton "Quilltap General" mount point.
 *
 * Post-cutover, shared wardrobe archetypes (the old `characterId = null` rows)
 * live here as `Wardrobe/*.md` files rather than in the `wardrobe_items` DB
 * table. They are offered to every character as fallback components and as
 * shared items in the wardrobe UI. The mount itself is provisioned by
 * `migrations/scripts/provision-general-mount.ts`; its id is persisted in
 * `instance_settings.generalMountPointId` and read via `getGeneralMountPointId()`.
 *
 * All helpers degrade gracefully when the mount has not yet been provisioned
 * (returning empty results / null) so a freshly-cloned database doesn't 500
 * the API during the race window before startup finishes migrations.
 *
 * @module mount-index/general-wardrobe
 */

import { logger } from '@/lib/logger';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { SHARED_WARDROBE_FOLDER, readSharedWardrobe } from '@/lib/mount-index/shared-wardrobe';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Shared archetypes live under the same `Wardrobe/` folder name as character vaults. */
export const GENERAL_WARDROBE_FOLDER = SHARED_WARDROBE_FOLDER;

/**
 * Idempotent: ensure the `Wardrobe/` folder exists in the "Quilltap General"
 * mount. Returns `{ mountPointId: null, folderId: null }` when the mount has
 * not yet been provisioned — write paths must tolerate this.
 */
export async function ensureGeneralWardrobeFolder(): Promise<{
  mountPointId: string | null;
  folderId: string | null;
}> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    return { mountPointId: null, folderId: null };
  }
  try {
    const folderId = await ensureFolderPath(mountPointId, GENERAL_WARDROBE_FOLDER);
    return { mountPointId, folderId };
  } catch (error) {
    logger.warn('[GeneralWardrobe] Failed to ensure Wardrobe folder', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { mountPointId, folderId: null };
  }
}

/**
 * Read all shared/archetype wardrobe items from `Quilltap General/Wardrobe/`.
 * `characterId` is coerced to `null` (these are not owned by any character).
 * Returns `[]` when the mount is not provisioned or the folder is empty.
 *
 * Archetype seeding is disabled in the underlying reader: this folder IS the
 * archetype set, so its composites resolve their components within the same
 * folder. Seeding would recurse back through `findArchetypes`.
 */
export async function readGeneralWardrobe(includeArchived = false): Promise<WardrobeItem[]> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) return [];

  return readSharedWardrobe(mountPointId, includeArchived);
}
