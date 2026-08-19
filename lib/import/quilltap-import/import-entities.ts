/**
 * Conflict-strategy importers for the remaining user-data entities: tags,
 * roleplay templates, projects, chats (with messages), and memories. Memories
 * are remap-only — they always insert, rewriting their character/chat/project/
 * tag FKs through the id maps populated by the earlier import phases.
 *
 * @module import/quilltap-import/import-entities
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  Tag,
  ChatMetadata,
  Memory,
  RoleplayTemplate,
  MessageEvent,
  Project,
  Group,
} from '@/lib/schemas/types';
import type { ImportOptions, IdMappingState, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export async function importTags(
  userId: string,
  tags: Tag[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const tag of tags) {
    try {
      const existing = await repos.tags.findById(tag.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.tags.set(tag.id, tag.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.tags.delete(tag.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const { id: _, userId: __, createdAt, updatedAt, ...tagData } = tag;
          const newTag = await repos.tags.create({
            ...tagData,
            name: `${tagData.name} (imported)`,
            nameLower: `${tagData.nameLower || tagData.name.toLowerCase()} (imported)`,
          });
          idMaps.tags.set(tag.id, newTag.id);
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...tagData } = tag;
      const createData = options.preserveIds ? { ...tagData, id: tag.id } : tagData;
      const createOptions = options.preserveIds ? { id: tag.id } : undefined;
      const newTag = options.preserveIds
        ? await repos.tags.create(createData, createOptions)
        : await repos.tags.create(createData);
      idMaps.tags.set(tag.id, newTag.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import tag "${tag.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import tag', {
        tagId: tag.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importRoleplayTemplates(
  userId: string,
  templates: RoleplayTemplate[],
  options: ImportOptions,
  idMaps: IdMappingState,
  globalRepos: ReturnType<typeof getRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const template of templates) {
    try {
      // Backward compatibility: convert old annotationButtons to delimiters format
      const templateAny = template as Record<string, unknown>;
      if (templateAny.annotationButtons && !template.delimiters?.length) {
        const oldButtons = templateAny.annotationButtons as Array<{ label?: string; abbrev?: string; prefix?: string; suffix?: string }>;
        const styleMap: Record<string, string> = {
          'Narration': 'qt-chat-narration', 'Nar': 'qt-chat-narration',
          'Internal Monologue': 'qt-chat-inner-monologue', 'Int': 'qt-chat-inner-monologue',
          'Out of Character': 'qt-chat-ooc', 'OOC': 'qt-chat-ooc',
        };
        template.delimiters = oldButtons.map(btn => {
          const prefix = btn.prefix || '';
          const suffix = btn.suffix || '';
          const name = btn.label || btn.abbrev || 'Unknown';
          const buttonName = btn.abbrev || btn.label || '?';
          const style = styleMap[btn.label || ''] || styleMap[btn.abbrev || ''] || 'qt-chat-narration';
          // A prefix with no suffix is a line-start marker (e.g. "// " OOC);
          // everything else is a wrap delimiter. Mirrors the kinds migration.
          if (prefix && !suffix) {
            return { kind: 'linePrefix' as const, name, buttonName, marker: prefix, style };
          }
          return {
            kind: 'wrap' as const,
            name,
            buttonName,
            delimiters: prefix === suffix ? prefix : ([prefix, suffix] as [string, string]),
            style,
          };
        });
        delete templateAny.annotationButtons;
      }
      // Remove legacy pluginName field if present
      delete templateAny.pluginName;

      const existing = await globalRepos.roleplayTemplates.findById(template.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.roleplayTemplates.set(template.id, template.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await globalRepos.roleplayTemplates.delete(template.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.roleplayTemplates.set(template.id, newId);
          const { id: _, createdAt, updatedAt, ...templateData } = template;
          const newTemplate = await globalRepos.roleplayTemplates.create({
            ...templateData,
            userId,
            name: `${templateData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, createdAt, updatedAt, ...templateData } = template;
      const createData = options.preserveIds ? { ...templateData, id: template.id } : templateData;
      const createOptions = options.preserveIds ? { id: template.id } : undefined;
      const newTemplate = options.preserveIds
        ? await globalRepos.roleplayTemplates.create({
            ...createData,
            userId,
          }, createOptions)
        : await globalRepos.roleplayTemplates.create({
            ...createData,
            userId,
          });
      idMaps.roleplayTemplates.set(template.id, newTemplate.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import roleplay template "${template.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import roleplay template', {
        templateId: template.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importProjects(
  userId: string,
  projects: Project[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const project of projects) {
    try {
      const existing = await repos.projects.findById(project.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.projects.set(project.id, project.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.projects.delete(project.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.projects.set(project.id, newId);
          // userId no longer exists on Project (projects are global). createdAt /
      // updatedAt / officialMountPointId are excluded so create() generates
      // fresh values and provisions a new store.
      const { id: _, createdAt, updatedAt, officialMountPointId: ___, ...projectData } = project;
          const newProject = await repos.projects.create({
            ...projectData,
            name: `${projectData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      // userId no longer exists on Project (projects are global). createdAt /
      // updatedAt / officialMountPointId are excluded so create() generates
      // fresh values and provisions a new store.
      const { id: _, createdAt, updatedAt, officialMountPointId: ___, ...projectData } = project;
      const createData = options.preserveIds ? { ...projectData, id: project.id } : projectData;
      const createOptions = options.preserveIds ? { id: project.id } : undefined;
      const newProject = options.preserveIds
        ? await repos.projects.create(createData, createOptions)
        : await repos.projects.create(createData);
      idMaps.projects.set(project.id, newProject.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import project "${project.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import project', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importGroups(
  userId: string,
  groups: Group[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const group of groups) {
    try {
      const existing = await repos.groups.findById(group.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.groups.set(group.id, group.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.groups.delete(group.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.groups.set(group.id, newId);
          // createdAt / updatedAt / officialMountPointId are excluded so create()
          // generates fresh values and provisions a new store.
          const { id: _, createdAt, updatedAt, officialMountPointId: ___, ...groupData } = group;
          const newGroup = await repos.groups.create({
            ...groupData,
            name: `${groupData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      // createdAt / updatedAt / officialMountPointId are excluded so create()
      // generates fresh values and provisions a new store.
      const { id: _, createdAt, updatedAt, officialMountPointId: ___, ...groupData } = group;
      const createData = options.preserveIds ? { ...groupData, id: group.id } : groupData;
      const createOptions = options.preserveIds ? { id: group.id } : undefined;
      const newGroup = options.preserveIds
        ? await repos.groups.create(createData, createOptions)
        : await repos.groups.create(createData);
      idMaps.groups.set(group.id, newGroup.id);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import group "${group.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import group', {
        groupId: group.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importChats(
  userId: string,
  chats: (ChatMetadata & { messages: MessageEvent[] })[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;
  let messages = 0;

  for (const chat of chats) {
    try {
      const existing = await repos.chats.findById(chat.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.chats.set(chat.id, chat.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.chats.delete(chat.id, { syncVaults: false });
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.chats.set(chat.id, newId);
          const { id: _, userId: __, messages: _msgs, createdAt, updatedAt, ...chatData } = chat;
          const newChat = await repos.chats.create({
            ...chatData,
            title: `${chatData.title} (imported)`,
          });

          // Add messages
          for (const message of chat.messages) {
            try {
              await repos.chats.addMessage(newChat.id, message);
              messages++;
            } catch (msgError) {
              warnings.push(
                `Failed to import message in chat "${chat.title}": ${
                  msgError instanceof Error ? msgError.message : String(msgError)
                }`
              );
            }
          }

          imported++;
          continue;
        }
      }

      const { id: _, userId: __, messages: _msgs, createdAt, updatedAt, ...chatData } = chat;
      const createData = options.preserveIds ? { ...chatData, id: chat.id } : chatData;
      const createOptions = options.preserveIds ? { id: chat.id } : undefined;
      const newChat = options.preserveIds
        ? await repos.chats.create(createData, createOptions)
        : await repos.chats.create(createData);
      idMaps.chats.set(chat.id, newChat.id);

      // Add messages
      for (const message of chat.messages) {
        try {
          await repos.chats.addMessage(newChat.id, message);
          messages++;
        } catch (msgError) {
          warnings.push(
            `Failed to import message in chat "${chat.title}": ${
              msgError instanceof Error ? msgError.message : String(msgError)
            }`
          );
        }
      }

      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import chat "${chat.title}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import chat', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped, messages };
}

/**
 * Insert imported memories, remapping every FK through the id maps.
 *
 * Deliberately uses the raw repository rather than `createMemoryWithGate`:
 * the gate can silently skip near-duplicates, reinforce an existing row
 * instead of inserting, or lose rows entirely when the embedding provider is
 * down — none of which is acceptable for an import, where the user asked for
 * exactly these rows.
 *
 * Returns the created memory IDs (alongside the counts) so the orchestrator
 * can enqueue targeted re-embedding — imported memories arrive with a NULL
 * embedding by design (see below).
 */
