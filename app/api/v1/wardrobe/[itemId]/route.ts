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
import { notFound, serverError } from '@/lib/api/responses';
import { updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import { applyArchiveFlag, cleanupEquippedRefs } from '@/lib/wardrobe/item-route-steps';

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
    const { archived, ...fields } = updateWardrobeSchema.parse(body);

    const archivePatch = applyArchiveFlag(existing.archivedAt, archived);

    const item = await repos.wardrobe.update(
      itemId,
      { ...fields, ...(archivePatch ?? {}) },
      null,
    );

    if (!item) {
      return notFound('Archetype wardrobe item');
    }

    logger.info('[Wardrobe Archetypes v1] Archetype item updated', {
      itemId,
      ...(archivePatch !== null && { archivedAt: archivePatch.archivedAt }),
    });

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

      await cleanupEquippedRefs(repos.chats, itemId, '[Wardrobe Archetypes v1]', { itemId });

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
