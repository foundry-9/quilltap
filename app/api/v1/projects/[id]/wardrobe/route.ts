/**
 * Project Wardrobe — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/wardrobe          — list every wardrobe item in the
 *                                                 project's `Wardrobe/` folder.
 * POST /api/v1/projects/[id]/wardrobe          — create a new project wardrobe
 *                                                 item. Body: { title, description?,
 *                                                 types, appropriateness?, isDefault?,
 *                                                 componentItemIds?, replace? }.
 * GET  /api/v1/projects/[id]/wardrobe?action=instructions — read the store's
 *                                                 `Wardrobe/instructions.md`
 *                                                 dressing instructions.
 * POST /api/v1/projects/[id]/wardrobe?action=instructions — write (or clear,
 *                                                 with null/blank) them.
 *                                                 Body: { instructions }.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model (character
 * vault + project stores + Quilltap General), mirroring project scenarios. Both
 * routes ensure the project's official store and its `Wardrobe/` folder first so
 * callers don't have to wait for a startup heal pass.
 *
 * @module app/api/v1/projects/[id]/wardrobe
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  ensureProjectWardrobeFolder,
  readProjectWardrobe,
} from '@/lib/mount-index/project-wardrobe';
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

// GET /api/v1/projects/[id]/wardrobe?action=instructions
async function handleGetInstructions(
  _req: NextRequest,
  { repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const project = await repos.projects.findById(id);
  if (!project) return notFound('Project');

  const ensured = await ensureProjectOfficialStore(project.id, project.name);
  if (!ensured) return serverError('Failed to ensure project document store');

  const instructions = await readWardrobeInstructionsFile(ensured.mountPointId);
  logger.debug('[Projects v1] Read project dressing instructions', {
    projectId: id,
    mountPointId: ensured.mountPointId,
    present: instructions !== null,
    context: 'wardrobe',
  });
  return successResponse({ instructions });
}

// POST /api/v1/projects/[id]/wardrobe?action=instructions
async function handlePostInstructions(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const project = await repos.projects.findById(id);
  if (!project) return notFound('Project');

  const { instructions } = instructionsBodySchema.parse(await req.json());
  const cleared = !instructions || instructions.trim().length === 0;

  const ensured = await ensureProjectOfficialStore(project.id, project.name);
  if (!ensured) return serverError('Failed to ensure project document store');
  await ensureProjectWardrobeFolder(ensured.mountPointId);

  await writeWardrobeInstructionsFile(ensured.mountPointId, instructions);
  logger.info('[Projects v1] Project dressing instructions updated', {
    projectId: id,
    userId: user.id,
    mountPointId: ensured.mountPointId,
    cleared,
    context: 'wardrobe',
  });
  return successResponse({ instructions: cleared ? null : instructions!.trim() });
}

// ============================================================================
// GET — list project wardrobe items
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handleGetInstructions },
  async (req: NextRequest, { repos }: RequestContext, { id }) => {
    const project = await repos.projects.findById(id);
    if (!project) return notFound('Project');

    const ensured = await ensureProjectOfficialStore(project.id, project.name);
    if (!ensured) {
      return serverError('Failed to ensure project document store');
    }
    await ensureProjectWardrobeFolder(ensured.mountPointId);

    const wardrobeItems = await readProjectWardrobe(
      ensured.mountPointId,
      readIncludeArchived(req),
    );

    return successResponse({
      mountPointId: ensured.mountPointId,
      wardrobeItems,
    });
  }),
);

// ============================================================================
// POST — create a new project wardrobe item
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handlePostInstructions },
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    const project = await repos.projects.findById(id);
    if (!project) return notFound('Project');

    const body = await req.json();
    const validated = createWardrobeSchema.parse(body);

    const ensured = await ensureProjectOfficialStore(project.id, project.name);
    if (!ensured) {
      return serverError('Failed to ensure project document store');
    }
    await ensureProjectWardrobeFolder(ensured.mountPointId);

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

    logger.info('[Projects v1] Created project wardrobe item', {
      projectId: id,
      userId: user.id,
      mountPointId: ensured.mountPointId,
      itemId: stored.id,
      title: stored.title,
      context: 'wardrobe',
    });

    // Return the freshly listed items so the client doesn't need a follow-up GET.
    const wardrobeItems = await readProjectWardrobe(ensured.mountPointId, true);
    return created({
      mountPointId: ensured.mountPointId,
      wardrobeItem: stored,
      wardrobeItems,
    });
  }),
);
