/**
 * Library File Byte Writer
 *
 * The one routing rule for bytes that are about to become a `files` row:
 * project-bound files land in their project's own document store (via
 * `FileStorageManager.uploadFile` → project-store-bridge); project-less files
 * land in the Quilltap Uploads mount under the caller's subfolder, never the
 * legacy `_general/` catch-all on disk.
 *
 * Chat attachments, `.qtap` file-library imports, and backup restore all
 * follow it, and all three must record what the bridge *stored* — MIME type,
 * size, sha256 — rather than what they handed in: either bridge may transcode
 * bitmaps to WebP, and a `files.sha256` naming bytes that were never stored is
 * bug 117 (a FileEntry that cannot be joined to the mount blob it points at).
 *
 * @module file-storage/library-file-writer
 */

import { logger as baseLogger } from '@/lib/logger';
import { fileStorageManager } from './manager';
import { writeUserUploadToMountStore, type UserUploadsSubfolder } from './user-uploads-bridge';

const logger = baseLogger.child({ module: 'file-storage:library-file-writer' });

export interface WriteLibraryFileBytesInput {
  filename: string;
  content: Buffer;
  /** The caller's best guess at the MIME type; the bridge may transcode. */
  contentType: string;
  /** Owning project, or null/undefined for a project-less file. */
  projectId?: string | null;
  /** Folder inside the project store (defaults to `/`); ignored when project-less. */
  folderPath?: string | null;
  /** Quilltap Uploads subfolder for a project-less file. */
  subfolder: UserUploadsSubfolder;
}

/** What the bridge actually persisted — the values a `files` row must carry. */
export interface WriteLibraryFileBytesResult {
  storageKey: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write file bytes through whichever bridge owns them and report the stored
 * identity. Throws whatever the bridge throws (a missing project store, an
 * unprovisioned uploads mount) — callers decide whether that fails the row or
 * the whole operation.
 */
export async function writeLibraryFileBytes(
  input: WriteLibraryFileBytesInput
): Promise<WriteLibraryFileBytesResult> {
  const { filename, content, contentType, projectId, subfolder } = input;

  logger.debug('Writing library file bytes', {
    filename,
    projectId: projectId ?? null,
    subfolder,
    sizeBytes: content.length,
  });

  const written = projectId
    ? await fileStorageManager.uploadFile({
        filename,
        content,
        contentType,
        projectId,
        folderPath: input.folderPath || '/',
      })
    : await writeUserUploadToMountStore({ filename, content, contentType, subfolder });

  return {
    storageKey: written.storageKey,
    storedMimeType: written.storedMimeType,
    sizeBytes: written.sizeBytes,
    sha256: written.sha256,
  };
}
