/**
 * Chat Files API v1 Route
 *
 * POST /api/v1/chats/[id]/files - Upload a file for a chat
 * GET /api/v1/chats/[id]/files - List files for a chat
 *
 * Files include both uploaded attachments and generated images.
 * POST uses FormData for file uploads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, getFilePath } from '@/lib/api/middleware';
import { uploadChatFile, type ConflictResolution } from '@/lib/chat-files-v2';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import { postLibrarianAttachAnnouncement } from '@/lib/services/librarian-notifications/writer';
import { generateImageDescription } from '@/lib/chat/file-attachment-fallback';
import { isPhotosRelativePath } from '@/lib/photos/photos-paths';
import { buildAttachDescriptionFromKeptImage } from '@/lib/photos/keep-image-markdown';
import { nativeTextAttachmentMime } from '@/lib/mount-index/path-utils';
import type { RepositoryContainer } from '@/lib/database/repositories';
import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types';
import type { FileAttachment } from '@/lib/llm/base';

/**
 * POST /api/v1/chats/[id]/files - Upload a file or link an existing file
 *
 * Actions:
 *   ?action=link  - Link an existing library file to this chat (JSON body: { fileId })
 *   (default)     - Upload a new file via FormData
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id: chatId }) => {
    try {
      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);

      if (!chat) {
        return notFound('Chat');
      }

      // Check for action dispatch
      const action = req.nextUrl.searchParams.get('action');

      if (action === 'link') {
        return handleLinkFile(req, repos, chatId);
      }

      if (action === 'attach-mount-file') {
        return handleAttachMountFile(req, repos, user.id, chatId);
      }

      // Default: file upload flow
      // Get the file from form data
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return badRequest('No file provided');
      }

      // Get optional resolution parameters for duplicate handling
      const resolution = formData.get('resolution') as ConflictResolution | null;
      const conflictingFileId = formData.get('conflictingFileId') as string | null;// Upload the file (creates file entry automatically)
      // Pass projectId so files in project chats become project files
      const uploadResult = await uploadChatFile(file, chatId, user.id, {
        projectId: chat.projectId,
        resolution: resolution || undefined,
        conflictingFileId: conflictingFileId || undefined,
      });

      // Check if this is a duplicate detection result
      if ('duplicate' in uploadResult && uploadResult.duplicate) {return NextResponse.json({
          duplicate: true,
          conflictType: uploadResult.conflictType,
          existingFile: uploadResult.existingFile,
          newFile: uploadResult.newFile,
        });
      }

      // Normal upload result - type is narrowed to ChatFileUploadResult
      const successResult = uploadResult as { id: string; filename: string; filepath: string; mimeType: string; size: number };

      // Get the file entry from repository to determine correct filepath
      const fileEntry = await repos.files.findById(successResult.id);
      const filepath = fileEntry ? getFilePath(fileEntry) : successResult.filepath;

      logger.info('[Chats v1 Files] File uploaded', {
        chatId,
        fileId: successResult.id,
        filename: successResult.filename,
      });

      return NextResponse.json({
        file: {
          id: successResult.id,
          filename: successResult.filename,
          filepath,
          mimeType: successResult.mimeType,
          size: successResult.size,
          url: filepath,
        },
      });
    } catch (error) {
      logger.error('[Chats v1 Files] Error uploading chat file', { chatId }, error as Error);

      if (error instanceof Error) {
        // Return validation errors with 400
        if (
          error.message.includes('Invalid file type') ||
          error.message.includes('File size exceeds')
        ) {
          return badRequest(error.message);
        }
      }

      return serverError('Failed to upload file');
    }
  }
);

/**
 * Handle linking an existing library file to a chat
 */
