/**
 * Chat file utility functions for handling file uploads in chat messages
 * Version 2: Uses centralized file manager
 */

import { createHash } from 'node:crypto';
import { FileAttachment } from './llm/base';
import { createFile, findFileById, deleteFile, readFile, readFileAsBase64 } from './file-manager';
import type { FileEntry } from './json-store/schemas/types';

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

  // Determine category based on MIME type
  const category = file.type.startsWith('image/') ? 'IMAGE' : 'ATTACHMENT';

  // Build linkedTo array
  const linkedTo: string[] = [chatId];
  if (messageId) {
    linkedTo.push(messageId);
  }

  // Create file entry using file manager
  const fileEntry = await createFile({
    buffer,
    originalFilename: file.name,
    mimeType: file.type,
    source: 'UPLOADED',
    category,
    userId,
    linkedTo,
  });

  const ext = file.name.split('.').pop() || 'bin';

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: `data/files/storage/${fileEntry.id}.${ext}`,
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    sha256: fileEntry.sha256,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
  };
}

/**
 * Convert file entries to FileAttachment format for LLM
 * Loads file data as base64
 */
export async function loadChatFilesForLLM(
  fileIds: string[]
): Promise<FileAttachment[]> {
  const attachments: FileAttachment[] = [];

  for (const fileId of fileIds) {
    try {
      const fileEntry = await findFileById(fileId);
      if (!fileEntry) {
        console.error(`File not found: ${fileId}`);
        continue;
      }

      const data = await readFileAsBase64(fileId);
      const ext = fileEntry.originalFilename.split('.').pop() || 'bin';

      attachments.push({
        id: fileEntry.id,
        filepath: `data/files/storage/${fileEntry.id}.${ext}`,
        filename: fileEntry.originalFilename,
        mimeType: fileEntry.mimeType,
        size: fileEntry.size,
        data,
      });
    } catch (error) {
      console.error(`Failed to load chat file ${fileId}:`, error);
      // Skip files that can't be loaded
    }
  }

  return attachments;
}

/**
 * Delete a chat file from the server
 */
export async function deleteChatFileById(fileId: string): Promise<void> {
  await deleteFile(fileId);
}

/**
 * Get chat file entry by ID
 */
export async function getChatFileById(fileId: string): Promise<FileEntry | null> {
  return await findFileById(fileId);
}

/**
 * Read chat file as buffer
 */
export async function readChatFileBuffer(fileId: string): Promise<Buffer> {
  return await readFile(fileId);
}

/**
 * Get supported MIME types for chat file uploads
 */
export function getSupportedMimeTypes(): string[] {
  return [...ALLOWED_CHAT_FILE_TYPES];
}
