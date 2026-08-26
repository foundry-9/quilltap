/**
 * Import connection / image / embedding profiles. All three share the same
 * conflict-strategy shape and never restore API keys (apiKeyId is forced to
 * null on insert).
 *
 * @module import/quilltap-import/import-profiles
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import type {
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
} from '@/lib/schemas/types';
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names';
import { seedLegacyConnectionProfileFields } from '@/lib/llm/connection-profile-legacy-fields';
import type { ImportOptions, IdMappingState, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export async function importConnectionProfiles(
  userId: string,
  profiles: ConnectionProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  // Connection-profile names are unique per user (enforced by a DB index), so
  // an insert must never reuse a name already present. Seed the taken-name set
  // from existing profiles and add each freshly-inserted name as we go.
  const existingProfiles = await repos.connections.findAll();
  const takenNames = new Set(existingProfiles.map((p) => normalizeProfileName(p.name)));

  for (const rawProfile of profiles) {
    // Older exports predate some of the columns; seed them so the bundle's
    // age, not the table DEFAULT, decides what the profile comes back as.
    // Shared with backup restore so the two paths can't drift.
    const profile: ConnectionProfile = seedLegacyConnectionProfileFields(rawProfile);
    if (
      rawProfile.multiCharacterPrefill === undefined ||
      rawProfile.supportsImageUpload === undefined
    ) {
      moduleLogger.debug('Seeded connection-profile columns the bundle predates', {
        profileId: profile.id,
        provider: profile.provider,
        seededMultiCharacterPrefill: rawProfile.multiCharacterPrefill === undefined,
        seededSupportsImageUpload: rawProfile.supportsImageUpload === undefined,
      });
    }

    try {
      const existing = await repos.connections.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.connectionProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.connections.delete(profile.id);
          // The overwritten row's name is no longer taken by it.
          takenNames.delete(normalizeProfileName(existing.name));
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.connectionProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const uniqueName = makeUniqueProfileName(`${profileData.name} (imported)`, takenNames);
          if (uniqueName !== `${profileData.name} (imported)`) {
            moduleLogger.debug('Renamed connection profile on import to avoid name collision', {
              from: `${profileData.name} (imported)`,
              to: uniqueName,
            });
          }
          takenNames.add(normalizeProfileName(uniqueName));
          const createOptions = options.preserveIds ? { id: profile.id } : undefined;
          const newProfile = options.preserveIds
            ? await repos.connections.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: uniqueName,
              }, createOptions)
            : await repos.connections.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: uniqueName,
              });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const uniqueName = makeUniqueProfileName(profileData.name, takenNames);
      if (uniqueName !== profileData.name) {
        moduleLogger.debug('Renamed connection profile on import to avoid name collision', {
          from: profileData.name,
          to: uniqueName,
        });
      }
      takenNames.add(normalizeProfileName(uniqueName));
      const createOptions = options.preserveIds ? { id: profile.id } : undefined;
      const newProfile = options.preserveIds
        ? await repos.connections.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: uniqueName,
          }, createOptions)
        : await repos.connections.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: uniqueName,
          });
      idMaps.connectionProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import connection profile "${profile.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import connection profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importImageProfiles(
  userId: string,
  profiles: ImageProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.imageProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.imageProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.imageProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.imageProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const createOptions = options.preserveIds ? { id: profile.id } : undefined;
          const newProfile = options.preserveIds
            ? await repos.imageProfiles.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: `${profileData.name} (imported)`,
              }, createOptions)
            : await repos.imageProfiles.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: `${profileData.name} (imported)`,
              });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const createOptions = options.preserveIds ? { id: profile.id } : undefined;
      const newProfile = options.preserveIds
        ? await repos.imageProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
          }, createOptions)
        : await repos.imageProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
          });
      idMaps.imageProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import image profile "${profile.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import image profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importEmbeddingProfiles(
  userId: string,
  profiles: EmbeddingProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.embeddingProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.embeddingProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.embeddingProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.embeddingProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const createOptions = options.preserveIds ? { id: profile.id } : undefined;
          const newProfile = options.preserveIds
            ? await repos.embeddingProfiles.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: `${profileData.name} (imported)`,
              }, createOptions)
            : await repos.embeddingProfiles.create({
                ...profileData,
                apiKeyId: null, // Don't restore API keys
                name: `${profileData.name} (imported)`,
              });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const createOptions = options.preserveIds ? { id: profile.id } : undefined;
      const newProfile = options.preserveIds
        ? await repos.embeddingProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
          }, createOptions)
        : await repos.embeddingProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
          });
      idMaps.embeddingProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import embedding profile "${profile.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import embedding profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}
