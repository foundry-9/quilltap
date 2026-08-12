/**
 * Wardrobe Archetypes API v1
 *
 * GET /api/v1/wardrobe - List all archetype wardrobe items
 * POST /api/v1/wardrobe - Create a new archetype wardrobe item
 */

import { NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { serverError, created } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

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

// GET /api/v1/wardrobe
export const GET = createContextHandler(async (req, { repos }) => {
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
});

// POST /api/v1/wardrobe
export const POST = createContextHandler(async (req, { repos }) => {
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
});
