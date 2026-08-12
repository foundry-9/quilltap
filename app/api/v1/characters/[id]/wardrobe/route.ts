/**
 * Character Wardrobe Items API v1
 *
 * GET /api/v1/characters/[id]/wardrobe - Get all wardrobe items for a character
 * POST /api/v1/characters/[id]/wardrobe - Create a new wardrobe item
 */

import { NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, created } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

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
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
        return notFound('Character');
      }

      const wardrobeItems = await repos.wardrobe.findByCharacterId(id);
      return NextResponse.json({ wardrobeItems });
    } catch (error) {
      logger.error('[Wardrobe v1] Error fetching wardrobe items', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch wardrobe items');
    }
  }
);

// POST /api/v1/characters/[id]/wardrobe
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
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
  }
);
