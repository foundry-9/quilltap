/**
 * Project Wardrobe — item detail endpoint.
 *
 * GET    /api/v1/projects/[id]/wardrobe/[itemId] — fetch one project wardrobe item.
 * PUT    /api/v1/projects/[id]/wardrobe/[itemId] — update one project wardrobe item.
 * DELETE /api/v1/projects/[id]/wardrobe/[itemId] — delete one project wardrobe item.
 *
 * @module app/api/v1/projects/[id]/wardrobe/[itemId]
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import { readProjectWardrobe } from '@/lib/mount-index/project-wardrobe';
import {
  updateProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';

/** Resolve the project's official store mount, or null when unavailable. */
async function resolveProjectMount(
  repos: RequestContext['repos'],
  projectId: string,
): Promise<string | null> {
  const project = await repos.projects.findById(projectId);
  if (!project) return null;
  const ensured = await ensureProjectOfficialStore(project.id, project.name);
  return ensured?.mountPointId ?? null;
}

// ============================================================================
// GET — fetch one item
// ============================================================================

export const GET = createContextParamsHandler<{ id: string; itemId: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
    const mountPointId = await resolveProjectMount(repos, id);
    if (!mountPointId) return notFound('Project');

    const items = await readProjectWardrobe(mountPointId, true);
    const item = items.find((i) => i.id === itemId);
    if (!item) return notFound('Project wardrobe item');

    return successResponse({ wardrobeItem: item });
  },
);

// ============================================================================
// PUT — update one item
// ============================================================================

export const PUT = createContextParamsHandler<{ id: string; itemId: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, itemId }) => {
    const mountPointId = await resolveProjectMount(repos, id);
    if (!mountPointId) return notFound('Project');

    const body = await req.json();
    const { archived, ...fields } = updateWardrobeSchema.parse(body);

    // `archived` is a request-shaped boolean; the item stores a timestamp.
    // Archiving is idempotent, so an already-archived item keeps its stamp.
    let archivePatch: { archivedAt: string | null } | null = null;
    if (archived !== undefined) {
      const items = await readProjectWardrobe(mountPointId, true);
      const current = items.find((i) => i.id === itemId);
      if (!current) return notFound('Project wardrobe item');
      archivePatch = archivedPatch(current.archivedAt, archived, new Date().toISOString());
    }

    let item;
    try {
      item = await updateProjectWardrobeItem(mountPointId, itemId, {
        ...fields,
        ...(archivePatch ?? {}),
      });
    } catch (error) {
      // Cycle rejection from the vault writer surfaces as a plain Error → 400.
      if (error instanceof Error && error.message.includes('component cycle')) {
        return badRequest(error.message);
      }
      throw error;
    }
    if (!item) return notFound('Project wardrobe item');

    logger.info('[Projects v1] Updated project wardrobe item', {
      projectId: id,
      userId: user.id,
      mountPointId,
      itemId,
      context: 'wardrobe',
      ...(archivePatch !== null && { archivedAt: archivePatch.archivedAt }),
    });

    return successResponse({ wardrobeItem: item });
  },
);

// ============================================================================
// DELETE — delete one item
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string; itemId: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
    const mountPointId = await resolveProjectMount(repos, id);
    if (!mountPointId) return notFound('Project');

    // Clean up equipped references before deleting. Composite items may still
    // reference this id in `componentItemIds`, but `expandComposites` tolerates
    // unknown ids, so dangling references are harmless.
    try {
      await repos.chats.removeEquippedItemFromAllChats(itemId);
    } catch (cleanupError) {
      logger.warn('[Projects v1] Cleanup of equipped references had issues, proceeding with delete', {
        projectId: id,
        itemId,
        context: 'wardrobe',
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    const success = await deleteProjectWardrobeItem(mountPointId, itemId);
    if (!success) return notFound('Project wardrobe item');

    logger.info('[Projects v1] Deleted project wardrobe item', {
      projectId: id,
      mountPointId,
      itemId,
      context: 'wardrobe',
    });

    return successResponse({ success: true });
  },
);