export async function importMemories(
  userId: string,
  memories: Memory[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts & { createdIds: Array<{ id: string; characterId: string }> }> {
  let imported = 0;
  let skipped = 0;
  const createdIds: Array<{ id: string; characterId: string }> = [];

  for (const memory of memories) {
    try {
      // Skip-if-present rehydrate (spec §6/F4): the memory is already back —
      // a partial restore being re-run. The surviving row wins.
      if (options.preserveIds && idMaps.preserveIdsSkips.has(memory.id)) {
        skipped++;
        continue;
      }

      // Remap character ID
      const newCharacterId = idMaps.characters.get(memory.characterId);
      if (!newCharacterId) {
        warnings.push(
          `Memory references non-existent character ${memory.characterId}`
        );
        skipped++;
        continue;
      }

      // Remap aboutCharacterId if present (Characters Not Personas: who the memory is about)
      let newAboutCharacterId = memory.aboutCharacterId;
      if (memory.aboutCharacterId) {
        // Try to map as a character first
        newAboutCharacterId = idMaps.characters.get(memory.aboutCharacterId) || null;
      }

      // Remap chat ID if present
      let newChatId = memory.chatId;
      if (memory.chatId) {
        newChatId = idMaps.chats.get(memory.chatId) || null;
      }

      // Remap project ID if present
      let newProjectId = memory.projectId;
      if (memory.projectId) {
        newProjectId = idMaps.projects.get(memory.projectId) || null;
      }

      // Remap tags if present
      let newTags = memory.tags;
      if (memory.tags && memory.tags.length > 0) {
        newTags = memory.tags
          .map((tagId) => idMaps.tags.get(tagId) || tagId)
          .filter((id) => id !== null) as string[];
      }

      // `embedding` is excluded on purpose. A vector is only meaningful
      // against the model that produced it, so a foreign one silently
      // corrupts semantic search whenever the dimensionality happens to
      // match — and the boot repair in lib/startup/repair-text-embeddings.ts
      // would *preserve* a bad vector by converting it to a valid blob rather
      // than discarding it. Import time is the only correct place to drop it.
      // The orchestrator enqueues an EMBEDDING_GENERATE per created row.
      const { id: _, createdAt, updatedAt, embedding: _embedding, ...memoryData } = memory;
      const createData = options.preserveIds ? { ...memoryData, id: memory.id } : memoryData;
      const createOptions = options.preserveIds ? { id: memory.id } : undefined;
      const payload = {
        ...createData,
        characterId: newCharacterId,
        aboutCharacterId: newAboutCharacterId,
        chatId: newChatId,
        projectId: newProjectId,
        tags: newTags,
      };
      const created = options.preserveIds
        ? await repos.memories.create(payload, createOptions)
        : await repos.memories.create(payload);
      createdIds.push({ id: created.id, characterId: newCharacterId });
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import memory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import memory', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  return { imported, skipped, createdIds };
}
