/**
 * Import orchestrator: drive every entity importer in dependency order,
 * thread the shared id maps and warnings through them, run the inline
 * chat-sidecar imports (conversation annotations + Document Mode pane state),
 * and finish with a reconciliation pass.
 *
 * @module import/quilltap-import/execute
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { QuilltapExport, QuilltapExportCounts } from '@/lib/export/types';
import {
  type ImportOptions,
  type ImportResult,
  type IdMappingState,
  getExportData,
} from './types';
import {
  importConnectionProfiles,
  importImageProfiles,
  importEmbeddingProfiles,
} from './import-profiles';
import { importCharacters } from './import-characters';
import {
  importTags,
  importRoleplayTemplates,
  importProjects,
  importGroups,
  importChats,
  importMemories,
} from './import-entities';
import { importDocumentStores } from './import-document-stores';
import { importFiles } from './import-files';
import {
  importPromptTemplates,
  importProviderModels,
  importPluginConfigs,
  importInstanceSettings,
} from './import-configuration';
import { reconcileRelationships } from './reconcile';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service';
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export class PreserveIdsCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreserveIdsCollisionError';
  }
}

function getPreserveIdsCreateOptions(sourceId: string | undefined, options: ImportOptions) {
  if (!sourceId || !options.preserveIds) return undefined;
  return { id: sourceId };
}

/**
 * Pre-scan every id the bundle would claim and check it against the live
 * instance, before a single write happens.
 *
 * Two modes (spec §3 / §6, F4):
 * - `refuse-on-collision` (default): any hit throws — no partial application.
 * - `skip-if-present` (rehydrate only): a hit *inside the rehydrate target* —
 *   the target character itself, its vault mount, rows inside that vault, its
 *   own memories — is recorded in `idMaps.preserveIdsSkips` for the importers
 *   to skip. A hit anywhere else still throws, atomically.
 */
