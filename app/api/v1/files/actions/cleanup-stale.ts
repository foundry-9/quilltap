import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canGenerateThumbnail, cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import { cleanupStaleSchema } from '../shared';

export async function handleCleanupStale(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  try {
    let dryRun = true;

    try {
      const body = await request.json();
      const parsed = cleanupStaleSchema.safeParse(body);
      if (parsed.success) {
        dryRun = parsed.data.dryRun;
      }
    } catch {
      // Empty body or invalid JSON defaults to dryRun.
    }

    logger.info('[Files v1] Cleanup stale records requested', {
      userId: ctx.user.id,
      dryRun,
    });

    const allFiles = await ctx.repos.files.findByUserId(ctx.user.id);
    const staleRecords: Array<{ id: string; originalFilename: string }> = [];
    const errors: string[] = [];

    for (const file of allFiles) {
      try {
        if (!file.storageKey) {
          continue;
        }

        const exists = await fileStorageManager.storageKeyExists(file.storageKey);
        if (!exists) {
          staleRecords.push({ id: file.id, originalFilename: file.originalFilename });
        }
      } catch (error) {
        errors.push(
          `Error checking file ${file.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    let deleted = 0;
    if (!dryRun && staleRecords.length > 0) {
      for (const stale of staleRecords) {
        try {
          const entry = allFiles.find(file => file.id === stale.id);
          if (entry && canGenerateThumbnail(entry.mimeType)) {
            await cleanupThumbnails(entry);
          }

          await ctx.repos.files.delete(stale.id);
          deleted += 1;
        } catch (error) {
          logger.error(
            '[Files v1] Failed to delete stale record',
            { fileId: stale.id },
            error instanceof Error ? error : undefined
          );
        }
      }

      logger.info('[Files v1] Cleanup stale records complete', {
        userId: ctx.user.id,
        total: allFiles.length,
        stale: staleRecords.length,
        deleted,
      });
    }

    return successResponse({
      total: allFiles.length,
      stale: staleRecords.length,
      deleted,
      dryRun,
      staleFiles: staleRecords.map(record => ({
        id: record.id,
        filename: record.originalFilename,
      })),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error(
      '[Files v1] Error cleaning up stale records',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to cleanup stale records');
  }
}
