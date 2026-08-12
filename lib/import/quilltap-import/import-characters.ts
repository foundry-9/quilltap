/**
 * Import characters and their per-character sidecars: wardrobe items (folding
 * pre-rework outfit presets into composites) and plugin data. Also migrates
 * the legacy single-`scenario` string field to the `scenarios` array shape.
 *
 * @module import/quilltap-import/import-characters
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { Character } from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { ExportedCharacter } from '@/lib/export/types';
import { type LegacyOutfitPreset, legacyPresetToComposite } from './legacy-presets';
import type { ImportOptions, IdMappingState, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Convert a legacy character with a `scenario` string field to the new `scenarios` array format.
 * Used when importing old .qtap files that predate the scenarios schema change.
 */
function migrateCharacterScenarios(character: any): any {
  // If already has scenarios array, nothing to do
  if (character.scenarios !== undefined) {
    return character;
  }
  // If has old scenario string, convert to scenarios array
  if (typeof character.scenario === 'string' && character.scenario) {
    const now = new Date().toISOString();
    return {
      ...character,
      scenarios: [{
        id: randomUUID(),
        title: 'Default',
        content: character.scenario,
        createdAt: now,
        updatedAt: now,
      }],
    };
  }
  // No scenario field at all — return with empty scenarios array
  return {
    ...character,
    scenarios: [],
  };
}

/**
 * Record which vault mount point the bundle claimed for a character we just
 * created. `characters.create()` deliberately drops the incoming pointer and
 * provisions a scaffold vault, so this is the only surviving trace of the
 * store the bundle meant — reconciliation needs it to repoint the character at
 * its imported vault and tear the scaffold down.
 *
 * Characters exported before WP A2 carry no vault, so nothing is recorded and
 * reconciliation leaves the scaffold in place.
 */
function rememberBundleVault(
  idMaps: IdMappingState,
  exported: { characterDocumentMountPointId?: string | null },
  newCharacterId: string
): void {
  if (exported.characterDocumentMountPointId) {
    idMaps.characterVaultMounts.set(newCharacterId, exported.characterDocumentMountPointId);
  }
}