async function handleLinkFile(
  req: NextRequest,
  repos: { files: { findById: (id: string) => Promise<any>; addLink: (fileId: string, entityId: string) => Promise<any> } },
  chatId: string
): Promise<NextResponse> {
  const body = await req.json();
  const { fileId } = body;

  if (!fileId || typeof fileId !== 'string') {
    return badRequest('fileId is required');
  }

  // Verify the file exists
  const file = await repos.files.findById(fileId);
  if (!file) {
    return notFound('File');
  }

  // Link the file to this chat
  const linkedFile = await repos.files.addLink(fileId, chatId);
  if (!linkedFile) {
    return serverError('Failed to link file');
  }

  const filepath = getFilePath(linkedFile);

  logger.info('[Chats v1 Files] File linked from library', {
    chatId,
    fileId: linkedFile.id,
    filename: linkedFile.originalFilename,
  });

  return NextResponse.json({
    file: {
      id: linkedFile.id,
      filename: linkedFile.originalFilename,
      filepath,
      mimeType: linkedFile.mimeType,
      size: linkedFile.size,
      url: filepath,
    },
  });
}

/**
 * Handle a "Librarian announces an attachment" request from the picker.
 *
 * The body is `{ mountPointId, relativePath }`. Resolves to a doc_mount_files
 * row, posts a Librarian announcement message carrying the row's id as a
 * message-level attachment, and returns the file metadata + the announcement
 * message id so the chat UI can refresh.
 *
 * No mount-link table is involved — the announcement message *is* the
 * attachment record. The existing assistant-attachment walker surfaces it to
 * the LLM, and the resolver in chat-files-v2 turns the id into bytes.
 */
/**
 * Ensure an image blob has a description in `doc_mount_blobs.description`,
 * generating one via the configured imageDescriptionProfile if the field is
 * empty. Returns whatever description ends up associated with the blob —
 * cached, freshly generated, or empty string on failure.
 *
 * Reused at every attach so vision providers and non-vision providers can
 * both find the description in the announcement message body.
 */
