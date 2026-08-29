/**
 * Post-import reconciliation: walk every imported entity and rewrite its
 * relationship FKs (tags, default profile/partner/template ids, participants,
 * project rosters, mount-point links) through the id maps now that every phase
 * has populated them.
 *
 * @module import/quilltap-import/reconcile
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  ChatMetadata,
  ChatParticipantBase,
  Project,
} from '@/lib/schemas/types';
import { deleteStoreCascade } from '@/lib/mount-index/delete-store-cascade';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Tear down the scaffold vault `characters.create()` provisioned, now that the
 * character points at the vault its bundle carried.
 *
 * Goes through `deleteStoreCascade` — the chokepoint that runs link-group
 * orphan GC — never a bare mount-point delete.
 *
 * Also hands the canonical vault name back: store names live in one
 * case-insensitive namespace, so with the scaffold holding
 * "<name> Character Vault" the imported vault was uniquified to "… (2)" on the
 * way in. With the scaffold gone the plain name is free, and a character whose
 * vault is permanently named "(2)" is a visible wart in the Scriptorium.
 */
async function discardScaffoldVault(
  scaffoldMountId: string,
  importedVaultId: string,
  characterId: string,
  warnings: string[]
): Promise<void> {
  const storeRepos = getRepositories();
  try {
    const scaffold = await storeRepos.docMountPoints.findById(scaffoldMountId);
    deleteStoreCascade(scaffoldMountId);
    moduleLogger.debug('Discarded scaffold vault in favour of the imported one', {
      characterId,
      scaffoldMountId,
      importedVaultId,
    });

    if (!scaffold) return;
    const allStores = await storeRepos.docMountPoints.findAll();
    // The scaffold itself never counts as holding the name — we just deleted
    // it, and a read served from a stale cache would otherwise block the
    // rename forever.
    const nameTaken = allStores.some(
      (mp) =>
        mp.id !== importedVaultId &&
        mp.id !== scaffoldMountId &&
        mp.name.toLowerCase() === scaffold.name.toLowerCase()
    );
    if (nameTaken) return;
    const imported = allStores.find((mp) => mp.id === importedVaultId);
    if (imported && imported.name !== scaffold.name) {
      await storeRepos.docMountPoints.update(importedVaultId, { name: scaffold.name });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to remove the placeholder vault for an imported character: ${msg}`);
    moduleLogger.warn('Failed to discard scaffold vault', {
      characterId,
      scaffoldMountId,
      error: msg,
    });
  }
}

/**
 * Updates all entity relationships with correct remapped IDs
 */
export async function reconcileRelationships(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<void> {
  moduleLogger.info('Starting post-import reconciliation', { userId });

  const remapId = (id: string | null | undefined, idMap: Map<string, string>): string | null => {
    if (!id) return null;
    return idMap.get(id) || null;
  };

  const remapIdArray = (ids: string[] | undefined, idMap: Map<string, string>): string[] => {
    if (!ids) return [];
    return ids
      .map((id) => idMap.get(id) || id)
      .filter((id) => id !== null) as string[];
  };

  // Reconcile characters
  for (const [backupId, newId] of idMaps.characters) {
    try {
      // Skip-if-present rehydrate (spec §6/F4): the surviving character was
      // never re-created — every id it references maps to itself, so there is
      // nothing to remap and no scaffold to tear down ("no reconcile pass
      // needed"). Attempting the identity patch anyway would be refused by
      // the archived-row write guard and surface as a spurious warning.
      if (backupId === newId && idMaps.preserveIdsSkips.has(newId)) continue;

      const character = await repos.characters.findById(newId);
      if (!character) continue;

      const updates: Partial<Character> = {};
      let hasUpdates = false;
      /** Scaffold vault to cascade-delete once the repoint below has landed. */
      let scaffoldMountId: string | null = null;

      // Remap tags
      if (character.tags && character.tags.length > 0) {
        const remappedTags = remapIdArray(character.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap defaultPartnerId (Characters Not Personas: default user-controlled character to pair with)
      if (character.defaultPartnerId) {
        const newPartnerId = remapId(character.defaultPartnerId, idMaps.characters);
        if (newPartnerId) {
          updates.defaultPartnerId = newPartnerId;
          hasUpdates = true;
        }
      }

      // Remap defaultConnectionProfileId
      if (character.defaultConnectionProfileId) {
        const newConnProfileId = remapId(character.defaultConnectionProfileId, idMaps.connectionProfiles);
        if (newConnProfileId) {
          updates.defaultConnectionProfileId = newConnProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultImageProfileId
      if (character.defaultImageProfileId) {
        const newImgProfileId = remapId(character.defaultImageProfileId, idMaps.imageProfiles);
        if (newImgProfileId) {
          updates.defaultImageProfileId = newImgProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultRoleplayTemplateId
      if (character.defaultRoleplayTemplateId) {
        const newTemplateId = remapId(character.defaultRoleplayTemplateId, idMaps.roleplayTemplates);
        if (newTemplateId) {
          updates.defaultRoleplayTemplateId = newTemplateId;
          hasUpdates = true;
        }
      }

      // The bundle carried this character's whole vault (WP A2), and
      // `create()` has already provisioned a scaffold vault whose fresh id is
      // what the row currently holds. Bundle wins, whole-store: repoint at the
      // imported store, then tear the scaffold down after the update lands.
      // Never merge the two.
      const bundleVaultId = idMaps.characterVaultMounts.get(newId);
      const importedVaultId = bundleVaultId ? remapId(bundleVaultId, idMaps.mountPoints) : null;
      if (importedVaultId && importedVaultId !== character.characterDocumentMountPointId) {
        scaffoldMountId = character.characterDocumentMountPointId ?? null;
        updates.characterDocumentMountPointId = importedVaultId;
        hasUpdates = true;
      } else if (character.characterDocumentMountPointId) {
        // Pre-A2 bundle (no vault records): only rewrite when the stored value
        // resolves to a remapped mount-point row. The post-create row holds a
        // freshly-allocated scaffold id we must not blow away. The earlier
        // behavior of nulling the field on a failed remap created orphaned
        // vaults: the importer would provision a vault, this pass would clear
        // the link, and the startup backfill would provision yet another one.
        const newMountId = remapId(character.characterDocumentMountPointId, idMaps.mountPoints);
        if (newMountId) {
          updates.characterDocumentMountPointId = newMountId;
          hasUpdates = true;
        }
      }

      // Remap avatar ids through the imported document-store link map. These
      // values are doc_mount_file_links.id values in the source instance's
      // vault. If the source used a legacy files.id, leave it unchanged;
      // otherwise null it with a warning so the character never keeps a
      // dangling reference after import.
      if (character.defaultImageId) {
        const remappedDefaultImageId = remapId(character.defaultImageId, idMaps.docMountFileLinks);
        if (remappedDefaultImageId) {
          updates.defaultImageId = remappedDefaultImageId;
          hasUpdates = true;
        } else if (!(await repos.files.findById(character.defaultImageId))) {
          warnings.push(
            `Character "${character.name}" defaultImageId could not be remapped and was cleared: ${character.defaultImageId}`
          );
          updates.defaultImageId = null;
          hasUpdates = true;
        }
      }

      if (character.avatarOverrides && character.avatarOverrides.length > 0) {
        let overridesChanged = false;
        const remapped = await Promise.all(
          character.avatarOverrides.map(async (override) => {
            const remappedImageId = remapId(override.imageId, idMaps.docMountFileLinks);
            if (remappedImageId) {
              overridesChanged = true;
              return { ...override, imageId: remappedImageId };
            }
            if (await repos.files.findById(override.imageId)) {
              return override;
            }
            warnings.push(
              `Character "${character.name}" avatar override could not be remapped and was dropped: ${override.imageId}`
            );
            // Drop the entry rather than nulling its imageId: the schema
            // requires a string there, so a null would fail the next
            // validated read of the character.
            overridesChanged = true;
            return null;
          })
        );
        // Only touch the field when something actually moved — an unconditional
        // write forces a pointless update (and a vault round-trip) on every
        // character that merely happens to own overrides.
        if (overridesChanged) {
          updates.avatarOverrides = remapped.filter(
            (override): override is NonNullable<typeof override> => override !== null
          ) as Character['avatarOverrides'];
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
      }

      // Only now that the character points at its imported vault is the
      // scaffold safe to remove: reversing the order would leave a window
      // where the row references a store that no longer exists, and any
      // overlay read in it throws CharacterVaultUnavailableError.
      if (scaffoldMountId && importedVaultId) {
        await discardScaffoldVault(scaffoldMountId, importedVaultId, newId, warnings);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile character relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile character', {
        characterId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile chats
  for (const [backupId, newId] of idMaps.chats) {
    try {
      const chat = await repos.chats.findById(newId);
      if (!chat) continue;

      const updates: Partial<ChatMetadata> = {};
      let hasUpdates = false;

      // Remap participants
      if (chat.participants && chat.participants.length > 0) {
        updates.participants = chat.participants
          .map((participant) => {
            const remapped: ChatParticipantBase = { ...participant };

            if (participant.characterId) {
              const newCharId = remapId(participant.characterId, idMaps.characters);
              if (newCharId) remapped.characterId = newCharId;
            }

            if (participant.connectionProfileId) {
              const newConnId = remapId(
                participant.connectionProfileId,
                idMaps.connectionProfiles
              );
              if (newConnId) remapped.connectionProfileId = newConnId;
            }

            if (participant.imageProfileId) {
              const newImgProfId = remapId(
                participant.imageProfileId,
                idMaps.imageProfiles
              );
              if (newImgProfId) remapped.imageProfileId = newImgProfId;
            }

            // Remap roleplayTemplateId
            if (participant.roleplayTemplateId) {
              const newTemplateId = remapId(
                participant.roleplayTemplateId,
                idMaps.roleplayTemplates
              );
              if (newTemplateId) remapped.roleplayTemplateId = newTemplateId;
            }

            return remapped;
          });
        hasUpdates = true;
      }

      // Remap tags
      if (chat.tags && chat.tags.length > 0) {
        const remappedTags = remapIdArray(chat.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap projectId
      if (chat.projectId) {
        const newProjectId = remapId(chat.projectId, idMaps.projects);
        if (newProjectId) {
          updates.projectId = newProjectId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.chats.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile chat relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile chat', {
        chatId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile projects
  for (const [backupId, newId] of idMaps.projects) {
    try {
      const project = await repos.projects.findById(newId);
      if (!project) continue;

      const updates: Partial<Project> = {};
      let hasUpdates = false;

      // Remap characterRoster
      if (project.characterRoster && project.characterRoster.length > 0) {
        const remappedRoster = remapIdArray(project.characterRoster, idMaps.characters);
        if (remappedRoster.length > 0) {
          updates.characterRoster = remappedRoster;
          hasUpdates = true;
        }
      }

      // Remap defaultImageProfileId
      if (project.defaultImageProfileId) {
        const newImgProfileId = remapId(project.defaultImageProfileId, idMaps.imageProfiles);
        if (newImgProfileId) {
          updates.defaultImageProfileId = newImgProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultRoleplayTemplateId (custom templates get fresh ids on import)
      if (project.defaultRoleplayTemplateId) {
        const newTemplateId = remapId(project.defaultRoleplayTemplateId, idMaps.roleplayTemplates);
        if (newTemplateId) {
          updates.defaultRoleplayTemplateId = newTemplateId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.projects.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile project relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile project', {
        projectId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile connection profiles (tags)
  for (const [backupId, newId] of idMaps.connectionProfiles) {
    try {
      const profile = await repos.connections.findById(newId);
      if (!profile) continue;

      const updates: Record<string, unknown> = {};

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
        }
      }

      // Remap fallbackProfileId (the understudy). This has to happen in the
      // reconcile pass rather than at insert time: a profile may name an
      // understudy that appears *later* in the bundle, so the map is only
      // complete once every profile has landed. A reference the map cannot
      // resolve is left alone — buildFallbackChain() drops a target that
      // isn't there, and clearing it would throw away a chain that a
      // preserve-ids import got right.
      if (profile.fallbackProfileId) {
        const newFallbackId = remapId(profile.fallbackProfileId, idMaps.connectionProfiles);
        if (newFallbackId && newFallbackId !== profile.fallbackProfileId) {
          updates.fallbackProfileId = newFallbackId;
        }
      }

      if (Object.keys(updates).length > 0) {
        await repos.connections.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile connection profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile connection profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile image profiles (tags)
  for (const [backupId, newId] of idMaps.imageProfiles) {
    try {
      const profile = await repos.imageProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.imageProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile image profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile image profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile embedding profiles (tags)
  for (const [backupId, newId] of idMaps.embeddingProfiles) {
    try {
      const profile = await repos.embeddingProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.embeddingProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile embedding profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile embedding profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile roleplay templates (tags)
  const globalRepos = getRepositories();
  for (const [backupId, newId] of idMaps.roleplayTemplates) {
    try {
      const template = await globalRepos.roleplayTemplates.findById(newId);
      if (!template) continue;

      if (template.tags && template.tags.length > 0) {
        const remappedTags = remapIdArray(template.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await globalRepos.roleplayTemplates.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile roleplay template relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile roleplay template', {
        templateId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.info('Post-import reconciliation completed');
}
