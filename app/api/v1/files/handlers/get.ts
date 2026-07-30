import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { normalizeFolderPath, resolveEffectiveFolderPath } from '@/lib/files/folder-utils';
import { successResponse, serverError } from '@/lib/api/responses';
import { serializeFileEntry } from '../shared';

export async function handleGet(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    const folderPath = searchParams.get('folderPath');
    const filter = searchParams.get('filter');

    const allFiles = await ctx.repos.files.findByUserId(ctx.user.id);
    let files = allFiles;

    if (filter === 'general') {
      files = files.filter(file => file.projectId === null || file.projectId === undefined);
    } else if (projectId) {
      files = files.filter(file => file.projectId === projectId);
    }

    if (folderPath) {
      const normalizedPath = normalizeFolderPath(folderPath);
      files = files.filter(
        file => resolveEffectiveFolderPath(file.folderPath, file.storageKey) === normalizedPath
      );
    }

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return successResponse({
      files: files.map(serializeFileEntry),
    });
  } catch (error) {
    logger.error('[Files v1] Error listing files', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list files');
  }
}