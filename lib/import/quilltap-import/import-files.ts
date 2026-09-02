/**
 * Importer for the general file library: folder tree first, then each file's
 * bytes written back through the same storage bridges the backup restore
 * uses, and finally the metadata row.
 *
 * Two rules drive everything here:
 *
 *  1. **`storageKey` never transfers.** The exporting instance's key points
 *     into its own storage (commonly `mount-blob:<mountPointId>:<blobId>`,
 *     naming a row in *that* instance's mount-index database). We discard it
 *     and record whatever key our own upload bridge hands back. The exported
 *     value survives as `_sourceStorageKey` provenance and nothing reads it.
 *  2. **Post-bridge mime/size win.** The bridges transcode bitmaps to WebP,
 *     so the archive's `mimeType`/`size` describe bytes that no longer exist
 *     once written. Recording the archive's values would re-introduce the
 *     "media_type X but bytes are Y" class of error.
 *
 * @module import/quilltap-import/import-files
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import type { ExportedFolder, ExportedFileWithBytes } from '@/lib/export/types';
import type { ImportOptions, IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export interface FileImportCounts {
  files: number;
  folders: number;
  skipped: number;
}

/**
 * Recreate the folder tree. Parents come first (the writer sorts by path
 * length), so a child's `parentFolderId` always resolves against a folder we
 * have already created — or against one that already existed here, which we
 * reuse rather than duplicate: a folder is a location, not content, so
 * "duplicate" would just produce two identical paths.
 */
