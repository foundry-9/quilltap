/**
 * Character Vault Backfill
 *
 * On server startup, ensures every Character has a linked database-backed
 * character document store ("vault"). Delegates per-character vault
 * provisioning to `ensureCharacterVault()`; this module just iterates
 * and coordinates logging.
 *
 * Idempotent: characters already carrying characterDocumentMountPointId are
 * skipped. Per-character failures are logged and do not stop the remainder
 * of the run.
 *
 * @module startup/backfill-character-vaults
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { ensureCharacterMetadataFile } from '@/lib/mount-index/character-scaffold';
import {
  readCharacterVaultProperties,
  writeCharacterVaultManagedFields,
} from '@/lib/database/repositories/character-properties-overlay';

const logger = createServiceLogger('Startup:CharacterVaultBackfill');

export interface BackfillResult {
  scanned: number;
  vaultsCreated: number;
  alreadyLinked: number;
  /** Pre-linked vaults whose missing files we repopulated from the raw row. */
  filesRepopulated: number;
  /** Pre-existing vaults we seeded an empty `metadata.json` into. */
  metadataSeeded: number;
  errors: number;
}

export async function backfillCharacterVaults(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    vaultsCreated: 0,
    alreadyLinked: 0,
    filesRepopulated: 0,
    metadataSeeded: 0,
    errors: 0,
  };

  const repos = getRepositories();
  // Raw reads so the vault populator writes DB values to properties.json,
  // never the overlaid (vault-sourced) values it would otherwise see.
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:vault-backfill:start', {
    detail: `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`,
  });

  logger.info('Character vault backfill scanning', { total: characters.length });

  let index = 0;
  for (const character of characters) {
    if (character.archivedAt) {
      index++;
      startupProgress.setSubProgress([
        { current: index, total: characters.length, unit: 'characters' },
      ]);
      continue;
    }
    index++;
    startupProgress.setSubProgress([
      { current: index, total: characters.length, unit: 'characters' },
    ]);
    try {
      const outcome = await ensureCharacterVault(character);
      if (outcome.created) {
        result.vaultsCreated++;
      } else {
        result.alreadyLinked++;
        // ensureCharacterVault early-returns on a set FK WITHOUT verifying the
        // vault files exist. A linked-but-unpopulated vault now reads as
        // CharacterVaultUnavailableError (the overlay throws on missing
        // properties.json), so heal it here from the raw row — mirrors the
        // project/group store backfills.
        const existingProps = await readCharacterVaultProperties(outcome.mountPointId, character.id);
        if (!existingProps) {
          // Repopulate the missing content files. Wardrobe is not part of this
          // projection — it lives solely in the vault (no DB rows to source
          // from) and is reconciled by the one-time refresh-vault-wardrobe task.
          // `metadata` is in the same position and is likewise not projected
          // from a raw row; the seed below is what gives it a file.
          await writeCharacterVaultManagedFields(outcome.mountPointId, { character });
          result.filesRepopulated++;
          logger.warn('Repopulated character vault with missing files', {
            characterId: character.id,
            mountPointId: outcome.mountPointId,
          });
        }

        // Every vault provisioned before the fact sheet existed has no
        // metadata.json. Hydration copes with that perfectly well — absence
        // reads as {} — but the file manager is the only place a sheet can be
        // edited, so without a file there is nothing for the user to open and
        // the feature is unreachable on an existing roster. Seeding here rather
        // than in a one-time migration also covers vaults adopted or restored
        // later, which arrive by paths no migration would ever revisit.
        if (await ensureCharacterMetadataFile(outcome.mountPointId)) {
          result.metadataSeeded++;
        }
      }
    } catch (err) {
      result.errors++;
      logger.error('Failed to create character vault', {
        characterId: character.id,
        name: character.name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Yield to the event loop between characters so backfilling a large roster
    // doesn't hog the main thread (each character is ~20-30 sync SQLCipher writes).
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  logger.info('Character vault backfill complete', result);
  startupProgress.publish({
    rawLabel: 'subsystem:vault-backfill:complete',
    detail: `${result.vaultsCreated} created, ${result.alreadyLinked} already linked${result.filesRepopulated > 0 ? `, ${result.filesRepopulated} repopulated` : ''}${result.metadataSeeded > 0 ? `, ${result.metadataSeeded} fact sheets seeded` : ''}${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
    level: result.errors > 0 ? 'warn' : 'info',
  });
  startupProgress.setSubProgress(null);
  return result;
}
