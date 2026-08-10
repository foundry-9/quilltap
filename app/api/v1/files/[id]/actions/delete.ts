import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { getFileAssociations } from '@/lib/files/get-file-associations';
import { getRepositories, getUserRepositories } from '@/lib/repositories/factory';
import { canGenerateThumbnail, cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import { badRequest, forbidden, notFound, serverError, successResponse } from '@/lib/api/responses';
import { dissociateFileFromAll } from '../shared';

export async function handleDeleteFile(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  try {
    const fileEntry = await ctx.repos.files.findById(fileId);
    if (!fileEntry) {
      return notFound('File');
    }

    if (fileEntry.userId !== ctx.user.id) {
      logger.warn('[Files v1] User tried to delete file they do not own', {
        fileId,
        userId: ctx.user.id,
        ownerId: fileEntry.userId,
      });
      return forbidden();
    }

    const force = request.nextUrl.searchParams.get('force') === 'true';
    const dissociate = request.nextUrl.searchParams.get('dissociate') === 'true';

    // A held archive bundle is the only copy of an archived character's pruned
    // material (character-archive spec §4.2a) — deleting it leaves a tombstone
    // that can never be rehydrated. Raw read: a broken vault must not let the
    // holder slip past the guard.
    if (fileEntry.category === 'ARCHIVE' && !force) {
      const holders = await getRepositories().characters.findAllRaw();
      const holder = holders.find((c) => c.archiveFileId === fileId);
      if (holder) {
        return badRequest(
          `This bundle holds the only copy of ${holder.name}'s archived effects. Rehydrate them first, or pass force=true to discard the bundle regardless.`,
          { code: 'ARCHIVE_BUNDLE_HELD', characterId: holder.id }
        );
      }
    }

    if (dissociate && fileEntry.linkedTo.length > 0) {
      await dissociateFileFromAll(fileId, fileEntry, ctx.repos);

      const updatedFile = await ctx.repos.files.findById(fileId);
      if (updatedFile) {
        Object.assign(fileEntry, updatedFile);
      }
    }

    if (!force && !dissociate && fileEntry.linkedTo.length > 0) {
      const userRepos = getUserRepositories(ctx.user.id);
      const associations = await getFileAssociations(fileId, fileEntry.linkedTo, userRepos);
      const hasRealAssociations =
        associations.characters.length > 0 || associations.messages.length > 0;

      if (hasRealAssociations) {
        return badRequest('File is linked to other items', {
          code: 'FILE_HAS_ASSOCIATIONS',
          associations,
        });
      }

      logger.info('[Files v1] File has stale linkedTo entries, cleaning up before deletion', {
        fileId,
        staleLinkedToCount: fileEntry.linkedTo.length,
      });
      await ctx.repos.files.update(fileId, { linkedTo: [] });
    }

    if (fileEntry.storageKey) {
      try {
        await fileStorageManager.deleteFile(fileEntry);
      } catch (storageError) {
        logger.warn('[Files v1] Failed to delete file from storage', {
          fileId,
          storageKey: fileEntry.storageKey,
          error: storageError instanceof Error ? storageError.message : 'Unknown error',
        });
      }
    }

    if (canGenerateThumbnail(fileEntry.mimeType)) {
      cleanupThumbnails(fileEntry).catch((error) => {
        logger.warn('[Files v1] Failed to clean up thumbnails', {
          fileId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }

    const deleted = await ctx.repos.files.delete(fileId);
    if (!deleted) {
      logger.warn('[Files v1] File metadata not found when attempting deletion', { fileId });
      return notFound('File');
    }

    logger.info('[Files v1] File deleted successfully', {
      fileId,
      hadStorageKey: !!fileEntry.storageKey,
    });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Files v1] Error deleting file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete file');
  }
}