/**
 * Character Wardrobe Item Detail API v1
 *
 * GET /api/v1/characters/[id]/wardrobe/[itemId] - Get a wardrobe item
 * PUT /api/v1/characters/[id]/wardrobe/[itemId] - Update a wardrobe item
 * DELETE /api/v1/characters/[id]/wardrobe/[itemId] - Delete a wardrobe item
 */

import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import { applyArchiveFlag, cleanupEquippedRefs } from '@/lib/wardrobe/item-route-steps';

// GET /api/v1/characters/[id]/wardrobe/[itemId]
export const GET = createContextParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
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
export const PUT = createContextParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    const character = await repos.characters.findById(id);

    if (!exists(character)) {
      return notFound('Character');
    }

    const existing = await repos.wardrobe.findByIdForCharacter(id, itemId);
    if (!existing || existing.characterId !== id) {
      return notFound('Wardrobe item');
    }

    const body = await req.json();
    const { archived, ...fields } = updateWardrobeSchema.parse(body);

    // `archived` is a request-shaped boolean; the item stores a timestamp.
    // Archiving is idempotent, so an already-archived item keeps its stamp.
    const archivePatch = applyArchiveFlag(existing.archivedAt, archived);

    const item = await repos.wardrobe.update(
      itemId,
      { ...fields, ...(archivePatch ?? {}) },
      id,
    );

    if (!item) {
      return notFound('Wardrobe item');
    }

    logger.info('[Wardrobe v1] Wardrobe item updated', {
      characterId: id,
      itemId,
      ...(archivePatch !== null && { archivedAt: archivePatch.archivedAt }),
    });

    return successResponse({ wardrobeItem: item });
  }
);

// DELETE /api/v1/characters/[id]/wardrobe/[itemId]
export const DELETE = createContextParamsHandler<{ id: string; itemId: string }>(
  async (req, { user, repos }, { id, itemId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
        return notFound('Character');
      }

      const existing = await repos.wardrobe.findByIdForCharacter(id, itemId);
      if (!existing || existing.characterId !== id) {
        return notFound('Wardrobe item');
      }

      await cleanupEquippedRefs(repos.chats, itemId, '[Wardrobe v1]', { characterId: id, itemId });

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
