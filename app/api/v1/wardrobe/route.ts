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
import { z } from 'zod';
import { serverError, created, successResponse } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { ensureGeneralWardrobeFolder } from '@/lib/mount-index/general-wardrobe';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';

const instructionsBodySchema = z.object({
  instructions: z.string().nullable(),
});

const createArchetypeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  /** Plain-text image-generation cue; preferred over title in image prompts. */
  imagePrompt: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1, 'At least one type is required'),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /**
   * IDs of other items this composite bundles. Empty/omitted = leaf item.
   * Cycle rejection is enforced by the repository.
   */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

// GET /api/v1/wardrobe?action=instructions
async function handleGetInstructions(): Promise<NextResponse> {
  const mountPointId = await getGeneralMountPointId();
  const instructions = mountPointId ? await readWardrobeInstructionsFile(mountPointId) : null;
  logger.debug('[Wardrobe Archetypes v1] Read General dressing instructions', {
    mountPointId,
    present: instructions !== null,
  });
  return successResponse({ instructions });
}

// POST /api/v1/wardrobe?action=instructions
async function handlePostInstructions(req: Request): Promise<NextResponse> {
  const { instructions } = instructionsBodySchema.parse(await req.json());
  const cleared = !instructions || instructions.trim().length === 0;
  const { mountPointId } = await ensureGeneralWardrobeFolder();
  if (!mountPointId) {
    // Clearing instructions that can't exist yet is a harmless no-op.
    if (cleared) return successResponse({ instructions: null });
    return serverError('Quilltap General store is not provisioned yet');
  }
  await writeWardrobeInstructionsFile(mountPointId, instructions);
  logger.info('[Wardrobe Archetypes v1] General dressing instructions updated', {
    mountPointId,
    cleared,
  });
  return successResponse({ instructions: cleared ? null : instructions!.trim() });
}

// GET /api/v1/wardrobe
export const GET = createContextHandler(
  withCollectionActionDispatch(
    { instructions: handleGetInstructions },
    async (req, { repos }) => {
      try {
        const archetypeItems = await repos.wardrobe.findArchetypes();
        return NextResponse.json({ wardrobeItems: archetypeItems });
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
    const validatedData = createArchetypeSchema.parse(body);

    const item = await repos.wardrobe.create({
      characterId: null,
      title: validatedData.title,
      description: validatedData.description ?? null,
      imagePrompt: validatedData.imagePrompt ?? null,
      types: validatedData.types,
      componentItemIds: validatedData.componentItemIds ?? [],
      appropriateness: validatedData.appropriateness ?? null,
      isDefault: validatedData.isDefault ?? false,
      replace: validatedData.replace ?? false,
      migratedFromClothingRecordId: null,
    });

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
