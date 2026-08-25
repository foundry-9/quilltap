/**
 * Group Wardrobe — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/wardrobe          — list every wardrobe item in the
 *                                               group's `Wardrobe/` folder.
 * POST /api/v1/groups/[id]/wardrobe          — create a new group wardrobe
 *                                               item. Body: { title, description?,
 *                                               types, appropriateness?, isDefault?,
 *                                               componentItemIds?, replace? }.
 *
 * Group wardrobe is the group tier of the four-tier wardrobe model (character
 * vault > group stores > project stores > Quilltap General), mirroring the
 * project wardrobe routes. Both routes ensure the group's official store and
 * its `Wardrobe/` folder first so callers don't have to wait for a startup
 * heal pass. Group and project items share the same mount-folder storage, so
 * the writes reuse the mount-scoped helpers in `wardrobe-writes.ts`.
 *
 * @module app/api/v1/groups/[id]/wardrobe
 */

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupWardrobeFolder,
  readGroupWardrobe,
} from '@/lib/mount-index/group-wardrobe';
import { createProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { createWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

// ============================================================================
// GET — list group wardrobe items
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id }) => {
    const group = await repos.groups.findById(id);
    if (!group) return notFound('Group');

    const ensured = await ensureGroupOfficialStore(group.id, group.name);
    if (!ensured) {
      return serverError('Failed to ensure group document store');
    }
    await ensureGroupWardrobeFolder(ensured.mountPointId);

    const wardrobeItems = await readGroupWardrobe(ensured.mountPointId, true);

    logger.debug('[Groups v1] Listed group wardrobe items', {
      groupId: id,
      mountPointId: ensured.mountPointId,
      count: wardrobeItems.length,
      context: 'wardrobe',
    });

    return successResponse({
      mountPointId: ensured.mountPointId,
      wardrobeItems,
    });
  },
);

// ============================================================================
// POST — create a new group wardrobe item
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    const group = await repos.groups.findById(id);
    if (!group) return notFound('Group');

    const body = await req.json();
    const validated = createWardrobeSchema.parse(body);

    const ensured = await ensureGroupOfficialStore(group.id, group.name);
    if (!ensured) {
      return serverError('Failed to ensure group document store');
    }
    await ensureGroupWardrobeFolder(ensured.mountPointId);

    const now = new Date().toISOString();
    const item: WardrobeItem = {
      id: randomUUID(),
      characterId: null,
      title: validated.title,
      description: validated.description ?? null,
      imagePrompt: validated.imagePrompt ?? null,
      types: validated.types,
      componentItemIds: validated.componentItemIds ?? [],
      appropriateness: validated.appropriateness ?? null,
      isDefault: validated.isDefault ?? false,
      replace: validated.replace ?? false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let stored;
    try {
      stored = await createProjectWardrobeItem(ensured.mountPointId, item);
    } catch (error) {
      // Cycle rejection from the vault writer surfaces as a plain Error → 400.
      if (error instanceof Error && error.message.includes('component cycle')) {
        return badRequest(error.message);
      }
      throw error;
    }

    logger.info('[Groups v1] Created group wardrobe item', {
      groupId: id,
      userId: user.id,
      mountPointId: ensured.mountPointId,
      itemId: stored.id,
      title: stored.title,
      context: 'wardrobe',
    });

    // Return the freshly listed items so the client doesn't need a follow-up GET.
    const wardrobeItems = await readGroupWardrobe(ensured.mountPointId, true);
    return created({
      mountPointId: ensured.mountPointId,
      wardrobeItem: stored,
      wardrobeItems,
    });
  },
);
