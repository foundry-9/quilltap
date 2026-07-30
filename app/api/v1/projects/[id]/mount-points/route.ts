/**
 * Projects API v1 - Project Mount Points Endpoint
 *
 * GET /api/v1/projects/[id]/mount-points - List mount points linked to a project
 * POST /api/v1/projects/[id]/mount-points - Link a mount point to a project
 * DELETE /api/v1/projects/[id]/mount-points - Unlink a mount point from a project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, notFound, badRequest, serverError, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const linkMountPointSchema = z.object({
  mountPointId: z.string().min(1, 'Mount point ID is required'),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        return notFound('Project');
      }

      // Get links for this project
      const links = await repos.projectDocMountLinks.findByProjectId(id);

      // Fetch each mount point
      const mountPoints = await Promise.all(
        links.map(async (link) => {
          const mountPoint = await repos.docMountPoints.findById(link.mountPointId);
          return mountPoint;
        })
      );

      // Filter out any null results (mount points that were deleted but links remain)
      const validMountPoints = mountPoints.filter((mp) => mp !== null);

      return NextResponse.json({ mountPoints: validMountPoints });
    } catch (error) {
      logger.error('[Projects v1] Error listing mount points for project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to list mount points for project');
    }
  }
);

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        return notFound('Project');
      }

      const body = await req.json();
      const validatedData = linkMountPointSchema.parse(body);

      // Verify mount point exists
      const mountPoint = await repos.docMountPoints.findById(validatedData.mountPointId);
      if (!mountPoint) {
        return notFound('Mount point');
      }

      const link = await repos.projectDocMountLinks.link(id, validatedData.mountPointId);

      logger.info('[Projects v1] Mount point linked to project', {
        projectId: id,
        mountPointId: validatedData.mountPointId,
        linkId: link.id,
        userId: user.id,
      });

      return created({ link, mountPoint });
    } catch (error) {
      logger.error('[Projects v1] Error linking mount point to project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to link mount point to project');
    }
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        return notFound('Project');
      }

      const body = await req.json();
      const validatedData = linkMountPointSchema.parse(body);

      const unlinked = await repos.projectDocMountLinks.unlink(id, validatedData.mountPointId);

      if (!unlinked) {
        return badRequest('No link exists between this project and mount point');
      }

      logger.info('[Projects v1] Mount point unlinked from project', {
        projectId: id,
        mountPointId: validatedData.mountPointId,
        userId: user.id,
      });

      return successResponse({ message: 'Mount point unlinked from project' });
    } catch (error) {
      logger.error('[Projects v1] Error unlinking mount point from project', { projectId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to unlink mount point from project');
    }
  }
);
