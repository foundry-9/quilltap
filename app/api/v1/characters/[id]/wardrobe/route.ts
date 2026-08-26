/**
 * Character Wardrobe Items API v1
 *
 * GET /api/v1/characters/[id]/wardrobe - Get all wardrobe items for a character
 * GET /api/v1/characters/[id]/wardrobe?scope=group - Get the shared items in the
 *   `Wardrobe/` folder of every store belonging to a group this character is a
 *   member of. The group tier of the wearable pool, as a standalone read for the
 *   client-side merge (`useCharacterWardrobeItems`).
 * GET /api/v1/characters/[id]/wardrobe?action=instructions - Read the vault's
 *   `Wardrobe/instructions.md` dressing instructions (null when absent)
 * POST /api/v1/characters/[id]/wardrobe - Create a new wardrobe item
 * POST /api/v1/characters/[id]/wardrobe?action=instructions - Write (or clear,
 *   with null/blank) the vault's dressing instructions
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, exists, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, created, conflict, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';
import { resolveWardrobeMount } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';

const instructionsBodySchema = z.object({
  instructions: z.string().nullable(),
});

// GET /api/v1/characters/[id]/wardrobe?action=instructions
async function handleGetInstructions(
  _req: NextRequest,
  { repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const character = await repos.characters.findById(id);
  if (!exists(character)) {
    return notFound('Character');
  }
  const mountPointId = character.characterDocumentMountPointId ?? null;
  const instructions = mountPointId ? await readWardrobeInstructionsFile(mountPointId) : null;
  logger.debug('[Wardrobe v1] Read character dressing instructions', {
    characterId: id,
    mountPointId,
    present: instructions !== null,
  });
  return successResponse({ instructions });
}

// POST /api/v1/characters/[id]/wardrobe?action=instructions
async function handlePostInstructions(
  req: NextRequest,
  { repos }: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const character = await repos.characters.findById(id);
  if (!exists(character)) {
    return notFound('Character');
  }
  const { instructions } = instructionsBodySchema.parse(await req.json());
  const cleared = !instructions || instructions.trim().length === 0;

  let loc;
  try {
    loc = await resolveWardrobeMount(id);
  } catch (error) {
    if (error instanceof CharacterArchivedError) {
      return conflict('Character is archived; dressing instructions cannot be edited');
    }
    throw error;
  }
  if (!loc) {
    if (cleared) return successResponse({ instructions: null });
    return serverError('Character has no vault to hold dressing instructions');
  }

  await writeWardrobeInstructionsFile(loc.mountPointId, instructions);
  logger.info('[Wardrobe v1] Character dressing instructions updated', {
    characterId: id,
    mountPointId: loc.mountPointId,
    cleared,
  });
  return successResponse({ instructions: cleared ? null : instructions!.trim() });
}

const createWardrobeItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  /** Plain-text image-generation cue; preferred over title in image prompts. */
  imagePrompt: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1, 'At least one type is required'),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /** Optional composite components — empty/omitted = leaf item. */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

// GET /api/v1/characters/[id]/wardrobe
export const GET = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handleGetInstructions }, async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
        return notFound('Character');
      }

      const includeArchived = readIncludeArchived(req);
      const scope = new URL(req.url).searchParams.get('scope');
      if (scope === 'group') {
        const groupMountPointIds = await resolveGroupMountPointIdsForCharacter(id);
        const wardrobeItems = await repos.wardrobe.findArchetypesInMounts(
          groupMountPointIds,
          includeArchived,
        );
        logger.debug('[Wardrobe v1] Group-tier wardrobe read', {
          characterId: id,
          groupMountCount: groupMountPointIds.length,
          itemCount: wardrobeItems.length,
          context: 'wardrobe',
        });
        return NextResponse.json({ wardrobeItems });
      }

      const wardrobeItems = await repos.wardrobe.findByCharacterId(id, includeArchived);
      return NextResponse.json({ wardrobeItems });
    } catch (error) {
      logger.error('[Wardrobe v1] Error fetching wardrobe items', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch wardrobe items');
    }
  })
);

// POST /api/v1/characters/[id]/wardrobe
export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch({ instructions: handlePostInstructions }, async (req, { user, repos }, { id }) => {
    const character = await repos.characters.findById(id);

    if (!exists(character)) {
      return notFound('Character');
    }

    const body = await req.json();
    const validatedData = createWardrobeItemSchema.parse(body);

    const item = await repos.wardrobe.create({
      characterId: id,
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
      return serverError('Failed to create wardrobe item');
    }

    logger.info('[Wardrobe v1] Wardrobe item created', {
      characterId: id,
      itemId: item.id,
      title: validatedData.title,
    });

    return created({ wardrobeItem: item });
  })
);
