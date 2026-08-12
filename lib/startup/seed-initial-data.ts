/**
 * Initial Data Seeding Service
 *
 * Seeds default data on first application startup when the database
 * is empty. Seeds default character(s) and a TF-IDF embedding profile
 * to provide immediate functionality for new users without requiring
 * any API keys.
 *
 * @module lib/startup/seed-initial-data
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import { SINGLE_USER_ID } from '@/lib/auth/single-user';
import {
  getSeedCharacters,
  prepareSeedCharacter,
  getSeedEmbeddingProfiles,
  prepareSeedEmbeddingProfile,
  getSeedImports,
  getSeedAvatars,
} from '@/first-startup';
import { executeImport } from '@/lib/import/quilltap-import-service';
import {
  getCharacterVaultStore,
  writeCharacterAvatarToVault,
} from '@/lib/file-storage/character-vault-bridge';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';

/**
 * Seed initial data if the database is empty
 *
 * This function checks if any characters exist for the default user.
 * If no characters exist, it seeds the default character(s) to provide
 * immediate functionality for new users.
 *
 * This function is designed to be safe to call multiple times - it only
 * seeds data when the database is truly empty.
 *
 * @returns Promise<void>
 */
export async function seedInitialData(): Promise<void> {
  const context = 'seed-initial-data';

  try {
    const repos = getRepositories();

    // Built-in roleplay templates: idempotent insert-or-update. Runs on every
    // startup (not gated by the first-startup check below) so changes to the
    // BUILT_IN_TEMPLATES table in roleplay-templates.repository.ts propagate
    // into the database. Must run on the parent — the read-path lazy-seed
    // that used to live in findById/findAll/findBuiltIn/findAllForUser was
    // removed because it tried to write through a readonly DB connection
    // when those reads happened inside a forked job-runner child.
    try {
      await repos.roleplayTemplates.seedBuiltInTemplates();
    } catch (templateError) {
      logger.error('Failed to seed built-in roleplay templates', {
        context,
        error: templateError instanceof Error ? templateError.message : String(templateError),
      });
    }

    // Is this actually a first startup? Probe with countOrThrow, never with a
    // find: the find* family returns [] on *any* failure, so a database that
    // is merely unreachable (another instance holding the instance lock, a
    // half-materialised iCloud file) reads as "no characters" and sends a
    // fully-populated instance down the seeding path. Seeding must fail
    // closed — an unanswerable question is not a yes.
    let existingCharacterCount: number;
    try {
      existingCharacterCount = await repos.characters.countOrThrow({ userId: SINGLE_USER_ID });
    } catch (probeError) {
      logger.error('Skipping initial-data seeding — could not determine whether the database is empty', {
        context,
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
      return;
    }

    if (existingCharacterCount > 0) {
      // Database already has characters, no need to seed
      return;
    }

    logger.info('Seeding initial data for first startup', { context });

    // Get seed characters from JSON files (if any)
    const seedCharacters = getSeedCharacters();

    if (seedCharacters.length > 0) {
      // Create each seed character
      for (const seedData of seedCharacters) {
        try {
          const characterData = prepareSeedCharacter(seedData, SINGLE_USER_ID);
          const created = await repos.characters.create(characterData);

          logger.info('Seeded initial character', {
            context,
            characterId: created.id,
            characterName: created.name,
          });
        } catch (charError) {
          logger.error('Failed to seed character', {
            context,
            characterName: seedData.name,
            error: charError instanceof Error ? charError.message : String(charError),
          });
          // Continue with other characters even if one fails
        }
      }

      logger.info('Character seeding complete', {
        context,
        seededCount: seedCharacters.length,
      });
    }

    // Seed embedding profiles if none exist
    await seedEmbeddingProfiles(repos, context);

    // Seed from .qtap import files (characters with memories, etc.)
    await seedFromImports(context);

    // Seed avatar images for imported characters
    await seedAvatars(repos, context);

    logger.info('Initial data seeding complete', { context });
  } catch (error) {
    logger.error('Error during initial data seeding', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - seeding failure should not prevent startup
  }
}

/**
 * Seed default embedding profile if none exist
 *
 * Creates a default TF-IDF embedding profile to enable semantic search
 * without requiring any API keys. This provides immediate functionality
 * for memory search and retrieval.
 */
async function seedEmbeddingProfiles(
  repos: ReturnType<typeof getRepositories>,
  context: string
): Promise<void> {
  try {
    // Same fail-closed probe as the character check above — a failed read must
    // not read as "no profiles exist" and mint a duplicate default.
    let existingProfileCount: number;
    try {
      existingProfileCount = await repos.embeddingProfiles.countOrThrow();
    } catch (probeError) {
      logger.error('Skipping embedding-profile seeding — could not determine whether any profiles exist', {
        context,
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
      return;
    }

    if (existingProfileCount > 0) {
      // Embedding profiles already exist, no need to seed
      return;
    }

    // Get seed embedding profiles
    const seedProfiles = getSeedEmbeddingProfiles();

    if (seedProfiles.length === 0) {
      logger.warn('No seed embedding profiles defined', { context });
      return;
    }

    logger.info('Seeding default embedding profile', {
      context,
      profileCount: seedProfiles.length,
    });

    // Create each seed embedding profile
    for (const seedData of seedProfiles) {
      try {
        const profileData = prepareSeedEmbeddingProfile(seedData, SINGLE_USER_ID);
        const created = await repos.embeddingProfiles.create(profileData);

        logger.info('Seeded embedding profile', {
          context,
          profileId: created.id,
          profileName: created.name,
          provider: created.provider,
          isDefault: created.isDefault,
        });
      } catch (profileError) {
        logger.error('Failed to seed embedding profile', {
          context,
          profileName: seedData.name,
          error: profileError instanceof Error ? profileError.message : String(profileError),
        });
        // Continue with other profiles even if one fails
      }
    }
  } catch (error) {
    logger.error('Error seeding embedding profiles', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is non-critical
  }
}

/**
 * Seed data from .qtap import files
 *
 * Loads .qtap files from first-startup/imports/ and runs them through
 * the standard import service with 'skip' conflict strategy. This allows
 * seeding characters with their memories and other related data in a
 * single bundle. The skip strategy ensures no duplicates on repeated runs.
 */
async function seedFromImports(context: string): Promise<void> {
  try {
    const seedImports = getSeedImports();

    if (seedImports.length === 0) {
      return;
    }

    logger.info('Seeding from .qtap import files', {
      context,
      fileCount: seedImports.length,
    });

    for (const { filename, data } of seedImports) {
      try {
        const result = await executeImport(SINGLE_USER_ID, data, {
          conflictStrategy: 'skip',
          includeMemories: true,
          includeRelatedEntities: false,
        });

        logger.info('Seed import complete', {
          context,
          filename,
          success: result.success,
          imported: result.imported,
          skipped: result.skipped,
          warnings: result.warnings.length > 0 ? result.warnings : undefined,
        });
      } catch (importError) {
        logger.error('Failed to execute seed import', {
          context,
          filename,
          error: importError instanceof Error ? importError.message : String(importError),
        });
        // Continue with other import files
      }
    }
  } catch (error) {
    logger.error('Error during seed imports', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - seed import failure should not prevent startup
  }
}

/**
 * Seed avatar images for imported characters
 *
 * Loads avatar image files from first-startup/avatars/ and associates them
 * with characters by name. Creates file entries in the database, uploads
 * files to storage, and sets defaultImageId on the matching characters.
 *
 * Skips characters that already have a defaultImageId set with a valid
 * file entry, ensuring idempotent behavior on repeated runs.
 */
async function seedAvatars(
  repos: ReturnType<typeof getRepositories>,
  context: string,
  targetCharacterNames?: string[]
): Promise<void> {
  try {
    const normalizedTargetNames = targetCharacterNames?.map(name => name.toLowerCase());
    const seedAvatarData = getSeedAvatars().filter(avatar => {
      if (!normalizedTargetNames || normalizedTargetNames.length === 0) {
        return true;
      }

      return normalizedTargetNames.includes(avatar.characterName.toLowerCase());
    });

    if (seedAvatarData.length === 0) {
      return;
    }

    logger.info('Seeding avatar images for characters', {
      context,
      avatarCount: seedAvatarData.length,
      characters: seedAvatarData.map(a => a.characterName),
    });

    // Get all characters for the default user to match by name
    const allCharacters = await repos.characters.findByUserId(SINGLE_USER_ID);

    for (const avatar of seedAvatarData) {
      try {
        // Find the character by name (case-insensitive match)
        const character = allCharacters.find(
          c => c.name.toLowerCase() === avatar.characterName.toLowerCase()
        );

        if (!character) {
          logger.warn('No matching character found for seed avatar', {
            context,
            characterName: avatar.characterName,
          });
          continue;
        }

        // Skip if the character already has a valid avatar. Post-Phase-3 the
        // id is a doc_mount_file_links id; the resolver also covers legacy
        // pre-migration files.id values.
        if (character.defaultImageId) {
          const resolved = await resolveCharacterAvatar(character.defaultImageId, repos);
          if (resolved) {
            continue;
          }
        }

        // Defensive vault check. repos.characters.create() now provisions the
        // vault inline, but this avatar-reseed path also runs against older
        // characters (e.g. ones predating the inline provisioning) — keep
        // ensureCharacterVault here as a recovery for those. Idempotent for
        // characters that already have a vault. Re-fetch first so we see
        // vaults provisioned by an upstream step like seedFromImports.
        const freshCharacter = await repos.characters.findById(character.id) ?? character;
        await ensureCharacterVault(freshCharacter);
        const vault = await getCharacterVaultStore(character.id);
        if (!vault) {
          throw new Error(
            `Failed to resolve vault for seed character ${character.id} (${character.name}) after provisioning.`,
          );
        }
        const written = await writeCharacterAvatarToVault({
          characterId: character.id,
          kind: 'main',
          filename: avatar.filename,
          content: avatar.content,
          contentType: avatar.mimeType,
        });

        // Post-Phase-3: defaultImageId is a doc_mount_file_links id pointing
        // at the avatar in the character's vault. No legacy `files` row.
        await repos.characters.update(character.id, {
          defaultImageId: written.linkId,
        });

        logger.info('Seeded avatar for character', {
          context,
          characterName: character.name,
          characterId: character.id,
          linkId: written.linkId,
          storageKey: written.storageKey,
          size: avatar.content.length,
        });
      } catch (avatarError) {
        logger.error('Failed to seed avatar for character', {
          context,
          characterName: avatar.characterName,
          error: avatarError instanceof Error ? avatarError.message : String(avatarError),
        });
        // Continue with other avatars
      }
    }
  } catch (error) {
    logger.error('Error during avatar seeding', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - avatar seeding failure should not prevent startup
  }
}

export async function reseedAvatarsForCharacters(
  characterNames: string[],
  context = 'reseed-avatars'
): Promise<void> {
  const repos = getRepositories();
  await seedAvatars(repos, context, characterNames);
}
