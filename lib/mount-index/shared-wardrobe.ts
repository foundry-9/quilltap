/**
 * Shared Wardrobe — read/ensure helpers for the `Wardrobe/` folder of an
 * arbitrary mount point.
 *
 * Every shared wardrobe tier is the same thing wearing a different hat: a
 * `Wardrobe/` folder in some mount, holding items nobody owns
 * (`characterId: null`). Quilltap General is the instance-wide one, a project
 * store is the project-wide one, a group's official store is the group-wide
 * one. This module is that one shape; `general-wardrobe.ts`,
 * `project-wardrobe.ts` and `group-wardrobe.ts` are thin scoped façades over it.
 *
 * The underlying reader (`readCharacterVaultWardrobe`) is already generic over
 * any mount point, so no new parsing is introduced here.
 *
 * @module mount-index/shared-wardrobe
 */

import { logger } from '@/lib/logger';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { readCharacterVaultWardrobe } from '@/lib/database/repositories/vault-overlay/vault-readers';
import { CHARACTER_WARDROBE_FOLDER } from '@/lib/database/repositories/vault-overlay/schema';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Shared wardrobe lives under the same `Wardrobe/` folder name as character vaults. */
export const SHARED_WARDROBE_FOLDER = CHARACTER_WARDROBE_FOLDER;

/**
 * Idempotent: ensure the `Wardrobe/` folder exists in the given mount.
 * Returns `{ folderId: null }` on failure — write paths must tolerate this.
 */
export async function ensureSharedWardrobeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  try {
    const folderId = await ensureFolderPath(mountPointId, SHARED_WARDROBE_FOLDER);
    return { folderId };
  } catch (error) {
    logger.warn('[SharedWardrobe] Failed to ensure Wardrobe folder', {
      mountPointId,
      context: 'wardrobe',
      error: error instanceof Error ? error.message : String(error),
    });
    return { folderId: null };
  }
}

/**
 * Read all wardrobe items from a mount's `Wardrobe/` folder. `characterId` is
 * coerced to `null` (shared items are not owned by a character). Returns `[]`
 * when the folder is empty or unreadable.
 *
 * Archetype seeding is disabled in the underlying reader: a shared composite
 * resolves its components within this same folder, not by recursing through
 * `findArchetypes` (which would loop back here).
 *
 * Consequence, and a known gap: a shared composite whose components live in a
 * *different* tier loses those refs at parse time — `resolveAndCheckComponentItems`
 * only sees this folder's items. Same-tier composites (the common case) are
 * fine. Read-time hydration in `lib/wardrobe/resolve-equipped.ts` recovers the
 * equipped case; the parse-time gap is tracked separately.
 */
export async function readSharedWardrobe(
  mountPointId: string,
  includeArchived = false,
): Promise<WardrobeItem[]> {
  const vault = await readCharacterVaultWardrobe(mountPointId, undefined, {
    seedArchetypes: false,
  });
  if (!vault) return [];

  let items: WardrobeItem[] = vault.items.map((item) => ({ ...item, characterId: null }));
  if (!includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }
  return items;
}
