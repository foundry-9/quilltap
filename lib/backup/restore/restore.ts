/**
 * Restore orchestrator. Extracts the archive once, optionally deletes existing
 * data (replace mode) or remaps every UUID (new-account mode), then re-inserts
 * every entity in dependency order with its backup/remapped id preserved so
 * cross-references stay valid. Per-entity failures are collected as warnings
 * rather than aborting the whole restore.
 *
 * @module backup/restore/restore
 */

import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import { makeCarriedStoreRowsResolver } from './carried-store-rows';
import { getNpmPluginsDir, getThemesDir } from '@/lib/paths';
import { isLLMLogsDegraded } from '@/lib/database/backends/sqlite/llm-logs-client';
import { rawQuery } from '@/lib/database/manager';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { TextReplacementRuleConflictError } from '@/lib/database/repositories';
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names';
import { reconcileEmbeddingDimensions } from '@/lib/startup/reconcile-embedding-dimensions';
import { enqueueEmbeddingReindexAll } from '@/lib/background-jobs/queue-service';
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service';
import type { RestoreOptions, RestoreSummary } from '../types';
import { UuidRemapper } from '../uuid-remapper';
import { parseBackupZip, getFileFromExtractedBackup, cleanupDir } from './archive';
import { deleteUserData } from './delete-service';
import { remapBackupData } from './uuid-remap';
import { coerceDocMountPointRow, coerceDocMountFileLinkRow } from './mount-index-coercion';

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Restores data from a backup ZIP file on disk
 */
