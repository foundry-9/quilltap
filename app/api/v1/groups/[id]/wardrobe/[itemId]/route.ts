/**
 * Group Wardrobe — item detail endpoint.
 *
 * GET    /api/v1/groups/[id]/wardrobe/[itemId] — fetch one group wardrobe item.
 * PUT    /api/v1/groups/[id]/wardrobe/[itemId] — update one group wardrobe item.
 * DELETE /api/v1/groups/[id]/wardrobe/[itemId] — delete one group wardrobe item.
 *
 * Mirrors the project wardrobe item routes; group and project items share the
 * same mount-folder storage, so the writes reuse the mount-scoped helpers.
 *
 * @module app/api/v1/groups/[id]/wardrobe/[itemId]
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import { readGroupWardrobe } from '@/lib/mount-index/group-wardrobe';
import {
  updateProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';

/** Resolve the group's official store mount, or null when unavailable. */
async function resolveGroupMount(
  repos: RequestContext['repos'],
  groupId: string,
): Promise<string | null> {
  const group = await repos.groups.findById(groupId);
  if (!group) return null;
  const ensured = await ensureGroupOfficialStore(group.id, group.name);
  return ensured?.mountPointId ?? null;
}

// ============================================================================
// GET — fetch one item
// ============================================================================

export const GET = createContextParamsHandler<{ id: string; itemId: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
    const mountPointId = await resolveGroupMount(repos, id);
    if (!mountPointId) return notFound('Group');

    const items = await readGroupWardrobe(mountPointId, true);
    const item = items.find((i) => i.id === itemId);
    if (!item) return notFound('Group wardrobe item');

    return successResponse({ wardrobeItem: item });
  },
);

// ============================================================================
// PUT — update one item
// ============================================================================

export const PUT = createContextParamsHandler<{ id: string; itemId: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, itemId }) => {
    const mountPointId = await resolveGroupMount(repos, id);
    if (!mountPointId) return notFound('Group');

    const body = await req.json();
    const { archived, ...fields } = updateWardrobeSchema.parse(body);

    // `archived` is a request-shaped boolean; the item stores a timestamp.
    // Archiving is idempotent, so an already-archived item keeps its stamp.
    let archivePatch: { archivedAt: string | null } | null = null;
    if (archived !== undefined) {
      const items = await readGroupWardrobe(mountPointId, true);
      const current = items.find((i) => i.id === itemId);
      if (!current) return notFound('Group wardrobe item');
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
    if (!item) return notFound('Group wardrobe item');

    logger.info('[Groups v1] Updated group wardrobe item', {
      groupId: id,
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
    const mountPointId = await resolveGroupMount(repos, id);
    if (!mountPointId) return notFound('Group');

    // Clean up equipped references before deleting. Composite items may still
    // reference this id in `componentItemIds`, but `expandComposites` tolerates
    // unknown ids, so dangling references are harmless.
    try {
      await repos.chats.removeEquippedItemFromAllChats(itemId);
    } catch (cleanupError) {
      logger.warn('[Groups v1] Cleanup of equipped references had issues, proceeding with delete', {
        groupId: id,
        itemId,
        context: 'wardrobe',
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    const success = await deleteProjectWardrobeItem(mountPointId, itemId);
    if (!success) return notFound('Group wardrobe item');

    logger.info('[Groups v1] Deleted group wardrobe item', {
      groupId: id,
      mountPointId,
      itemId,
      context: 'wardrobe',
    });

    return successResponse({ success: true });
  },
);
