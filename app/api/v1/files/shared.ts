import { randomUUID } from 'crypto';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import { resolveEffectiveFolderPath, normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';
import { findAndPrepareOverwrite } from '@/lib/files/overwrite-utils';
import { logger } from '@/lib/logger';
import { MAX_THUMBNAIL_SIZE } from '@/lib/files/thumbnail-utils';
import type { FileCategory } from '@/lib/schemas/file.types';

export const FILE_POST_ACTIONS = [
  'upload',
  'generate-thumbnails',
  'cleanup-stale',
  'cleanup-orphans',
  'sync',
] as const;

export type FilePostAction = typeof FILE_POST_ACTIONS[number];

export const MAX_BATCH_SIZE = 100;
export const THUMBNAIL_CONCURRENCY = 3;

export const generateThumbnailsSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
  size: z.number().int().min(1).max(MAX_THUMBNAIL_SIZE).optional(),
});

export const cleanupStaleSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

export const cleanupOrphansSchema = z.object({
  mode: z.enum(['move', 'delete']),
  dryRun: z.boolean().optional().default(true),
});

export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map(issue => issue.message).join(', ');
}

export function serializeFileEntry(file: any) {
  return {
    id: file.id,
    userId: file.userId,
    originalFilename: file.originalFilename,
    filename: file.originalFilename,
    filepath: getFilePath(file),
    mimeType: file.mimeType,
    size: file.size,
    category: file.category,
    description: file.description,
    projectId: file.projectId,
    folderPath: resolveEffectiveFolderPath(file.folderPath, file.storageKey),
    width: file.width,
    height: file.height,
    fileStatus: file.fileStatus || 'ok',
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function normalizeAndValidateFolderPath(rawFolderPath?: string | null):
  | { success: true; folderPath: string }
  | { success: false; error: string } {
  const folderPath = normalizeFolderPath(rawFolderPath || '/');
  const validation = validateFolderPath(folderPath);

  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error || 'Invalid folder path',
    };
  }

  return {
    success: true,
    folderPath,
  };
}

export function inferMimeType(filename: string, detectedMimeType?: string | null): string {
  if (detectedMimeType && detectedMimeType !== 'application/octet-stream') {
    return detectedMimeType;
  }

  const extension = sanitizeFilename(filename).toLowerCase().split('.').pop();
  const mimeMap: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    pdf: 'application/pdf',
    json: 'application/json',
    csv: 'text/csv',
  };

  return mimeMap[extension || ''] || 'application/octet-stream';
}

interface SaveFileEntryOptions {
  ctx: RequestContext;
  filename: string;
  contentBuffer: Buffer;
  mimeType: string;
  projectId: string | null;
  folderPath: string;
  category: FileCategory;
  linkedTo: string[];
  tags: string[];
  overwriteLogMessage: string;
  createLogMessage: string;
}

export async function saveFileEntry(options: SaveFileEntryOptions): Promise<{
  fileEntry: any;
  statusCode: number;
}> {
  const sanitizedFilename = sanitizeFilename(options.filename);
  const sha256 = sha256OfBuffer(options.contentBuffer);

  const overwrite = await findAndPrepareOverwrite(options.ctx.repos, {
    userId: options.ctx.user.id,
    projectId: options.projectId,
    folderPath: options.folderPath,
    filename: sanitizedFilename,
  });

  // Project-bound files keep flowing through FSM (which resolves to the
  // project-store-bridge). Project-less uploads land in the Quilltap Uploads
  // mount under uploads/, not the catch-all _general/. The user's chosen
  // folderPath is preserved on the files row for the Files-tab tree UI.
  // The bridges transcode bitmap uploads to WebP; we propagate the stored
  // mime/size so the FileEntry reflects what's on disk, not what came in.
  let storageKey: string;
  let storedMimeType: string;
  let storedSize: number;
  if (options.projectId) {
    const uploaded = await fileStorageManager.uploadFile({
      filename: sanitizedFilename,
      content: options.contentBuffer,
      contentType: options.mimeType,
      projectId: options.projectId,
      folderPath: options.folderPath,
    });
    storageKey = uploaded.storageKey;
    storedMimeType = uploaded.storedMimeType;
    storedSize = uploaded.sizeBytes;
  } else {
    const subfolder = options.category === 'IMAGE' ? 'images' : 'uploads';
    const written = await writeUserUploadToMountStore({
      filename: sanitizedFilename,
      content: options.contentBuffer,
      contentType: options.mimeType,
      subfolder,
    });
    storageKey = written.storageKey;
    storedMimeType = written.storedMimeType;
    storedSize = written.sizeBytes;
  }

  const fileId = overwrite ? overwrite.fileId : randomUUID();

  if (overwrite) {
    const fileEntry = await options.ctx.repos.files.update(fileId, {
      sha256,
      mimeType: storedMimeType,
      size: storedSize,
      storageKey,
    });

    logger.info(options.overwriteLogMessage, {
      fileId,
      filename: sanitizedFilename,
      mimeType: storedMimeType,
      size: storedSize,
      userId: options.ctx.user.id,
    });

    return {
      fileEntry,
      statusCode: 200,
    };
  }

  const fileEntry = await options.ctx.repos.files.create({
    userId: options.ctx.user.id,
    originalFilename: sanitizedFilename,
    mimeType: storedMimeType,
    size: storedSize,
    sha256,
    source: 'UPLOADED',
    category: options.category,
    storageKey,
    projectId: options.projectId,
    folderPath: options.folderPath,
    linkedTo: options.linkedTo,
    tags: options.tags,
  }, { id: fileId });

  logger.info(options.createLogMessage, {
    fileId,
    filename: sanitizedFilename,
    mimeType: storedMimeType,
    size: storedSize,
    userId: options.ctx.user.id,
  });

  return {
    fileEntry,
    statusCode: 201,
  };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\:*?"<>|]/g, '_');
}