async function preflightPreserveIds(
  userId: string,
  data: ReturnType<typeof getExportData>,
  options: ImportOptions,
  repos: ReturnType<typeof getUserRepositories>,
  globalRepos: ReturnType<typeof getRepositories>,
  warnings: string[],
  idMaps: IdMappingState
): Promise<void> {
  if (!options.preserveIds) return;

  const mode = options.preserveIdsMode ?? { mode: 'refuse-on-collision' as const };
  const skipTarget = mode.mode === 'skip-if-present' ? mode : null;

  moduleLogger.debug('Running preserveIds preflight', {
    userId,
    mode: mode.mode,
    targetCharacterId: skipTarget?.targetCharacterId,
    targetVaultMountPointId: skipTarget?.targetVaultMountPointId,
  });

  /** Is this mount the rehydrate target's own vault? */
  const isTargetVault = (mountPointId: string | null | undefined): boolean =>
    skipTarget !== null &&
    skipTarget.targetVaultMountPointId !== null &&
    mountPointId === skipTarget.targetVaultMountPointId;

  /** Does this content row have a link inside the target vault? */
  const fileLinkedInTargetVault = async (fileId: string): Promise<boolean> => {
    if (!skipTarget?.targetVaultMountPointId) return false;
    const links = await globalRepos.docMountFileLinks.findByFileId(fileId);
    return links.some((link) => link.mountPointId === skipTarget.targetVaultMountPointId);
  };

  const documents = data.documents ?? [];
  const blobs = data.blobs ?? [];
  const isNonEmpty = (id: string | null | undefined): id is string => Boolean(id);
  // Hard-link groups share one content row, so the same fileId legitimately
  // appears on several document/blob records — dedupe rather than treating
  // the repeat as a duplicate claim.
  const carriedFileIds = Array.from(
    new Set([...documents.map((d) => d.fileId), ...blobs.map((b) => b.fileId)].filter(isNonEmpty))
  );
  const carriedLinkIds = [...documents.map((d) => d.linkId), ...blobs.map((b) => b.linkId)].filter(isNonEmpty);
  const carriedBlobIds = blobs.map((b) => b.blobId).filter(isNonEmpty);
  const carriedFolderIds = (data.folders ?? [])
    .map((folder: { id?: string | null }) => folder.id)
    .filter(isNonEmpty);

  const seenIds = new Map<string, string>();
  const checks: Array<{
    kind: string;
    ids: string[];
    exists: (id: string) => Promise<boolean>;
    /**
     * Skip-if-present classifier: given that `id` exists, does it live inside
     * the rehydrate target? Only consulted in skip-if-present mode; kinds
     * without one always refuse on collision.
     */
    skippable?: (id: string) => Promise<boolean>;
  }> = [
    {
      kind: 'character',
      ids: (data.characters ?? []).map((character) => character.id),
      exists: async (id) => Boolean(await repos.characters.findById(id)),
      skippable: async (id) => id === skipTarget?.targetCharacterId,
    },
    {
      kind: 'tag',
      ids: (data.tags ?? []).map((tag) => tag.id),
      exists: async (id) => Boolean(await repos.tags.findById(id)),
    },
    {
      kind: 'connection profile',
      ids: (data.connectionProfiles ?? []).map((profile) => profile.id),
      exists: async (id) => Boolean(await repos.connections.findById(id)),
    },
    {
      kind: 'image profile',
      ids: (data.imageProfiles ?? []).map((profile) => profile.id),
      exists: async (id) => Boolean(await repos.imageProfiles.findById(id)),
    },
    {
      kind: 'embedding profile',
      ids: (data.embeddingProfiles ?? []).map((profile) => profile.id),
      exists: async (id) => Boolean(await repos.embeddingProfiles.findById(id)),
    },
    {
      kind: 'roleplay template',
      ids: (data.roleplayTemplates ?? []).map((template) => template.id),
      exists: async (id) => Boolean(await globalRepos.roleplayTemplates.findById(id)),
    },
    {
      kind: 'project',
      ids: (data.projects ?? []).map((project) => project.id),
      exists: async (id) => Boolean(await repos.projects.findById(id)),
    },
    {
      kind: 'group',
      ids: (data.groups ?? []).map((group) => group.id),
      exists: async (id) => Boolean(await repos.groups.findById(id)),
    },
    {
      kind: 'chat',
      ids: (data.chats ?? []).map((chat) => chat.id),
      exists: async (id) => Boolean(await repos.chats.findById(id)),
    },
    {
      kind: 'memory',
      ids: (data.memories ?? []).map((memory) => memory.id),
      exists: async (id) => Boolean(await repos.memories.findById(id)),
      // The rehydrate target's own memories may already be back (a partial
      // restore that is being re-run); another character's memory refuses.
      skippable: async (id) => {
        const memory = await repos.memories.findById(id);
        return memory?.characterId === skipTarget?.targetCharacterId;
      },
    },
    {
      kind: 'document store',
      ids: (data.mountPoints ?? []).map((mountPoint) => mountPoint.id),
      exists: async (id) => Boolean(await globalRepos.docMountPoints.findById(id)),
      skippable: async (id) => isTargetVault(id),
    },
    {
      kind: 'file',
      ids: (data.files ?? []).map((file) => file.id),
      exists: async (id) => Boolean(await repos.files.findById(id)),
    },
    {
      kind: 'document store folder',
      ids: carriedFolderIds,
      exists: async (id) => Boolean(await globalRepos.docMountFolders.findById(id)),
      skippable: async (id) => {
        const folder = await globalRepos.docMountFolders.findById(id);
        return isTargetVault(folder?.mountPointId);
      },
    },
    {
      kind: 'document store file',
      ids: carriedFileIds,
      exists: async (id) => Boolean(await globalRepos.docMountFiles.findById(id)),
      // Content rows are content-addressed and shared; the row is "inside"
      // the target vault when any of its links lives there.
      skippable: async (id) => fileLinkedInTargetVault(id),
    },
    {
      kind: 'document store link',
      ids: carriedLinkIds,
      exists: async (id) => Boolean(await globalRepos.docMountFileLinks.findById(id)),
      skippable: async (id) => {
        const link = await globalRepos.docMountFileLinks.findById(id);
        return isTargetVault(link?.mountPointId);
      },
    },
    {
      kind: 'document store blob',
      ids: carriedBlobIds,
      exists: async (id) => Boolean(await globalRepos.docMountBlobs.findById(id)),
      skippable: async (id) => {
        const blob = await globalRepos.docMountBlobs.findById(id);
        return blob ? fileLinkedInTargetVault(blob.fileId) : false;
      },
    },
  ];

  for (const check of checks) {
    for (const id of check.ids) {
      if (!id) continue;
      if (seenIds.has(id)) {
        const existingKind = seenIds.get(id);
        const message = `Preserve IDs collision for ${check.kind} ${id} (also seen as ${existingKind})`;
        warnings.push(message);
        throw new PreserveIdsCollisionError(message);
      }
      const exists = await check.exists(id);
      if (exists) {
        if (skipTarget && check.skippable && (await check.skippable(id))) {
          idMaps.preserveIdsSkips.add(id);
          seenIds.set(id, check.kind);
          continue;
        }
        const message = `Preserve IDs collision for ${check.kind} ${id}`;
        warnings.push(message);
        throw new PreserveIdsCollisionError(message);
      }
      seenIds.set(id, check.kind);
    }
  }

  if (idMaps.preserveIdsSkips.size > 0) {
    moduleLogger.debug('Preserve IDs preflight sanctioned skip-if-present ids', {
      userId,
      skipCount: idMaps.preserveIdsSkips.size,
    });
  }
}

