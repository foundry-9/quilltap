/**
 * Chat file utility functions for handling file uploads in chat messages
 * Version 2: Uses repository pattern for metadata storage and centralized file storage manager
 */

import { extname } from 'node:path';
import { transcodeToWebP } from './mount-index/blob-transcode';
import { FileAttachment } from './llm/base';
import { getRepositories } from './repositories/factory';
import { fileStorageManager } from './file-storage/manager';
import { writeUserUploadToMountStore } from './file-storage/user-uploads-bridge';
import { detectTextContent, getBestMimeType } from './files/text-detection';
import type { FileEntry, FileCategory, Provider } from './schemas/types';
import { logger } from '@/lib/logger';
import { getInheritedTags } from './files/tag-inheritance';
import { resizeImageForProvider, canResizeImage, calculateBase64Size, getProviderMaxBase64Size } from './files/image-processing';
import { autoDescribeChatImageAttachment } from './photos/auto-describe-attachment';
import { nativeTextAttachmentMime } from './mount-index/path-utils';

export interface ChatFileUploadResult {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  sha256: string;
  width?: number;
  height?: number;
}

/**
 * Result when a duplicate file is detected in project uploads
 */
export interface ChatFileDuplicateResult {
  duplicate: true;
  conflictType: 'filename' | 'content' | 'both';
  existingFile: {
    id: string;
    filename: string;
    size: number;
    createdAt: string;
    sha256: string;
  };
  newFile: {
    filename: string;
    size: number;
    sha256: string;
  };
}

/**
 * Resolution action for duplicate file conflicts
 */
export type ConflictResolution = 'replace' | 'keepBoth' | 'skip';

/**
 * Options for chat file upload
 */
export interface ChatFileUploadOptions {
  /** Message ID to link the file to */
  messageId?: string;
  /** Project ID if this chat belongs to a project */
  projectId?: string | null;
  /** Resolution action for duplicate conflicts */
  resolution?: ConflictResolution;
  /** ID of the conflicting file (for replace action) */
  conflictingFileId?: string;
}

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Generate a unique filename by appending (1), (2), etc.
 * @param filename - Original filename
 * @param existingFilenames - Set of filenames that already exist
 */
function generateUniqueFilename(
  filename: string,
  existingFilenames: Set<string>
): string {
  if (!existingFilenames.has(filename)) {
    return filename;
  }

  const ext = extname(filename);
  const basename = ext ? filename.slice(0, -ext.length) : filename;

  let counter = 1;
  let newName = `${basename} (${counter})${ext}`;

  while (existingFilenames.has(newName)) {
    counter++;
    newName = `${basename} (${counter})${ext}`;
  }

  return newName;
}

/**
 * Get the filepath for a file - always returns API path for S3-backed files
 */
function getFileApiPath(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

/**
 * Validate chat file (size only - no type restrictions)
 */
export function validateChatFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    );
  }
}

/**
 * Upload a chat file to the server
 * When projectId is provided, the file is stored as a project file with duplicate detection
 */
