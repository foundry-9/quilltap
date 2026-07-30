/**
 * Mount Points API v1 - Individual Mount Point Endpoint
 *
 * GET /api/v1/mount-points/[id] - Get mount point details
 * PATCH /api/v1/mount-points/[id] - Update mount point
 * DELETE /api/v1/mount-points/[id] - Delete mount point and associated data
 *
 * Actions:
 * POST /api/v1/mount-points/[id]?action=scan - Trigger scan and embedding
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, conflict, notFound, serverError, successResponse } from '@/lib/api/responses';
import { scanMountPoint } from '@/lib/mount-index/scanner';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { reindexLinks, enqueueEmbeddingJobsScoped } from '@/lib/mount-index/reindex';
import { detachMountPoint, refreshMountPoint } from '@/lib/mount-index/watcher';
import {
  convertMountPointToDatabase,
  deconvertMountPointToFilesystem,
  validateDeconvertTarget,
} from '@/lib/mount-index/conversion';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { copyFile, moveFile, writeFile, deleteFile, linkFile, FileOpError } from '@/lib/mount-index/file-ops';
import { deleteFolder, moveFolder } from '@/lib/mount-index/folder-ops';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { fileOpStatus } from '@/lib/mount-index/file-op-status';
import { deriveMountCapabilities } from '@/lib/mount-index/capabilities';

// ============================================================================
// Schemas
// ============================================================================

const updateMountPointSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // basePath may be empty when switching to (or already is) a database-backed store.
  basePath: z.string().optional(),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).optional(),
  storeType: z.enum(['documents', 'character']).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const mountPoint = await repos.docMountPoints.findById(id);

      if (!mountPoint) {
        return notFound('Mount point');
      }

      // Compute embedded chunk count
      const allChunks = await repos.docMountChunks.findByMountPointId(id);
      const embeddedChunkCount = allChunks.filter(
        c => c.embedding != null && c.embedding.length > 0
      ).length;

      // Derived (non-persisted) per-mount capability flags so the file-manager UI
      // can gate verbs from a single server-side source of truth.
      const capabilities = deriveMountCapabilities(mountPoint);

      return successResponse({
        mountPoint: { ...mountPoint, embeddedChunkCount, capabilities },
      });
    } catch (error) {
      logger.error('[Mount Points v1] Error fetching mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch mount point');
    }
  }
);

// ============================================================================
// PATCH Handler
// ============================================================================

export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const existing = await repos.docMountPoints.findById(id);
      if (!existing) {
        return notFound('Mount point');
      }

      const body = await req.json();
      const validatedData = updateMountPointSchema.parse(body);

      // Renames stay inside the case-insensitive name namespace: no store may
      // take a name a peer already holds, even in a different casing.
      if (validatedData.name !== undefined) {
        const desiredLower = validatedData.name.trim().toLowerCase();
        const allStores = await repos.docMountPoints.findAll();
        const clash = allStores.find(
          mp => mp.id !== id && mp.name.trim().toLowerCase() === desiredLower
        );
        if (clash) {
          logger.warn('[Mount Points v1] Rejected duplicate mount point rename', {
            mountPointId: id,
            name: validatedData.name,
            clashesWith: clash.id,
            userId: user.id,
          });
          return conflict(
            `A document store named "${clash.name}" already exists. Names are matched without regard to case — please choose a different name.`
          );
        }
      }

      const updated = await repos.docMountPoints.update(id, validatedData);

      if (!updated) {
        logger.error('[Mount Points v1] Failed to update mount point', { mountPointId: id });
        return serverError('Failed to update mount point');
      }

      logger.info('[Mount Points v1] Mount point updated', {
        mountPointId: id,
        name: updated.name,
        userId: user.id,
      });

      // Scaffold preset structure when storeType is flipped to 'character'
      // on a database-backed store. Missing-only — existing files are not touched.
      const flippedToCharacter =
        existing.storeType !== 'character' && updated.storeType === 'character';
      if (flippedToCharacter && updated.mountType === 'database') {
        await scaffoldCharacterMount(id).catch((err) => {
          logger.warn('[Mount Points v1] Character scaffold failed after flip', {
            mountPointId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Refresh the watcher so basePath / pattern / enabled changes take effect
      refreshMountPoint(updated).catch((err) => {
        logger.warn('[Mount Points v1] Failed to refresh watcher after update', {
          mountPointId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return successResponse({ mountPoint: updated });
    } catch (error) {
      logger.error('[Mount Points v1] Error updating mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update mount point');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const existing = await repos.docMountPoints.findById(id);
      if (!existing) {
        return notFound('Mount point');
      }

      // Stop the watcher before tearing down the database records
      await detachMountPoint(id).catch((err) => {
        logger.warn('[Mount Points v1] Failed to detach watcher before delete', {
          mountPointId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Delete associated chunks first
      const chunksDeleted = await repos.docMountChunks.deleteByMountPointId(id);

      // Delete associated files
      const filesDeleted = await repos.docMountFiles.deleteByMountPointId(id);

      // Delete DB-backed document bodies and blobs (no-ops on filesystem mounts).
      const documentsDeleted = await repos.docMountDocuments.deleteByMountPointId(id);
      const blobsDeleted = await repos.docMountBlobs.deleteByMountPointId(id);

      // Delete folder hierarchy. Folder rows don't cascade from any other delete
      // above (no FK to mount points or file_links), so they'd otherwise leak.
      await repos.docMountFolders.deleteByMountPointId(id);

      // Delete project links
      const links = await repos.projectDocMountLinks.findByMountPointId(id);
      for (const link of links) {
        await repos.projectDocMountLinks.delete(link.id);
      }

      // Delete the mount point itself
      await repos.docMountPoints.delete(id);

      logger.info('[Mount Points v1] Mount point deleted', {
        mountPointId: id,
        name: existing.name,
        chunksDeleted,
        filesDeleted,
        linksDeleted: links.length,
        userId: user.id,
      });

      return successResponse({ message: 'Mount point deleted successfully' });
    } catch (error) {
      logger.error('[Mount Points v1] Error deleting mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete mount point');
    }
  }
);

// ============================================================================
// POST Handler (Action Dispatch)
// ============================================================================

async function handleScan(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      return notFound('Mount point');
    }

    // Run the scan
    const scanResult = await scanMountPoint(mountPoint);

    logger.info('[Mount Points v1] Scan completed', {
      mountPointId: id,
      name: mountPoint.name,
      filesScanned: scanResult.filesScanned,
      filesNew: scanResult.filesNew,
      filesModified: scanResult.filesModified,
      filesDeleted: scanResult.filesDeleted,
      chunksCreated: scanResult.chunksCreated,
      errors: scanResult.errors.length,
    });

    // Enqueue embedding jobs for newly scanned content
    const embeddingJobsEnqueued = await enqueueEmbeddingJobsForMountPoint(id);

    return successResponse({ scanResult, embeddingJobsEnqueued });
  } catch (error) {
    logger.error('[Mount Points v1] Error scanning mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to scan mount point');
  }
}

// ============================================================================
// Convert (filesystem/obsidian → database) Action
// ============================================================================

async function handleConvert(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      return notFound('Mount point');
    }
    if (mountPoint.mountType !== 'filesystem' && mountPoint.mountType !== 'obsidian') {
      return badRequest(
        `Mount point is already database-backed (mountType=${mountPoint.mountType})`
      );
    }
    if (mountPoint.conversionStatus === 'converting' || mountPoint.conversionStatus === 'deconverting') {
      return badRequest('A conversion is already in progress for this mount point');
    }

    await repos.docMountPoints.updateConversionStatus(id, 'converting');

    // Stop the watcher so chokidar doesn't react to files disappearing as the
    // mount-type changes; database-backed stores have no filesystem to watch.
    await detachMountPoint(id).catch((err) => {
      logger.warn('[Mount Points v1] Failed to detach watcher before convert', {
        mountPointId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    try {
      const convertResult = await convertMountPointToDatabase(mountPoint);

      await repos.docMountPoints.update(id, {
        mountType: 'database',
        basePath: '',
      });
      await repos.docMountPoints.updateConversionStatus(id, 'idle');

      logger.info('[Mount Points v1] Convert completed', {
        mountPointId: id,
        name: mountPoint.name,
        filesMigrated: convertResult.filesMigrated,
        documentsWritten: convertResult.documentsWritten,
        blobsWritten: convertResult.blobsWritten,
        filesSkipped: convertResult.filesSkipped,
        errors: convertResult.errors.length,
        userId: user.id,
      });

      const updated = await repos.docMountPoints.findById(id);
      return successResponse({
        mountPoint: updated,
        convertResult,
        previousBasePath: mountPoint.basePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await repos.docMountPoints.updateConversionStatus(id, 'error', msg);
      // Best-effort: re-attach the watcher so a partially-converted store still
      // picks up on-disk changes until the user retries.
      refreshMountPoint(mountPoint).catch(() => {});
      throw err;
    }
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error converting mount point',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(
      `Failed to convert mount point: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Deconvert (database → filesystem) Action
// ============================================================================

const deconvertSchema = z.object({
  targetPath: z.string().min(1),
});

async function handleDeconvert(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {

    const body = await req.json().catch(() => ({}));
    const parsed = deconvertSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('Deconvert requires a non-empty targetPath');
    }
    const { targetPath } = parsed.data;

    const mountPoint = await repos.docMountPoints.findById(id);
    if (!mountPoint) {
      return notFound('Mount point');
    }
    if (mountPoint.mountType !== 'database') {
      return badRequest(
        `Mount point is not database-backed (mountType=${mountPoint.mountType}); nothing to deconvert`
      );
    }
    if (mountPoint.conversionStatus === 'converting' || mountPoint.conversionStatus === 'deconverting') {
      return badRequest('A conversion is already in progress for this mount point');
    }

    try {
      await validateDeconvertTarget(targetPath);
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : String(err));
    }

    await repos.docMountPoints.updateConversionStatus(id, 'deconverting');

    try {
      const deconvertResult = await deconvertMountPointToFilesystem(mountPoint, targetPath);

      const updated = await repos.docMountPoints.update(id, {
        mountType: 'filesystem',
        basePath: targetPath,
      });
      await repos.docMountPoints.updateConversionStatus(id, 'idle');

      // Reattach the watcher against the new basePath so live edits on disk
      // start flowing back into the mount index.
      if (updated) {
        refreshMountPoint(updated).catch((watcherErr) => {
          logger.warn('[Mount Points v1] Failed to attach watcher after deconvert', {
            mountPointId: id,
            error: watcherErr instanceof Error ? watcherErr.message : String(watcherErr),
          });
        });
      }

      logger.info('[Mount Points v1] Deconvert completed', {
        mountPointId: id,
        name: mountPoint.name,
        targetPath,
        filesWritten: deconvertResult.filesWritten,
        blobsWritten: deconvertResult.blobsWritten,
        bytesWritten: deconvertResult.bytesWritten,
        errors: deconvertResult.errors.length,
        userId: user.id,
      });

      return successResponse({
        mountPoint: updated,
        deconvertResult,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await repos.docMountPoints.updateConversionStatus(id, 'error', msg);
      throw err;
    }
  } catch (error) {
    logger.error(
      '[Mount Points v1] Error deconverting mount point',
      { mountPointId: id },
      error instanceof Error ? error : undefined
    );
    return serverError(
      `Failed to deconvert mount point: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Move / Copy Actions
// ============================================================================

const moveFileSchema = z.object({
  sourcePath: z.string().min(1),
  destMountPointId: z.string().min(1),
  destPath: z.string().min(1),
});

const copyFileSchema = moveFileSchema.extend({
  force: z.boolean().optional(),
});

const deleteFolderSchema = z.object({
  path: z.string().min(1),
});

const moveFolderSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
});

async function handleMoveFile(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = moveFileSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Move requires sourcePath, destMountPointId, and destPath');
  }
  try {
    const result = await moveFile({
      sourceMountPointId: id,
      sourcePath: parsed.data.sourcePath,
      destMountPointId: parsed.data.destMountPointId,
      destPath: parsed.data.destPath,
    });
    logger.info('[Mount Points v1] Moved file', {
      ...result,
      userId: user.id,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: fileOpStatus(err) }
      );
    }
    logger.error(
      '[Mount Points v1] Error moving file',
      { mountPointId: id },
      err instanceof Error ? err : undefined
    );
    return serverError('Failed to move file');
  }
}

async function handleCopyFile(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = copyFileSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Copy requires sourcePath, destMountPointId, and destPath');
  }
  try {
    const result = await copyFile({
      sourceMountPointId: id,
      sourcePath: parsed.data.sourcePath,
      destMountPointId: parsed.data.destMountPointId,
      destPath: parsed.data.destPath,
      force: parsed.data.force,
    });
    logger.info('[Mount Points v1] Copied file', {
      ...result,
      userId: user.id,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: fileOpStatus(err) }
      );
    }
    logger.error(
      '[Mount Points v1] Error copying file',
      { mountPointId: id },
      err instanceof Error ? err : undefined
    );
    return serverError('Failed to copy file');
  }
}

async function handleLinkFile(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = moveFileSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Link requires sourcePath, destMountPointId, and destPath');
  }
  try {
    const result = await linkFile({
      sourceMountPointId: id,
      sourcePath: parsed.data.sourcePath,
      destMountPointId: parsed.data.destMountPointId,
      destPath: parsed.data.destPath,
    });
    logger.info('[Mount Points v1] Linked file', { ...result, userId: user.id });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: fileOpStatus(err) });
    }
    logger.error('[Mount Points v1] Error linking file', { mountPointId: id }, err instanceof Error ? err : undefined);
    return serverError('Failed to link file');
  }
}

async function handleDeleteFolder(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = deleteFolderSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Delete folder requires a non-empty path');
  }
  try {
    const result = await deleteFolder({ mountPointId: id, relativePath: parsed.data.path });
    logger.info('[Mount Points v1] Deleted folder', { ...result, userId: user.id });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError || err instanceof DatabaseStoreError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: fileOpStatus(err) });
    }
    logger.error('[Mount Points v1] Error deleting folder', { mountPointId: id }, err instanceof Error ? err : undefined);
    return serverError('Failed to delete folder');
  }
}

async function handleMoveFolder(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = moveFolderSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Move folder requires fromPath and toPath');
  }
  try {
    const result = await moveFolder({ mountPointId: id, fromPath: parsed.data.fromPath, toPath: parsed.data.toPath });
    logger.info('[Mount Points v1] Moved folder', { ...result, userId: user.id });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError || err instanceof DatabaseStoreError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: fileOpStatus(err) });
    }
    logger.error('[Mount Points v1] Error moving folder', { mountPointId: id }, err instanceof Error ? err : undefined);
    return serverError('Failed to move folder');
  }
}

async function handleWriteFile(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return badRequest('Expected multipart/form-data');
    }
    const form = await req.formData();
    const file = form.get('file');
    const relativePath = String(form.get('path') ?? '').trim();
    const force = String(form.get('force') ?? '').toLowerCase() === 'true';
    if (!(file instanceof File)) {
      return badRequest('Missing "file" field in multipart body');
    }
    if (!relativePath) {
      return badRequest('Missing "path" field');
    }
    const data = Buffer.from(await file.arrayBuffer());
    const result = await writeFile({
      mountPointId: id,
      relativePath,
      data,
      force,
    });
    logger.info('[Mount Points v1] Wrote file', {
      ...result,
      userId: user.id,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: fileOpStatus(err) }
      );
    }
    logger.error(
      '[Mount Points v1] Error writing file',
      { mountPointId: id },
      err instanceof Error ? err : undefined
    );
    return serverError('Failed to write file');
  }
}

async function handleDeleteFile(
  req: NextRequest,
  { user }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const relativePath = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!relativePath) {
      return badRequest('Missing "path" field');
    }
    const result = await deleteFile({ mountPointId: id, relativePath });
    logger.info('[Mount Points v1] Deleted file', {
      ...result,
      userId: user.id,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof FileOpError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: fileOpStatus(err) }
      );
    }
    logger.error(
      '[Mount Points v1] Error deleting file',
      { mountPointId: id },
      err instanceof Error ? err : undefined
    );
    return serverError('Failed to delete file');
  }
}

async function handleReindex(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const mountPoint = await repos.docMountPoints.findById(id);
  if (!mountPoint) return notFound('Mount point');

  let body: { path?: string; force?: boolean } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch (err) {
    return badRequest(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
  }

  logger.info('[Mount Points v1] Reindex requested', {
    mountPointId: id,
    name: mountPoint.name,
    path: body.path,
    force: !!body.force,
  });

  try {
    const result = await reindexLinks(mountPoint, { path: body.path, force: body.force });
    return successResponse({
      mountPointId: id,
      mountName: mountPoint.name,
      ...result,
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Reindex failed',
      { mountPointId: id },
      error instanceof Error ? error : undefined,
    );
    return serverError(`Reindex failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleEmbed(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string }
): Promise<NextResponse> {
  const mountPoint = await repos.docMountPoints.findById(id);
  if (!mountPoint) return notFound('Mount point');

  let body: { path?: string; force?: boolean } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch (err) {
    return badRequest(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
  }

  logger.info('[Mount Points v1] Embed requested', {
    mountPointId: id,
    name: mountPoint.name,
    path: body.path,
    force: !!body.force,
  });

  try {
    const result = await enqueueEmbeddingJobsScoped(mountPoint, {
      path: body.path,
      force: body.force,
    });
    return successResponse({
      mountPointId: id,
      mountName: mountPoint.name,
      ...result,
    });
  } catch (error) {
    logger.error(
      '[Mount Points v1] Embed enqueue failed',
      { mountPointId: id },
      error instanceof Error ? error : undefined,
    );
    return serverError(`Embed failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => {
    const dispatch = withActionDispatch<{ id: string }>({
      scan: handleScan,
      convert: handleConvert,
      deconvert: handleDeconvert,
      'move-file': handleMoveFile,
      'copy-file': handleCopyFile,
      'link-file': handleLinkFile,
      'write-file': handleWriteFile,
      'delete-file': handleDeleteFile,
      'delete-folder': handleDeleteFolder,
      'move-folder': handleMoveFolder,
      reindex: handleReindex,
      embed: handleEmbed,
    });
    return dispatch(req, ctx, { id });
  }
);
