import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError } from '@/lib/api/responses';
import {
  DEFAULT_THUMBNAIL_SIZE,
  MAX_THUMBNAIL_SIZE,
  canGenerateThumbnail,
  generateThumbnail,
} from '@/lib/files/thumbnail-utils';

export async function handleGetThumbnail(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  try {
    const sizeParam = request.nextUrl.searchParams.get('size');
    let size = DEFAULT_THUMBNAIL_SIZE;

    if (sizeParam) {
      const parsedSize = parseInt(sizeParam, 10);
      if (isNaN(parsedSize) || parsedSize < 1) {
        return badRequest('Invalid size parameter');
      }
      size = Math.min(parsedSize, MAX_THUMBNAIL_SIZE);
    }

    const fileEntry = await ctx.repos.files.findById(fileId);
    if (!fileEntry) {
      return notFound('File');
    }

    if (!canGenerateThumbnail(fileEntry.mimeType)) {
      return badRequest('File is not a resizable image');
    }

    const { buffer } = await generateThumbnail(fileEntry, size);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    logger.error('[Files v1] Error generating thumbnail', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to generate thumbnail');
  }
}