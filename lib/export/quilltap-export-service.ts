/**
 * Quilltap Export Service
 *
 * Preview helpers for the `.qtap` export feature. The live export itself is
 * streamed by `lib/export/ndjson-writer.ts`; this file only powers the
 * pre-export preview (entity names + optional memory counts) shown in the UI
 * before an export runs.
 */

import { logger as baseLogger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { ExportOptions, ExportPreview } from './types';
import type { Memory } from '@/lib/schemas/types';
import { listPortableInstanceSettings } from '@/lib/instance-settings';

const logger = baseLogger.child({ module: 'export:quilltap-export-service' });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Collect all memories for a character
 */
async function collectCharacterMemories(
  repos: ReturnType<typeof getUserRepositories>,
  characterId: string
): Promise<Memory[]> {
  try {
    return await repos.memories.findByCharacterId(characterId);
  } catch (error) {
    return [];
  }
}

/**
 * Collect all memories for a chat
 */
async function collectChatMemories(
  repos: ReturnType<typeof getUserRepositories>,
  chatId: string
): Promise<Memory[]> {
  try {
    // Get all characters and collect their memories filtered by chatId
    const characters = await repos.characters.findAll();
    const memoriesArrays = await Promise.all(
      characters.map(char => repos.memories.findByCharacterId(char.id))
    );
    const allMemories = memoriesArrays.flat();
    return allMemories.filter(m => m.chatId === chatId);
  } catch (error) {
    return [];
  }
}

/**
 * Summarize the character vaults a `characters` export will carry (WP A2), so
 * the wizard can warn that a bundle with photos in it is not a small file.
 *
 * Best-effort by design: a store that fails to read is left out of the totals
 * rather than failing the preview — this only ever feeds a UI hint.
 */
async function summarizeCharacterVaults(
  mountPointIds: string[]
): Promise<ExportPreview['vaults']> {
  const summary = { stores: 0, documents: 0, blobs: 0, estimatedBytes: 0 };
  if (mountPointIds.length === 0) return summary;

  const globalRepos = getRepositories();
  for (const mountPointId of mountPointIds) {
    try {
      summary.stores++;

      const documents = await globalRepos.docMountDocuments.findByMountPointId(mountPointId);
      summary.documents += documents.length;
      for (const doc of documents) {
        summary.estimatedBytes += doc.plainTextLength ?? doc.content?.length ?? 0;
      }

      const blobs = await globalRepos.docMountBlobs.listByMountPoint(mountPointId);
      summary.blobs += blobs.length;
      for (const blob of blobs) {
        // Blob bytes travel base64-encoded, which costs a third more.
        summary.estimatedBytes += Math.ceil((blob.sizeBytes ?? 0) * (4 / 3));
      }
    } catch (error) {
      logger.warn('Failed to summarize a character vault for export preview', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

// ============================================================================
// PUBLIC API FUNCTIONS
// ============================================================================

/**
 * Preview what will be exported before creation
 * Returns entity names and counts for UI display
 */
export async function previewExport(
  userId: string,
  options: ExportOptions
): Promise<ExportPreview> {
  try {
    const repos = getUserRepositories(userId);
    const entities: Array<{ id: string; name: string }> = [];
    let memoryCount = 0;
    let vaults: ExportPreview['vaults'];

    const entityIds = options.scope === 'all' ? [] : (options.selectedIds ?? []);

    switch (options.type) {
      case 'characters': {
        const allCharacters = options.scope === 'all'
          ? await repos.characters.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allCharacters.map(c => c.id)
          : entityIds;

        const vaultMountIds: string[] = [];
        for (const id of ids) {
          const char = await repos.characters.findById(id);
          if (char) {
            entities.push({ id: char.id, name: char.name });
            if (char.characterDocumentMountPointId) {
              vaultMountIds.push(char.characterDocumentMountPointId);
            }
            if (options.includeMemories) {
              const memories = await collectCharacterMemories(repos, id);
              memoryCount += memories.length;
            }
          }
        }
        vaults = await summarizeCharacterVaults(vaultMountIds);
        break;
      }

      case 'chats': {
        const allChats = options.scope === 'all'
          ? await repos.chats.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allChats.map(c => c.id)
          : entityIds;

        for (const id of ids) {
          const chat = await repos.chats.findById(id);
          if (chat) {
            entities.push({ id: chat.id, name: chat.title });
            if (options.includeMemories) {
              const memories = await collectChatMemories(repos, id);
              memoryCount += memories.length;
            }
          }
        }
        break;
      }

      case 'roleplay-templates': {
        const globalRepos = getRepositories();
        const allTemplates = options.scope === 'all'
          ? await globalRepos.roleplayTemplates.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTemplates
              .filter(t => !t.isBuiltIn && t.userId === userId)
              .map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const template = await globalRepos.roleplayTemplates.findById(id);
          if (template && !template.isBuiltIn && template.userId === userId) {
            entities.push({ id: template.id, name: template.name });
          }
        }
        break;
      }

      case 'connection-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.connections.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.connections.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'image-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.imageProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.imageProfiles.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'embedding-profiles': {
        const allProfiles = options.scope === 'all'
          ? await repos.embeddingProfiles.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProfiles.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const profile = await repos.embeddingProfiles.findById(id);
          if (profile) {
            entities.push({ id: profile.id, name: profile.name });
          }
        }
        break;
      }

      case 'tags': {
        const allTags = options.scope === 'all'
          ? await repos.tags.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTags.map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const tag = await repos.tags.findById(id);
          if (tag) {
            entities.push({ id: tag.id, name: tag.name });
          }
        }
        break;
      }

      case 'projects': {
        const allProjects = options.scope === 'all'
          ? await repos.projects.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allProjects.map(p => p.id)
          : entityIds;

        for (const id of ids) {
          const project = await repos.projects.findById(id);
          if (project) {
            entities.push({ id: project.id, name: project.name });
          }
        }
        break;
      }

      case 'groups': {
        const allGroups = options.scope === 'all'
          ? await repos.groups.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allGroups.map(g => g.id)
          : entityIds;

        for (const id of ids) {
          const group = await repos.groups.findById(id);
          if (group) {
            entities.push({ id: group.id, name: group.name });
          }
        }
        break;
      }

      case 'document-stores': {
        const globalReposDS = getRepositories();
        const allStores = options.scope === 'all'
          ? await globalReposDS.docMountPoints.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allStores.map(s => s.id)
          : entityIds;
        for (const id of ids) {
          const store = await globalReposDS.docMountPoints.findById(id);
          if (store) {
            entities.push({ id: store.id, name: store.name });
          }
        }
        break;
      }

      case 'files': {
        const allFiles = options.scope === 'all'
          ? (await repos.files.findAll()).filter(
              (f) => f.category !== 'BACKUP' && f.folderPath !== '/backups'
            )
          : [];
        const ids = options.scope === 'all'
          ? allFiles.map(f => f.id)
          : entityIds;

        for (const id of ids) {
          const file = await repos.files.findById(id);
          if (file) {
            entities.push({ id: file.id, name: file.originalFilename });
          }
        }
        break;
      }

      case 'prompt-templates': {
        const globalReposPT = getRepositories();
        const allTemplates = options.scope === 'all'
          ? await globalReposPT.promptTemplates.findAll()
          : [];
        const ids = options.scope === 'all'
          ? allTemplates
              .filter(t => !t.isBuiltIn && t.userId === userId)
              .map(t => t.id)
          : entityIds;

        for (const id of ids) {
          const template = await globalReposPT.promptTemplates.findById(id);
          if (template && !template.isBuiltIn && template.userId === userId) {
            entities.push({ id: template.id, name: template.name });
          }
        }
        break;
      }

      case 'provider-models': {
        // Instance-global catalogue, no user filter.
        const globalReposPM = getRepositories();
        const allModels = await globalReposPM.providerModels.findAll();
        const wanted = options.scope === 'all' ? null : new Set(entityIds);
        for (const model of allModels) {
          if (wanted && !wanted.has(model.id)) continue;
          entities.push({ id: model.id, name: `${model.provider} / ${model.modelId}` });
        }
        break;
      }

      case 'plugin-configs': {
        const globalReposPC = getRepositories();
        const configs = await globalReposPC.pluginConfigs.findByUserId(userId);
        const wanted = options.scope === 'all' ? null : new Set(entityIds);
        for (const config of configs) {
          if (wanted && !wanted.has(config.id)) continue;
          entities.push({ id: config.id, name: config.pluginName });
        }
        break;
      }

      case 'instance-settings': {
        // Keyed by setting key — the table has no id column.
        const settings = await listPortableInstanceSettings();
        const wanted = options.scope === 'all' ? null : new Set(entityIds);
        for (const setting of settings) {
          if (wanted && !wanted.has(setting.key)) continue;
          entities.push({ id: setting.key, name: setting.key });
        }
        break;
      }

      default:
        throw new Error(`Unknown export type: ${options.type}`);
    }
    return {
      type: options.type,
      entities,
      ...(memoryCount > 0 && { memoryCount }),
      ...(vaults && vaults.stores > 0 && { vaults }),
    };
  } catch (error) {
    logger.error('Error previewing export', { userId, type: options.type }, error as Error);
    throw error;
  }
}