/**
 * Enqueue one targeted `EMBEDDING_GENERATE` per memory this import created.
 *
 * Imported memories arrive with a NULL embedding on purpose — a foreign
 * instance's vectors are meaningless here (see `importMemories`). Mirrors the
 * memory backfill sweeper (`/api/v1/memories?action=backfill-embeddings`)
 * exactly: the **system default profile**, whatever its provider, embeds
 * everything — memories, chunks, help docs — so imported rows use it too,
 * never a different or second-guessed one.
 *
 * For the BUILTIN TF-IDF default the corpus itself just grew, so a debounced
 * vocabulary refit (+ reindex) is also scheduled — the same follow-up manual
 * memory creation performs. The refit's reindex additionally heals any
 * per-row job that ran before the vocabulary was first fitted.
 *
 * Deliberately *not* one immediate `EMBEDDING_REINDEX_ALL`: that job walks
 * every character's entire memory table plus conversation chunks, help docs
 * and mount chunks — wildly disproportionate to an import of a handful of
 * rows under an API-backed profile.
 *
 * Never throws: a failure to schedule re-indexing must not fail an import
 * whose rows are already committed. The boot reconcile remains the backstop.
 */
async function enqueueImportedMemoryEmbeddings(
  userId: string,
  memoryRefs: Array<{ id: string; characterId: string }>,
  warnings: string[]
): Promise<void> {
  if (memoryRefs.length === 0) return;

  moduleLogger.debug('Resolving embedding profile for imported memories', {
    userId,
    memoryCount: memoryRefs.length,
  });

  let profile: { id: string; provider: string } | null = null;
  try {
    profile = await getDefaultEmbeddingProfile(userId);
  } catch (error) {
    moduleLogger.warn('Failed to resolve default embedding profile after import', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!profile) {
    moduleLogger.warn('Imported memories left unembedded', {
      userId,
      memoryCount: memoryRefs.length,
      reason: 'no default embedding profile is configured',
    });
    warnings.push(
      `${memoryRefs.length} memories were imported without embeddings because no default ` +
        'embedding profile is configured; they will be indexed once one is.'
    );
    return;
  }

  let enqueued = 0;
  for (const ref of memoryRefs) {
    try {
      const result = await enqueueEmbeddingGenerate(userId, {
        entityType: 'MEMORY',
        entityId: ref.id,
        characterId: ref.characterId,
        profileId: profile.id,
      });
      if (result.isNew) enqueued++;
    } catch (error) {
      moduleLogger.warn('Failed to enqueue embedding job for imported memory', {
        userId,
        memoryId: ref.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.debug('Enqueued embedding jobs for imported memories', {
    userId,
    profileId: profile.id,
    requested: memoryRefs.length,
    enqueued,
  });

  if (enqueued < memoryRefs.length) {
    warnings.push(
      `${memoryRefs.length - enqueued} of ${memoryRefs.length} imported memories could not be ` +
        'queued for embedding; the next startup sweep will pick them up.'
    );
  }

  // BUILTIN TF-IDF vocabularies are corpus-derived and the corpus just grew:
  // schedule the debounced refit-with-reindex, the same follow-up manual
  // memory creation performs. (No-op for API-backed providers.)
  if (profile.provider === 'BUILTIN') {
    try {
      await scheduleRefit(userId, profile.id);
    } catch (error) {
      moduleLogger.warn('Failed to schedule vocabulary refit after import', {
        userId,
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Executes the import of QuilltapExport data
 */
export async function executeImport(
  userId: string,
  exportData: QuilltapExport,
  options: ImportOptions
): Promise<ImportResult> {
  moduleLogger.info('Starting import execution', {
    userId,
    conflictStrategy: options.conflictStrategy,
    includeMemories: options.includeMemories,
  });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();
  const warnings: string[] = [];

  // Initialize ID mapping state
  const idMaps: IdMappingState = {
    tags: new Map(),
    characters: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
    docMountFileLinks: new Map(),
    characterVaultMounts: new Map(),
    skippedCharacterVaults: new Set(),
    preserveIdsSkips: new Set(),
  };

  // Initialize counts
  const imported: QuilltapExportCounts = {
    characters: 0,
    chats: 0,
    messages: 0,
    roleplayTemplates: 0,
    connectionProfiles: 0,
    imageProfiles: 0,
    embeddingProfiles: 0,
    tags: 0,
    memories: 0,
    projects: 0,
    groups: 0,
  };

  const skipped: QuilltapExportCounts = {
    characters: 0,
    chats: 0,
    messages: 0,
    roleplayTemplates: 0,
    connectionProfiles: 0,
    imageProfiles: 0,
    embeddingProfiles: 0,
    tags: 0,
    memories: 0,
    projects: 0,
    groups: 0,
  };

  const data = getExportData(exportData);

  try {
    await preflightPreserveIds(userId, data, options, repos, globalRepos, warnings, idMaps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    moduleLogger.warn('Preserve IDs preflight failed', { userId, error: errorMessage });
    return {
      success: false,
      imported,
      skipped,
      warnings,
      importedCharacterIds: Array.from(idMaps.characters.values()),
    };
  }

  /**
   * Memories created by this import, collected so we can enqueue targeted
   * re-embedding once the whole import has settled. Imported memories always
   * arrive with a NULL embedding (see importMemories).
   */
  let importedMemoryRefs: Array<{ id: string; characterId: string }> = [];

  try {
    // Import in dependency order
    // 1. Tags (no dependencies)
    if (data.tags && data.tags.length > 0) {
      const tagCounts = await importTags(
        userId,
        data.tags,
        options,
        idMaps,
        repos
      );
      imported.tags = tagCounts.imported;
      skipped.tags = tagCounts.skipped;
    }

    // 2. Connection Profiles
    if (data.connectionProfiles && data.connectionProfiles.length > 0) {
      const counts = await importConnectionProfiles(
        userId,
        data.connectionProfiles,
        options,
        idMaps,
        repos
      );
      imported.connectionProfiles = counts.imported;
      skipped.connectionProfiles = counts.skipped;
    }

    // 3. Image Profiles
    if (data.imageProfiles && data.imageProfiles.length > 0) {
      const counts = await importImageProfiles(
        userId,
        data.imageProfiles,
        options,
        idMaps,
        repos
      );
      imported.imageProfiles = counts.imported;
      skipped.imageProfiles = counts.skipped;
    }

    // 4. Embedding Profiles
    if (data.embeddingProfiles && data.embeddingProfiles.length > 0) {
      const counts = await importEmbeddingProfiles(
        userId,
        data.embeddingProfiles,
        options,
        idMaps,
        repos
      );
      imported.embeddingProfiles = counts.imported;
      skipped.embeddingProfiles = counts.skipped;
    }

    // 5. Roleplay Templates
    if (data.roleplayTemplates && data.roleplayTemplates.length > 0) {
      const counts = await importRoleplayTemplates(
        userId,
        data.roleplayTemplates,
        options,
        idMaps,
        globalRepos
      );
      imported.roleplayTemplates = counts.imported;
      skipped.roleplayTemplates = counts.skipped;
    }

    // 5.5. Projects (before characters since projects reference characters in roster)
    if (data.projects && data.projects.length > 0) {
      const counts = await importProjects(
        userId,
        data.projects,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.projects = counts.imported;
      skipped.projects = counts.skipped;
    }

    // 5.6. Groups (before characters since groups reference characters in membership)
    if (data.groups && data.groups.length > 0) {
      const counts = await importGroups(
        userId,
        data.groups,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.groups = counts.imported;
      skipped.groups = counts.skipped;
    }

    // 6. Characters
    if (data.characters && data.characters.length > 0) {
      const counts = await importCharacters(
        userId,
        data.characters,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.characters = counts.imported;
      skipped.characters = counts.skipped;
    }

    // 7. Chats
    if (data.chats && data.chats.length > 0) {
      const counts = await importChats(
        userId,
        data.chats,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.chats = counts.imported;
      imported.messages = counts.messages;
      skipped.chats = counts.skipped;
    }

    // 7a. Conversation annotations attached to imported chats. Remap chatId
    // through idMaps.chats; sourceMessageId stays as-is because the message
    // import preserves message IDs.
    if (data.conversationAnnotations && data.conversationAnnotations.length > 0) {
      const globalRepos = getRepositories();
      let annotationsImported = 0;
      for (const annotation of data.conversationAnnotations) {
        const remappedChatId = idMaps.chats.get(annotation.chatId) ?? annotation.chatId;
        try {
          const { id, createdAt, updatedAt, ...annotationData } = annotation;
          await globalRepos.conversationAnnotations.create({
            ...annotationData,
            chatId: remappedChatId,
          });
          annotationsImported++;
        } catch (error) {
          warnings.push(
            `Failed to import conversation annotation: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      imported.conversationAnnotations = annotationsImported;
    }

    // 7b. Chat documents (Document Mode pane state). Remap chatId; the rest
    // is opaque path/scope metadata that survives without remapping.
    if (data.chatDocuments && data.chatDocuments.length > 0) {
      const globalRepos = getRepositories();
      let chatDocsImported = 0;
      for (const cd of data.chatDocuments) {
        const remappedChatId = idMaps.chats.get(cd.chatId) ?? cd.chatId;
        try {
          const { id, createdAt, updatedAt, ...cdData } = cd;
          await globalRepos.chatDocuments.create({
            ...cdData,
            chatId: remappedChatId,
          });
          chatDocsImported++;
        } catch (error) {
          warnings.push(
            `Failed to import chat document: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      imported.chatDocuments = chatDocsImported;
    }

    // 7c. Document stores (Scriptorium) — mount point configs plus, for
    //    database-backed mounts, folder structures, document bodies and blobs.
    //
    //    Must run *before* the group↔store link step below: those links
    //    resolve through idMaps.mountPoints, which only this importer
    //    populates. It ran last for a long time, so in a mixed archive every
    //    group's linked stores were silently dropped. It still has to follow
    //    importProjects — its project links remap through idMaps.projects.
    //
    //    A characters bundle carries each character's vault here too (WP A2).
    //    Vaults belonging to characters the conflict strategy skipped are
    //    dropped: the existing character keeps the vault it already has, so
    //    importing the bundle's copy would strand an orphan store. Dropping
    //    the mount point is enough — its folders, documents and blobs resolve
    //    through `idMaps.mountPoints` and are skipped with it.
    const importableMountPoints = (data.mountPoints ?? []).filter(
      (mp) => !idMaps.skippedCharacterVaults.has(mp.id)
    );
    if (importableMountPoints.length > 0) {
      const counts = await importDocumentStores(
        importableMountPoints,
        data.folders ?? [],
        data.documents ?? [],
        data.blobs ?? [],
        data.projectLinks ?? [],
        options,
        repos,
        idMaps,
        warnings
      );
      imported.documentStores = counts.mountPoints;
      imported.documentStoreFolders = counts.folders;
      imported.documentStoreDocuments = counts.documents;
      imported.documentStoreBlobs = counts.blobs;
      imported.documentStoreProjectLinks = counts.projectLinks;
    }

    // 7d. Group character membership and linked document stores. Remap
    // group and character IDs; skip members/links that don't exist in the import.
    if (data.groups && data.groups.length > 0) {
      const groupsData = data.groups as Array<{
        id: string;
        _memberCharacterIds?: string[];
        _linkedStoreMountPointIds?: string[];
      }>;

      for (const groupExport of groupsData) {
        const remappedGroupId = idMaps.groups.get(groupExport.id) ?? groupExport.id;

        // Re-establish character membership
        if (groupExport._memberCharacterIds && groupExport._memberCharacterIds.length > 0) {
          for (const characterId of groupExport._memberCharacterIds) {
            const remappedCharacterId = idMaps.characters.get(characterId);
            if (!remappedCharacterId) {
              moduleLogger.debug('Skipping group member — character not in import', {
                groupId: groupExport.id,
                characterId,
              });
              continue;
            }
            try {
              await repos.groupCharacterMembers.addMember(remappedGroupId, remappedCharacterId);
            } catch (error) {
              moduleLogger.warn('Failed to add group member', {
                groupId: remappedGroupId,
                characterId: remappedCharacterId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        // Link additional document stores (beyond the official mount point)
        if (groupExport._linkedStoreMountPointIds && groupExport._linkedStoreMountPointIds.length > 0) {
          for (const mountPointId of groupExport._linkedStoreMountPointIds) {
            const remappedMountPointId = idMaps.mountPoints.get(mountPointId);
            if (!remappedMountPointId) {
              moduleLogger.debug('Skipping group linked store — mount point not in import', {
                groupId: groupExport.id,
                mountPointId,
              });
              continue;
            }
            try {
              await repos.groupDocMountLinks.link(remappedGroupId, remappedMountPointId);
            } catch (error) {
              moduleLogger.warn('Failed to link document store to group', {
                groupId: remappedGroupId,
                mountPointId: remappedMountPointId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    }

    // 8. Memories (if includeMemories option is enabled)
    if (options.includeMemories && data.memories && data.memories.length > 0) {
      const counts = await importMemories(
        userId,
        data.memories,
        options,
        idMaps,
        repos,
        warnings
      );
      imported.memories = counts.imported;
      skipped.memories = counts.skipped;
      importedMemoryRefs = counts.createdIds;
    }

    // 9. General file library. Runs after projects (folders and files remap
    //    projectId) and after characters/chats (linkedTo resolution).
    if (data.files && data.files.length > 0) {
      const counts = await importFiles(
        userId,
        data.files,
        (data.folders ?? []) as Parameters<typeof importFiles>[2],
        options,
        repos,
        idMaps,
        warnings
      );
      imported.files = counts.files;
      imported.folders = counts.folders;
      skipped.files = counts.skipped;
    }

    // 10. Configuration-shaped types. None of these are referenced by id, so
    //     they have no ordering constraint against the entity importers.
    if (data.promptTemplates && data.promptTemplates.length > 0) {
      const counts = await importPromptTemplates(userId, data.promptTemplates, options, warnings);
      imported.promptTemplates = counts.imported;
      skipped.promptTemplates = counts.skipped;
    }

    if (data.providerModels && data.providerModels.length > 0) {
      const counts = await importProviderModels(data.providerModels, warnings);
      imported.providerModels = counts.imported;
      skipped.providerModels = counts.skipped;
    }

    if (data.pluginConfigs && data.pluginConfigs.length > 0) {
      const counts = await importPluginConfigs(userId, data.pluginConfigs, warnings);
      imported.pluginConfigs = counts.imported;
      skipped.pluginConfigs = counts.skipped;
    }

    if (data.instanceSettings && data.instanceSettings.length > 0) {
      const counts = await importInstanceSettings(data.instanceSettings, warnings);
      imported.instanceSettings = counts.imported;
      skipped.instanceSettings = counts.skipped;
    }

    // Post-import reconciliation
    await reconcileRelationships(userId, repos, idMaps, warnings);

    // Re-embed what we just inserted. Imported memories carry no vector, and
    // without this their semantic search stays broken until the next boot's
    // reconcile sweep runs.
    await enqueueImportedMemoryEmbeddings(userId, importedMemoryRefs, warnings);

    // Destination character IDs — for the `duplicate` strategy every value is a
    // freshly created character (see import-characters). The Salon "Summon from
    // Lore" flow reads these to select the character it just summoned.
    const importedCharacterIds = Array.from(idMaps.characters.values());

    moduleLogger.info('Import execution completed successfully', {
      userId,
      imported,
      skipped,
      warningCount: warnings.length,
      importedCharacterIdCount: importedCharacterIds.length,
    });

    return {
      success: true,
      imported,
      skipped,
      warnings,
      importedCharacterIds,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    moduleLogger.error('Import execution failed', {
      userId,
      error: errorMessage,
    });

    return {
      success: false,
      imported,
      skipped,
      warnings: [
        ...warnings,
        `Import failed: ${errorMessage}`,
      ],
      importedCharacterIds: Array.from(idMaps.characters.values()),
    };
  }
}
