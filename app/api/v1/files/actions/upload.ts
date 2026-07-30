import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import {
  inferMimeType,
  normalizeAndValidateFolderPath,
  saveFileEntry,
  serializeFileEntry,
} from '../shared';

export async function handleUploadFile(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return badRequest('Expected multipart/form-data content type');
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const tagsJson = formData.get('tags') as string | null;
    const projectId = formData.get('projectId') as string | null;
    const rawFolderPath = formData.get('folderPath') as string | null;

    if (!file) {
      return badRequest('No file provided');
    }

    const folderResult = normalizeAndValidateFolderPath(rawFolderPath);
    if (!folderResult.success) {
      return badRequest(folderResult.error);
    }

    let tags: Array<{ tagType: string; tagId: string }> | undefined;
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson) as Array<{ tagType: string; tagId: string }>;
      } catch {
        return badRequest('Invalid tags JSON');
      }
    }

    const targetProjectId = projectId || null;

    // Note: No file write permission check here. This endpoint is for user-initiated
    // uploads (already authenticated via createContextHandler). The file write
    // permission system gates AI-initiated writes through the tool executor, not here.

    const arrayBuffer = await file.arrayBuffer();
    const contentBuffer = Buffer.from(arrayBuffer);
    const mimeType = inferMimeType(file.name, file.type);
    const linkedTo = tags ? tags.map(tag => tag.tagId) : [];

    const { fileEntry, statusCode } = await saveFileEntry({
      ctx,
      filename: file.name,
      contentBuffer,
      mimeType,
      projectId: targetProjectId,
      folderPath: folderResult.folderPath,
      category: 'DOCUMENT',
      linkedTo,
      tags: linkedTo,
      overwriteLogMessage: '[Files v1] File upload overwritten existing file',
      createLogMessage: '[Files v1] File uploaded successfully',
    });

    return successResponse(
      {
        data: serializeFileEntry(fileEntry),
      },
      statusCode
    );
  } catch (error) {
    logger.error(
      '[Files v1] Error uploading file',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to upload file');
  }
}