async function ensureImageDescription(
  repos: RepositoryContainer,
  userId: string,
  blob: { id: string; storedMimeType: string; description: string; originalFileName: string; sizeBytes: number },
): Promise<string> {
  if (!blob.storedMimeType.toLowerCase().startsWith('image/')) {
    return '';
  }
  const existing = blob.description?.trim();
  if (existing) {
    return existing;
  }

  let bytes: Buffer | null = null;
  try {
    bytes = await repos.docMountBlobs.readData(blob.id);
  } catch (err) {
    logger.warn('[Chats v1 Files] Failed to read blob bytes for description', {
      blobId: blob.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
  if (!bytes) {
    return '';
  }

  const fileAttachment: FileAttachment = {
    id: blob.id,
    filename: blob.originalFileName,
    mimeType: blob.storedMimeType,
    size: blob.sizeBytes,
    data: bytes.toString('base64'),
  };

  const result = await generateImageDescription(fileAttachment, repos, userId);
  if (result.type !== 'image_description' || !result.imageDescription) {
    logger.warn('[Chats v1 Files] Image description generation did not return a description', {
      blobId: blob.id,
      resultType: result.type,
      error: result.error,
    });
    return '';
  }

  const description = result.imageDescription.trim();
  try {
    await repos.docMountBlobs.updateDescription(blob.id, description);
    logger.info('[Chats v1 Files] Cached generated image description on blob', {
      blobId: blob.id,
      descriptionLength: description.length,
      descriptionProfileId: result.processingMetadata?.descriptionProfileId,
    });
  } catch (err) {
    logger.warn('[Chats v1 Files] Failed to persist generated description', {
      blobId: blob.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return description;
}

/**
 * Attach a native-text document (a `.md`/`.txt`/`.json` in a database store,
 * held in doc_mount_documents with no blob). Posts the same Librarian
 * announcement as the blob path — the Librarian catalogue entry, not the bytes,
 * is what rides into chat history — carrying the link id so the assistant
 * attachment walker and loadChatFilesForLLM can resolve it back to text.
 */
async function handleAttachMountDocument(
  repos: RepositoryContainer,
  chatId: string,
  mountPointId: string,
  relativePath: string,
  mountFile: DocMountFileLinkWithContent,
  mimeType: string,
): Promise<NextResponse> {
  const mountPoint = await repos.docMountPoints.findById(mountPointId);
  const mountPointName = mountPoint?.name ?? null;
  const displayTitle = mountFile.originalFileName || mountFile.fileName;

  const announcement = await postLibrarianAttachAnnouncement({
    chatId,
    displayTitle,
    filePath: relativePath,
    mountPoint: mountPointName,
    mountFileId: mountFile.id,
    mimeType,
    description: '',
  });

  if (!announcement) {
    return serverError('Failed to post Librarian attachment announcement');
  }

  const url = `/api/v1/mount-points/${mountPointId}/files/${encodeURI(relativePath)}`;

  logger.info('[Chats v1 Files] Mount-point document attached via Librarian', {
    chatId,
    mountFileId: mountFile.id,
    mountPointId,
    relativePath,
    announcementMessageId: announcement.id,
    mimeType,
  });

  return NextResponse.json({
    file: {
      id: mountFile.id,
      filename: displayTitle,
      filepath: url,
      mimeType,
      size: mountFile.fileSizeBytes,
      url,
      type: 'mountFile' as const,
    },
    announcement: {
      id: announcement.id,
      createdAt: announcement.createdAt,
    },
  });
}

async function handleAttachMountFile(
  req: NextRequest,
  repos: RepositoryContainer,
  userId: string,
  chatId: string,
): Promise<NextResponse> {
  const body = await req.json();
  const { mountPointId, relativePath } = body ?? {};

  if (!mountPointId || typeof mountPointId !== 'string') {
    return badRequest('mountPointId is required');
  }
  if (!relativePath || typeof relativePath !== 'string') {
    return badRequest('relativePath is required');
  }

  const mountFile = await repos.docMountFiles.findByMountPointAndPath(mountPointId, relativePath);
  if (!mountFile) {
    return notFound('Mount-point file');
  }

  const blob = await repos.docMountBlobs.findByMountPointAndPath(mountPointId, relativePath);
  if (!blob) {
    // Native-text files (.md/.txt/.json) PUT into a database store become
    // documents (doc_mount_documents, no blob row). The picker lists them, so a
    // blob-only attach path 404'd on exactly those documents (Bug 38). Serve the
    // document to the Librarian instead — its text is what the LLM needs, and
    // loadMountFileAsAttachment resolves the same document back to bytes.
    const textMime = nativeTextAttachmentMime(relativePath);
    const document = textMime
      ? await repos.docMountDocuments.findByFileId(mountFile.fileId)
      : null;
    if (document && textMime) {
      return handleAttachMountDocument(repos, chatId, mountPointId, relativePath, mountFile, textMime);
    }
    logger.warn('[Chats v1 Files] Mount file has no blob or document row, refusing to attach', {
      chatId,
      mountPointId,
      relativePath,
    });
    return notFound('Mount-point file blob');
  }

  const mountPoint = await repos.docMountPoints.findById(mountPointId);
  const mountPointName = mountPoint?.name ?? null;

  // For kept images (anything in a `photos/` folder) the link's extractedText
  // already carries the original generation prompt, scene snapshot, and
  // saver caption — built by keep_image / save-image-to-album. Surface that
  // verbatim instead of running the vision LLM on top of what is, by
  // construction, a richer description than vision could produce.
  let description = '';
  let descriptionSource: 'kept-image-markdown' | 'vision-llm-cached' | 'vision-llm-generated' | 'empty' = 'empty';
  if (isPhotosRelativePath(relativePath)) {
    const fromMarkdown = buildAttachDescriptionFromKeptImage(mountFile.extractedText);
    if (fromMarkdown) {
      description = fromMarkdown;
      descriptionSource = 'kept-image-markdown';
    }
  }
  if (!description) {
    description = await ensureImageDescription(repos, userId, blob);
    if (description) {
      descriptionSource = blob.description?.trim() ? 'vision-llm-cached' : 'vision-llm-generated';
    }
  }

  const announcement = await postLibrarianAttachAnnouncement({
    chatId,
    displayTitle: blob.originalFileName || mountFile.fileName,
    filePath: relativePath,
    mountPoint: mountPointName,
    mountFileId: mountFile.id,
    mimeType: blob.storedMimeType,
    description,
  });

  if (!announcement) {
    return serverError('Failed to post Librarian attachment announcement');
  }

  const url = `/api/v1/mount-points/${mountPointId}/blobs/${encodeURI(relativePath)}`;

  logger.info('[Chats v1 Files] Mount-point file attached via Librarian', {
    chatId,
    mountFileId: mountFile.id,
    mountPointId,
    relativePath,
    announcementMessageId: announcement.id,
    descriptionIncluded: description.length > 0,
    descriptionSource,
  });

  return NextResponse.json({
    file: {
      id: mountFile.id,
      filename: blob.originalFileName || mountFile.fileName,
      filepath: url,
      mimeType: blob.storedMimeType,
      size: blob.sizeBytes,
      url,
      type: 'mountFile' as const,
    },
    announcement: {
      id: announcement.id,
      createdAt: announcement.createdAt,
    },
  });
}

/**
 * GET /api/v1/chats/[id]/files - List files for a chat (includes uploaded files and generated images)
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id: chatId }) => {
    try {
      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);

      if (!chat) {
        return notFound('Chat');
      }

      // Get all files linked to this chat from repository
      const chatFiles = await repos.files.findByLinkedTo(chatId);

      type ChatFilesEntry = {
        id: string;
        filename: string;
        filepath: string;
        mimeType: string;
        size: number;
        url: string;
        createdAt: string;
        type: 'chatFile' | 'generatedImage' | 'mountFile';
      };

      const allFiles: ChatFilesEntry[] = chatFiles.map((f) => ({
        id: f.id,
        filename: f.originalFilename,
        filepath: getFilePath(f),
        mimeType: f.mimeType,
        size: f.size,
        url: getFilePath(f),
        createdAt: f.createdAt,
        type: f.source === 'GENERATED' ? 'generatedImage' : 'chatFile',
      }));

      // Mount-file attachments are recorded only on Librarian announcement
      // messages (no link table). Walk the chat's messages and collect any
      // attachment ids that resolve through doc_mount_files.
      const seenIds = new Set(allFiles.map((f) => f.id));
      try {
        const events = await repos.chats.getMessages(chatId);
        for (const event of events) {
          if (event.type !== 'message') continue;
          const ids = Array.isArray(event.attachments) ? event.attachments : [];
          for (const attachmentId of ids) {
            if (seenIds.has(attachmentId)) continue;
            // Try as a link id (modern) or fall back to file id.
            let mountLink = await repos.docMountFileLinks.findByIdWithContent(attachmentId);
            if (!mountLink) {
              const links = await repos.docMountFileLinks.findByFileId(attachmentId);
              mountLink = links[0] ?? null;
            }
            if (!mountLink) continue;
            const blob = await repos.docMountBlobs.findByFileId(mountLink.fileId);
            if (blob) {
              const url = `/api/v1/mount-points/${mountLink.mountPointId}/blobs/${encodeURI(mountLink.relativePath)}`;
              allFiles.push({
                id: mountLink.id,
                filename: mountLink.originalFileName ?? mountLink.fileName,
                filepath: url,
                mimeType: blob.storedMimeType,
                size: blob.sizeBytes,
                url,
                createdAt: event.createdAt,
                type: 'mountFile',
              });
              seenIds.add(mountLink.id);
              continue;
            }
            // No blob → native-text document (Bug 38). Surface it from the
            // document row so the attached markdown shows in the chat file list.
            const textMime = nativeTextAttachmentMime(mountLink.relativePath);
            if (!textMime) continue;
            const document = await repos.docMountDocuments.findByFileId(mountLink.fileId);
            if (!document) continue;
            const url = `/api/v1/mount-points/${mountLink.mountPointId}/files/${encodeURI(mountLink.relativePath)}`;
            allFiles.push({
              id: mountLink.id,
              filename: mountLink.originalFileName ?? mountLink.fileName,
              filepath: url,
              mimeType: textMime,
              size: mountLink.fileSizeBytes,
              url,
              createdAt: event.createdAt,
              type: 'mountFile',
            });
            seenIds.add(mountLink.id);
          }
        }
      } catch (err) {
        logger.warn('[Chats v1 Files] Failed to enumerate mount-file attachments', {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Sort by creation time, newest first
      allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return NextResponse.json({
        files: allFiles,
      });
    } catch (error) {
      logger.error('[Chats v1 Files] Error listing chat files', { chatId }, error as Error);
      return serverError('Failed to list files');
    }
  }
);
