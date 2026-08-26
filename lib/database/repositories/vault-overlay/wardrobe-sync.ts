/**
 * Wardrobe read overlay + vault projection. The vault `Wardrobe/` folder is
 * the sole source of truth for a character's wardrobe items: reads come from
 * it, and the per-write vault writers (plus the one-time startup refresh)
 * project the authoritative item list back out to `Wardrobe/*.md`. There is no
 * DB mirror any more — the `wardrobe_items` table is retired, so there is no
 * sync-back machinery promoting vault items into DB rows.
 *
 * @module database/repositories/vault-overlay/wardrobe-sync
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import {
  buildWardrobeItemFile,
  buildSlugByItemIdMap,
  sanitizeFileName,
} from '@/lib/mount-index/character-vault';

import {
  CHARACTER_WARDROBE_FOLDER,
  CHARACTER_WARDROBE_JSON_PATH,
  WARDROBE_INSTRUCTIONS_FILENAME,
} from './schema';
import { hasLinkedVault } from './parsers';
import { readCharacterVaultWardrobe } from './vault-readers';
import { projectArrayIntoVaultFolder } from './vault-projection';

export interface WardrobeOverlayOptions {
  /** Include items whose archivedAt is non-null. Default false. */
  includeArchived?: boolean;
  /** Only return items with isDefault=true. */
  defaultsOnly?: boolean;
}

/**
 * Read a character's wardrobe items from the authoritative vault `Wardrobe/`
 * folder. Every character has a linked vault after the wardrobe cutover, so a
 * missing vault (or an unreadable wardrobe folder) is a misconfiguration, not a
 * reason to read a DB row — there is no DB row. We log it and return an empty
 * list rather than throwing, so the equip/chat/UI read paths that call this
 * directly degrade gracefully instead of failing mid-request.
 *
 * Items parsed from the vault have their `characterId` coerced to the lookup
 * ID — a wardrobe file scoped to one character's vault always belongs to that
 * character, and coercing keeps downstream consumers from tripping over a
 * hand-edited characterId that doesn't match.
 */
export async function getOverlaidWardrobeItems(
  characterId: string,
  options: WardrobeOverlayOptions = {},
): Promise<WardrobeItem[]> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    logger.debug('getOverlaidWardrobeItems: character not found; returning empty wardrobe', {
      characterId,
    });
    return [];
  }
  if (!hasLinkedVault(character)) {
    logger.error(
      'getOverlaidWardrobeItems: character has no linked vault; wardrobe lives only in the vault, returning empty list',
      { characterId },
    );
    return [];
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) {
    logger.error(
      'getOverlaidWardrobeItems: character vault wardrobe is unreadable; returning empty list',
      { characterId, mountPointId },
    );
    return [];
  }

  let items: WardrobeItem[] = vault.items.map((item) => ({
    ...item,
    characterId,
  }));
  if (!options.includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }
  if (options.defaultsOnly) {
    items = items.filter((item) => item.isDefault);
  }

  return items;
}

/**
 * Project an authoritative wardrobe-item list into the vault's `Wardrobe/`
 * folder, deleting any stale legacy `wardrobe.json` so the new format is the
 * single source on disk. Composite items emit their `componentItems:` slug
 * arrays via the slug map built here. Shared between the per-write vault
 * writers (`wardrobe-writes.ts`) and the one-time startup refresh so they all
 * produce the same on-disk shape.
 *
 * The retired `Outfits/` folder is intentionally not touched — pre-rework
 * preset files left on disk are removed by a separate database-side
 * migration, not by every wardrobe write.
 */
export async function projectVaultWardrobe(
  mountPointId: string,
  characterId: string,
  items: readonly WardrobeItem[],
): Promise<void> {
  const slugByItemId = buildSlugByItemIdMap(items);

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_WARDROBE_FOLDER,
    items,
    (item) => ({
      fileName: `${sanitizeFileName(item.title)}.md`,
      content: buildWardrobeItemFile(item, slugByItemId),
    }),
    characterId,
    // The dressing-instructions file is not a garment: the sweep must never
    // delete it, and an item titled "Instructions" must land on a suffix.
    { preserveFileNames: [WARDROBE_INSTRUCTIONS_FILENAME] },
  );

  // The legacy single-JSON file is always cleaned up after a successful
  // projection so it can't drift back to authoritative-on-read.
  try {
    await deleteDatabaseDocument(mountPointId, CHARACTER_WARDROBE_JSON_PATH);
  } catch (err) {
    if (!(err instanceof DatabaseStoreError && err.code === 'NOT_FOUND')) {
      logger.warn('Failed to delete legacy wardrobe.json after folder projection', {
        characterId,
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
