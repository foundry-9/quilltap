/**
 * Thumbnail Generation Utilities
 *
 * Shared utility for generating, caching, and managing image thumbnails.
 * Centralizes thumbnail storage key generation and Sharp processing to
 * ensure consistent caching across the application.
 *
 * @module lib/files/thumbnail-utils
 */

import sharp from 'sharp';
import { createLogger } from '@/lib/logging/create-logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canResizeImage } from '@/lib/files/image-processing';
import type { FileEntry } from '@/lib/schemas/file.types';

const logger = createLogger('files:thumbnails');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default thumbnail size in pixels */
export const DEFAULT_THUMBNAIL_SIZE = 150;

/** Maximum allowed thumbnail size in pixels */
export const MAX_THUMBNAIL_SIZE = 300;

/** WebP quality for thumbnails (1-100) */
export const THUMBNAIL_QUALITY = 80;

/** Common thumbnail sizes to clean up on file deletion */
export const COMMON_THUMBNAIL_SIZES = [120, 150, 300];

// ============================================================================
// KEY BUILDING
// ============================================================================

/** The storage-key prefix (directory) every cached thumbnail lives under. */
export const THUMBNAIL_KEY_PREFIX = '_thumbnails';

/**
 * Build the canonical storage key for a cached thumbnail.
 *
 * Format: `_thumbnails/{fileId}_{size}.webp`
 *
 * This MUST be the single source of truth for thumbnail cache keys.
 * Both cache reads and cache writes must use this function.
 *
 * @param _userId - Deprecated, kept for API compatibility (ignored)
 * @param fileId - File UUID
 * @param size - Thumbnail size in pixels
 */
export function buildThumbnailStorageKey(_userId: string, fileId: string, size: number): string {
  return `${THUMBNAIL_KEY_PREFIX}/${fileId}_${size}.webp`;
}

/**
 * Inverse of {@link buildThumbnailStorageKey}: pull the source `fileId` back out
 * of a thumbnail storage key. Returns null for anything that doesn't match the
 * canonical `_thumbnails/{uuid}_{size}.webp` shape, so the orphan sweep can skip
 * (rather than blindly delete) unexpected entries. The UUID carries hyphens but
 * never underscores, so the last underscore reliably separates it from the size.
 */
export function parseThumbnailStorageKey(
  storageKey: string,
): { fileId: string; size: number } | null {
  const match = /^_thumbnails\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_(\d+)\.webp$/.exec(
    storageKey,
  );
  if (!match) return null;
  return { fileId: match[1], size: Number(match[2]) };
}

// ============================================================================
// TYPE CHECKING
// ============================================================================

/**
 * Check if a file's MIME type supports thumbnail generation.
 */
export function canGenerateThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('image/') && canResizeImage(mimeType);
}

// ============================================================================
// GENERATION
// ============================================================================

export interface ThumbnailResult {
  /** The generated thumbnail buffer */
  buffer: Buffer;
  /** Whether this was served from cache */
  fromCache: boolean;
}

/**
 * Generate a thumbnail for a file entry, using cache when available.
 *
 * 1. Checks if a cached thumbnail exists at the canonical storage key
 * 2. If cached, returns it immediately
 * 3. If not, downloads the original, generates a thumbnail via Sharp,
 *    caches it at the canonical key, and returns it
 *
 * @param fileEntry - The file entry to thumbnail
 * @param size - Desired thumbnail size in pixels (width & height, cover fit)
 * @returns The thumbnail buffer and cache status
 * @throws If the file cannot be downloaded or Sharp processing fails
 */
export async function generateThumbnail(
  fileEntry: FileEntry,
  size: number = DEFAULT_THUMBNAIL_SIZE
): Promise<ThumbnailResult> {
  const clampedSize = Math.min(size, MAX_THUMBNAIL_SIZE);
  const thumbnailKey = buildThumbnailStorageKey(fileEntry.userId, fileEntry.id, clampedSize);

  // Build a synthetic FileEntry pointing at the thumbnail key for cache lookup
  const thumbnailFileEntry = { ...fileEntry, storageKey: thumbnailKey };

  // Check cache
  const exists = await fileStorageManager.fileExists(thumbnailFileEntry);
  if (exists) {
    const cachedBuffer = await fileStorageManager.downloadFile(thumbnailFileEntry);
    return { buffer: cachedBuffer, fromCache: true };
  }

  // Cache miss — generate
  const imageBuffer = await fileStorageManager.downloadFile(fileEntry);

  const thumbnailBuffer = await sharp(imageBuffer)
    .resize(clampedSize, clampedSize, {
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

  // Cache the thumbnail at the canonical key (fire-and-forget)
  fileStorageManager.uploadRaw({
    storageKey: thumbnailKey,
    content: thumbnailBuffer,
    contentType: 'image/webp',
  }).catch((cacheError) => {
    logger.warn('Failed to cache thumbnail', {
      fileId: fileEntry.id,
      error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
    });
  });

  return { buffer: thumbnailBuffer, fromCache: false };
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Delete cached thumbnails for a file across all common sizes.
 *
 * Called during file deletion to clean up thumbnail cache entries.
 * Failures are logged but do not throw.
 */
export async function cleanupThumbnails(fileEntry: FileEntry): Promise<void> {
  for (const size of COMMON_THUMBNAIL_SIZES) {
    const key = buildThumbnailStorageKey(fileEntry.userId, fileEntry.id, size);
    try {
      await fileStorageManager.deleteRaw(key);
    } catch (error) {
      // Silently ignore — thumbnail may not exist for this size
    }
  }
}