export async function restore(
  zipPath: string,
  options: RestoreOptions
): Promise<RestoreSummary> {
  const { mode, targetUserId } = options;

  moduleLogger.info('Starting restore operation', { mode, targetUserId });

  const warnings: string[] = [];

  // Extract zip to temp directory once — all file reads come from disk
  const { data: parsedData, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    let data = parsedData;

    // For replace mode, delete existing data first
    if (mode === 'replace') {
      await deleteUserData(targetUserId);
    }

    // For new-account mode, remap all UUIDs
    if (mode === 'new-account') {
      const remapper = new UuidRemapper();
      data = remapBackupData(data, targetUserId, remapper);
    }

    const repos = getUserRepositories(targetUserId);

    // Restore in dependency order
    // All entities preserve their backup/remapped IDs via CreateOptions.id,
    // so cross-references (characterId in participants, tags, etc.) are already correct.

    // 1. Tags (no dependencies)
    for (const tag of data.tags) {
      try {
        const { userId, createdAt, updatedAt, ...tagData } = tag;
        await repos.tags.create({ ...tagData, nameLower: tagData.nameLower || tagData.name.toLowerCase() }, { id: tag.id });
      } catch (error) {
        warnings.push(`Failed to restore tag "${tag.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tag', { tagId: tag.id, error });
      }
    }

    // 2. Connection profiles (no entity dependencies, but have tag refs).
    // Names are unique per user (DB index). Pre-migration backups can carry
    // duplicate names, and merge restores can collide with existing profiles —
    // rename on collision rather than letting the constraint drop the profile.
    const existingConnectionProfiles = await repos.connections.findAll();
    const takenConnectionNames = new Set(existingConnectionProfiles.map((p) => normalizeProfileName(p.name)));
    for (const profile of data.connectionProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        // Note: apiKeyId is not restored as API keys are encrypted and can't be restored
        const uniqueName = makeUniqueProfileName(profileData.name, takenConnectionNames);
        if (uniqueName !== profileData.name) {
          moduleLogger.debug('Renamed connection profile on restore to avoid name collision', {
            profileId: profile.id,
            from: profileData.name,
            to: uniqueName,
          });
        }
        takenConnectionNames.add(normalizeProfileName(uniqueName));
        await repos.connections.create({ ...profileData, name: uniqueName, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore connection profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore connection profile', { profileId: profile.id, error });
      }
    }

    // 3. Image profiles
    for (const profile of data.imageProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.imageProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore image profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore image profile', { profileId: profile.id, error });
      }
    }

    // 4. Embedding profiles
    for (const profile of data.embeddingProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.embeddingProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore embedding profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding profile', { profileId: profile.id, error });
      }
    }

    // 5. Files — DEFERRED to step 22a-bis (after doc-store mounts exist).
    // Every user file now lands in a document store: project-bound files go
    // through the project-store bridge, project-less files through the Quilltap
    // Uploads bridge. Neither target can resolve at this point in the restore —
    // projects arrive at 13, and the mount-point rows (including the Quilltap
    // Uploads mount, which `deleteUserData` truncates in replace mode while
    // deliberately leaving its `instance_settings` pointer dangling) arrive at
    // 22a. Restoring here worked only when the target instance happened to
    // already hold those stores; into a fresh or wiped instance — the
    // disaster-recovery case — not one byte landed.
    let filesRestored = 0;

    // 6. Characters
    for (const character of data.characters) {
      try {
        const { userId, createdAt, updatedAt, ...charData } = character;
        await repos.characters.create(charData, { id: character.id });
      } catch (error) {
        warnings.push(`Failed to restore character "${character.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character', { characterId: character.id, error });
      }
    }

    // 7. Chats (with messages)
    let messagesRestored = 0;
    for (const chat of data.chats) {
      try {
        const { userId, createdAt, updatedAt, messages, ...chatData } = chat;
        const createdChat = await repos.chats.create(chatData, { id: chat.id });

        // Add messages to the chat
        for (const message of messages) {
          try {
            await repos.chats.addMessage(createdChat.id, message);
            messagesRestored++;
          } catch (msgError) {
            warnings.push(`Failed to restore message in chat "${chat.title}": ${msgError instanceof Error ? msgError.message : String(msgError)}`);
          }
        }
      } catch (error) {
        warnings.push(`Failed to restore chat "${chat.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat', { chatId: chat.id, error });
      }
    }

    // 9. Memories
    // IDs are preserved during creation, so characterId/aboutCharacterId already point
    // to the correct (preserved) character IDs — no remapping needed.
    //
    // The memory's own id is preserved too, and that matters: memories reference
    // each other through `relatedMemoryIds`, which uuid-remap rewrites in lockstep
    // with `id` for new-account restores. Letting the repository mint a fresh id
    // here would leave every one of those edges pointing at a memory that no longer
    // exists, quietly flattening the Commonplace Book's graph on restore.
    for (const memory of data.memories) {
      try {
        const { id, createdAt, updatedAt, ...memoryData } = memory;

        // Strip legacy personaId from old backups (column no longer exists)
        const { personaId: _legacyPersonaId, ...cleanMemoryData } = memoryData as Record<string, unknown>;
        await repos.memories.create(cleanMemoryData as Parameters<typeof repos.memories.create>[0], { id });
      } catch (error) {
        warnings.push(`Failed to restore memory: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore memory', { memoryId: memory.id, error });
      }
    }

    // 10. Prompt Templates (user-created only)
    const globalRepos = getRepositories();
    let promptTemplatesRestored = 0;
    for (const template of data.promptTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.promptTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        promptTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore prompt template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore prompt template', { templateId: template.id, error });
      }
    }

    // 11. Roleplay Templates (user-created only)
    let roleplayTemplatesRestored = 0;
    for (const template of data.roleplayTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.roleplayTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        roleplayTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore roleplay template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore roleplay template', { templateId: template.id, error });
      }
    }

    // 12. Provider Models (global cache)
    let providerModelsRestored = 0;
    for (const model of data.providerModels) {
      try {
        const { id, createdAt, updatedAt, ...modelData } = model;
        await globalRepos.providerModels.upsertModel(modelData);
        providerModelsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore provider model "${model.modelId}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore provider model', { modelId: model.modelId, error });
      }
    }

    // 13. Projects
    let projectsRestored = 0;
    for (const project of data.projects) {
      try {
        // userId no longer exists on Project (projects are global).
        const { createdAt, updatedAt, ...projectData } = project;
        await repos.projects.create(projectData, { id: project.id });
        projectsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project "${project.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project', { projectId: project.id, error });
      }
    }

    // 13a. Groups — parallel to projects: a slim row plus an official document
    // store. `groups.create` (store-backed) discards any incoming
    // officialMountPointId and provisions a fresh store, writing the hydrated
    // description/instructions/state/properties back into it — exactly as
    // projects restore above. Membership and additional-store links are restored
    // later (22h-i / 22h-ii), once doc-mount points exist.
    let groupsRestored = 0;
    for (const group of data.groups || []) {
      try {
        const { createdAt, updatedAt, ...groupData } = group;
        await repos.groups.create(groupData, { id: group.id });
        groupsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group "${group.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group', { groupId: group.id, error });
      }
    }

    // 14. LLM Logs
    let llmLogsRestored = 0;
    if (isLLMLogsDegraded()) {
      moduleLogger.warn('Skipping LLM logs restore — logs database is in degraded mode');
      warnings.push('LLM logs were not restored because the logs database is in degraded mode');
    } else {
      for (const log of data.llmLogs) {
        try {
          const { id, createdAt, ...logData } = log;
          await repos.llmLogs.create(logData, { id, createdAt });
          llmLogsRestored++;
        } catch (error) {
          warnings.push(`Failed to restore LLM log: ${error instanceof Error ? error.message : String(error)}`);
          moduleLogger.warn('Failed to restore LLM log', { logId: log.id, error });
        }
      }
    }

    // 15. Plugin Configs
    let pluginConfigsRestored = 0;
    for (const config of data.pluginConfigs || []) {
      try {
        const { id, createdAt, updatedAt, ...configData } = config;
        // Use upsert to merge with existing configs or create new ones.
        // `enabled` rides along: without it a plugin the user had switched
        // off silently came back on after a restore.
        await globalRepos.pluginConfigs.upsertForUserPlugin(
          targetUserId,
          configData.pluginName,
          configData.config as Record<string, unknown>,
          configData.enabled
        );
        pluginConfigsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore plugin config for "${config.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore plugin config', { pluginName: config.pluginName, error });
      }
    }

    // 16. Chat Settings
    let chatSettingsRestored = 0;
    for (const settings of data.chatSettings || []) {
      try {
        const { id, createdAt, updatedAt, ...settingsData } = settings;
        await globalRepos.chatSettings.create(settingsData, { id });
        chatSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat settings: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat settings', { settingsId: settings.id, error });
      }
    }

    // 17. Folders
    let foldersRestored = 0;
    for (const folder of data.folders || []) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.folders.create({ ...folderData, userId: targetUserId }, { id: folder.id });
        foldersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore folder', { folderId: folder.id, error });
      }
    }

    // 19. Wardrobe Items — DEFERRED to step 22g (after doc-store mounts exist).
    // Wardrobe is vault-only: `wardrobe.create` writes into the character's
    // Character Vault / Quilltap General document store and now refuses a
    // SQL-row fallback. At this point in the restore those mounts haven't been
    // recreated yet (they land at 22a), so resolving the vault would fail.
    // Items from a post-cutover backup already restore as `Wardrobe/*.md`
    // documents via 22c–22e; only LEGACY (pre-cutover) backups carry
    // `data.wardrobeItems`, and those are seeded into the vault at 22g.
    let wardrobeItemsRestored = 0;

    // 20. Outfit Presets — REMOVED: presets are now composite WardrobeItems and
    // were folded into data.wardrobeItems at parse time for back-compat with
    // older backups. Nothing to restore here.

    // 21. Character Plugin Data (depends on characters)
    let characterPluginDataRestored = 0;
    for (const cpd of data.characterPluginData || []) {
      try {
        const { id, createdAt, updatedAt, ...cpdData } = cpd;
        await globalRepos.characterPluginData.create(cpdData, { id: cpd.id });
        characterPluginDataRestored++;
      } catch (error) {
        warnings.push(`Failed to restore character plugin data for plugin "${cpd.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character plugin data', { cpdId: cpd.id, pluginName: cpd.pluginName, error });
      }
    }

    // 22. Conversation Annotations (depends on chats)
    let conversationAnnotationsRestored = 0;
    for (const annotation of data.conversationAnnotations || []) {
      try {
        const { id, createdAt, updatedAt, ...annotationData } = annotation;
        await globalRepos.conversationAnnotations.create(annotationData, { id: annotation.id });
        conversationAnnotationsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation annotation: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation annotation', { annotationId: annotation.id, error });
      }
    }

    // ========================================================================
    // Format-3 entities (depend on the entities created above)
    // ========================================================================

    // 22a. Document store mount points. The archive carries these rows as the
    // raw `SELECT *` gave them up — pattern arrays as JSON text, `enabled` as
    // INTEGER 0/1 — so coerce back to domain shape or every row is rejected by
    // the repository schema and the stores come back unreachable.
    let docMountPointsRestored = 0;
    for (const mp of data.docMountPoints || []) {
      try {
        const { id, createdAt, updatedAt, ...mpData } = coerceDocMountPointRow(mp);
        await globalRepos.docMountPoints.create(mpData, { id: mp.id });
        docMountPointsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore document store "${mp.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount point', { mountPointId: mp.id, error });
      }
    }

    // 22a-bis. Files (deferred from step 5). The mount points now exist, so
    // both bridges resolve: projects (13) own their official stores and the
    // Quilltap Uploads mount is back under the id its `instance_settings`
    // pointer still names. Read from the extracted dir on disk, write through
    // the bridge, then record the row.
    // In new-account mode, file IDs are remapped but on-disk filenames use original IDs.
    // Use parsedData.files (original) for disk lookup, data.files (remapped) for DB records.
    //
    // Bug 12: a second-generation archive (a backup of an instance that was
    // itself restored) already carries the doc-store rows (file/link/blob) for
    // a project-less user file — its storageKey points at an archived mount
    // blob that 22c–22f restore verbatim, and its link already sits at
    // `restored/<name>`. Re-ingesting it below would mint a *new* blob + link
    // at that same path (the replay gets there first), so 22d's archived link
    // then collides on UNIQUE(mountPointId, relativePath) and loses its id, and
    // the store rows duplicate one more copy per generation. So detect the
    // carried rows and skip the replay: keep the (remapped) archived storageKey
    // and let the archived rows restore intact. First-generation archives are
    // unaffected — their files' bytes aren't yet in a mount blob, so the
    // storageKey isn't a `mount-blob:` key and the replay runs as before.
    const carriedStorageKeyFor = makeCarriedStoreRowsResolver(
      parsedData.docMountBlobs || [],
      data.docMountBlobs || [],
      parsedData.docMountPoints || [],
      data.docMountPoints || [],
    );

    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      const originalFile = parsedData.files[i]; // original IDs for disk lookup
      try {
        // Carried store rows (Bug 12): skip the replay, preserve the archived
        // storageKey. Project-bound files are handled separately below (their
        // duplication is orthogonal, per docs/developer/bugs.md), so this only fires for
        // project-less files.
        const carriedStorageKey = !file.projectId
          ? carriedStorageKeyFor(originalFile.storageKey)
          : null;
        if (carriedStorageKey) {
          const { userId, createdAt, updatedAt, storageKey, ...fileData } = file as typeof file & Record<string, unknown>;
          delete (fileData as Record<string, unknown>).s3Key;
          delete (fileData as Record<string, unknown>).s3Bucket;
          delete (fileData as Record<string, unknown>).mountPointId;
          await repos.files.create(
            { ...fileData, storageKey: carriedStorageKey },
            { id: file.id }
          );
          filesRestored++;
          continue;
        }

        const fileBuffer = await getFileFromExtractedBackup(rootPath, originalFile, data.manifest?.backupFormat);
        if (fileBuffer) {
          // Project-bound files restore into the project mount (via FSM →
          // project-store-bridge). Project-less files land in the Quilltap
          // Uploads mount under restored/, not the catch-all _general/.
          let restoredStorageKey: string;
          let restoredMimeType: string;
          let restoredSize: number;
          if (file.projectId) {
            const uploadResult = await fileStorageManager.uploadFile({
              filename: file.originalFilename,
              content: fileBuffer,
              contentType: file.mimeType,
              projectId: file.projectId,
              folderPath: file.folderPath || '/',
            });
            restoredStorageKey = uploadResult.storageKey;
            restoredMimeType = uploadResult.storedMimeType;
            restoredSize = uploadResult.sizeBytes;
          } else {
            const written = await writeUserUploadToMountStore({
              filename: file.originalFilename,
              content: fileBuffer,
              contentType: file.mimeType,
              subfolder: 'restored',
            });
            restoredStorageKey = written.storageKey;
            restoredMimeType = written.storedMimeType;
            restoredSize = written.sizeBytes;
          }

          // Create file metadata with storage key. The bridges may transcode
          // bytes (bitmaps → WebP), so we record the post-bridge mime/size
          // rather than what the backup row claimed — a backup made before
          // this fix may carry the pre-transcode lie, and re-writing it would
          // re-introduce the "media_type X but bytes are Y" error.
          // Strip auto-generated and legacy fields from backup data
          const { userId, createdAt, updatedAt, storageKey, ...fileData } = file as typeof file & Record<string, unknown>;
          // Remove legacy fields that may exist in older backups
          delete (fileData as Record<string, unknown>).s3Key;
          delete (fileData as Record<string, unknown>).s3Bucket;
          delete (fileData as Record<string, unknown>).mountPointId;
          await repos.files.create(
            {
              ...fileData,
              mimeType: restoredMimeType,
              size: restoredSize,
              storageKey: restoredStorageKey,
            },
            { id: file.id }
          );
          filesRestored++;
        } else {
          warnings.push(`File not found in backup: ${file.originalFilename}`);
        }
      } catch (error) {
        warnings.push(`Failed to restore file "${file.originalFilename}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore file', { fileId: file.id, error });
      }
    }

    // 22b. Document store folders — sort by path length so parents precede
    // children (parentId is a self-FK into the same table).
    let docMountFoldersRestored = 0;
    const sortedFolders = [...(data.docMountFolders || [])].sort(
      (a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0)
    );
    for (const folder of sortedFolders) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.docMountFolders.create(folderData, { id: folder.id });
        docMountFoldersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount folder', { folderId: folder.id, error });
      }
    }

    // 22c. Document store file content rows (content-addressed by sha256).
    let docMountFilesRestored = 0;
    for (const file of data.docMountFiles || []) {
      try {
        const { id, createdAt, updatedAt, ...fileData } = file;
        await globalRepos.docMountFiles.create(fileData, { id: file.id });
        docMountFilesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file row: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file', { fileId: file.id, error });
      }
    }

    // 22d. Document store file links (hard links to file content). Same
    // storage-type coercion as 22a — the three policy flags arrive as
    // INTEGER 0/1 and the schema demands booleans.
    let docMountFileLinksRestored = 0;
    for (const link of data.docMountFileLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = coerceDocMountFileLinkRow(link);
        await globalRepos.docMountFileLinks.create(linkData, { id: link.id });
        docMountFileLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file link "${link.relativePath}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file link', { linkId: link.id, error });
      }
    }

    // 22e. Document store text documents (database-backed text content).
    let docMountDocumentsRestored = 0;
    for (const doc of data.docMountDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...docData } = doc;
        await globalRepos.docMountDocuments.create(docData, { id: doc.id });
        docMountDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount document', { documentId: doc.id, error });
      }
    }

    // 22f. Document store binary blobs (metadata rows + bytes from disk).
    // Bytes were staged in mount-blobs/<blobId> at backup time. We restore
    // them by writing the metadata row + bytes directly to the mount-index
    // DB so we preserve the original blob id (a UNIQUE column on fileId).
    let docMountBlobsRestored = 0;
    if ((data.docMountBlobs || []).length > 0) {
      // In new-account mode the metadata id is remapped but the bytes on
      // disk are still keyed by the *original* id. Pair them by index, the
      // same trick used for user files higher up.
      const originalBlobs = parsedData.docMountBlobs || [];
      const blobsDir = path.join(rootPath, 'mount-blobs');
      const mountIndexDb = isMountIndexDegraded() ? null : getRawMountIndexDatabase();
      if (!mountIndexDb) {
        warnings.push('Doc-store blobs were not restored — mount-index database is unavailable');
      } else {
        const insert = mountIndexDb.prepare(
          `INSERT INTO "doc_mount_blobs" (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (let i = 0; i < (data.docMountBlobs || []).length; i++) {
          const blob = (data.docMountBlobs || [])[i];
          const original = originalBlobs[i] ?? blob;
          try {
            const bytesPath = path.join(blobsDir, original.id);
            const bytes = await fs.promises.readFile(bytesPath);
            insert.run(
              blob.id,
              blob.fileId,
              blob.sha256,
              blob.sizeBytes,
              blob.storedMimeType,
              bytes,
              blob.createdAt,
              blob.updatedAt
            );
            docMountBlobsRestored++;
          } catch (error) {
            warnings.push(`Failed to restore doc-store blob ${blob.id}: ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore doc mount blob', { blobId: blob.id, error });
          }
        }
      }
    }

    // 22f-bis. Legacy wardrobe items (deferred from step 19). The doc-store
    // mounts, folders, and file rows now exist (22a–22f), so each character's
    // Character Vault — and Quilltap General for shared archetypes — resolves.
    // `wardrobe.create` therefore writes these straight into the vault document
    // store (its sole home); it no longer falls back to a SQL `wardrobe_items`
    // row. Post-cutover backups carry their wardrobe as `Wardrobe/*.md`
    // documents (already restored above) and leave `data.wardrobeItems` empty,
    // so this loop only fires for older, pre-cutover backups.
    for (const item of data.wardrobeItems || []) {
      try {
        const { id, createdAt, updatedAt, ...itemData } = item;
        await globalRepos.wardrobe.create(itemData, { id: item.id });
        wardrobeItemsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore wardrobe item "${item.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore wardrobe item', { wardrobeItemId: item.id, error });
      }
    }

    // 22g. Document store embedded chunks. The repo's create() accepts the
    // chunk in serialised form; the schema rehydrates embedding as Float32Array.
    let docMountChunksRestored = 0;
    for (const chunk of data.docMountChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        await globalRepos.docMountChunks.create(chunkData as unknown as Parameters<typeof globalRepos.docMountChunks.create>[0], { id: chunk.id });
        docMountChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount chunk', { chunkId: chunk.id, error });
      }
    }

    // 22h. Project ↔ document-store links.
    let projectDocMountLinksRestored = 0;
    for (const link of data.projectDocMountLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.projectDocMountLinks.create(linkData, { id: link.id });
        projectDocMountLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project↔store link: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project doc mount link', { linkId: link.id, error });
      }
    }

    // 22h-i. Group ↔ document-store links (a group's *additional* linked stores;
    // the official store rides on the group row). Mirror of projectDocMountLinks.
    let groupDocMountLinksRestored = 0;
    for (const link of data.groupDocMountLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.groupDocMountLinks.create(linkData, { id: link.id });
        groupDocMountLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group↔store link: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group doc mount link', { linkId: link.id, error });
      }
    }

    // 22h-ii. Group ↔ character membership. groupId/characterId both reference
    // main-DB rows already restored above (groups at 13a, characters at 6).
    let groupCharacterMembersRestored = 0;
    for (const member of data.groupCharacterMembers || []) {
      try {
        const { id, createdAt, updatedAt, ...memberData } = member;
        await globalRepos.groupCharacterMembers.create(memberData, { id: member.id });
        groupCharacterMembersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group membership: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group character member', { memberId: member.id, error });
      }
    }

    // 22i. Chat documents (Document Mode pane state per chat).
    let chatDocumentsRestored = 0;
    for (const cd of data.chatDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...cdData } = cd;
        await globalRepos.chatDocuments.create(cdData, { id: cd.id });
        chatDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat document', { chatDocumentId: cd.id, error });
      }
    }

    // 22j. Vector index metas + entries. Without these every memory would
    // need to be re-embedded after restore.
    let vectorIndexMetasRestored = 0;
    for (const meta of data.vectorIndexMetas || []) {
      try {
        await globalRepos.vectorIndices.saveMeta(meta.characterId, meta.dimensions);
        vectorIndexMetasRestored++;
      } catch (error) {
        warnings.push(`Failed to restore vector index meta for character ${meta.characterId}: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector index meta', { characterId: meta.characterId, error });
      }
    }

    // The repo's addEntries batch path expects Float32Array; the serialised
    // form holds plain number arrays, so rehydrate before insert.
    let vectorEntriesRestored = 0;
    if ((data.vectorEntries || []).length > 0) {
      try {
        const rehydrated = (data.vectorEntries || []).map((e) => ({
          id: e.id,
          characterId: e.characterId,
          embedding: new Float32Array(e.embedding),
        }));
        await globalRepos.vectorIndices.addEntries(rehydrated);
        vectorEntriesRestored = rehydrated.length;
      } catch (error) {
        warnings.push(`Failed to restore vector entries: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector entries batch', { error });
      }
    }

    // 22k. Conversation chunks (semantic chunks with embeddings).
    let conversationChunksRestored = 0;
    for (const chunk of data.conversationChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        // The repo's create accepts ConversationChunkInput; embeddings come
        // through as number[] and the Zod transform rehydrates them.
        await globalRepos.conversationChunks.create(
          chunkData as unknown as Parameters<typeof globalRepos.conversationChunks.create>[0],
          { id: chunk.id }
        );
        conversationChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation chunk', { chunkId: chunk.id, error });
      }
    }

    // 22l. TF-IDF vocabularies (one per BUILTIN embedding profile).
    let tfidfVocabulariesRestored = 0;
    for (const voc of data.tfidfVocabularies || []) {
      try {
        const { id, createdAt, updatedAt, ...vocData } = voc;
        await globalRepos.tfidfVocabularies.create(
          { ...vocData, userId: targetUserId },
          { id: voc.id }
        );
        tfidfVocabulariesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore TF-IDF vocabulary: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tfidf vocabulary', { vocabularyId: voc.id, error });
      }
    }

    // 22m. Embedding status flags.
    let embeddingStatusRestored = 0;
    for (const es of data.embeddingStatus || []) {
      try {
        const { id, createdAt, updatedAt, ...esData } = es;
        await globalRepos.embeddingStatus.create(
          { ...esData, userId: targetUserId },
          { id: es.id }
        );
        embeddingStatusRestored++;
      } catch (error) {
        warnings.push(`Failed to restore embedding status: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding status', { statusId: es.id, error });
      }
    }

    // 22n. Text replacement rules (global; no userId, no FKs). Insert each row
    // through the repository so its unique-conflict guard applies. Replace mode
    // truncates the table first (delete-service), so conflicts here only arise
    // in merge mode against pre-existing rules — swallow those and keep going,
    // matching the tolerance of the other restore loops.
    let textReplacementRulesRestored = 0;
    for (const rule of data.textReplacementRules || []) {
      try {
        const { id, createdAt, updatedAt, ...ruleData } = rule;
        await globalRepos.textReplacementRules.create(ruleData, { id: rule.id });
        textReplacementRulesRestored++;
      } catch (error) {
        if (error instanceof TextReplacementRuleConflictError) {
          moduleLogger.debug('Skipping duplicate text replacement rule on restore', {
            fromText: rule.fromText,
            caseSensitive: rule.caseSensitive,
          });
          continue;
        }
        warnings.push(`Failed to restore text replacement rule: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore text replacement rule', { ruleId: rule.id, error });
      }
    }
    if (textReplacementRulesRestored > 0) {
      moduleLogger.debug('Restored text replacement rules', { count: textReplacementRulesRestored });
    }

    // 22o. Instance settings — applied last because the mount-point keys
    // reference doc_mount_points that we just restored above. Upsert by key
    // so a fresh instance's auto-provisioned defaults get overwritten by the
    // backup's values.
    let instanceSettingsRestored = 0;
    for (const row of data.instanceSettings || []) {
      try {
        await rawQuery(
          'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
            'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
          [row.key, row.value]
        );
        instanceSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore instance setting "${row.key}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore instance setting', { key: row.key, error });
      }
    }

    // 23. NPM Plugins (copy from extracted dir to plugins/npm directory)
    let npmPluginsRestored = 0;
    const npmPluginsSrcDir = path.join(rootPath, 'plugins', 'npm');

    try {
      const pluginEntries = await fs.promises.readdir(npmPluginsSrcDir, { withFileTypes: true });
      const npmPluginsDir = getNpmPluginsDir();

      // Ensure the npm plugins directory exists
      await fs.promises.mkdir(npmPluginsDir, { recursive: true });

      for (const entry of pluginEntries) {
        if (entry.isDirectory()) {
          try {
            const srcPath = path.join(npmPluginsSrcDir, entry.name);
            const destPath = path.join(npmPluginsDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            npmPluginsRestored++;
            moduleLogger.debug('Restored npm plugin', { pluginName: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore npm plugin "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore npm plugin', { pluginName: entry.name, error });
          }
        }
      }

      if (npmPluginsRestored > 0) {
        moduleLogger.info('Restored npm plugins', {
          count: npmPluginsRestored,
          plugins: pluginEntries.filter((e) => e.isDirectory()).map((e) => e.name),
        });
      }
    } catch {
      // No plugins/npm directory in the backup — that's fine
      moduleLogger.debug('No npm plugins directory in backup');
    }

    // 24. User-installed theme bundles (copy from extracted dir to themes directory)
    let userInstalledThemesRestored = 0;
    const themesSrcDir = path.join(rootPath, 'themes');

    try {
      const themeEntries = await fs.promises.readdir(themesSrcDir, { withFileTypes: true });
      const themesDir = getThemesDir();

      // Ensure the themes directory exists
      await fs.promises.mkdir(themesDir, { recursive: true });

      for (const entry of themeEntries) {
        if (entry.isDirectory() && entry.name !== '.cache') {
          try {
            const srcPath = path.join(themesSrcDir, entry.name);
            const destPath = path.join(themesDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true, force: true });
            userInstalledThemesRestored++;
            moduleLogger.debug('Restored theme bundle', { themeId: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore theme bundle "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore theme bundle', { themeId: entry.name, error });
          }
        } else if (entry.isFile() && entry.name === 'themes-index.json') {
          // Restore the themes index file
          try {
            const themesDir2 = getThemesDir();
            await fs.promises.cp(path.join(themesSrcDir, 'themes-index.json'), path.join(themesDir2, 'themes-index.json'), { force: true });
          } catch (error) {
            moduleLogger.warn('Failed to restore themes-index.json', { error });
          }
        }
      }

      if (userInstalledThemesRestored > 0) {
        moduleLogger.info('Restored user-installed theme bundles', {
          count: userInstalledThemesRestored,
        });
      }
    } catch {
      // No themes directory in the backup — that's fine
      moduleLogger.debug('No themes directory in backup');
    }

    moduleLogger.info('All entities restored with preserved IDs - no reconciliation needed');

    // 24a. Compact archives arrive with no vectors at all: memory embeddings
    // are NULL and every derived collection (conversation chunks, vector
    // entries, TF-IDF vocabularies, doc-mount chunks) was omitted at backup
    // time. The reconcile below deliberately ignores *absent* chunk rows — it
    // only repairs non-conforming ones — so without this the instance would
    // come back with search quietly cold. Enqueued before the reconcile so the
    // reconcile's own dedup sees this job and doesn't stack a second one.
    if (parsedData.manifest?.compact) {
      try {
        const profile = await getDefaultEmbeddingProfile(targetUserId);
        if (profile) {
          await enqueueEmbeddingReindexAll(targetUserId, { profileId: profile.id, scope: 'all' });
          moduleLogger.debug('Queued full re-index for compact backup restore', {
            targetUserId,
            profileId: profile.id,
          });
          warnings.push(
            'This was a compact backup, so search indexes were rebuilt rather than restored — ' +
              'search will warm back up as re-indexing completes. Conversation and document ' +
              'chunks are rebuilt as those chats and stores are next touched.'
          );
        } else {
          warnings.push(
            'This was a compact backup, but no default embedding profile is configured, so ' +
              'search cannot be rebuilt yet. Configure one and re-index from the Commonplace Book.'
          );
        }
      } catch (error) {
        warnings.push(
          `Failed to queue re-indexing after compact restore: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        moduleLogger.warn('Failed to enqueue reindex after compact restore', { error });
      }
    }

    // 25. Embedding reconcile. Restore is the one moment a corpus can arrive
    // whose vectors were produced under a different embedding standard than
    // this instance's default profile — new-account mode, or simply a machine
    // configured differently from the one the backup came off. Until now the
    // only repair was the *next boot's* sweep, which is fine for an in-place
    // restore and wrong for everything else.
    //
    // The reconcile takes no arguments, never throws (it catches into a null
    // result), resolves the default profile itself and dedupes its own
    // reindex enqueue — so in the ordinary conforming case this is a cheap
    // no-op.
    const reconcileResult = await reconcileEmbeddingDimensions();
    moduleLogger.debug('Post-restore embedding reconcile complete', {
      targetDimensions: reconcileResult.targetDimensions,
      skippedReason: reconcileResult.skippedReason,
      vectorEntriesDeleted: reconcileResult.vectorEntriesDeleted,
      vectorIndexMetaFixed: reconcileResult.vectorIndexMetaFixed,
      reindexEnqueued: reconcileResult.reindexEnqueued,
      mismatched: reconcileResult.mismatched,
    });
    if (reconcileResult.skippedReason) {
      warnings.push(
        `Embedding reconcile was skipped after restore (${reconcileResult.skippedReason}); ` +
          'semantic search will be repaired on the next startup.'
      );
    } else if (reconcileResult.reindexEnqueued) {
      warnings.push(
        'Some restored embeddings did not match this instance\'s embedding profile; ' +
          're-indexing has been queued and search will warm back up as it completes.'
      );
    }

    const summary: RestoreSummary = {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: messagesRestored,
      tags: data.tags.length,
      files: filesRestored,
      memories: data.memories.length,
      profiles: {
        connection: data.connectionProfiles.length,
        image: data.imageProfiles.length,
        embedding: data.embeddingProfiles.length,
      },
      templates: {
        prompt: promptTemplatesRestored,
        roleplay: roleplayTemplatesRestored,
      },
      providerModels: providerModelsRestored,
      projects: projectsRestored,
      groups: groupsRestored,
      llmLogs: llmLogsRestored,
      pluginConfigs: pluginConfigsRestored,
      chatSettings: chatSettingsRestored,
      folders: foldersRestored,
      wardrobeItems: wardrobeItemsRestored,
      npmPlugins: npmPluginsRestored,
      characterPluginData: characterPluginDataRestored,
      conversationAnnotations: conversationAnnotationsRestored,
      userInstalledThemes: userInstalledThemesRestored,
      chatDocuments: chatDocumentsRestored,
      instanceSettings: instanceSettingsRestored,
      embeddingStatus: embeddingStatusRestored,
      conversationChunks: conversationChunksRestored,
      tfidfVocabularies: tfidfVocabulariesRestored,
      vectorIndexMetas: vectorIndexMetasRestored,
      vectorEntries: vectorEntriesRestored,
      docMountPoints: docMountPointsRestored,
      docMountFolders: docMountFoldersRestored,
      docMountFiles: docMountFilesRestored,
      docMountFileLinks: docMountFileLinksRestored,
      docMountChunks: docMountChunksRestored,
      docMountDocuments: docMountDocumentsRestored,
      docMountBlobs: docMountBlobsRestored,
      projectDocMountLinks: projectDocMountLinksRestored,
      groupDocMountLinks: groupDocMountLinksRestored,
      groupCharacterMembers: groupCharacterMembersRestored,
      textReplacementRules: textReplacementRulesRestored,
      embeddingReconcile: {
        targetDimensions: reconcileResult.targetDimensions,
        skippedReason: reconcileResult.skippedReason,
        vectorEntriesDeleted: reconcileResult.vectorEntriesDeleted,
        vectorIndexMetaFixed: reconcileResult.vectorIndexMetaFixed,
        reindexEnqueued: reconcileResult.reindexEnqueued,
      },
      warnings,
    };

    moduleLogger.info('Restore operation completed', {
      targetUserId,
      mode,
      summary,
      warningCount: warnings.length,
    });

    return summary;
  } finally {
    // Always clean up the extracted temp directory
    await cleanupDir(extractDir);
  }
}
