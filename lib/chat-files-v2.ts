/**
 * Chat file utility functions for handling file uploads in chat messages
 * Version 2: Uses repository pattern for metadata storage and S3 for file storage when enabled
 */

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { FileAttachment } from './llm/base';
import { getRepositories } from './repositories/factory';
import { uploadFile as uploadS3File, deleteFile as deleteS3File, downloadFile as downloadS3File } from './s3/operations';
import { buildS3Key } from './s3/client';
import type { FileEntry, FileCategory } from './json-store/schemas/types';
import { logger } from '@/lib/logger';

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
 * Allowed file MIME types for chat attachments
 * Includes images and documents that various providers support
 */
const ALLOWED_CHAT_FILE_TYPES = [
  // Images (supported by OpenAI, Anthropic, Grok)
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  // Documents (supported by Anthropic, Grok)
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
];

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Get the file extension from an original filename
 */
function getExtension(filename: string): string {
  const ext = extname(filename);
  return ext || '.bin';
}

/**
 * Get the filepath for a file - always returns API path for S3-backed files
 */
function getFilePath(fileId: string): string {
  return `/api/files/${fileId}`;
}

/**
 * Validate chat file
 */
export function validateChatFile(file: File): void {
  if (!ALLOWED_CHAT_FILE_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_CHAT_FILE_TYPES.join(', ')}`
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    );
  }
}

/**
 * Upload a chat file to the server
 */
export async function uploadChatFile(
  file: File,
  chatId: string,
  userId: string,
  messageId?: string
): Promise<ChatFileUploadResult> {
  validateChatFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // Determine category based on MIME type
  const category: FileCategory = file.type.startsWith('image/') ? 'IMAGE' : 'ATTACHMENT';

  // Build linkedTo array
  const linkedTo: string[] = [chatId];
  if (messageId) {
    linkedTo.push(messageId);
  }

  const repos = getRepositories();

  // Check for duplicate by hash
  const existingFiles = await repos.files.findBySha256(sha256);
  if (existingFiles.length > 0) {
    const existing = existingFiles[0];
    // File already exists, just update the linkedTo array if needed
    const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
    if (updatedLinkedTo.length > existing.linkedTo.length) {
      const updated = await repos.files.update(existing.id, { linkedTo: updatedLinkedTo });
      if (updated) {
        logger.debug('Updated existing chat file with new links', { fileId: existing.id, newLinks: linkedTo });
        return {
          id: updated.id,
          filename: updated.originalFilename,
          filepath: getFilePath(updated.id),
          mimeType: updated.mimeType,
          size: updated.size,
          sha256: updated.sha256,
          width: updated.width || undefined,
          height: updated.height || undefined,
        };
      }
    }
    logger.debug('Chat file with same hash already exists', { fileId: existing.id, sha256 });
    return {
      id: existing.id,
      filename: existing.originalFilename,
      filepath: getFilePath(existing.id),
      mimeType: existing.mimeType,
      size: existing.size,
      sha256: existing.sha256,
      width: existing.width || undefined,
      height: existing.height || undefined,
    };
  }

  // Generate a new file ID
  const fileId = crypto.randomUUID();

  // Upload to S3
  const s3Key = buildS3Key(userId, fileId, file.name, category);
  await uploadS3File(s3Key, buffer, file.type, {
    userId,
    fileId,
    category,
    filename: file.name,
    sha256,
  });
  logger.debug('Uploaded chat file to S3', { fileId, s3Key, size: buffer.length });

  // Create metadata in repository
  const fileEntry = await repos.files.create({
    userId,
    sha256,
    originalFilename: file.name,
    mimeType: file.type,
    size: buffer.length,
    width: null,
    height: null,
    linkedTo,
    source: 'UPLOADED',
    category,
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    description: null,
    tags: [],
    s3Key,
  });

  logger.debug('Created chat file metadata in repository', { fileId: fileEntry.id, s3Key });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: getFilePath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    sha256: fileEntry.sha256,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
  };
}

/**
 * Read a file as base64 from S3
 */
async function readFileAsBase64(fileId: string): Promise<string> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.s3Key) {
    throw new Error(`File ${fileId} has no S3 key - file may need migration`);
  }

  // Download from S3
  const buffer = await downloadS3File(entry.s3Key);
  logger.debug('Downloaded file from S3 for base64', { fileId, s3Key: entry.s3Key, size: buffer.length });

  return buffer.toString('base64');
}

/**
 * Convert file entries to FileAttachment format for LLM
 * Loads file data as base64
 */
export async function loadChatFilesForLLM(
  fileIds: string[]
): Promise<FileAttachment[]> {
  logger.debug('Loading chat files for LLM', { fileIds });
  const attachments: FileAttachment[] = [];
  const repos = getRepositories();

  for (const fileId of fileIds) {
    try {
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.error(`File not found: ${fileId}`, { fileId });
        continue;
      }

      const data = await readFileAsBase64(fileId);

      attachments.push({
        id: fileEntry.id,
        filepath: getFilePath(fileEntry.id),
        filename: fileEntry.originalFilename,
        mimeType: fileEntry.mimeType,
        size: fileEntry.size,
        data,
      });

      logger.debug('Loaded chat file', {
        fileId: fileEntry.id,
        filename: fileEntry.originalFilename,
        mimeType: fileEntry.mimeType,
        size: fileEntry.size,
        dataLength: data?.length || 0,
      });
    } catch (error) {
      logger.error(`Failed to load chat file ${fileId}:`, {}, error instanceof Error ? error : new Error(String(error)));
      // Skip files that can't be loaded
    }
  }

  logger.debug('Loaded chat files for LLM', { count: attachments.length });
  return attachments;
}

/**
 * Delete a chat file from S3 and repository
 */
export async function deleteChatFileById(fileId: string): Promise<void> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    logger.debug('Chat file not found for deletion', { fileId });
    return;
  }

  // Delete the file bytes from S3
  if (entry.s3Key) {
    try {
      await deleteS3File(entry.s3Key);
      logger.debug('Deleted chat file from S3', { fileId, s3Key: entry.s3Key });
    } catch (error) {
      logger.error('Failed to delete chat file from S3', { fileId, s3Key: entry.s3Key }, error instanceof Error ? error : undefined);
    }
  }

  // Delete metadata from repository
  await repos.files.delete(fileId);
  logger.debug('Deleted chat file metadata from repository', { fileId });
}

/**
 * Get chat file entry by ID
 */
export async function getChatFileById(fileId: string): Promise<FileEntry | null> {
  const repos = getRepositories();
  return await repos.files.findById(fileId);
}

/**
 * Read chat file as buffer from S3
 */
export async function readChatFileBuffer(fileId: string): Promise<Buffer> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.s3Key) {
    throw new Error(`File ${fileId} has no S3 key - file may need migration`);
  }

  // Download from S3
  const buffer = await downloadS3File(entry.s3Key);
  logger.debug('Downloaded chat file from S3', { fileId, s3Key: entry.s3Key, size: buffer.length });
  return buffer;
}

/**
 * Get supported MIME types for chat file uploads
 */
export function getSupportedMimeTypes(): string[] {
  return [...ALLOWED_CHAT_FILE_TYPES];
}
