/**
 * User Photo Gallery API v1 - Item Endpoint
 *
 * GET    /api/v1/photos/[id]   Get a single gallery entry (with link summary)
 * DELETE /api/v1/photos/[id]   Remove a gallery entry (cascades to chunks; GC drops the file row if it was the last link)
 *
 * `id` is a `doc_mount_file_links.id` (the `linkId` returned by POST /photos
 * or GET /photos).
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, notFound, badRequest, serverError } from '@/lib/api/responses';
import {
  getUserGalleryEntry,
  removeFromUserGallery,
} from '@/lib/photos/user-gallery-service';

export const GET = createContextParamsHandler<{ id: string }>(
  async (_req, { user, repos }, { id }) => {
    try {
      if (!id) return badRequest('Missing gallery entry id');

      const entry = await getUserGalleryEntry(id, user.id, repos);
      if (!entry) return notFound('Gallery entry');

      return successResponse(entry);
    } catch (error) {
      logger.error('[Photos v1] Error getting gallery entry', { userId: user.id }, error instanceof Error ? error : undefined);
      return serverError('Failed to get gallery entry');
    }
  }
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (_req, { user, repos }, { id }) => {
    try {
      if (!id) return badRequest('Missing gallery entry id');

      const result = await removeFromUserGallery({ linkId: id, userId: user.id, repos });
      if (!result.deleted) return notFound('Gallery entry');

      return successResponse({ deleted: true, fileGC: result.fileGC });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete gallery entry';
      if (message.includes('not in the user gallery') || message.includes('not a gallery entry')) {
        return badRequest(message);
      }
      logger.error('[Photos v1] Error deleting gallery entry', { userId: user.id }, error instanceof Error ? error : undefined);
      return serverError(message);
    }
  }
);
