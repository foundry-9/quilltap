/**
 * Character photo gallery API v1 — Item endpoint
 *
 * DELETE /api/v1/characters/[id]/photos/[linkId]
 *   Remove a photo from the character's gallery (the vault `photos/` folder).
 *
 * `[linkId]` is the `doc_mount_file_links.id` returned by `GET/POST
 * /api/v1/characters/[id]/photos`. If this link was the character's
 * current `defaultImageId` (or appeared in any `avatarOverrides[].imageId`),
 * those pointers are nulled too.
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses';
import { removeFromCharacterGallery } from '@/lib/photos/character-gallery-service';

export const DELETE = createContextParamsHandler<{ id: string; linkId: string }>(
  async (_req, { user, repos }, { id, linkId }) => {
    try {
      if (!id) return badRequest('Missing character id');
      if (!linkId) return badRequest('Missing photo link id');

      const result = await removeFromCharacterGallery({
        characterId: id,
        linkId,
        repos,
      });
      if (!result.deleted) return notFound('Gallery entry');

      return successResponse({ deleted: true, fileGC: result.fileGC });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete photo';
      if (message.startsWith('Character not found')) {
        return notFound('Character');
      }
      logger.error('[Characters/Photos v1] Error deleting photo', { userId: user.id, characterId: id, linkId }, error instanceof Error ? error : undefined);
      return serverError(message);
    }
  }
);
