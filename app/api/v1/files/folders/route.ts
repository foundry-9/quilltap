/**
 * Files API v1 - Folders Collection Endpoint
 *
 * GET /api/v1/files/folders - List all folders for a user/project
 * POST /api/v1/files/folders?action=create - Create a folder
 * POST /api/v1/files/folders?action=rename - Rename a folder
 * POST /api/v1/files/folders?action=delete - Delete an empty folder
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, badRequest, notFound, validationError } from '@/lib/api/responses';
import {
  validateFolderPath,
  normalizeFolderPath,
  getParentPath,
  getFolderName,
} from '@/lib/files/folder-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';

// ============================================================================
// Schemas
// ============================================================================

const createFolderSchema = z.object({
  path: z.string().min(1),
  projectId: z.uuid().nullable().optional(),
});

const renameFolderSchema = z.object({
  path: z.string().min(1),
  newName: z.string().min(1).max(100),
  projectId: z.uuid().nullable().optional(),
});

const deleteFolderSchema = z.object({
  path: z.string().min(1),
  projectId: z.uuid().nullable().optional(),
});

const FOLDERS_POST_ACTIONS = ['create', 'rename', 'delete'] as const;
type FoldersPostAction = typeof FOLDERS_POST_ACTIONS[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate folder name for renaming
 */
function validateFolderName(name: string): { isValid: boolean; error?: string; sanitized?: string } {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Folder name must be a non-empty string' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'Folder name cannot be empty' };
  }

  if (trimmed.length > 100) {
    return { isValid: false, error: 'Folder name must be 100 characters or less' };
  }

  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f/\\]/;
  if (invalidChars.test(trimmed)) {
    return { isValid: false, error: 'Folder name contains invalid characters' };
  }

  // Check for path traversal
  if (trimmed === '.' || trimmed === '..') {
    return { isValid: false, error: 'Invalid folder name' };
  }

  return { isValid: true, sanitized: trimmed };
}

/**
 * Recursively ensure parent folders exist, creating them if needed
 */
