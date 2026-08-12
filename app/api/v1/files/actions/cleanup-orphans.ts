import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canGenerateThumbnail, cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import { cleanupOrphansSchema } from '../shared';
import type { FileEntry } from '@/lib/schemas/file.types';

/**
 * Build a set of file IDs and SHA-256 hashes that are actively referenced by
 * characters (as default avatars, avatar overrides, or gallery links).
 * Any orphaned file matching these must be rescued, not deleted.
 */
async function buildReferencedFileSets(
  ctx: RequestContext,
  allFiles: FileEntry[]
): Promise<{ referencedIds: Set<string>; referencedHashes: Set<string> }> {
  const referencedIds = new Set<string>();

  // Gather all character-referenced file IDs
  const characters = await ctx.repos.characters.findAll();
  for (const char of characters) {
    if (char.defaultImageId) {
      referencedIds.add(char.defaultImageId);
    }
    if (Array.isArray(char.avatarOverrides)) {
      for (const override of char.avatarOverrides) {
        if (override.imageId) {
          referencedIds.add(override.imageId);
        }
      }
    }
  }

  // Also treat any file with non-empty linkedTo as referenced
  for (const file of allFiles) {
    if (file.linkedTo && file.linkedTo.length > 0) {
      referencedIds.add(file.id);
    }
  }

  // Build SHA-256 set from referenced files so we can catch orphaned copies
  // of files that characters still need (e.g. after reconciliation re-created
  // the DB record under a new ID)
  const referencedHashes = new Set<string>();
  const fileById = new Map(allFiles.map(f => [f.id, f]));
  for (const id of referencedIds) {
    const file = fileById.get(id);
    if (file?.sha256) {
      referencedHashes.add(file.sha256);
    }
  }

  return { referencedIds, referencedHashes };
}

/**
 * Check whether an orphaned file is actually still referenced and should be
 * rescued rather than deleted/moved.
 */
function isFileReferenced(
  file: FileEntry,
  referencedIds: Set<string>,
  referencedHashes: Set<string>
): boolean {
  // Direct ID reference (character avatar, override, etc.)
  if (referencedIds.has(file.id)) return true;
  // Non-empty linkedTo (gallery tag, message attachment link, etc.)
  if (file.linkedTo && file.linkedTo.length > 0) return true;
  // SHA-256 matches a referenced file — the physical content is still needed
  if (file.sha256 && referencedHashes.has(file.sha256)) return true;
  return false;
}

export async function handleCleanupOrphans(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  try {
    let dryRun = true;
    let mode: 'move' | 'delete' = 'delete';

    try {
      const body = await request.json();
      const parsed = cleanupOrphansSchema.safeParse(body);
      if (parsed.success) {
        dryRun = parsed.data.dryRun;
        mode = parsed.data.mode;
      }
    } catch {
      // Empty body or invalid JSON defaults to dryRun and delete mode.
    }

    logger.info('[Files v1] Cleanup orphans requested', {
      userId: ctx.user.id,
      dryRun,
      mode,
    });

    const allFiles = await ctx.repos.files.findByUserId(ctx.user.id);

    // Build sets of file IDs and hashes that are actively referenced
    const { referencedIds, referencedHashes } = await buildReferencedFileSets(ctx, allFiles);

    // Partition into orphaned and tracked files
    const allOrphaned = allFiles.filter(f => f.fileStatus === 'orphaned');
    const tracked = allFiles.filter(f => f.fileStatus !== 'orphaned');

    // Rescue orphaned files that are still referenced by characters or linked entities
    const rescued: FileEntry[] = [];
    const orphaned: FileEntry[] = [];
    for (const file of allOrphaned) {
      if (isFileReferenced(file, referencedIds, referencedHashes)) {
        rescued.push(file);
      } else {
        orphaned.push(file);
      }
    }

    if (rescued.length > 0) {
      logger.info('[Files v1] Rescued referenced files from orphan cleanup', {
        userId: ctx.user.id,
        rescuedCount: rescued.length,
        rescuedIds: rescued.map(f => f.id),
      });
    }

    // Build set of tracked SHA-256 hashes
    const trackedHashes = new Set(tracked.map(f => f.sha256));

    // Split orphans into duplicates and unique
    const duplicates = orphaned.filter(f => trackedHashes.has(f.sha256));
    const unique = orphaned.filter(f => !trackedHashes.has(f.sha256));

    // Calculate sizes
    const totalSize = orphaned.reduce((sum, f) => sum + f.size, 0);
    const duplicateSize = duplicates.reduce((sum, f) => sum + f.size, 0);
    const uniqueSize = unique.reduce((sum, f) => sum + f.size, 0);

    logger.info('[Files v1] Cleanup orphans analysis', {
      userId: ctx.user.id,
      orphanedCount: orphaned.length,
      rescuedCount: rescued.length,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
    });

    // Dry run: just return stats
    if (dryRun === true) {
      return successResponse({
        orphanedCount: orphaned.length,
        rescuedCount: rescued.length,
        duplicateCount: duplicates.length,
        uniqueCount: unique.length,
        totalSize,
        duplicateSize,
        uniqueSize,
        dryRun: true,
      });
    }

    // Rescue referenced files: restore their status to 'ok'
    let rescuedActual = 0;
    for (const file of rescued) {
      try {
        await ctx.repos.files.update(file.id, { fileStatus: 'ok' });
        rescuedActual += 1;
      } catch (error) {
        logger.warn('[Files v1] Failed to rescue orphaned file', {
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Actual cleanup
    let deleted = 0;
    let moved = 0;
    const errors: string[] = [];

    // Determine which files to delete
    const filesToDelete = mode === 'delete' ? [...duplicates, ...unique] : duplicates;

    // Delete files
    for (const file of filesToDelete) {
      try {
        if (file.storageKey) {
          await fileStorageManager.deleteFile(file);
        }

        if (canGenerateThumbnail(file.mimeType)) {
          await cleanupThumbnails(file);
        }

        await ctx.repos.files.delete(file.id);
        deleted += 1;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          '[Files v1] Failed to delete orphaned file',
          { fileId: file.id },
          error instanceof Error ? error : undefined
        );
        errors.push(`Error deleting file ${file.id}: ${errorMsg}`);
      }
    }

    // Move unique files to /orphans/ folder (only if mode === 'move')
    if (mode === 'move') {
      for (const file of unique) {
        try {
          await ctx.repos.files.update(file.id, {
            folderPath: '/orphans/',
            fileStatus: 'ok',
            projectId: null,
          });
          moved += 1;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            '[Files v1] Failed to move orphaned file',
            { fileId: file.id },
            error instanceof Error ? error : undefined
          );
          errors.push(`Error moving file ${file.id}: ${errorMsg}`);
        }
      }
    }

    logger.info('[Files v1] Cleanup orphans complete', {
      userId: ctx.user.id,
      orphanedCount: orphaned.length,
      rescuedCount: rescuedActual,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
      deleted,
      moved,
      mode,
    });

    return successResponse({
      orphanedCount: orphaned.length,
      rescuedCount: rescuedActual,
      duplicateCount: duplicates.length,
      uniqueCount: unique.length,
      totalSize,
      deleted,
      moved,
      dryRun: false,
      mode,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error(
      '[Files v1] Error cleaning up orphaned files',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to cleanup orphaned files');
  }
}