export async function importCharacters(
  userId: string,
  characters: Character[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  // Pre-fetch existing characters for name-based matching (cross-instance imports)
  const existingCharacters = await repos.characters.findAll();
  const existingByName = new Map<string, Character>();
  for (const char of existingCharacters) {
    existingByName.set(char.name.toLowerCase(), char);
  }

  for (const rawCharacter of characters) {
    const character = migrateCharacterScenarios(rawCharacter);
    try {
      // Skip-if-present rehydrate (spec §6/F4): this IS the character being
      // rehydrated — its row survived the archive. Map it to itself and move
      // on. Deliberately NOT via the conflict-strategy 'skip' branch below:
      // that one adds the vault to skippedCharacterVaults, which would drop
      // the very store records this import exists to restore. Nor
      // rememberBundleVault: the character still points at its own vault, so
      // reconciliation must not repoint anything or tear down a "scaffold".
      if (options.preserveIds && idMaps.preserveIdsSkips.has(character.id)) {
        idMaps.characters.set(character.id, character.id);
        skipped++;
        continue;
      }

      // Check by ID first (same-instance re-import), then by name (cross-instance)
      let existing = await repos.characters.findById(character.id);
      let nameMatched = false;

      if (!existing) {
        const nameMatch = existingByName.get(character.name.toLowerCase());
        if (nameMatch) {
          existing = nameMatch;
          nameMatched = true;
          moduleLogger.debug('Character matched by name for cross-instance import', {
            importedId: character.id,
            existingId: nameMatch.id,
            name: character.name,
          });
        }
      }

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.characters.set(character.id, existing.id);
          // The existing character keeps its own vault untouched, so the
          // bundle's store must not be imported at all — it would land as a
          // store nothing points at.
          if (character.characterDocumentMountPointId) {
            idMaps.skippedCharacterVaults.add(character.characterDocumentMountPointId);
          }
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          // Map old import ID to the existing ID before deleting, so related
          // entities (chats, memories) get re-linked to the replacement
          idMaps.characters.set(character.id, existing.id);
          await repos.characters.delete(existing.id);
          // Remove from name map so we don't re-match
          existingByName.delete(character.name.toLowerCase());
        }

        if (options.conflictStrategy === 'duplicate') {
          const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
          // create() provisions the vault and projects every managed field
          // (identity / description / manifesto / personality / etc.) into it
          // atomically — no follow-up ensureCharacterVault call is needed.
          const newCharacter = await repos.characters.create({
            ...charData,
            name: `${charData.name} (imported)`,
          });
          idMaps.characters.set(character.id, newCharacter.id);
          rememberBundleVault(idMaps, character, newCharacter.id);

          // Import wardrobe items for duplicated character (folding any legacy
          // outfitPresets into composites for pre-rework `.qtap` exports).
          // wardrobe.create() reprojects the vault's Wardrobe/ folder after
          // each insert, so by the time this returns the vault is in sync.
          await importCharacterWardrobeItems(
            (rawCharacter as ExportedCharacter).wardrobeItems,
            (rawCharacter as ExportedCharacter & { outfitPresets?: LegacyOutfitPreset[] }).outfitPresets,
            newCharacter.id,
            warnings
          );

          // Import plugin data for duplicated character
          await importCharacterPluginData(
            (rawCharacter as ExportedCharacter).pluginData,
            newCharacter.id,
            warnings
          );

          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...charData } = character;
      const createData = options.preserveIds ? { ...charData, id: character.id } : charData;
      const createOptions = options.preserveIds ? { id: character.id } : undefined;
      // create() provisions vault + projects managed fields atomically.
      const newCharacter = options.preserveIds
        ? await repos.characters.create(createData, createOptions)
        : await repos.characters.create(createData);
      idMaps.characters.set(character.id, newCharacter.id);
      rememberBundleVault(idMaps, character, newCharacter.id);

      // Import wardrobe items for this character (folding any legacy
      // outfitPresets into composites for pre-rework `.qtap` exports).
      await importCharacterWardrobeItems(
        (rawCharacter as ExportedCharacter).wardrobeItems,
        (rawCharacter as ExportedCharacter & { outfitPresets?: LegacyOutfitPreset[] }).outfitPresets,
        newCharacter.id,
        warnings
      );

      // Import plugin data for this character
      await importCharacterPluginData(
        (rawCharacter as ExportedCharacter).pluginData,
        newCharacter.id,
        warnings
      );

      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import character "${character.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import character', {
        characterId: character.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

/**
 * Import wardrobe items for a character, assigning them to the new character ID.
 * Skips archetype items (characterId = null) since those are shared and not per-character.
 *
 * Back-compat: pre-rework `.qtap` exports may carry an `outfitPresets` array on
 * the character payload. Each legacy preset is folded into a composite
 * WardrobeItem (preserving preset.id so chat references stay valid). If the
 * import already contains wardrobe items with a non-empty `componentItemIds`,
 * we treat the export as post-rework and skip folding so we don't double-create
 * the same composite.
 */
async function importCharacterWardrobeItems(
  wardrobeItems: WardrobeItem[] | undefined,
  legacyPresets: LegacyOutfitPreset[] | undefined,
  newCharacterId: string,
  warnings: string[]
): Promise<number> {
  let combined: WardrobeItem[] = wardrobeItems ? [...wardrobeItems] : [];

  if (legacyPresets && legacyPresets.length > 0) {
    const hasComposites = combined.some(
      (item) => Array.isArray(item.componentItemIds) && item.componentItemIds.length > 0
    );
    if (hasComposites) {
      moduleLogger.debug(
        'Skipping legacy outfit-preset fold; export already contains composite wardrobe items',
        { newCharacterId, legacyPresetCount: legacyPresets.length }
      );
    } else {
      const folded = legacyPresets.map(legacyPresetToComposite);
      moduleLogger.info('Folded legacy outfit presets into composite wardrobe items on import', {
        newCharacterId,
        legacyPresetCount: legacyPresets.length,
        existingWardrobeItemCount: combined.length,
      });
      combined = [...combined, ...folded];
    }
  }

  if (combined.length === 0) return 0;

  const globalRepos = getRepositories();
  let importedCount = 0;

  for (const item of combined) {
    // Skip archetype items (characterId = null) — they are shared, not per-character
    if (!item.characterId) {
      moduleLogger.debug('Skipping archetype wardrobe item during import', {
        wardrobeItemId: item.id,
        title: item.title,
      });
      continue;
    }

    try {
      const { id: _, characterId: __, createdAt, updatedAt, migratedFromClothingRecordId, ...itemData } = item;
      await globalRepos.wardrobe.create({
        ...itemData,
        characterId: newCharacterId,
        migratedFromClothingRecordId: null,
      });
      importedCount++;

      moduleLogger.debug('Imported wardrobe item for character', {
        originalId: item.id,
        newCharacterId,
        title: item.title,
      });
    } catch (error) {
      warnings.push(
        `Failed to import wardrobe item "${item.title}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import wardrobe item', {
        wardrobeItemId: item.id,
        characterId: newCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return importedCount;
}

/**
 * Import plugin data for a character, assigning entries to the new character ID.
 */
async function importCharacterPluginData(
  pluginData: Record<string, unknown> | undefined,
  newCharacterId: string,
  warnings: string[]
): Promise<number> {
  if (!pluginData || Object.keys(pluginData).length === 0) return 0;

  const globalRepos = getRepositories();
  let importedCount = 0;

  for (const [pluginName, data] of Object.entries(pluginData)) {
    try {
      await globalRepos.characterPluginData.upsert(newCharacterId, pluginName, data);
      importedCount++;

      moduleLogger.debug('Imported plugin data for character', {
        pluginName,
        newCharacterId,
      });
    } catch (error) {
      warnings.push(
        `Failed to import plugin data for "${pluginName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import plugin data', {
        pluginName,
        characterId: newCharacterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return importedCount;
}