async function ensureParentFoldersExist(
  repos: any,
  userId: string,
  path: string,
  projectId: string | null
): Promise<string | null> {
  if (path === '/') {
    return null;
  }

  const parentPath = getParentPath(path);

  if (parentPath === '/') {
    return null;
  }

  let parentFolder = await repos.folders.findByPath(userId, parentPath, projectId);

  if (!parentFolder) {
    const grandparentId = await ensureParentFoldersExist(repos, userId, parentPath, projectId);

    const parentName = getFolderName(parentPath) || 'Folder';
    // Find-or-create at the chokepoint: the read above and this write are not
    // atomic, and a concurrent creator would otherwise leave a duplicate row
    // for the same path (bug 114).
    parentFolder = await repos.folders.ensureByPath({
      userId,
      path: parentPath,
      name: parentName,
      parentFolderId: grandparentId,
      projectId: projectId || null,
    });


    try {
      await fileStorageManager.createFolder({
        projectId,
        folderPath: parentPath,
      });
    } catch (error) {
      logger.warn('[Files v1] Failed to create parent folder in storage', {
        path: parentPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return parentFolder.id;
}

// ============================================================================
// GET Handler - List folders
// ============================================================================

export const GET = createContextHandler(async (request, { user, repos }) => {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('projectId');

  // Get all folders for this user
  let folders = await repos.folders.findByUserId(user.id);

  // Filter by project if provided
  if (projectId) {
    folders = folders.filter((f: any) => f.projectId === projectId);
  } else {
    // If no projectId, return general folders (null projectId)
    folders = folders.filter((f: any) => f.projectId === null);
  }

  // Sort by path
  folders.sort((a: any, b: any) => a.path.localeCompare(b.path));

  logger.info('[Files v1] Retrieved folder list', { userId: user.id, folderCount: folders.length });

  return successResponse({
    folders: folders.map((folder: any) => ({
      id: folder.id,
      userId: folder.userId,
      path: folder.path,
      name: folder.name,
      projectId: folder.projectId,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    })),
    count: folders.length,
  });
});

// ============================================================================
// POST Handler - Action dispatch
// ============================================================================

export const POST = createContextHandler(async (request, { user, repos }) => {
  const action = getActionParam(request);

  if (!isValidAction(action, FOLDERS_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${FOLDERS_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<FoldersPostAction, () => Promise<NextResponse>> = {
    create: () => handleCreateFolder(request, user, repos),
    rename: () => handleRenameFolder(request, user, repos),
    delete: () => handleDeleteFolder(request, user, repos),
  };

  return actionHandlers[action]();
});

// ============================================================================
// Action: Create Folder
// ============================================================================

async function handleCreateFolder(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  const body = await request.json();
  const parsed = createFolderSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { path, projectId } = parsed.data;

  const validation = validateFolderPath(path);
  if (!validation.isValid) {
    return badRequest(validation.error || 'Invalid folder path');
  }

  const normalizedPath = normalizeFolderPath(path);
  // Check if folder already exists
  const existingFolder = await repos.folders.findByPath(
    user.id,
    normalizedPath,
    projectId || null
  );

  if (existingFolder) {
    return successResponse({
      folder: existingFolder,
      alreadyExists: true,
      message: 'Folder already exists',
    });
  }

  // Ensure parent folders exist
  const parentFolderId = await ensureParentFoldersExist(
    repos,
    user.id,
    normalizedPath,
    projectId || null
  );

  // Create the folder entity
  const folderName = getFolderName(normalizedPath) || 'Folder';
  const folder = await repos.folders.ensureByPath({
    userId: user.id,
    path: normalizedPath,
    name: folderName,
    parentFolderId,
    projectId: projectId || null,
  });

  // Create storage directory for local backends
  try {
    await fileStorageManager.createFolder({
      projectId: projectId || null,
      folderPath: normalizedPath,
    });
  } catch (error) {
    logger.warn('[Files v1] Failed to create folder in storage', {
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[Files v1] Folder created', { path: normalizedPath, folderId: folder.id, projectId });

  return successResponse({
    folder,
    alreadyExists: false,
    message: 'Folder created successfully',
  }, 201);
}

// ============================================================================
// Action: Rename Folder
// ============================================================================

async function handleRenameFolder(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  const body = await request.json();
  const parsed = renameFolderSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { path, newName, projectId } = parsed.data;

  const pathValidation = validateFolderPath(path);
  if (!pathValidation.isValid) {
    return badRequest(pathValidation.error || 'Invalid folder path');
  }

  const nameValidation = validateFolderName(newName);
  if (!nameValidation.isValid) {
    return badRequest(nameValidation.error || 'Invalid folder name');
  }

  const normalizedPath = normalizeFolderPath(path);

  if (normalizedPath === '/') {
    return badRequest('Cannot rename root folder');
  }

  const sanitizedName = nameValidation.sanitized!;
  const parentPath = getParentPath(normalizedPath);
  const newPath = normalizeFolderPath(`${parentPath}${sanitizedName}`);

  const newPathValidation = validateFolderPath(newPath);
  if (!newPathValidation.isValid) {
    return badRequest(newPathValidation.error || 'Invalid resulting path');
  }

  // Find the folder entity
  const folder = await repos.folders.findByPath(
    user.id,
    normalizedPath,
    projectId || null
  );

  if (!folder) {
    return notFound('Folder');
  }

  // Update the folder entity
  await repos.folders.update(folder.id, {
    path: newPath,
    name: sanitizedName,
  });

  // Update all descendant folders' paths
  const descendantFoldersUpdated = await repos.folders.updatePathPrefix(
    user.id,
    normalizedPath,
    newPath,
    projectId || null
  );

  // Update all affected file paths
  const allFiles = projectId
    ? await repos.files.findByProjectId(user.id, projectId)
    : await repos.files.findGeneralFiles(user.id);

  const affectedFiles = allFiles.filter((f: any) => {
    const filePath = f.folderPath || '/';
    return filePath === normalizedPath || filePath.startsWith(normalizedPath);
  });

  let filesUpdated = 0;
  for (const file of affectedFiles) {
    const oldFilePath = file.folderPath || '/';
    const newFilePath = oldFilePath.replace(normalizedPath, newPath);
    await repos.files.update(file.id, { folderPath: newFilePath });
    filesUpdated++;
  }

  logger.info('[Files v1] Folder renamed', {
    oldPath: normalizedPath,
    newPath,
    foldersUpdated: descendantFoldersUpdated + 1,
    filesUpdated,
  });

  return successResponse({
    oldPath: normalizedPath,
    newPath,
    foldersUpdated: descendantFoldersUpdated + 1,
    filesUpdated,
  });
}

// ============================================================================
// Action: Delete Folder
// ============================================================================

async function handleDeleteFolder(request: NextRequest, user: any, repos: any): Promise<NextResponse> {
  const body = await request.json();
  const parsed = deleteFolderSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { path, projectId } = parsed.data;

  const validation = validateFolderPath(path);
  if (!validation.isValid) {
    return badRequest(validation.error || 'Invalid folder path');
  }

  const normalizedPath = normalizeFolderPath(path);

  if (normalizedPath === '/') {
    return badRequest('Cannot delete root folder');
  }

  // Find the folder entity
  const folder = await repos.folders.findByPath(
    user.id,
    normalizedPath,
    projectId || null
  );

  if (!folder) {
    return notFound('Folder');
  }

  // Check if any files exist in this folder or subfolders
  const allFiles = projectId
    ? await repos.files.findByProjectId(user.id, projectId)
    : await repos.files.findGeneralFiles(user.id);

  const filesInFolder = allFiles.filter((f: any) => {
    const filePath = f.folderPath || '/';
    return filePath === normalizedPath || filePath.startsWith(normalizedPath);
  });

  if (filesInFolder.length > 0) {
    return badRequest(`Folder contains ${filesInFolder.length} file(s) and cannot be deleted`);
  }

  // Check if any child folders exist
  const hasChildren = await repos.folders.hasChildren(folder.id);
  if (hasChildren) {
    return badRequest('Folder contains subfolders and cannot be deleted');
  }

  // Delete from storage (for local backends)
  try {
    await fileStorageManager.deleteFolder({
      projectId: projectId || null,
      folderPath: normalizedPath,
    });
  } catch (error) {
    logger.warn('[Files v1] Failed to delete folder from storage', {
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Delete the folder entity
  await repos.folders.delete(folder.id);

  logger.info('[Files v1] Folder deleted', { path: normalizedPath, folderId: folder.id });

  return successResponse({
    message: 'Folder deleted successfully',
    path: normalizedPath,
  });
}
