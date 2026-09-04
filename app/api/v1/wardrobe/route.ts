/**
 * Wardrobe Archetypes API v1
 *
 * GET /api/v1/wardrobe - List all archetype wardrobe items
 * GET /api/v1/wardrobe?action=instructions - Read the Quilltap General
 *   `Wardrobe/instructions.md` dressing instructions (null when absent)
 * POST /api/v1/wardrobe - Create a new archetype wardrobe item
 * POST /api/v1/wardrobe?action=instructions - Write (or clear, with
 *   null/blank) the General dressing instructions
 */

import { NextResponse } from 'next/server';
import { createContextHandler, withCollectionActionDispatch } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError, created, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { createWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import { wardrobeItemFromCreateBody } from '@/lib/wardrobe/create-body';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { ensureGeneralWardrobeFolder } from '@/lib/mount-index/general-wardrobe';
import {
  parseWardrobeInstructionsBody,
  handleReadWardrobeInstructions,
  handleWriteWardrobeInstructions,
} from '@/lib/wardrobe/wardrobe-instructions-handlers';

// GET /api/v1/wardrobe?action=instructions
async function handleGetInstructions(): Promise<NextResponse> {
  const mountPointId = await getGeneralMountPointId();
  return handleReadWardrobeInstructions(mountPointId, ({ present }) => {
    logger.debug('[Wardrobe Archetypes v1] Read General dressing instructions', {
      mountPointId,
      present,
    });
  });
}

// POST /api/v1/wardrobe?action=instructions
async function handlePostInstructions(req: Request): Promise<NextResponse> {
  const body = await parseWardrobeInstructionsBody(req);
  const { mountPointId } = await ensureGeneralWardrobeFolder();
  if (!mountPointId) {
    // Clearing instructions that can't exist yet is a harmless no-op.
    if (body.cleared) return successResponse({ instructions: null });
    return serverError('Quilltap General store is not provisioned yet');
  }
  return handleWriteWardrobeInstructions(mountPointId, body, ({ cleared }) => {
    logger.info('[Wardrobe Archetypes v1] General dressing instructions updated', {
      mountPointId,
      cleared,
    });
  });
}

// GET /api/v1/wardrobe
export const GET = createContextHandler(
  withCollectionActionDispatch(
    { instructions: handleGetInstructions },
    async (req, { repos }) => {
      try {
        const archetypeItems = await repos.wardrobe.findArchetypes(readIncludeArchived(req));
        return successResponse({ wardrobeItems: archetypeItems });
      } catch (error) {
        logger.error(
          '[Wardrobe Archetypes v1] Error fetching archetype items',
          {},
          error instanceof Error ? error : undefined
        );
        return serverError('Failed to fetch archetype wardrobe items');
      }
    },
  ),
);

// POST /api/v1/wardrobe
export const POST = createContextHandler(
  withCollectionActionDispatch({ instructions: handlePostInstructions }, async (req, { repos }) => {
    const body = await req.json();
    const validatedData = createWardrobeSchema.parse(body);

    const item = await repos.wardrobe.create(wardrobeItemFromCreateBody(validatedData, null));

    if (!item) {
      return serverError('Failed to create archetype wardrobe item');
    }

    logger.info('[Wardrobe Archetypes v1] Archetype item created', {
      itemId: item.id,
      title: validatedData.title,
    });

    return created({ wardrobeItem: item });
  }),
);