async function importFolders(
  userId: string,
  folders: ExportedFolder[],
  idMaps: IdMappingState,
  warnings: string[]
): Promise<{ imported: number; idByOldId: Map<string, string> }> {
  const globalRepos = getRepositories();
  const idByOldId = new Map<string, string>();
  let imported = 0;

  const sorted = [...folders].sort((a, b) => a.path.length - b.path.length);

  for (const folder of sorted) {
    try {
      const projectId = folder.projectId
        ? idMaps.projects.get(folder.projectId) ?? folder.projectId
        : null;

      const existing = await globalRepos.folders.findByPath(userId, folder.path, projectId);
      if (existing) {
        idByOldId.set(folder.id, existing.id);
        moduleLogger.debug('Reusing existing folder for import', {
          path: folder.path,
          folderId: existing.id,
        });
        continue;
      }

      const parentFolderId = folder.parentFolderId
        ? idByOldId.get(folder.parentFolderId) ?? null
        : null;

      // Find-or-create at the chokepoint. The `findByPath` above is the
      // reuse-reporting branch, not the uniqueness guarantee — that lives in
      // `ensureByPath` and the unique index behind it (bug 114).
      const created = await globalRepos.folders.ensureByPath({
        userId,
        path: folder.path,
        name: folder.name,
        parentFolderId,
        projectId,
      });
      idByOldId.set(folder.id, created.id);
      imported++;
      moduleLogger.debug('Imported folder', { path: folder.path, folderId: created.id });
    } catch (error) {
      warnings.push(
        `Failed to import folder "${folder.path}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import folder', {
        folderId: folder.id,
        path: folder.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, idByOldId };
}

/**
 * Remap a file's `linkedTo` array.
 *
 * An id is kept when the import remapped it, or when it already names
 * something on this instance (a same-instance re-import, or an archive landing
 * beside entities restored earlier). Everything else is dropped: a dangling id
 * is not inert — `lib/cascade-delete.ts` reads `linkedTo` to decide whether a
 * file is still referenced, so a ghost reference can keep a genuinely orphaned
 * file alive forever.
 *
 * Message ids are the common companion of a chat id in the same array
 * (`chat-files-v2` writes `[chatId, messageId]`), so once a chat resolves we
 * check its message ids too rather than dropping the attachment's finer link.
 */
async function remapLinkedTo(
  linkedTo: string[],
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  messageIdCache: Map<string, Set<string>>
): Promise<{ kept: string[]; dropped: string[] }> {
  const kept: string[] = [];
  const dropped: string[] = [];
  const resolvedChatIds: string[] = [];
  const unresolved: string[] = [];

  for (const id of linkedTo) {
    const mapped =
      idMaps.characters.get(id) ??
      idMaps.chats.get(id) ??
      idMaps.projects.get(id) ??
      idMaps.groups.get(id);
    if (mapped) {
      kept.push(mapped);
      if (idMaps.chats.get(id)) resolvedChatIds.push(mapped);
      continue;
    }

    if (await repos.chats.findById(id)) {
      kept.push(id);
      resolvedChatIds.push(id);
      continue;
    }
    if ((await repos.characters.findById(id)) || (await repos.projects.findById(id))) {
      kept.push(id);
      continue;
    }
    unresolved.push(id);
  }

  for (const id of unresolved) {
    let matched = false;
    for (const chatId of resolvedChatIds) {
      let messageIds = messageIdCache.get(chatId);
      if (!messageIds) {
        const events = await repos.chats.getMessages(chatId);
        messageIds = new Set(events.map((event) => event.id));
        messageIdCache.set(chatId, messageIds);
      }
      if (messageIds.has(id)) {
        kept.push(id);
        matched = true;
        break;
      }
    }
    if (!matched) dropped.push(id);
  }

  return { kept, dropped };
}

/**
 * Import file metadata plus bytes. Files whose bytes never made it into the
 * archive (`_bytesMissing`) are skipped outright — a metadata row with no
 * content is a broken thumbnail waiting to happen.
 */
export async function importFiles(
  userId: string,
  files: ExportedFileWithBytes[],
  folders: ExportedFolder[],
  options: ImportOptions,
  repos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<FileImportCounts> {
  moduleLogger.debug('Importing file library', {
    userId,
    fileCount: files.length,
    folderCount: folders.length,
    conflictStrategy: options.conflictStrategy,
  });

  const { imported: foldersImported } = await importFolders(userId, folders, idMaps, warnings);

  let imported = 0;
  let skipped = 0;
  let droppedLinks = 0;
  const messageIdCache = new Map<string, Set<string>>();

  for (const file of files) {
    try {
      if (file._bytesMissing || !file.dataBase64) {
        warnings.push(
          `File "${file.originalFilename}" was exported without its contents and was skipped.`
        );
        skipped++;
        continue;
      }

      const existing = await repos.files.findById(file.id);
      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          continue;
        }
        if (options.conflictStrategy === 'overwrite') {
          await repos.files.delete(file.id);
        }
        // 'duplicate' falls through — create() mints a fresh id.
      }

      const bytes = Buffer.from(file.dataBase64, 'base64');
      const projectId = file.projectId
        ? idMaps.projects.get(file.projectId) ?? file.projectId
        : null;

      // Same two bridges the backup restore uses: project-bound files land in
      // their project's own store, everything else in the Quilltap Uploads
      // mount under `imported/`.
      let storageKey: string;
      let storedMimeType: string;
      let sizeBytes: number;
      if (projectId) {
        const uploaded = await fileStorageManager.uploadFile({
          filename: file.originalFilename,
          content: bytes,
          contentType: file.mimeType,
          projectId,
          folderPath: file.folderPath || '/',
        });
        storageKey = uploaded.storageKey;
        storedMimeType = uploaded.storedMimeType;
        sizeBytes = uploaded.sizeBytes;
      } else {
        const written = await writeUserUploadToMountStore({
          filename: file.originalFilename,
          content: bytes,
          contentType: file.mimeType,
          subfolder: 'imported',
        });
        storageKey = written.storageKey;
        storedMimeType = written.storedMimeType;
        sizeBytes = written.sizeBytes;
      }

      const { kept, dropped } = await remapLinkedTo(
        file.linkedTo ?? [],
        idMaps,
        repos,
        messageIdCache
      );
      droppedLinks += dropped.length;

      const tags = (file.tags ?? []).map((tagId) => idMaps.tags.get(tagId) ?? tagId);

      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        dataBase64: _bytes,
        _sourceStorageKey,
        _bytesMissing,
        ...fileData
      } = file;

      await repos.files.create({
        ...fileData,
        projectId,
        linkedTo: kept,
        tags,
        // Post-bridge truth, not what the archive claimed (see module header).
        mimeType: storedMimeType,
        size: sizeBytes,
        storageKey,
      });
      imported++;
      moduleLogger.debug('Imported file', {
        originalFilename: file.originalFilename,
        sizeBytes,
        droppedLinkCount: dropped.length,
      });
    } catch (error) {
      warnings.push(
        `Failed to import file "${file.originalFilename}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import file', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  if (droppedLinks > 0) {
    warnings.push(
      `${droppedLinks} file link(s) pointed at entities that are not present on this instance and were dropped.`
    );
  }

  moduleLogger.debug('File library import complete', {
    userId,
    imported,
    skipped,
    foldersImported,
    droppedLinks,
  });

  return { files: imported, folders: foldersImported, skipped };
}
