/**
 * Group Wardrobe — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/wardrobe          — list every wardrobe item in the
 *                                               group's `Wardrobe/` folder.
 * POST /api/v1/groups/[id]/wardrobe          — create a new group wardrobe
 *                                               item. Body: { title, description?,
 *                                               types, appropriateness?, isDefault?,
 *                                               componentItemIds?, replace? }.
 * GET  /api/v1/groups/[id]/wardrobe?action=instructions — read the store's
 *                                               `Wardrobe/instructions.md`
 *                                               dressing instructions.
 * POST /api/v1/groups/[id]/wardrobe?action=instructions — write (or clear,
 *                                               with null/blank) them.
 *                                               Body: { instructions }.
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

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupWardrobeFolder,
  readGroupWardrobe,
} from '@/lib/mount-index/group-wardrobe';
import { createProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { createWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';

const instructionsBodySchema = z.object({
  instructions: z.string().nullable(),
});

// GET /api/v1/groups/[id]/wardrobe?action=instructions
async function handleGetInstructions(
  _req: NextRequest,
  { repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const group = await repos.groups.findById(id);
  if (!group) return notFound('Group');

  const ensured = await ensureGroupOfficialStore(group.id, group.name);
  if (!ensured) return serverError('Failed to ensure group document store');

  const instructions = await readWardrobeInstructionsFile(ensured.mountPointId);
  logger.debug('[Groups v1] Read group dressing instructions', {
    groupId: id,
    mountPointId: ensured.mountPointId,
    present: instructions !== null,
    context: 'wardrobe',
  });
  return successResponse({ instructions });
}

// POST /api/v1/groups/[id]/wardrobe?action=instructions
async function handlePostInstructions(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const group = await repos.groups.findById(id);
  if (!group) return notFound('Group');

  const { instructions } = instructionsBodySchema.parse(await req.json());
  const cleared = !instructions || instructions.trim().length === 0;

  const ensured = await ensureGroupOfficialStore(group.id, group.name);
  if (!ensured) return serverError('Failed to ensure group document store');
  await ensureGroupWardrobeFolder(ensured.mountPointId);

  await writeWardrobeInstructionsFile(ensured.mountPointId, instructions);
  logger.info('[Groups v1] Group dressing instructions updated', {
    groupId: id,
    userId: user.id,
    mountPointId: ensured.mountPointId,
    cleared,
    context: 'wardrobe',
  });
  return successResponse({ instructions: cleared ? null : instructions!.trim() });
}

// ============================================================================
// GET — list group wardrobe items
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handleGetInstructions },
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
  }),
);

// ============================================================================
// POST — create a new group wardrobe item
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handlePostInstructions },
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
  }),
);
