/**
 * Project Wardrobe — read/ensure helpers for a project document store's
 * `Wardrobe/` folder.
 *
 * Mirrors `general-wardrobe.ts` but scoped to an explicit project mount point,
 * so wardrobe is tri-tier (character vault + project stores + Quilltap General)
 * the same way knowledge and scenarios already are. Project wardrobe items are
 * shared within the project — `characterId` is coerced to `null` like shared
 * archetypes — but they live in the project's mount rather than Quilltap
 * General.
 *
 * The underlying reader (`readCharacterVaultWardrobe`) is already generic over
 * any mount point, so no new parsing is introduced here.
 *
 * @module mount-index/project-wardrobe
 */

import { logger } from '@/lib/logger';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { readCharacterVaultWardrobe } from '@/lib/database/repositories/vault-overlay/vault-readers';
import { CHARACTER_WARDROBE_FOLDER } from '@/lib/database/repositories/vault-overlay/schema';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Project wardrobe lives under the same `Wardrobe/` folder name as vaults. */
export const PROJECT_WARDROBE_FOLDER = CHARACTER_WARDROBE_FOLDER;

/**
 * Idempotent: ensure the `Wardrobe/` folder exists in the given project mount.
 * Returns `{ folderId: null }` on failure — write paths must tolerate this.
 */
export async function ensureProjectWardrobeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  try {
    const folderId = await ensureFolderPath(mountPointId, PROJECT_WARDROBE_FOLDER);
    return { folderId };
  } catch (error) {
    logger.warn('[ProjectWardrobe] Failed to ensure Wardrobe folder', {
      mountPointId,
      context: 'wardrobe',
      error: error instanceof Error ? error.message : String(error),
    });
    return { folderId: null };
  }
}

/**
 * Read all wardrobe items from a project mount's `Wardrobe/` folder.
 * `characterId` is coerced to `null` (project items are shared, not owned by a
 * character). Returns `[]` when the folder is empty or unreadable.
 *
 * Archetype seeding is disabled in the underlying reader: a project composite
 * resolves its components within this same folder, not by recursing through
 * `findArchetypes` (which would loop back here).
 *
 * Consequence, and a known gap: a project composite whose components live in
 * *Quilltap General* loses those refs at parse time — `resolveAndCheckComponentItems`
 * only sees this folder's items. Same-tier composites (the common case) are
 * fine. Read-time hydration in `lib/wardrobe/resolve-equipped.ts` recovers the
 * equipped case; the parse-time gap is tracked separately.
 */
export async function readProjectWardrobe(
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