export async function uploadChatFile(
  file: File,
  chatId: string,
  userId: string,
  options: ChatFileUploadOptions = {}
): Promise<ChatFileUploadResult | ChatFileDuplicateResult> {
  const { messageId, projectId, resolution, conflictingFileId } = options;

  validateChatFile(file);

  const bytes = await file.arrayBuffer();
  const inputBuffer = Buffer.from(bytes);

  // Detect text content and infer better MIME type if needed. This reads the
  // *input* bytes, before any transcode, which is the only thing it can mean.
  const textDetection = detectTextContent(inputBuffer, file.name, file.type);
  const inputMimeType = getBestMimeType(textDetection, file.type);

  // Bug 117: run the transcode the storage bridge is about to run, here,
  // before anything is hashed — the same shape `lib/images-v2.ts` has always
  // had, and the reason all 2541 of its generated rows join cleanly while
  // 118 of 239 chat uploads did not.
  //
  // `transcodeToWebP` is the bridge's own function (`storeMountFile` calls it
  // with these exact arguments) and is a no-op for anything already WebP or
  // not an image, so handing it the result a second time changes nothing: the
  // bytes we hash here are the bytes that land on disk. That makes one hash
  // serve both jobs — dedup against other uploads, *and* the join to
  // `doc_mount_files.sha256` that carries a description into the search index
  // and lets describe_image/attach_image resolve a mount link back to its
  // FileEntry.
  //
  // The residual: sharp's WebP encoding has to be deterministic for dedup to
  // keep working across two uploads of the same source file. It is, for a
  // given sharp version; a version bump can cost a missed duplicate (a second
  // row, nothing worse), which is the same bargain images-v2 has always made.
  const stored = await transcodeToWebP(inputBuffer, inputMimeType);
  const buffer = stored.data;
  const mimeType = stored.storedMimeType;
  const sha256 = stored.sha256;

  // Determine category based on MIME type
  const category: FileCategory = mimeType.startsWith('image/') ? 'IMAGE' : 'ATTACHMENT';

  // Build linkedTo array
  const linkedTo: string[] = [chatId];
  if (messageId) {
    linkedTo.push(messageId);
  }

  const repos = getRepositories();

  // For project files, check for duplicates within the project
  if (projectId) {
    // Check for content duplicate (same SHA256) in project
    const existingByHash = await repos.files.findBySha256(sha256);
    const contentDuplicate = existingByHash.find(f => f.projectId === projectId);

    // Check for filename duplicate in project
    const existingByName = await repos.files.findByFilenameInProject(userId, projectId, file.name);
    const filenameDuplicate = existingByName.length > 0 ? existingByName[0] : null;

    // Determine conflict type
    const hasContentConflict = !!contentDuplicate;
    const hasFilenameConflict = !!filenameDuplicate;

    if ((hasContentConflict || hasFilenameConflict) && !resolution) {
      // Duplicate detected and no resolution provided - return conflict info
      const conflictType: 'filename' | 'content' | 'both' =
        hasContentConflict && hasFilenameConflict ? 'both' :
        hasContentConflict ? 'content' : 'filename';

      // Use the more relevant duplicate for the response
      const existingFile = hasFilenameConflict ? filenameDuplicate! : contentDuplicate!;
      return {
        duplicate: true,
        conflictType,
        existingFile: {
          id: existingFile.id,
          filename: existingFile.originalFilename,
          size: existingFile.size,
          createdAt: existingFile.createdAt,
          sha256: existingFile.sha256,
        },
        newFile: {
          filename: file.name,
          size: buffer.length,
          sha256,
        },
      };
    }

    // Handle resolution
    if (resolution) {
      if (resolution === 'skip') {
        // User chose to skip - return the existing file info
        const existingFile = conflictingFileId
          ? await repos.files.findById(conflictingFileId)
          : (filenameDuplicate || contentDuplicate);

        if (existingFile) {
          // Link the existing file to this chat (and optional message) so the
          // LLM context loader can find it via findByLinkedTo(chatId). Without
          // this, the message saves with the fileId in its attachments array
          // but the bytes never reach the provider.
          let linked = existingFile;
          for (const entityId of linkedTo) {
            const updated = await repos.files.addLink(linked.id, entityId);
            if (updated) {
              linked = updated;
            }
          }
          return {
            id: linked.id,
            filename: linked.originalFilename,
            filepath: getFileApiPath(linked.id),
            mimeType: linked.mimeType,
            size: linked.size,
            sha256: linked.sha256,
            width: linked.width || undefined,
            height: linked.height || undefined,
          };
        }
      }

      if (resolution === 'replace' && conflictingFileId) {
        // Delete the existing file first
        const existingFile = await repos.files.findById(conflictingFileId);
        if (existingFile) {
          try {
            await fileStorageManager.deleteFile(existingFile);
          } catch (error) {
            logger.error('Failed to delete existing file from storage', {
              context: 'chat-files-v2',
              fileId: conflictingFileId,
            }, error instanceof Error ? error : undefined);
          }
        }
        await repos.files.delete(conflictingFileId);
      }

      // For 'keepBoth', generate a unique filename
      let finalFilename = file.name;
      if (resolution === 'keepBoth') {
        const projectFiles = await repos.files.findByProjectId(userId, projectId);
        const existingFilenames = new Set(projectFiles.map(f => f.originalFilename));
        finalFilename = generateUniqueFilename(file.name, existingFilenames);
      }

      // Proceed with upload using the final filename
      return await uploadFileToProject(
        buffer,
        finalFilename,
        mimeType,
        sha256,
        category,
        userId,
        projectId,
        linkedTo,
        textDetection.isPlainText
      );
    }
  }

  // Non-project files: use existing behavior with hash-based deduplication
  const existingFiles = await repos.files.findBySha256(sha256);
  if (existingFiles.length > 0) {
    const existing = existingFiles[0];
    // File already exists, just update the linkedTo array if needed
    const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
    if (updatedLinkedTo.length > existing.linkedTo.length) {
      const updated = await repos.files.update(existing.id, { linkedTo: updatedLinkedTo });
      if (updated) {
        return {
          id: updated.id,
          filename: updated.originalFilename,
          filepath: getFileApiPath(updated.id),
          mimeType: updated.mimeType,
          size: updated.size,
          sha256: updated.sha256,
          width: updated.width || undefined,
          height: updated.height || undefined,
        };
      }
    }
    return {
      id: existing.id,
      filename: existing.originalFilename,
      filepath: getFileApiPath(existing.id),
      mimeType: existing.mimeType,
      size: existing.size,
      sha256: existing.sha256,
      width: existing.width || undefined,
      height: existing.height || undefined,
    };
  }

  // No project - upload as before (general file)
  return await uploadFileToProject(
    buffer,
    file.name,
    mimeType,
    sha256,
    category,
    userId,
    projectId || undefined,
    linkedTo,
    textDetection.isPlainText
  );
}

