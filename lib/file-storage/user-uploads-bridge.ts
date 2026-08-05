/**
 * Quilltap Uploads Store Bridge
 *
 * Holds the singleton global "Quilltap Uploads" database-backed document
 * store — the home for files produced outside of any project context:
 * chat attachments in project-less chats, pasted/drag-dropped images,
 * capabilities reports, and restored backup files whose original
 * `projectId` was null. Replaces the legacy `<filesDir>/_general/`
 * catch-all on disk.
 *
 * The mount-point id is persisted in `instance_settings.userUploadsMountPointId`
 * (provisioned by `provision-user-uploads-mount-v1`); callers should not look
 * it up by name.
 *
 * Layout inside the mount:
 *
 *   chat/<safeFilename>           — attachments uploaded into a chat with no project
 *   images/<safeFilename>         — paste/drag-drop image uploads outside a project
 *   diagnostics/<safeFilename>    — capabilities-report exports
 *   restored/<safeFilename>       — backup-restore replay of project-less files
 *   imported/<safeFilename>       — `.qtap` file-library import of project-less files
 *
 * Returns the same `mount-blob:{mountPointId}:{blobId}` shim the project,
 * character, and Lantern bridges use, so existing `FileStorageManager` read /
 * delete paths resolve the bytes without change.
 *
 * @module file-storage/user-uploads-bridge
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getUserUploadsMountPointId } from '@/lib/instance-settings';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName } from './bridge-path-helpers';

interface UserUploadsTarget {
  mountPointId: string;
}

export type UserUploadsSubfolder =
  | 'chat'
  | 'images'
  | 'diagnostics'
  | 'restored'
  | 'imported'
  | 'uploads'
  | 'photos';

/**
 * Look up the global Quilltap Uploads mount, if provisioned. Returns null
 * when the migration hasn't yet run or the mount row has been deleted.
 */
export async function getUserUploadsStore(): Promise<UserUploadsTarget | null> {
  try {
    const id = await getUserUploadsMountPointId();
    if (!id) return null;
    const repos = getRepositories();
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) return null;
    if (mp.mountType !== 'database') return null;
    return { mountPointId: mp.id };
  } catch (error) {
    logger.warn('Failed to resolve Quilltap Uploads store', {
      context: 'file-storage.user-uploads-bridge',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface WriteUserUploadInput {
  filename: string;
  content: Buffer;
  contentType: string;
  subfolder: UserUploadsSubfolder;
  description?: string;
}

interface WriteUserUploadResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write a file into the Quilltap Uploads mount. Caller must have verified
 * provisioning via `getUserUploadsStore()`; this throws otherwise. Image
 * bytes that sharp can decode are transcoded to WebP — same policy as the
 * other bridges. Non-image uploads (PDFs, text, archives) are stored as-is.
 */
export async function writeUserUploadToMountStore(
  input: WriteUserUploadInput
): Promise<WriteUserUploadResult> {
  const target = await getUserUploadsStore();
  if (!target) {
    throw new Error('Quilltap Uploads mount has not been provisioned');
  }

  const safeName = sanitizeLeafName(input.filename);
  const desiredPath = `${input.subfolder}/${safeName}`;

  const result = await storeMountFile({
    mountPointId: target.mountPointId,
    relativePath: desiredPath,
    data: input.content,
    originalMimeType: input.contentType,
    originalFileName: safeName,
    description: input.description,
    collisionStrategy: 'unique-suffix',
    treatNativeTextAsDocument: false,
    transcodeImages: true,
    extractText: false,
    enqueueEmbedding: false,
    assetStorage: 'database',
  });

  return {
    storageKey: buildMountBlobStorageKey(result.mountPointId, result.blobId!),
    mountPointId: result.mountPointId,
    blobId: result.blobId!,
    relativePath: result.relativePath,
    storedMimeType: result.storedMimeType,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
  };
}
