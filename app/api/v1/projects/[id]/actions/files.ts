/**
 * Projects API v1 - File Association Actions
 *
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { resolveEffectiveFolderPath } from '@/lib/files/folder-utils';
import { getProjectDocumentStore } from '@/lib/file-storage/project-store-bridge';
import { detectMimeType } from '@/lib/file-storage/scanner';
import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types';
import { addFileSchema, removeFileSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Map a doc_mount_files row's fileType (+ filename, for the 'blob' catch-all)
 * to a concrete MIME type for the Files card thumbnail and preview.
 */
function mimeForMountFile(file: DocMountFileLinkWithContent): string {
  switch (file.fileType) {
    case 'pdf': return 'application/pdf';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'markdown': return 'text/markdown';
    case 'txt': return 'text/plain';
    case 'json': return 'application/json';
    case 'jsonl': return 'application/jsonl';
    case 'blob': return detectMimeType(file.fileName);
  }
}

/**
 * List files associated with project
 */
export async function handleListFiles(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!exists(project)) {
      return notFound('Project');
    }

    // When the project has a linked primary Scriptorium store, the store is
    // the source of truth — its doc_mount_files rows reflect what's actually
    // in the Browse All Files modal, so the Files card count tracks reality
    // rather than the legacy files-table (which keeps pre-migration rows
    // with stale on-disk storageKeys after Stage 1 archives the directory).
    const primaryStore = await getProjectDocumentStore(projectId);
    if (primaryStore) {
      const mountFiles = await repos.docMountFiles.findByMountPointId(primaryStore.mountPointId);
      const files = mountFiles.map(f => {
        const mimeType = mimeForMountFile(f);
        return {
          id: f.id,
          originalFilename: f.fileName,
          filename: f.fileName,
          mimeType,
          size: f.fileSizeBytes,
          category: mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
          description: null,
          projectId,
          folderPath: null,
          width: null,
          height: null,
          createdAt: f.createdAt,
          updatedAt: f.lastModified || f.updatedAt,
          mountPointId: f.mountPointId,
          relativePath: f.relativePath,
        };
      });

      return successResponse({
        files,
        count: files.length,
      });
    }

    const allFiles = await repos.files.findAll();
    const files = allFiles
      .filter(f => f.projectId === projectId)
      .map(f => ({
        id: f.id,
        userId: f.userId,
        originalFilename: f.originalFilename,
        filename: f.originalFilename,
        mimeType: f.mimeType,
        size: f.size,
        category: f.category,
        description: f.description,
        projectId: f.projectId,
        folderPath: resolveEffectiveFolderPath(f.folderPath, f.storageKey),
        width: f.width,
        height: f.height,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));

    return successResponse({
      files,
      count: files.length,
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project files', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to list files');
  }
}

/**
 * Associate file with project
 */
export async function handleAddFile(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { fileId } = addFileSchema.parse(body);

  // Check file exists and is owned by user
  const file = await repos.files.findById(fileId);
  if (!file) {
    return notFound('File');
  }

  // Associate file with project
  await repos.files.update(fileId, { projectId });

  logger.info('[Projects v1] File added to project', { projectId, fileId });

  return successResponse({ success: true });
}

/**
 * Remove file from project
 */
export async function handleRemoveFile(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { fileId } = removeFileSchema.parse(body);

  // Remove projectId from file
  await repos.files.update(fileId, { projectId: null });

  logger.info('[Projects v1] File removed from project', { projectId, fileId });

  return successResponse({ success: true });
}
