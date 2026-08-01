/**
 * Wardrobe Repository
 *
 * Backend-agnostic repository for WardrobeItem entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { WardrobeItem, WardrobeItemSchema } from '@/lib/schemas/wardrobe.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { getOverlaidWardrobeItems } from './character-properties-overlay';
import {
  createVaultWardrobeItem,
  updateVaultWardrobeItem,
  deleteVaultWardrobeItem,
} from './vault-overlay/wardrobe-writes';
import { mergeWearablePool } from '@/lib/wardrobe/wearable-pool';
import { TypedQueryFilter } from '../interfaces';

/**
 * Wardrobe Repository
 * Implements CRUD operations for wardrobe items (clothing, accessories, etc.)
 * associated with characters or shared as archetypes.
 */
export class WardrobeRepository extends AbstractBaseRepository<WardrobeItem> {
  constructor() {
    super('wardrobe_items', WardrobeItemSchema);
  }

  /**
   * Find all wardrobe items belonging to a specific character. Items are
   * sourced solely from the character's vault `Wardrobe/*.md` files — there is
   * no DB mirror.
   *
   * @param characterId The character ID
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   */
  async findByCharacterId(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      () => getOverlaidWardrobeItems(characterId, { includeArchived }),
      'Error finding wardrobe items by character ID',
      { characterId, includeArchived }
    );
  }

  /**
   * Raw DB-only variant of `findByCharacterId` that bypasses the document-store
   * overlay. Retained only for the one-time vault populator
   * (`refresh-vault-wardrobe`) and the historical `cutover-characters-to-vault`
   * migration, which read DB rows to avoid the file they're about to write.
   * Both run only while the `wardrobe_items` table still exists; this method is
   * slated for removal once that table is dropped.
   */
  async findByCharacterIdRaw(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const items = await this.findByFilter({ characterId } as TypedQueryFilter<WardrobeItem>);
        if (includeArchived) {
          return items;
        }
        return items.filter((item) => !item.archivedAt);
      },
      'Error finding wardrobe items by character ID (raw)',
      { characterId, includeArchived }
    );
  }

  /**
   * Find a single wardrobe item wearable by a character. Resolves against the
   * character's own vault wardrobe first, then the shared archetype tiers
   * (Quilltap General + any project stores). Includes archived items because
   * callers in the equip path need an item's `types` even if it's been archived
   * after the chat last loaded.
   */
  async findByIdForCharacter(
    characterId: string,
    id: string,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const owned = items.find((item) => item.id === id);
        if (owned) return owned;
        const archetype = await this.findArchetypeById(id, opts);
        if (archetype) return archetype;
        return null;
      },
      'Error finding wardrobe item by character + id',
      { characterId, wardrobeItemId: id }
    );
  }

  /**
   * Find multiple wardrobe items wearable by a character. Honours the
   * document-store overlay and includes archetype items (characterId null)
   * for any IDs not found in the character's own wardrobe.
   */
  async findByIdsForCharacter(
    characterId: string,
    ids: string[],
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem[]> {
    if (ids.length === 0) return [];
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const found = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, i]));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length > 0) {
          // Shared items live in Quilltap General + any project stores; seed any
          // missing ids from the merged tier set.
          const archetypes = await this.findArchetypes(true, opts);
          for (const a of archetypes) {
            if (missing.includes(a.id)) found.set(a.id, a);
          }
        }
        return Array.from(found.values());
      },
      'Error finding wardrobe items by character + ids',
      { characterId, idCount: ids.length }
    );
  }

  /**
   * Find everything a character can actually wear: the shared tiers (Quilltap
   * General + any project stores in `opts.projectMountPointIds`) merged under
   * the character's own vault. Character items shadow shared ones on id
   * collision; archived items are dropped.
   *
   * This is the pool every "what can this character wear?" question should ask
   * — `wardrobe_list`, chat-start default resolution, the `llm_choose`
   * candidate list. Filter it (e.g. `isDefault`) *after* the merge, never
   * before: a personal `isDefault: false` item shadowing a shared default is
   * invisible to a merge done on pre-filtered lists.
   *
   * Do NOT "simplify" this to call `readCharacterVaultWardrobe` directly or to
   * flip `seedArchetypes` on the shared readers. The archetype read is a
   * *sibling* of the vault read here, not nested inside it, which is what keeps
   * the recursion guard in `lib/mount-index/general-wardrobe.ts` intact.
   *
   * The `opts` object shape is deliberate: the group tier lands later as
   * `opts.groupMountPointIds` with no call-site churn.
   */
  async findWearablePoolForCharacter(
    characterId: string,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const shared = await this.findArchetypes(false, opts);
        const own = await this.findByCharacterId(characterId);
        return mergeWearablePool(shared, own);
      },
      'Error finding wearable pool for character',
      { characterId, projectMountCount: opts?.projectMountPointIds?.length ?? 0 }
    );
  }

  /**
   * Find archetype/shared wardrobe items (characterId is null). Tri-tier: reads
   * Quilltap General plus every project store passed in `opts.projectMountPointIds`.
   * Project items override Quilltap General items on id collision (precedence
   * character > project > general; the character tier is handled by callers via
   * `findByCharacterId`).
   *
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   * @param opts.projectMountPointIds Project document stores to fold into the shared pool
   */
  async findArchetypes(
    includeArchived = false,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        // Shared archetypes live in Quilltap General/Wardrobe, optionally
        // shadowed by project stores. There is no DB tier any more — an
        // unprovisioned General simply yields no archetypes (a startup-ordering
        // issue to surface, not a row to read).
        const { readGeneralWardrobe } = await import('@/lib/mount-index/general-wardrobe');
        const general = await readGeneralWardrobe(includeArchived);

        const projectMountPointIds = opts?.projectMountPointIds ?? [];
        if (projectMountPointIds.length === 0) {
          return general;
        }

        // Merge the project tier over the general tier — project items win on
        // id collision so a project can shadow a household archetype.
        const { readProjectWardrobe } = await import('@/lib/mount-index/project-wardrobe');
        const byId = new Map<string, WardrobeItem>();
        for (const item of general) byId.set(item.id, item);
        for (const mountPointId of projectMountPointIds) {
          try {
            const projectItems = await readProjectWardrobe(mountPointId, includeArchived);
            for (const item of projectItems) byId.set(item.id, item);
          } catch (error) {
            logger.warn('Failed to read project wardrobe tier; skipping', {
              mountPointId,
              context: 'wardrobe',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return Array.from(byId.values());
      },
      'Error finding archetype wardrobe items',
      { includeArchived }
    );
  }

  /**
   * Find a single shared archetype by id. Reads Quilltap General/Wardrobe (and
   * any project stores in `opts.projectMountPointIds`); returns null if the id
   * isn't present in any tier.
   */
  async findArchetypeById(
    id: string,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const archetypes = await this.findArchetypes(true, opts);
        return archetypes.find((a) => a.id === id) ?? null;
      },
      'Error finding archetype wardrobe item by id',
      { wardrobeItemId: id }
    );
  }

  /**
   * Archive a wardrobe item (soft delete)
   * Sets archivedAt to the current timestamp.
   */
  async archive(id: string, ownerCharacterId?: string | null): Promise<WardrobeItem | null> {
    const now = this.getCurrentTimestamp();
    const item = await this.update(id, { archivedAt: now }, ownerCharacterId);
    if (item) {
      logger.info('Wardrobe item archived', { wardrobeItemId: id, archivedAt: now });
    }
    return item;
  }

  /**
   * Unarchive a wardrobe item (restore from archive)
   * Sets archivedAt to null.
   */
  async unarchive(id: string, ownerCharacterId?: string | null): Promise<WardrobeItem | null> {
    const item = await this.update(id, { archivedAt: null }, ownerCharacterId);
    if (item) {
      logger.info('Wardrobe item unarchived', { wardrobeItemId: id });
    }
    return item;
  }

  /**
   * Create a new wardrobe item
   * @param data The wardrobe item data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<WardrobeItem> {
    return this.safeQuery(
      async () => {
        const candidateId = options?.id ?? this.generateId();
        const now = this.getCurrentTimestamp();
        const newItem: WardrobeItem = {
          ...data,
          id: candidateId,
          characterId: data.characterId ?? null,
          // Apply the schema defaults for array/flag fields here at the
          // construction chokepoint so callers that hand us a partial item
          // (e.g. AI import, which omits these) never let an undefined reach the
          // vault writer's `componentItemIds.length` check.
          componentItemIds: data.componentItemIds ?? [],
          replace: data.replace ?? false,
          createdAt: options?.createdAt ?? now,
          updatedAt: options?.updatedAt ?? now,
        };

        // Vault-first: write the item straight into the owning character's
        // vault, or Quilltap General for shared archetypes (characterId null).
        // Cycle detection happens inside against the folder's current items.
        const vault = await createVaultWardrobeItem(newItem);
        if (vault.handled) {
          logger.info('Wardrobe item created in vault', {
            wardrobeItemId: newItem.id,
            characterId: newItem.characterId,
            title: newItem.title,
          });
          return vault.value;
        }

        // No vault mount resolved. Wardrobe lives exclusively in the document
        // store ("Character Vault" / Quilltap General) — there is no DB mirror,
        // and we must never write a wardrobe item as a SQL row. If we land here,
        // the General mount isn't provisioned yet — surface that rather than
        // silently creating an authoritative item the vault doesn't know about.
        logger.error('Wardrobe create has no resolvable vault mount; refusing SQL fallback', {
          wardrobeItemId: newItem.id,
          characterId: newItem.characterId,
          title: newItem.title,
        });
        throw new Error(
          'Cannot create wardrobe item: no Character Vault or Quilltap General mount is available. ' +
            'Wardrobe items are stored exclusively in the document store.',
        );
      },
      'Error creating wardrobe item',
      { characterId: data.characterId ?? null, title: data.title }
    );
  }

  /**
   * Update a wardrobe item.
   *
   * `ownerCharacterId` (the owning character, or `null` for a shared archetype)
   * locates the vault mount. Callers that know it — the wardrobe routes — should
   * pass it; without it we derive a best-effort hint from the patch or a
   * (possibly stale) DB row. Wardrobe items live solely in the vault, so an
   * unresolvable mount is an error, not a reason to fall back to a DB row.
   */
  async update(
    id: string,
    data: Partial<WardrobeItem>,
    ownerCharacterId?: string | null,
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const updateData = { ...data };

        // Remove immutable fields to prevent accidental overwrites
        delete updateData.id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        // Resolve the owning character for mount resolution. The wardrobe routes
        // pass it explicitly; otherwise we can only derive it from a characterId
        // in the patch. There is no DB row to consult — wardrobe lives in the vault.
        let hint: string | null | undefined = ownerCharacterId;
        if (hint === undefined && 'characterId' in updateData) {
          hint = updateData.characterId ?? null;
        }

        if (hint !== undefined) {
          const vault = await updateVaultWardrobeItem(id, updateData, hint);
          if (vault.handled) {
            if (vault.value) {
              logger.info('Wardrobe item updated in vault', { wardrobeItemId: id });
            }
            return vault.value;
          }
        }

        // Wardrobe items live exclusively in the document store. An unresolved
        // mount (no owner hint, or an unprovisioned store) means there is nothing
        // to update — surface it rather than writing a DB row.
        logger.error('Wardrobe update has no resolvable vault mount; refusing DB fallback', {
          wardrobeItemId: id,
        });
        throw new Error(
          'Cannot update wardrobe item: no Character Vault or Quilltap General mount is available. ' +
            'Wardrobe items are stored exclusively in the document store.',
        );
      },
      'Error updating wardrobe item',
      { wardrobeItemId: id }
    );
  }

  /**
   * Delete a wardrobe item.
   *
   * `ownerCharacterId` (or `null` for a shared archetype) locates the vault
   * mount; the wardrobe routes pass it. Wardrobe items live solely in the vault,
   * so an unresolvable mount is an error, not a reason to touch a DB row.
   */
  async delete(id: string, ownerCharacterId?: string | null): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const hint: string | null | undefined = ownerCharacterId;

        if (hint !== undefined) {
          const vault = await deleteVaultWardrobeItem(id, hint);
          if (vault.handled) {
            if (vault.value) {
              logger.info('Wardrobe item deleted from vault', { wardrobeItemId: id });
            }
            return vault.value;
          }
        }

        // Wardrobe items live exclusively in the document store. An unresolved
        // mount means there is nothing to delete — surface it rather than
        // touching a DB row.
        logger.error('Wardrobe delete has no resolvable vault mount; refusing DB fallback', {
          wardrobeItemId: id,
        });
        throw new Error(
          'Cannot delete wardrobe item: no Character Vault or Quilltap General mount is available. ' +
            'Wardrobe items are stored exclusively in the document store.',
        );
      },
      'Error deleting wardrobe item',
      { wardrobeItemId: id }
    );
  }

}
