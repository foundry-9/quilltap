/**
 * Chat File API Routes (v1)
 *
 * POST /api/v1/chat-files/:id?action=tag - Tag a chat file with CHARACTER
 * DELETE /api/v1/chat-files/:id - Delete a chat file
 *
 * Uses the repository pattern for metadata and S3 for file storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, badRequest, serverError, unauthorized, validationError, successResponse } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

const tagSchema = z.object({
  tagType: z.literal('CHARACTER'),
  tagId: z.string(),
});

/**
 * Handle POST ?action=tag
 * Tag a chat file with a CHARACTER
 */
async function handleTag(
  request: NextRequest,
  ctx: RequestContext,
  params: { id: string }
): Promise<NextResponse> {
  const { id } = params;
  const { user, repos } = ctx;

  const body = await request.json();
  const parseResult = tagSchema.safeParse(body);

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { tagType, tagId } = parseResult.data;

  // Get the file from the repository
  const fileEntry = await repos.files.findById(id);

  if (!fileEntry) {
    return notFound('File');
  }

  // Verify the file is linked to a chat
  const chatId = fileEntry.linkedTo.find((linkId: string) => linkId.startsWith('chat-') || linkId.length === 36);
  if (!chatId) {
    return badRequest('File is not associated with a chat');
  }

  // Verify chat belongs to user
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return unauthorized();
  }

  // Verify the tagged entity exists and belongs to user
  const character = await repos.characters.findById(tagId);
  if (!character) {
    return notFound('Character');
  }

  // Check if tag already exists on this file
  const alreadyTagged = fileEntry.tags.includes(tagId);
  if (alreadyTagged) {
    return NextResponse.json({
      data: {
        fileId: id,
        tagType,
        tagId,
        alreadyTagged: true,
      },
    });
  }

  // Add the tag to the file using repository
  const updatedFileEntry = await repos.files.addTag(id, tagId);

  return NextResponse.json({
    data: {
      fileId: id,
      tagType,
      tagId,
    },
  });
}

/**
 * POST /api/v1/chat-files/:id
 * With ?action=tag - Tag a chat file
 */
export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch(
    {
      tag: handleTag,
    },
    // Default handler when no action specified - require action
    async () => badRequest('Action parameter required: tag')
  )
);

/**
 * DELETE /api/v1/chat-files/:id
 * Delete a chat file and its physical file
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (request: NextRequest, ctx, params) => {
    const { id } = params;
    const { user, repos } = ctx;

    try {
      // Get the file from repository
      const fileEntry = await repos.files.findById(id);

      if (!fileEntry) {
        return notFound('File');
      }

      // Verify the file is linked to a chat
      const chatId = fileEntry.linkedTo.find((linkId: string) => linkId.startsWith('chat-') || linkId.length === 36);
      if (!chatId) {
        return badRequest('File is not associated with a chat');
      }

      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return unauthorized();
      }

      // Delete from storage if file has storageKey
      if (fileEntry.storageKey) {
        try {
          await fileStorageManager.deleteFile(fileEntry);
        } catch (storageError) {
          logger.warn('DELETE /api/v1/chat-files/[id] - Failed to delete from storage', {
            fileId: id,
            storageKey: fileEntry.storageKey,
            error: storageError instanceof Error ? storageError.message : 'Unknown error',
          });
          // Continue with metadata deletion even if storage deletion fails
        }
      }

      // Delete the file metadata from repository
      const deleted = await repos.files.delete(id);

      if (!deleted) {
        return notFound('File');
      }

      return successResponse({ success: true });
    } catch (error) {
      logger.error(
        'Error deleting file',
        { context: 'DELETE /api/v1/chat-files/[id]' },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete file');
    }
  }
);
