/**
 * Image utility functions for handling uploads, URL imports, and image processing
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';

export interface ImageUploadResult {
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url?: string;
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
export async function uploadImage(file: File, userId: string): Promise<ImageUploadResult> {
  validateImageFile(file);

  // Generate unique filename
  const ext = file.name.split('.').pop() || 'jpg';
  const filename = `${userId}_${Date.now()}_${randomUUID()}.${ext}`;

  // Create user-specific directory
  const userDir = join(process.cwd(), 'public', 'uploads', 'images', userId);
  await mkdir(userDir, { recursive: true });

  // Save file
  const filepath = join('uploads', 'images', userId, filename);
  const fullPath = join(process.cwd(), 'public', filepath);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  await writeFile(fullPath, buffer);

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, file.type);

  return {
    filename,
    filepath,
    mimeType: file.type,
    size: file.size,
    ...dimensions,
  };
}

/**
 * Import an image from a URL
 */
export async function importImageFromUrl(url: string, userId: string): Promise<ImageUploadResult> {
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

  // Generate unique filename
  const ext = contentType.split('/')[1] || 'jpg';
  const filename = `${userId}_${Date.now()}_${randomUUID()}.${ext}`;

  // Create user-specific directory
  const userDir = join(process.cwd(), 'public', 'uploads', 'images', userId);
  await mkdir(userDir, { recursive: true });

  // Save file
  const filepath = join('uploads', 'images', userId, filename);
  const fullPath = join(process.cwd(), 'public', filepath);

  await writeFile(fullPath, buffer);

  // Get image dimensions
  const dimensions = await getImageDimensions(buffer, contentType);

  return {
    filename,
    filepath,
    mimeType: contentType,
    size: buffer.length,
    url,
    ...dimensions,
  };
}

/**
 * Delete an image file from the server
 */
export async function deleteImage(filepath: string): Promise<void> {
  const { unlink } = await import('fs/promises');
  const fullPath = join(process.cwd(), 'public', filepath);

  try {
    await unlink(fullPath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
