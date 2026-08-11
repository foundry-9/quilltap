/**
 * Mount Points API v1 - Folders Endpoint
 *
 * POST /api/v1/mount-points/[id]/folders - Create a folder inside a mount point
 */

import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, errorResponse, notFound, serverError, successResponse } from '@/lib/api/responses';
import { createDatabaseFolder } from '@/lib/mount-index/database-store';
import { createFilesystemFolder } from '@/lib/mount-index/scanner';
import { BasePathUnavailableError } from '@/lib/mount-index/base-path-availability';

const createFolderSchema = z.object({
  path: z.string().min(1).max(1024),
});

function normaliseRelativePath(input: string): string {
  return input.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\\/g, '/');
}

function isPathSafe(rel: string): boolean {
  if (!rel) return false;
  if (path.isAbsolute(rel)) return false;
  const segments = rel.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (/[\x00-\x1f]/.test(seg)) return false;
    if (/[<>:"|?*\\]/.test(seg)) return false;
    if (seg.length > 200) return false;
  }
  return true;
}

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const body = await req.json().catch(() => ({}));
      const parsed = createFolderSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest('Folder path is required');
      }

      const rel = normaliseRelativePath(parsed.data.path);
      if (!isPathSafe(rel)) {
        return badRequest('Folder path contains invalid characters or segments');
      }

      const mountPoint = await repos.docMountPoints.findById(id);
      if (!mountPoint) {
        return notFound('Mount point');
      }
      if (!mountPoint.enabled) {
        return badRequest('Mount point is disabled');
      }

      if (mountPoint.mountType === 'database') {
        const result = await createDatabaseFolder(id, rel);
        logger.info('[Mount Points v1] Database folder created', {
          mountPointId: id,
          path: result.path,
          userId: user.id,
        });
        return successResponse({ path: result.path });
      }

      const baseDir = mountPoint.basePath;
      if (!baseDir) {
        return badRequest('Mount point has no base path configured');
      }

      try {
        await createFilesystemFolder(baseDir, id, rel);
      } catch (folderErr) {
        if (folderErr instanceof BasePathUnavailableError) {
          // The store's own root is unreachable, so this is a configuration
          // problem rather than a bad request or a server fault. Hand back the
          // diagnosis — it names the remedy, which a bare 500 never could.
          logger.warn('[Mount Points v1] Folder creation refused — base path unavailable', {
            mountPointId: id,
            basePath: baseDir,
            reason: folderErr.reason,
            containerized: folderErr.containerized,
            userId: user.id,
          });
          return errorResponse(folderErr.message, 409);
        }
        if (folderErr instanceof Error && folderErr.message.includes('escapes')) {
          return badRequest('Folder path escapes mount point boundary');
        }
        throw folderErr;
      }

      logger.info('[Mount Points v1] Filesystem folder created', {
        mountPointId: id,
        path: rel,
        userId: user.id,
      });

      return successResponse({ path: rel });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error creating folder in mount point',
        { mountPointId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to create folder');
    }
  }
);
