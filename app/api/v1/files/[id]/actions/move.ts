import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { formatValidationIssues, normalizeAndValidateFolderPath } from '../../shared';
import { buildManagedFileResponse, moveFileSchema, validateFilename } from '../shared';

export async function handleMoveFile(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string,
  file: any
): Promise<NextResponse> {
  const body = await request.json();
  const parsed = moveFileSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(`Invalid request: ${formatValidationIssues(parsed.error)}`);
  }

  const { folderPath: rawFolderPath, filename, projectId } = parsed.data;
  if (rawFolderPath === undefined && filename === undefined && projectId === undefined) {
    return badRequest('At least one of folderPath, filename, or projectId must be provided');
  }

  if (filename) {
    const filenameValidation = validateFilename(filename);
    if (!filenameValidation.success) {
      return badRequest(filenameValidation.error);
    }
  }

  if (projectId !== undefined && projectId !== null) {
    // Existence gate only — moving a file just sets its projectId and never reads
    // the project's store, so use the raw row (which can't throw on a degraded store).
    const project = await ctx.repos.projects.findByIdRaw(projectId);
    if (!project) {
      return notFound('Project');
    }
  }

  let folderPath = file.folderPath;
  if (rawFolderPath !== undefined) {
    const folderResult = normalizeAndValidateFolderPath(rawFolderPath);
    if (!folderResult.success) {
      return badRequest(folderResult.error);
    }
    folderPath = folderResult.folderPath;
  }

  const updated = await ctx.repos.files.update(fileId, {
    originalFilename: filename || file.originalFilename,
    folderPath,
    projectId: projectId === undefined ? file.projectId : projectId,
  });

  if (!updated) {
    return notFound('File');
  }

  logger.info('[Files v1] File moved/renamed successfully', {
    fileId,
    newFilename: updated.originalFilename,
    newFolderPath: updated.folderPath,
    newProjectId: updated.projectId,
  });

  return successResponse({
    data: buildManagedFileResponse(updated),
  });
}