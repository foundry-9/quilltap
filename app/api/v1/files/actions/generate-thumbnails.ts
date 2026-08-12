import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import {
  DEFAULT_THUMBNAIL_SIZE,
  canGenerateThumbnail,
  generateThumbnail,
} from '@/lib/files/thumbnail-utils';
import {
  formatValidationIssues,
  generateThumbnailsSchema,
  THUMBNAIL_CONCURRENCY,
} from '../shared';

export async function handleGenerateThumbnails(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = generateThumbnailsSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(`Invalid request: ${formatValidationIssues(parsed.error)}`);
    }

    const { fileIds, size } = parsed.data;
    const thumbnailSize = size ?? DEFAULT_THUMBNAIL_SIZE;
    const fileEntries = await Promise.all(fileIds.map(fileId => ctx.repos.files.findById(fileId)));

    const validEntries = fileEntries.filter(
      entry => entry && entry.userId === ctx.user.id && canGenerateThumbnail(entry.mimeType)
    );

    let generated = 0;
    let cached = 0;
    let errors = 0;
    const processQueue = [...validEntries];

    async function processNext(): Promise<void> {
      while (processQueue.length > 0) {
        const entry = processQueue.shift();
        if (!entry) {
          break;
        }

        try {
          const result = await generateThumbnail(entry, thumbnailSize);
          if (result.fromCache) {
            cached += 1;
          } else {
            generated += 1;
          }
        } catch (error) {
          errors += 1;
          logger.warn('[Files v1] Batch thumbnail generation failed for file', {
            fileId: entry.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: THUMBNAIL_CONCURRENCY }, () => processNext())
    );

    logger.info('[Files v1] Batch thumbnail generation complete', {
      total: validEntries.length,
      generated,
      cached,
      errors,
      userId: ctx.user.id,
    });

    return successResponse({
      total: validEntries.length,
      generated,
      cached,
      errors,
    });
  } catch (error) {
    logger.error(
      '[Files v1] Error in batch thumbnail generation',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to generate thumbnails');
  }
}