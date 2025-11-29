/**
 * Image utility functions for handling uploads, URL imports, and image processing
 * Version 2: Uses centralized file manager
 */

import { createHash } from 'crypto';
import fetch from 'node-fetch';
import { createFile, deleteFile, findFileById, readFile } from './file-manager';
import type { FileEntry } from './json-store/schemas/types';

export interface ImageUploadResult {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url?: string;
  sha256: string;
}

/**
 * Allowed image MIME types
 */
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Get image dimensions from buffer
 */
async function getImageDimensions(buffer: Buffer, mimeType: string): Promise<{ width?: number; height?: number }> {
  // For now, we'll return undefined dimensions
  // In a production app, you'd use a library like 'sharp' or 'image-size'
  // to extract actual image dimensions
  return { width: undefined, height: undefined };
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }
}

/**
 * Upload an image file to the server
 */
export async function uploadImage(file: File, userId: string, linkedTo: string[] = []): Promise<ImageUploadResult> {
  validateImageFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, file.type);

  // Create file entry using file manager
  const fileEntry = await createFile({
    buffer,
    originalFilename: file.name,
    mimeType: file.type,
    source: 'UPLOADED',
    category: 'IMAGE',
    userId,
    linkedTo,
    ...dimensions,
  });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: `data/files/storage/${fileEntry.id}.${file.name.split('.').pop()}`,
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    sha256: fileEntry.sha256,
  };
}

/**
 * Import an image from a URL
 */
export async function importImageFromUrl(url: string, userId: string, linkedTo: string[] = []): Promise<ImageUploadResult> {
  // Fetch the image
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`Invalid image type from URL. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
  }

  // Get buffer
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`Image size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, contentType);

  // Determine original filename from URL
  const urlPath = new URL(url).pathname;
  const urlFilename = urlPath.split('/').pop() || 'imported-image';
  const ext = contentType.split('/')[1] || 'jpg';
  const originalFilename = urlFilename.includes('.') ? urlFilename : `${urlFilename}.${ext}`;

  // Create file entry using file manager
  const fileEntry = await createFile({
    buffer,
    originalFilename,
    mimeType: contentType,
    source: 'IMPORTED',
    category: 'IMAGE',
    userId,
    linkedTo,
    description: `Imported from ${url}`,
    ...dimensions,
  });

  return {
    id: fileEntry.id,
    filename: fileEntry.originalFilename,
    filepath: `data/files/storage/${fileEntry.id}.${ext}`,
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    url,
    sha256: fileEntry.sha256,
  };
}

/**
 * Delete an image file from the server
 */
export async function deleteImageById(fileId: string): Promise<void> {
  await deleteFile(fileId);
}

/**
 * Get image file entry by ID
 */
export async function getImageById(fileId: string): Promise<FileEntry | null> {
  return await findFileById(fileId);
}

/**
 * Read image file as buffer
 */
export async function readImageBuffer(fileId: string): Promise<Buffer> {
  return await readFile(fileId);
}

/**
 * Calculate SHA256 hash of buffer
 */
export function calculateSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
