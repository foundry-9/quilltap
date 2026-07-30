/**
 * Character Wardrobe Item Detail API v1
 *
 * GET /api/v1/characters/[id]/wardrobe/[itemId] - Get a wardrobe item
 * PUT /api/v1/characters/[id]/wardrobe/[itemId] - Update a wardrobe item
 * DELETE /api/v1/characters/[id]/wardrobe/[itemId] - Delete a wardrobe item
 */

import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

const updateWardrobeItemSchema = z.object({
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

// GET /api/v1/characters/[id]/wardrobe/[itemId]
export const GET = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const item = await repos.wardrobe.findByIdForCharacter(id, itemId);

      if (!item || item.characterId !== id) {
        return notFound('Wardrobe item');
      }

      return successResponse({ wardrobeItem: item });
    } catch (error) {
      logger.error('[Wardrobe v1] Error fetching wardrobe item', { characterId: id, itemId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch wardrobe item');
    }
  }
);

// PUT /api/v1/characters/[id]/wardrobe/[itemId]
export const PUT = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    const character = await repos.characters.findById(id);

    if (!checkOwnership(character, user.id)) {
      return notFound('Character');
    }

    const existing = await repos.wardrobe.findByIdForCharacter(id, itemId);
    if (!existing || existing.characterId !== id) {
      return notFound('Wardrobe item');
    }

    const body = await req.json();
    const validatedData = updateWardrobeItemSchema.parse(body);

    const item = await repos.wardrobe.update(itemId, validatedData, id);

    if (!item) {
      return notFound('Wardrobe item');
    }

    logger.info('[Wardrobe v1] Wardrobe item updated', {
      characterId: id,
      itemId,
    });

    return successResponse({ wardrobeItem: item });
  }
);

// DELETE /api/v1/characters/[id]/wardrobe/[itemId]
export const DELETE = createAuthenticatedParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const existing = await repos.wardrobe.findByIdForCharacter(id, itemId);
      if (!existing || existing.characterId !== id) {
        return notFound('Wardrobe item');
      }

      // Clean up equipped references before deleting. Composite items that
      // reference this item via `componentItemIds` are intentionally left as-is;
      // expand-time resolution drops unknown ids without surfacing an error.
      try {
        await repos.chats.removeEquippedItemFromAllChats(itemId);
      } catch (cleanupError) {
        logger.warn('[Wardrobe v1] Cleanup of equipped references had issues, proceeding with delete', {
          characterId: id,
          itemId,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      const success = await repos.wardrobe.delete(itemId, id);

      if (!success) {
        return notFound('Wardrobe item');
      }

      logger.info('[Wardrobe v1] Wardrobe item deleted', {
        characterId: id,
        itemId,
      });

      return successResponse({ success: true });
    } catch (error) {
      logger.error('[Wardrobe v1] Error deleting wardrobe item', { characterId: id, itemId }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete wardrobe item');
    }
  }
);