/**
 * Internal helper to upload file to S3 and create repository entry.
 *
 * `buffer` / `mimeType` / `sha256` all describe the *stored* bytes — the
 * caller has already run the bridge's transcode (bug 117). The hash is passed
 * in only so a bridge that disagrees can be caught below; the bridge's own
 * answer is what reaches the row.
 */
async function uploadFileToProject(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  sha256: string,
  category: FileCategory,
  userId: string,
  projectId: string | undefined,
  linkedTo: string[],
  isPlainText?: boolean
): Promise<ChatFileUploadResult> {
  const repos = getRepositories();

  // Generate a new file ID
  const fileId = crypto.randomUUID();

  // Route project-bound attachments through the project mount (via FSM, which
  // resolves to project-store-bridge). Project-less attachments land in the
  // Quilltap Uploads mount under chat/, not the catch-all _general/.
  let storageKey: string;
  let fileFolderPath: string | null;
  let fileProjectId: string | null;
  // The bridges may transcode bitmap uploads to WebP; the FileEntry must
  // record the stored mimeType/size/sha256 — all three — not the input.
  // mimeType and size were always taken from here; sha256 was not, and that
  // one omission is bug 117: `files.sha256` named bytes that were never
  // stored, so every join to `doc_mount_files.sha256` was between two
  // different languages and returned an empty result nobody logged.
  let storedMimeType: string;
  let storedSize: number;
  let storedSha256: string;
  if (projectId) {
    const uploaded = await fileStorageManager.uploadFile({
      filename,
      content: buffer,
      contentType: mimeType,
      projectId,
      folderPath: '/',
    });
    storageKey = uploaded.storageKey;
    storedMimeType = uploaded.storedMimeType;
    storedSize = uploaded.sizeBytes;
    storedSha256 = uploaded.sha256;
    fileFolderPath = '/';
    fileProjectId = projectId;
  } else {
    const written = await writeUserUploadToMountStore({
      filename,
      content: buffer,
      contentType: mimeType,
      subfolder: 'chat',
    });
    storageKey = written.storageKey;
    storedMimeType = written.storedMimeType;
    storedSize = written.sizeBytes;
    storedSha256 = written.sha256;
    fileFolderPath = null;
    fileProjectId = null;
  }

  // The caller pre-ran the bridge's own transcode, so these agree by
  // construction. If they ever stop agreeing, a bridge has changed its
  // storage policy and the dedup hash computed upstream is stale — say so
  // rather than let the join rot silently a second time. The bridge wins.
  if (storedSha256 !== sha256) {
    logger.warn('Stored-bytes hash differs from the pre-upload hash; recording the stored one', {
      context: 'chat-files-v2',
      filename,
      preUploadSha256: sha256,
      storedSha256,
      storedMimeType,
    });
  }
  // Inherit tags from the chat (and any other linked entities)
  const inheritedTags = await getInheritedTags(linkedTo, userId);
  // Create metadata in repository
  // IMPORTANT: Pass the fileId to ensure metadata matches storage path
  const fileEntry = await repos.files.create({
    userId,
    sha256: storedSha256,
    originalFilename: filename,
    mimeType: storedMimeType,
    size: storedSize,
    width: null,
    height: null,
    isPlainText,
    linkedTo,
    source: 'UPLOADED',
    category,
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    description: null,
    tags: inheritedTags,
    projectId: fileProjectId,
    folderPath: fileFolderPath,
    storageKey,
  }, { id: fileId });

  // Fire-and-forget vision-describe for image uploads. The describe call
  // takes 5-15s; running it inline would block the upload response. Failures
  // are logged inside the orchestrator — the upload still succeeds.
  if (category === 'IMAGE') {
    void autoDescribeChatImageAttachment({ fileEntryId: fileEntry.id, userId, repos })
      .catch(err => {
        logger.warn('Auto-describe failed for chat image upload', {
          module: 'chat-files-v2',
          fileId: fileEntry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: getFileApiPath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    sha256: fileEntry.sha256,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
  };
}

/**
 * Options for loading chat files for LLM
 */
export interface LoadChatFilesOptions {
  /** The provider being used (for size limit calculation) */
  provider?: Provider
  /** Whether to automatically resize images that exceed limits (default: true) */
  autoResize?: boolean
}

/**
 * Read a file as base64 from S3, optionally resizing images for provider limits
 */
async function readFileAsBase64(
  fileId: string,
  mimeType: string,
  provider?: Provider
): Promise<{ data: string; wasResized?: boolean; mimeType: string }> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.storageKey) {
    throw new Error(`File ${fileId} has no storage key - file may need migration`);
  }

  // Download from file storage
  let buffer = await fileStorageManager.downloadFile(entry);
  let outputMimeType = mimeType;
  let wasResized = false;
  // Check if this is an image that might need resizing
  if (provider && mimeType.startsWith('image/') && canResizeImage(mimeType)) {
    const maxBase64Size = getProviderMaxBase64Size(provider);
    const base64Size = calculateBase64Size(buffer);

    if (base64Size > maxBase64Size) {
      logger.info('Image exceeds provider limits, attempting resize', {
        module: 'chat-files-v2',
        fileId,
        originalSize: buffer.length,
        base64Size,
        maxBase64Size,
        provider,
      });

      const resizeResult = await resizeImageForProvider({
        provider,
        buffer,
        mimeType,
        filename: entry.originalFilename,
      });

      if (resizeResult.wasResized) {
        buffer = resizeResult.buffer;
        outputMimeType = resizeResult.mimeType;
        wasResized = true;

        logger.info('Image resized successfully', {
          module: 'chat-files-v2',
          fileId,
          originalSize: resizeResult.originalSize,
          finalSize: resizeResult.finalSize,
          dimensions: resizeResult.width && resizeResult.height
            ? `${resizeResult.width}x${resizeResult.height}`
            : 'unknown',
        });
      }
    }
  }

  return {
    data: buffer.toString('base64'),
    wasResized,
    mimeType: outputMimeType,
  };
}

/**
 * Load a Scriptorium document-store file (doc_mount_files row) as a
 * FileAttachment for the LLM. Used when an attachment id refers to a
 * mount-point file rather than a row in the legacy `files` table — the two
 * tables draw IDs from disjoint UUID space, so callers can probe the legacy
 * table first and fall through here on miss. Returns null when the id isn't
 * a mount-file or its bytes are unreachable.
 */
async function loadMountFileAsAttachment(
  mountFileId: string,
  options: LoadChatFilesOptions = {}
): Promise<FileAttachment | null> {
  const { provider, autoResize = true } = options;
  const repos = getRepositories();

  // The chat attachment id can be either a file id or a link id depending
  // on when the chat was created. Try as a link id first (the modern path);
  // fall back to looking up by file id.
  let mountLink = await repos.docMountFileLinks.findByIdWithContent(mountFileId);
  if (!mountLink) {
    const links = await repos.docMountFileLinks.findByFileId(mountFileId);
    mountLink = links[0] ?? null;
  }
  if (!mountLink) {
    return null;
  }

  const blob = await repos.docMountBlobs.findByFileId(mountLink.fileId);
  if (!blob) {
    // Native-text documents (.md/.txt/.json in a database store) have no blob;
    // their bytes live in doc_mount_documents. Serve the document text so an
    // attached markdown document actually reaches the LLM (Bug 38).
    const textMime = nativeTextAttachmentMime(mountLink.relativePath);
    if (textMime) {
      const document = await repos.docMountDocuments.findByFileId(mountLink.fileId);
      if (document) {
        const buffer = Buffer.from(document.content, 'utf-8');
        const url = `/api/v1/mount-points/${mountLink.mountPointId}/files/${encodeURI(mountLink.relativePath)}`;
        return {
          id: mountLink.id,
          filepath: url,
          filename: mountLink.originalFileName ?? mountLink.fileName,
          mimeType: textMime,
          size: buffer.length,
          data: buffer.toString('base64'),
          url,
        };
      }
    }
    logger.warn('[chat-files-v2] Mount file has no blob or document row', {
      mountFileId,
      mountPointId: mountLink.mountPointId,
      relativePath: mountLink.relativePath,
    });
    return null;
  }

  const bytes = await repos.docMountBlobs.readData(blob.id);
  if (!bytes) {
    logger.warn('[chat-files-v2] Mount blob bytes unreadable', {
      mountFileId,
      blobId: blob.id,
    });
    return null;
  }

  let buffer = bytes;
  let outputMimeType = blob.storedMimeType;

  if (autoResize && provider && outputMimeType.startsWith('image/') && canResizeImage(outputMimeType)) {
    const maxBase64Size = getProviderMaxBase64Size(provider);
    const base64Size = calculateBase64Size(buffer);
    if (base64Size > maxBase64Size) {
      logger.info('[chat-files-v2] Mount image exceeds provider limits, resizing', {
        mountFileId,
        originalSize: buffer.length,
        base64Size,
        maxBase64Size,
        provider,
      });
      const resizeResult = await resizeImageForProvider({
        provider,
        buffer,
        mimeType: outputMimeType,
        filename: mountLink.originalFileName ?? mountLink.fileName,
      });
      if (resizeResult.wasResized) {
        buffer = resizeResult.buffer;
        outputMimeType = resizeResult.mimeType;
      }
    }
  }

  const url = `/api/v1/mount-points/${mountLink.mountPointId}/blobs/${encodeURI(mountLink.relativePath)}`;

  return {
    id: mountLink.id,
    filepath: url,
    filename: mountLink.originalFileName ?? mountLink.fileName,
    mimeType: outputMimeType,
    size: buffer.length,
    data: buffer.toString('base64'),
    url,
  };
}

/**
 * Convert file entries to FileAttachment format for LLM
 * Loads file data as base64, optionally resizing images for provider limits.
 *
 * Each id is probed against the legacy `files` table first; on miss it falls
 * through to the Scriptorium document-store (doc_mount_files), so chats can
 * mix uploaded attachments with mount-linked documents in the same set.
 */
export async function loadChatFilesForLLM(
  fileIds: string[],
  options: LoadChatFilesOptions = {}
): Promise<FileAttachment[]> {
  const { provider, autoResize = true } = options;
  const attachments: FileAttachment[] = [];
  const repos = getRepositories();

  for (const fileId of fileIds) {
    try {
      const fileEntry = await repos.files.findById(fileId);
      if (fileEntry) {
        const { data, mimeType } = await readFileAsBase64(
          fileId,
          fileEntry.mimeType,
          autoResize ? provider : undefined
        );

        attachments.push({
          id: fileEntry.id,
          filepath: getFileApiPath(fileEntry.id),
          filename: fileEntry.originalFilename,
          mimeType,
          size: fileEntry.size,
          data,
        });
        continue;
      }

      const mountAttachment = await loadMountFileAsAttachment(fileId, options);
      if (mountAttachment) {
        attachments.push(mountAttachment);
        continue;
      }

      logger.error(`File not found in either files or doc_mount_files: ${fileId}`, { fileId });
    } catch (error) {
      logger.error(`Failed to load chat file ${fileId}:`, {}, error instanceof Error ? error : new Error(String(error)));
      // Skip files that can't be loaded
    }
  }
  return attachments;
}
