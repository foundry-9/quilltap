/**
 * Character Avatar API Routes
 * PATCH /api/characters/:id/avatar - Set default avatar for character
 *
 * Uses the repository pattern for file metadata management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/json-store/schemas/types';

/**
 * Get the filepath for a file - always returns API path for S3-backed files
 */
function getFilePath(file: FileEntry): string {
  return `/api/files/${file.id}`;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

/**
 * PATCH /api/characters/:id/avatar
 * Set or clear default avatar for a character
 *
 * Flow:
 * 1. Verify user is authenticated
 * 2. Verify character exists and belongs to user
 * 3. If imageId is provided:
 *    - Check file exists in file-manager
 *    - Verify file belongs to user
 *    - Verify file category is 'IMAGE' or 'AVATAR'
 * 4. Update character's defaultImageId
 * 5. Return updated character with file info
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.debug('Avatar update rejected: unauthorized', {
        context: 'PATCH /api/characters/[id]/avatar',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    logger.debug('Avatar update request received', {
      context: 'PATCH /api/characters/[id]/avatar',
      characterId: id,
      userId: session.user.id,
    });

    const body = await request.json();
    const { imageId } = avatarSchema.parse(body);

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id);

    if (!character || character.userId !== session.user.id) {
      logger.debug('Avatar update failed: character not found or unauthorized', {
        context: 'PATCH /api/characters/[id]/avatar',
        characterId: id,
        userId: session.user.id,
        characterFound: !!character,
      });
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    logger.debug('Character verified for avatar update', {
      context: 'PATCH /api/characters/[id]/avatar',
      characterId: id,
      characterName: character.name,
    });

    // If imageId is provided, validate it from repository
    if (imageId) {
      logger.debug('Validating avatar file from repository', {
        context: 'PATCH /api/characters/[id]/avatar',
        imageId,
        characterId: id,
      });

      const fileEntry = await repos.files.findById(imageId);

      // Verify file exists
      if (!fileEntry) {
        logger.warn('Avatar update failed: file not found', {
          context: 'PATCH /api/characters/[id]/avatar',
          imageId,
          characterId: id,
        });
        return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
      }

      // Verify file belongs to user
      if (fileEntry.userId !== session.user.id) {
        logger.warn('Avatar update failed: file belongs to different user', {
          context: 'PATCH /api/characters/[id]/avatar',
          imageId,
          characterId: id,
          fileUserId: fileEntry.userId,
          requestUserId: session.user.id,
        });
        return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
      }

      // Verify file category is IMAGE or AVATAR
      if (fileEntry.category !== 'IMAGE' && fileEntry.category !== 'AVATAR') {
        logger.warn('Avatar update failed: file category is not IMAGE or AVATAR', {
          context: 'PATCH /api/characters/[id]/avatar',
          imageId,
          characterId: id,
          fileCategory: fileEntry.category,
        });
        return NextResponse.json(
          { error: `Invalid file type. Expected IMAGE or AVATAR, got ${fileEntry.category}` },
          { status: 400 }
        );
      }

      logger.debug('Avatar file validation successful', {
        context: 'PATCH /api/characters/[id]/avatar',
        imageId,
        characterId: id,
        fileCategory: fileEntry.category,
        fileName: fileEntry.originalFilename,
      });
    }

    // Update character with the new default image ID
    logger.debug('Updating character with new avatar', {
      context: 'PATCH /api/characters/[id]/avatar',
      characterId: id,
      newImageId: imageId,
    });

    const updatedCharacter = await repos.characters.update(id, {
      defaultImageId: imageId,
    });

    logger.debug('Character avatar updated successfully', {
      context: 'PATCH /api/characters/[id]/avatar',
      characterId: id,
      newImageId: imageId,
    });

    // Build response with file info if image is set
    let defaultImage = null;
    if (updatedCharacter?.defaultImageId) {
      const fileEntry = await repos.files.findById(updatedCharacter.defaultImageId);
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFilePath(fileEntry),
          url: null,
        };
      }
    }

    return NextResponse.json({
      data: {
        ...updatedCharacter,
        defaultImage,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Avatar update validation error', {
        context: 'PATCH /api/characters/[id]/avatar',
        details: error.errors,
      });
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    logger.error(
      'Error updating character avatar',
      { context: 'PATCH /api/characters/[id]/avatar' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      {
        error: 'Failed to update character avatar',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
