/**
 * Compatibility Layer for File Manager
 *
 * Provides backwards-compatible interfaces and helpers for transitioning
 * from the old BinaryIndexEntry system to the new FileEntry system.
 */

import type { BinaryIndexEntry, FileEntry } from '../json-store/schemas/types';
import { getFileUrl } from './index';

/**
 * Convert a FileEntry to a BinaryIndexEntry (for legacy code)
 */
export function fileEntryToBinaryEntry(fileEntry: FileEntry, userId: string): BinaryIndexEntry {
  // Determine type from category
  let type: 'image' | 'chat_file' | 'avatar';
  switch (fileEntry.category) {
    case 'IMAGE':
      type = 'image';
      break;
    case 'AVATAR':
      type = 'avatar';
      break;
    default:
      type = 'chat_file';
  }

  // Determine source
  let source: 'upload' | 'import' | 'generated';
  switch (fileEntry.source) {
    case 'UPLOADED':
      source = 'upload';
      break;
    case 'IMPORTED':
      source = 'import';
      break;
    case 'GENERATED':
      source = 'generated';
      break;
    default:
      source = 'upload';
  }

  // Extract specific IDs from linkedTo array
  const messageId = fileEntry.linkedTo.find(id => id.startsWith('msg-')) || null;
  const chatId = fileEntry.linkedTo.find(id => id.startsWith('chat-')) || fileEntry.linkedTo[0] || null;
  const characterId = fileEntry.linkedTo.find(id => id.startsWith('char-')) || null;

  // Build relative path for legacy API
  const ext = fileEntry.originalFilename.split('.').pop() || '';
  const relativePath = `files/storage/${fileEntry.id}.${ext}`;

  return {
    id: fileEntry.id,
    sha256: fileEntry.sha256,
    type,
    userId,
    filename: fileEntry.originalFilename,
    relativePath,
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    source,
    generationPrompt: fileEntry.generationPrompt || undefined,
    generationModel: fileEntry.generationModel || undefined,
    chatId: chatId || undefined,
    characterId: characterId || undefined,
    messageId: messageId || undefined,
    tags: fileEntry.tags,
    createdAt: fileEntry.createdAt,
    updatedAt: fileEntry.updatedAt,
  };
}

/**
 * Get file URL with proper extension
 */
export function getCompatFileUrl(fileEntry: FileEntry): string {
  return getFileUrl(fileEntry.id, fileEntry.originalFilename);
}

/**
 * Check if a FileEntry is an image
 */
export function isImageFile(fileEntry: FileEntry): boolean {
  return fileEntry.category === 'IMAGE' || fileEntry.category === 'AVATAR' ||
         fileEntry.mimeType.startsWith('image/');
}

/**
 * Check if a FileEntry is a document
 */
export function isDocumentFile(fileEntry: FileEntry): boolean {
  return fileEntry.category === 'DOCUMENT' ||
         fileEntry.mimeType.startsWith('text/') ||
         fileEntry.mimeType === 'application/pdf';
}

/**
 * Get file extension from FileEntry
 */
export function getFileExtension(fileEntry: FileEntry): string {
  const parts = fileEntry.originalFilename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * Check if file is linked to a specific entity
 */
export function isLinkedTo(fileEntry: FileEntry, entityId: string): boolean {
  return fileEntry.linkedTo.includes(entityId);
}

/**
 * Get all message IDs linked to this file
 */
export function getLinkedMessages(fileEntry: FileEntry): string[] {
  // This is a simple heuristic - in practice you might want a better way
  // to identify message IDs vs other entity IDs
  return fileEntry.linkedTo.filter(id => {
    // Assuming message IDs follow a pattern or you have a way to identify them
    return true; // Return all for now, refine as needed
  });
}

/**
 * Get all chat IDs linked to this file
 */
export function getLinkedChats(fileEntry: FileEntry): string[] {
  return fileEntry.linkedTo.filter(id => {
    // Refine based on your ID patterns
    return true;
  });
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get a human-readable description of the file source
 */
export function getSourceLabel(source: FileEntry['source']): string {
  switch (source) {
    case 'UPLOADED':
      return 'Uploaded';
    case 'GENERATED':
      return 'AI Generated';
    case 'IMPORTED':
      return 'Imported';
    case 'SYSTEM':
      return 'System';
    default:
      return 'Unknown';
  }
}

/**
 * Get a human-readable description of the file category
 */
export function getCategoryLabel(category: FileEntry['category']): string {
  switch (category) {
    case 'IMAGE':
      return 'Image';
    case 'DOCUMENT':
      return 'Document';
    case 'AVATAR':
      return 'Avatar';
    case 'ATTACHMENT':
      return 'Attachment';
    case 'EXPORT':
      return 'Export';
    default:
      return 'File';
  }
}
