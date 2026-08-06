/**
 * User-data deletion. `deleteUserData` clears existing data ahead of a
 * replace-mode restore; `deleteAllUserData` extends that to API keys and
 * backups for a full account reset. Both have count-only preview siblings.
 * Format-3 tables are truncated via raw DELETEs because per-row repository
 * cascades are too slow at chunk/vector scale.
 *
 * @module backup/restore/delete-service
 */

import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { rawQuery } from '@/lib/database/manager';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import type { FileEntry } from '@/lib/schemas/types';

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Truncate the format-3 tables (mount-index + new main-DB tables) before a
 * replace-mode restore. Done via raw DELETEs because per-row repository
 * deletes are expensive at scale (especially vector_entries and
 * doc_mount_chunks). Each statement is independently guarded — if a table
 * doesn't exist on a very old database, the rest still run.
 *
 * Also clears `text_replacement_rules`: it's a global table (no userId), so
 * the per-row, userId-scoped deletion in `deleteUserData` never touches it.
 * Truncating it here lets a replace-mode restore re-insert the backup's rules
 * without colliding on the unique `(fromText, caseSensitive)` constraint.
 */
async function clearFormat3Entities(): Promise<void> {
  const mainTables = [
    'chat_documents',
    'conversation_chunks',
    // Per-message annotations. On no delete path in v4, so "delete all my data"
    // left them behind (a privacy leak) and a restore into a migrated instance
    // hit `UNIQUE constraint failed: conversation_annotations` (Bug 10). Cleared
    // in bulk here — the UNIQUE(chatId,messageIndex,characterName) exists only on
    // migrated instances, so the leak-on-delete affects every instance.
    'conversation_annotations',
    'tfidf_vocabularies',
    'embedding_status',
    'vector_entries',
    'vector_indices',
    'text_replacement_rules',
  ];
  for (const table of mainTables) {
    try {
      await rawQuery(`DELETE FROM "${table}"`);
    } catch (error) {
      moduleLogger.debug('Skipping table truncate (table missing or empty)', {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // instance_settings is special: we don't want to drop EVERYTHING since some
  // keys are written by startup migrations and aren't part of the backup. The
  // restore upserts each backup row by key, which is the right behavior. So
  // we leave the table alone here.

  if (isMountIndexDegraded()) return;
  const db = getRawMountIndexDatabase();
  if (!db) return;
  const mountTables = [
    'doc_mount_chunks',
    'doc_mount_blobs',
    'doc_mount_documents',
    'doc_mount_file_links',
    'doc_mount_files',
    'doc_mount_folders',
    'project_doc_mount_links',
    'group_doc_mount_links',
    'group_character_members',
    'doc_mount_points',
  ];
  for (const table of mountTables) {
    try {
      db.prepare(`DELETE FROM "${table}"`).run();
    } catch (error) {
      moduleLogger.debug('Skipping mount-index table truncate', {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Deletes all user data before restore (for 'replace' mode)
 * Also used for the "delete all data" feature
 */
export async function deleteUserData(userId: string): Promise<void> {
  moduleLogger.info('Deleting existing user data for replace mode', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Get all entities to delete
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, promptTemplates, roleplayTemplates, projects, groups, llmLogs, chatSettings, folders, wardrobeItems] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
      repos.groups.findAll(),
      repos.llmLogs.findAll(10000), // High limit to get all user logs
      globalRepos.chatSettings.findByUserId(userId),
      globalRepos.folders.findByUserId(userId),
      globalRepos.wardrobe.findAll(),
    ]);

  // Delete memories for each character first
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    for (const memory of memories) {
      await repos.memories.delete(memory.id);
    }
  }

  // Delete all entities (including user-created templates, projects, and LLM logs)
  await Promise.all([
    ...characters.map((c) => repos.characters.delete(c.id)),
    ...chats.map((c) => repos.chats.delete(c.id, { syncVaults: false })),
    ...tags.map((t) => repos.tags.delete(t.id)),
    ...connectionProfiles.map((cp) => repos.connections.delete(cp.id)),
    ...imageProfiles.map((ip) => repos.imageProfiles.delete(ip.id)),
    ...embeddingProfiles.map((ep) => repos.embeddingProfiles.delete(ep.id)),
    ...promptTemplates.map((pt) => globalRepos.promptTemplates.delete(pt.id)),
    ...roleplayTemplates.map((rt) => globalRepos.roleplayTemplates.delete(rt.id)),
    ...projects.map((p) => repos.projects.delete(p.id)),
    // Group slim rows. Membership + additional-store links are cleared in bulk
    // by clearFormat3Entities (group_character_members / group_doc_mount_links);
    // the official store mount points go with doc_mount_points there too.
    ...groups.map((g) => repos.groups.delete(g.id)),
    ...llmLogs.map((log) => repos.llmLogs.delete(log.id)),
    ...(chatSettings ? [globalRepos.chatSettings.delete(chatSettings.id)] : []),
    ...folders.map((f) => globalRepos.folders.delete(f.id)),
    ...wardrobeItems.map((w) => globalRepos.wardrobe.delete(w.id, w.characterId ?? null)),
  ]);

  // Delete files from storage
  for (const file of files) {
    try {
      if (file.storageKey) {
        await fileStorageManager.deleteFile(file);
      }
      await repos.files.delete(file.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete file during cleanup', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Bulk-delete format-3 entities so the restore can re-insert them with
  // their backup ids without colliding. Raw DELETEs because the row counts
  // (chunks, vectors, etc.) can be large and per-row cascades through the
  // repositories are slow.
  await clearFormat3Entities();

  moduleLogger.info('Deleted existing user data', {
    userId,
    deletedCounts: {
      characters: characters.length,
      chats: chats.length,
      tags: tags.length,
      files: files.length,
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      promptTemplates: promptTemplates.length,
      roleplayTemplates: roleplayTemplates.length,
      projects: projects.length,
      groups: groups.length,
      llmLogs: llmLogs.length,
      chatSettings: chatSettings ? 1 : 0,
      folders: folders.length,
      wardrobeItems: wardrobeItems.length,
    },
  });
}

/**
 * Summary of deleted data counts
 */
export interface DeleteSummary {
  characters: number;
  chats: number;
  tags: number;
  files: number;
  memories: number;
  apiKeys: number;
  backups: number;
  projects: number;
  profiles: {
    connection: number;
    image: number;
    embedding: number;
  };
  templates: {
    prompt: number;
    roleplay: number;
  };
}

/**
 * Deletes all user data including API keys and backups
 * This is a complete account reset
 */
export async function deleteAllUserData(userId: string): Promise<DeleteSummary> {
  moduleLogger.info('Starting complete user data deletion', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // First, count everything before deletion
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups
  const allBackupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );
  const backupsCount = allBackupFiles.length;

  // Now delete everything using the existing function (includes templates)
  await deleteUserData(userId);

  // Delete API keys
  for (const apiKey of apiKeys) {
    try {
      await repos.connections.deleteApiKey(apiKey.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete API key', {
        apiKeyId: apiKey.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete backups from storage (note: already deleted by deleteUserData above)
  // but we log for clarity
  moduleLogger.info('Backups deleted with other files', {
    backupsCount,
  });

  const summary: DeleteSummary = {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupsCount,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };

  moduleLogger.info('Complete user data deletion finished', { userId, summary });

  return summary;
}

/**
 * Preview what will be deleted (counts only, no actual deletion)
 */
export async function previewDeleteAllUserData(userId: string): Promise<DeleteSummary> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups from files
  const backupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );

  return {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupFiles.length,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };
}
