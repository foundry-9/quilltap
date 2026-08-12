/**
 * Mount Points API v1 - Mount Point Files Endpoint
 *
 * GET /api/v1/mount-points/[id]/files - List indexed files for a mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { listFilesystemFolders } from '@/lib/mount-index/scanner';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const mountPoint = await repos.docMountPoints.findById(id);

      if (!mountPoint) {
        return notFound('Mount point');
      }

      const [files, folderRows] = await Promise.all([
        repos.docMountFiles.findByMountPointId(id),
        repos.docMountFolders.findByMountPointId(id),
      ]);

      // Database-backed mounts: folders live in `doc_mount_folders`.
      // Filesystem/obsidian mounts: enumerate directories on disk so empty
      // folders are visible too.
      const folderSet = new Set<string>();
      for (const row of folderRows) {
        if (typeof row.path === 'string' && row.path.length > 0) {
          folderSet.add(row.path);
        }
      }

      if (mountPoint.mountType !== 'database' && mountPoint.basePath) {
        const fsFolders = await listFilesystemFolders(
          mountPoint.basePath,
          mountPoint.excludePatterns ?? []
        );
        for (const f of fsFolders) folderSet.add(f);
      }

      const folders = Array.from(folderSet);

      return NextResponse.json({ files, folders });
    } catch (error) {
      logger.error('[Mount Points v1] Error listing files for mount point', { mountPointId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to list files for mount point');
    }
  }
);
