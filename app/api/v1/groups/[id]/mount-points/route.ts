/**
 * Groups API v1 - Group Mount Points Endpoint
 *
 * GET /api/v1/groups/[id]/mount-points - List mount points linked to a group
 * POST /api/v1/groups/[id]/mount-points - Link a mount point to a group
 * DELETE /api/v1/groups/[id]/mount-points - Unlink a mount point from a group
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, notFound, badRequest, successResponse } from '@/lib/api/responses';

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
    // Verify group exists
    const group = await repos.groups.findById(id);
    if (!group) {
      return notFound('Group');
    }

    // Get links for this group
    const links = await repos.groupDocMountLinks.findByGroupId(id);

    // Fetch each mount point
    const mountPoints = await Promise.all(
      links.map(async (link) => {
        const mountPoint = await repos.docMountPoints.findById(link.mountPointId);
        return mountPoint;
      })
    );

    // Filter out any null results (mount points that were deleted but links remain)
    const validMountPoints = mountPoints.filter(
      (mp): mp is NonNullable<typeof mp> => mp !== null,
    );

    return successResponse({ mountPoints: validMountPoints });
  }
);

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    // Verify group exists
    const group = await repos.groups.findById(id);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = linkMountPointSchema.parse(body);

    // Verify mount point exists
    const mountPoint = await repos.docMountPoints.findById(validatedData.mountPointId);
    if (!mountPoint) {
      return notFound('Mount point');
    }

    const link = await repos.groupDocMountLinks.link(id, validatedData.mountPointId);

    logger.info('[Groups v1] Mount point linked to group', {
      groupId: id,
      mountPointId: validatedData.mountPointId,
      linkId: link.id,
      userId: user.id,
    });

    return created({ link, mountPoint });
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    // Verify group exists
    const group = await repos.groups.findById(id);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = linkMountPointSchema.parse(body);

    const unlinked = await repos.groupDocMountLinks.unlink(id, validatedData.mountPointId);

    if (!unlinked) {
      return badRequest('No link exists between this group and mount point');
    }

    logger.info('[Groups v1] Mount point unlinked from group', {
      groupId: id,
      mountPointId: validatedData.mountPointId,
      userId: user.id,
    });

    return successResponse({ message: 'Mount point unlinked from group' });
  }
);
