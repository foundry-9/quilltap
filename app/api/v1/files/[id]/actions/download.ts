import { NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { buildContentDisposition } from '../shared';

export async function handleDownloadFile(
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  try {
    const fileEntry = await ctx.repos.files.findById(fileId);
    if (!fileEntry) {
      return notFound('File');
    }

    if (!fileEntry.storageKey) {
      logger.error('[Files v1] File has no storage key', { fileId });
      return serverError('File not available - storage key missing');
    }

    const buffer = await fileStorageManager.downloadFile(fileEntry);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': fileEntry.mimeType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': buildContentDisposition(fileEntry.originalFilename, 'inline'),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
      },
    });
  } catch (error) {
    logger.error('[Files v1] Error serving file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to serve file');
  }
}