/**
 * Orphaned-thumbnail sweep.
 *
 * `files/_thumbnails/{fileId}_{size}.webp` is a derived cache: each entry is a
 * WebP thumbnail regenerated on demand from its source file. In-app deletes call
 * `cleanupThumbnails`, but a file that left by any *other* route — a restore, a
 * delete-all, an out-of-app edit — strands its thumbnails, and nothing ever
 * reaps them, so the directory only grows (Bug 43).
 *
 * This sweep enumerates the cache, parses the leading `fileId` off each entry,
 * and deletes those whose source `files` row no longer exists. Because the cache
 * is derived and regenerated on demand, deletion is always safe. Unparseable
 * names are skipped and logged (never deleted blind). Runs on the parent inside
 * the daily maintenance pass.
 *
 * @module lib/background-jobs/maintenance/sweep-orphaned-thumbnails
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  THUMBNAIL_KEY_PREFIX,
  parseThumbnailStorageKey,
} from '@/lib/files/thumbnail-utils';

const moduleLogger = logger.child({ module: 'sweep-orphaned-thumbnails' });

export interface OrphanedThumbnailSweepResult {
  /** Total cache entries examined. */
  scanned: number;
  /** Entries whose source file was gone and were deleted. */
  deleted: number;
  /** Entries whose name didn't match the canonical shape (skipped, not deleted). */
  unparseable: number;
}

/**
 * Sweep orphaned thumbnails: delete every `_thumbnails/{fileId}_{size}.webp`
 * whose `fileId` has no surviving `files` row. Never throws — storage/DB errors
 * are logged and the sweep reports what it managed.
 */
export async function sweepOrphanedThumbnails(): Promise<OrphanedThumbnailSweepResult> {
  const result: OrphanedThumbnailSweepResult = { scanned: 0, deleted: 0, unparseable: 0 };

  const keys = await fileStorageManager.listRaw(THUMBNAIL_KEY_PREFIX);
  result.scanned = keys.length;
  if (keys.length === 0) {
    moduleLogger.debug('Orphaned-thumbnail sweep: cache empty, nothing to do');
    return result;
  }

  // Parse every key up front so we can batch the DB existence check.
  const keyToFileId = new Map<string, string>();
  for (const key of keys) {
    const parsed = parseThumbnailStorageKey(key);
    if (!parsed) {
      result.unparseable += 1;
      moduleLogger.debug('Skipping unparseable thumbnail cache entry', { key });
      continue;
    }
    keyToFileId.set(key, parsed.fileId);
  }

  const uniqueFileIds = Array.from(new Set(keyToFileId.values()));
  if (uniqueFileIds.length === 0) {
    moduleLogger.debug('Orphaned-thumbnail sweep: no parseable entries', result);
    return result;
  }

  const existing = new Set(
    (await getRepositories().files.findByIds(uniqueFileIds)).map((f) => f.id),
  );

  for (const [key, fileId] of keyToFileId) {
    if (existing.has(fileId)) continue;
    try {
      await fileStorageManager.deleteRaw(key);
      result.deleted += 1;
    } catch (error) {
      moduleLogger.warn('Failed to delete orphaned thumbnail — continuing', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.debug('Orphaned-thumbnail sweep complete', result);
  return result;
}
