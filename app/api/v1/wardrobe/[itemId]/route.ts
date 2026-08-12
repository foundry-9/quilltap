/**
 * Wardrobe Archetype Item Detail API v1
 *
 * GET /api/v1/wardrobe/[itemId] - Get an archetype wardrobe item
 * PUT /api/v1/wardrobe/[itemId] - Update an archetype wardrobe item
 * DELETE /api/v1/wardrobe/[itemId] - Delete an archetype wardrobe item
 */

import { NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

const updateArchetypeSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  /** Plain-text image-generation cue; preferred over title in image prompts. */
  imagePrompt: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1).optional(),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /** Replace this item's composite components (use `[]` to demote to a leaf). */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

// GET /api/v1/wardrobe/[itemId]
export const GET = createContextParamsHandler<{ itemId: string }>(
  async (req, { repos }, { itemId }) => {
    try {
      const item = await repos.wardrobe.findArchetypeById(itemId);

      if (!item || item.characterId !== null) {
        return notFound('Archetype wardrobe item');
      }

      return NextResponse.json({ wardrobeItem: item });
    } catch (error) {
      logger.error(
        '[Wardrobe Archetypes v1] Error fetching archetype item',
        { itemId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch archetype wardrobe item');
    }
  }
);

// PUT /api/v1/wardrobe/[itemId]
export const PUT = createContextParamsHandler<{ itemId: string }>(
  async (req, { repos }, { itemId }) => {
    const existing = await repos.wardrobe.findArchetypeById(itemId);
    if (!existing || existing.characterId !== null) {
      return notFound('Archetype wardrobe item');
    }

    const body = await req.json();
    const validatedData = updateArchetypeSchema.parse(body);

    const item = await repos.wardrobe.update(itemId, validatedData, null);

    if (!item) {
      return notFound('Archetype wardrobe item');
    }

    logger.info('[Wardrobe Archetypes v1] Archetype item updated', { itemId });

    return NextResponse.json({ wardrobeItem: item });
  }
);

// DELETE /api/v1/wardrobe/[itemId]
export const DELETE = createContextParamsHandler<{ itemId: string }>(
  async (req, { repos }, { itemId }) => {
    try {
      const existing = await repos.wardrobe.findArchetypeById(itemId);
      if (!existing || existing.characterId !== null) {
        return notFound('Archetype wardrobe item');
      }

      // Clean up references before deleting.
      // Outfit presets no longer exist as a separate table — composite
      // wardrobe items may still reference this id in `componentItemIds`,
      // but `expandComposites` tolerates unknown ids gracefully so any
      // dangling references are harmless.
      try {
        await repos.chats.removeEquippedItemFromAllChats(itemId);
      } catch (cleanupError) {
        logger.warn('[Wardrobe Archetypes v1] Cleanup of equipped references had issues, proceeding with delete', {
          itemId,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      const success = await repos.wardrobe.delete(itemId, null);

      if (!success) {
        return notFound('Archetype wardrobe item');
      }

      logger.info('[Wardrobe Archetypes v1] Archetype item deleted', { itemId });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error(
        '[Wardrobe Archetypes v1] Error deleting archetype item',
        { itemId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete archetype wardrobe item');
    }
  }
);
