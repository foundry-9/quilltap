/**
 * Individual Image API Routes
 * GET /api/images/:id - Get single image
 * DELETE /api/images/:id - Delete image
 *
 * Uses the repository pattern for metadata and S3 for file storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { isS3Enabled } from '@/lib/s3/config';
import { deleteFile as deleteS3File, downloadFile as downloadS3File } from '@/lib/s3/operations';
import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/json-store/schemas/types';

const LOCAL_STORAGE_DIR = 'public/data/files/storage';

/**
 * Get the filepath for an image based on storage type
 */
function getFilePath(image: FileEntry): string {
  if (image.s3Key) {
    return `/api/files/${image.id}`;
  }
  const ext = image.originalFilename.includes('.')
    ? image.originalFilename.substring(image.originalFilename.lastIndexOf('.'))
    : '';
  return `data/files/storage/${image.id}${ext}`;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/images/:id
 * Get a single image by ID
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.debug('GET /api/images/[id] - Unauthorized: no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    logger.debug('GET /api/images/[id] - Fetching image', { imageId: id, userId: session.user.id });

    const image = await repos.files.findById(id);

    if (!image) {
      logger.debug('GET /api/images/[id] - Image not found', { imageId: id });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Verify image belongs to user
    if (image.userId !== session.user.id) {
      logger.warn('GET /api/images/[id] - User tried to access image they do not own', {
        imageId: id,
        userId: session.user.id,
        ownerId: image.userId,
      });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Verify file category
    if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
      logger.debug('GET /api/images/[id] - File is not an image', { imageId: id, category: image.category });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Count usages by checking related entities
    const [allCharacters, allPersonas] = await Promise.all([
      repos.characters.findByUserId(session.user.id),
      repos.personas.findByUserId(session.user.id),
    ]);

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id).length;
    const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id).length;
    const chatAvatarOverrides = allCharacters.reduce((count, c) => {
      return count + c.avatarOverrides.filter(o => o.imageId === id).length;
    }, 0);

    // Map source to old format
    const source = image.source === 'UPLOADED' ? 'upload' :
                   image.source === 'IMPORTED' ? 'import' :
                   image.source === 'GENERATED' ? 'generated' : 'upload';

    logger.debug('GET /api/images/[id] - Image fetched successfully', {
      imageId: id,
      filename: image.originalFilename,
      usageCount: charactersUsingAsDefault + personasUsingAsDefault + chatAvatarOverrides,
    });

    return NextResponse.json({
      data: {
        id: image.id,
        userId: session.user.id,
        filename: image.originalFilename,
        filepath: getFilePath(image),
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        source,
        generationPrompt: image.generationPrompt,
        generationModel: image.generationModel,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
        tags: image.tags,
        _count: {
          charactersUsingAsDefault,
          personasUsingAsDefault,
          chatAvatarOverrides,
        },
      }
    });
  } catch (error) {
    logger.error('Error fetching image:', { context: 'GET /api/images/[id]' }, error as Error);
    return NextResponse.json(
      { error: 'Failed to fetch image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/images/:id
 * Delete an image
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.debug('DELETE /api/images/[id] - Unauthorized: no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    logger.debug('DELETE /api/images/[id] - Deleting image', { imageId: id, userId: session.user.id });

    // Check if image exists
    const image = await repos.files.findById(id);

    if (!image) {
      logger.debug('DELETE /api/images/[id] - Image not found', { imageId: id });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Verify image belongs to user
    if (image.userId !== session.user.id) {
      logger.warn('DELETE /api/images/[id] - User tried to delete image they do not own', {
        imageId: id,
        userId: session.user.id,
        ownerId: image.userId,
      });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Verify file category
    if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
      logger.debug('DELETE /api/images/[id] - File is not an image', { imageId: id, category: image.category });
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Check if the underlying file actually exists (to detect orphaned metadata)
    let fileExists = false;
    const s3Enabled = isS3Enabled();
    if (s3Enabled && image.s3Key) {
      try {
        await downloadS3File(image.s3Key);
        fileExists = true;
      } catch {
        logger.debug('DELETE /api/images/[id] - S3 file does not exist (orphaned)', { imageId: id, s3Key: image.s3Key });
      }
    } else if (!s3Enabled) {
      const ext = image.originalFilename.includes('.')
        ? image.originalFilename.substring(image.originalFilename.lastIndexOf('.'))
        : '';
      const localPath = join(LOCAL_STORAGE_DIR, `${image.id}${ext}`);
      try {
        await fs.access(localPath);
        fileExists = true;
      } catch {
        logger.debug('DELETE /api/images/[id] - Local file does not exist (orphaned)', { imageId: id, localPath });
      }
    }

    // Count usages by checking related entities
    const [allCharacters, allPersonas] = await Promise.all([
      repos.characters.findByUserId(session.user.id),
      repos.personas.findByUserId(session.user.id),
    ]);

    const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id);
    const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id);
    const chatAvatarOverrides = allCharacters.reduce((acc, c) => {
      const overrides = c.avatarOverrides.filter(o => o.imageId === id);
      return overrides.length > 0 ? [...acc, { characterId: c.id, overrides }] : acc;
    }, [] as Array<{ characterId: string; overrides: Array<{ chatId: string; imageId: string }> }>);

    // Check if image is being used
    const isInUse =
      charactersUsingAsDefault.length > 0 ||
      personasUsingAsDefault.length > 0 ||
      chatAvatarOverrides.length > 0;

    // If the file is orphaned (doesn't exist), clean up references and allow deletion
    if (!fileExists && isInUse) {
      logger.info('DELETE /api/images/[id] - Cleaning up references to orphaned image', {
        imageId: id,
        charactersUsingAsDefault: charactersUsingAsDefault.length,
        personasUsingAsDefault: personasUsingAsDefault.length,
        chatAvatarOverrides: chatAvatarOverrides.length,
      });

      // Clear defaultImageId on characters
      for (const character of charactersUsingAsDefault) {
        await repos.characters.update(character.id, { defaultImageId: null });
        logger.debug('DELETE /api/images/[id] - Cleared defaultImageId on character', { characterId: character.id });
      }

      // Clear defaultImageId on personas
      for (const persona of personasUsingAsDefault) {
        await repos.personas.update(persona.id, { defaultImageId: null });
        logger.debug('DELETE /api/images/[id] - Cleared defaultImageId on persona', { personaId: persona.id });
      }

      // Clear avatar overrides
      for (const { characterId, overrides } of chatAvatarOverrides) {
        const character = allCharacters.find(c => c.id === characterId);
        if (character) {
          const updatedOverrides = character.avatarOverrides.filter(o => o.imageId !== id);
          await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });
          logger.debug('DELETE /api/images/[id] - Cleared avatar overrides on character', { characterId, removedCount: overrides.length });
        }
      }
    } else if (isInUse) {
      // File exists and is in use - don't allow deletion
      logger.debug('DELETE /api/images/[id] - Image is in use, cannot delete', {
        imageId: id,
        charactersUsingAsDefault: charactersUsingAsDefault.length,
        personasUsingAsDefault: personasUsingAsDefault.length,
        chatAvatarOverrides: chatAvatarOverrides.length,
      });
      return NextResponse.json(
        {
          error: 'Image is in use',
          details:
            'This image is currently being used as an avatar or in chat overrides. Please remove all usages before deleting.',
        },
        { status: 400 }
      );
    }

    // Delete from S3 if applicable
    if (s3Enabled && image.s3Key) {
      try {
        await deleteS3File(image.s3Key);
        logger.debug('DELETE /api/images/[id] - Deleted from S3', { imageId: id, s3Key: image.s3Key });
      } catch (s3Error) {
        logger.warn('DELETE /api/images/[id] - Failed to delete from S3', {
          imageId: id,
          s3Key: image.s3Key,
          error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
        });
        // Continue with metadata deletion even if S3 deletion fails
      }
    }

    // Delete file metadata from repository
    const deleted = await repos.files.delete(id);

    if (!deleted) {
      logger.warn('DELETE /api/images/[id] - Failed to delete file metadata', { imageId: id });
      return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
    }

    logger.debug('DELETE /api/images/[id] - Image deleted successfully', {
      imageId: id,
      filename: image.originalFilename,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    logger.error('Error deleting image:', { context: 'DELETE /api/images/[id]' }, error as Error);
    return NextResponse.json(
      { error: 'Failed to delete image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
