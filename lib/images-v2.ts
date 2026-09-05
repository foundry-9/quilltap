/**
 * Image utility functions for handling uploads, URL imports, and image processing
 * Version 2: Uses repository pattern for metadata storage and file storage manager for file storage
 */

import { extname } from 'node:path';
import fetch from 'node-fetch';
import { getRepositories } from './repositories/factory';
import { fileStorageManager } from './file-storage/manager';
import { writeUserUploadToMountStore } from './file-storage/user-uploads-bridge';
import type { FileEntry, FileSource, FileCategory } from './schemas/types';
import { logger } from './logger';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { getInheritedTags, mergeTags } from './files/tag-inheritance';
import { convertToWebP } from './files/webp-conversion';

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
 * Get image dimensions from buffer using sharp
 */
async function getImageDimensions(buffer: Buffer, _mimeType: string): Promise<{ width?: number; height?: number }> {
  try {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    return { width: undefined, height: undefined };
  }
}

/**
 * Get the filepath for a file - always returns the API path for S3-backed files
 */
function getFileApiPath(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

interface CreateFileParams {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  source: FileSource;
  category: FileCategory;
  userId: string;
  linkedTo?: string[];
  tags?: string[];
  width?: number;
  height?: number;
  generationPrompt?: string;
  generationModel?: string;
  generationRevisedPrompt?: string;
  description?: string;
}

/**
 * Create a new file - stores bytes to S3 and metadata to repository
 */
async function createFile(params: CreateFileParams): Promise<FileEntry> {
  const {
    source,
    category,
    userId,
    linkedTo = [],
    tags = [],
    width,
    height,
    generationPrompt,
    generationModel,
    generationRevisedPrompt,
    description,
  } = params;

  let { buffer, originalFilename, mimeType } = params;

  const repos = getRepositories();

  // Auto-convert raster images to WebP (SVGs pass through unchanged)
  if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
    const converted = await convertToWebP(buffer, mimeType, originalFilename);
    if (converted.wasConverted) {
      buffer = converted.buffer;
      mimeType = converted.mimeType;
      originalFilename = converted.filename;
    }
  }

  const sha256 = sha256OfBuffer(buffer);

  // Check for duplicate by hash
  const existingFiles = await repos.files.findBySha256(sha256);
  if (existingFiles.length > 0) {
    const existing = existingFiles[0];

    // Verify the actual file bytes still exist in storage before returning the cached entry
    let fileExists = false;
    try {
      fileExists = await fileStorageManager.fileExists(existing);
    } catch {
    }

    if (fileExists) {
      // File already exists, just update the linkedTo array if needed
      const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
      if (updatedLinkedTo.length > existing.linkedTo.length) {
        const updated = await repos.files.update(existing.id, { linkedTo: updatedLinkedTo });
        if (updated) {
          return updated;
        }
      }
      return existing;
    } else {
      // File bytes are missing - delete the orphaned metadata and proceed with fresh upload
      logger.info('Cleaning up orphaned file metadata before re-upload', { fileId: existing.id, sha256 });
      await repos.files.delete(existing.id);
    }
  }

  // Generate a new file ID
  const fileId = crypto.randomUUID();

  // images-v2 covers paste/drag-drop image uploads and URL imports — neither
  // ever carries a projectId, so route directly into the Quilltap Uploads
  // mount under images/ rather than the catch-all _general/.
  const written = await writeUserUploadToMountStore({
    filename: originalFilename,
    content: buffer,
    contentType: mimeType,
    subfolder: 'images',
  });
  // Inherit tags from linked entities and merge with any explicitly provided tags
  const inheritedTags = await getInheritedTags(linkedTo, userId);
  const finalTags = mergeTags(tags, inheritedTags);
  // Create metadata in repository. The bridge may transcode bitmap uploads
  // to WebP; record the stored mime/size, not the input — vision providers
  // reject "media_type X but bytes are Y" mismatches.
  // IMPORTANT: Pass the fileId to ensure metadata matches storage path
  const fileEntry = await repos.files.create({
    userId,
    sha256,
    originalFilename,
    mimeType: written.storedMimeType,
    size: written.sizeBytes,
    width: width || null,
    height: height || null,
    linkedTo,
    source,
    category,
    generationPrompt: generationPrompt || null,
    generationModel: generationModel || null,
    generationRevisedPrompt: generationRevisedPrompt || null,
    description: description || null,
    tags: finalTags,
    storageKey: written.storageKey,
  }, { id: fileId });
  return fileEntry;
}

/**
 * Read a file as buffer from storage
 */
async function readFile(fileId: string): Promise<Buffer> {
  const repos = getRepositories();
  const entry = await repos.files.findById(fileId);

  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.storageKey) {
    throw new Error(`File ${fileId} has no storage key - file may need migration`);
  }

  // Download from storage
  const buffer = await fileStorageManager.downloadFile(entry);
  return buffer;
}

/**
 * Find a file entry by ID
 */
async function findFileById(fileId: string): Promise<FileEntry | null> {
  const repos = getRepositories();
  return await repos.files.findById(fileId);
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

  // Create file entry
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
    filepath: getFileApiPath(fileEntry.id),
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

  // Create file entry
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
    filepath: getFileApiPath(fileEntry.id),
    mimeType: fileEntry.mimeType,
    size: fileEntry.size,
    width: fileEntry.width || undefined,
    height: fileEntry.height || undefined,
    url,
    sha256: fileEntry.sha256,
  };
}

/**
 * Ingest an in-memory image buffer as a FileEntry. Used by recovery paths that
 * have raw bytes from a non-images-v2 source (e.g. a mount-file blob whose
 * original images-v2 sister was reaped) and need a synthesized FileEntry to
 * carry on with downstream flows.
 */
export async function ingestImageBuffer(params: {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  userId: string;
  linkedTo?: string[];
  source?: FileSource;
  description?: string;
}): Promise<FileEntry> {
  const dimensions = await getImageDimensions(params.buffer, params.mimeType);
  return createFile({
    buffer: params.buffer,
    originalFilename: params.originalFilename,
    mimeType: params.mimeType,
    source: params.source ?? 'IMPORTED',
    category: 'IMAGE',
    userId: params.userId,
    linkedTo: params.linkedTo ?? [],
    description: params.description,
    ...dimensions,
  });
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
