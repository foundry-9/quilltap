/**
 * Project Wardrobe — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/wardrobe          — list every wardrobe item in the
 *                                                 project's `Wardrobe/` folder.
 * POST /api/v1/projects/[id]/wardrobe          — create a new project wardrobe
 *                                                 item. Body: { title, description?,
 *                                                 types, appropriateness?, isDefault?,
 *                                                 componentItemIds?, replace? }.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model (character
 * vault + project stores + Quilltap General), mirroring project scenarios. Both
 * routes ensure the project's official store and its `Wardrobe/` folder first so
 * callers don't have to wait for a startup heal pass.
 *
 * @module app/api/v1/projects/[id]/wardrobe
 */

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  ensureProjectWardrobeFolder,
  readProjectWardrobe,
} from '@/lib/mount-index/project-wardrobe';
import { createProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { createWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

// ============================================================================
// GET — list project wardrobe items
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id }) => {
    const project = await repos.projects.findById(id);
    if (!project) return notFound('Project');

    const ensured = await ensureProjectOfficialStore(project.id, project.name);
    if (!ensured) {
      return serverError('Failed to ensure project document store');
    }
    await ensureProjectWardrobeFolder(ensured.mountPointId);

    const wardrobeItems = await readProjectWardrobe(ensured.mountPointId, true);

    return successResponse({
      mountPointId: ensured.mountPointId,
      wardrobeItems,
    });
  },
);

// ============================================================================
// POST — create a new project wardrobe item
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
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
  },
);
