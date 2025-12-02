/**
 * Individual Image API Routes
 * GET /api/images/:id - Get single image
 * DELETE /api/images/:id - Delete image
 *
 * Uses only the file-manager system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { findFileById, deleteFile, getFileUrl } from '@/lib/file-manager';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/images/:id
 * Get a single image by ID
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      logger.debug('GET /api/images/[id] - Unauthorized: no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    logger.debug('GET /api/images/[id] - Fetching image', { imageId: id, userId: session.user.id });

    const image = await findFileById(id);

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
        filepath: getFileUrl(image.id, image.originalFilename),
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      logger.debug('DELETE /api/images/[id] - Unauthorized: no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    logger.debug('DELETE /api/images/[id] - Deleting image', { imageId: id, userId: session.user.id });

    // Check if image exists
    const image = await findFileById(id);

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

    // Check if image is being used
    const isInUse =
      charactersUsingAsDefault > 0 ||
      personasUsingAsDefault > 0 ||
      chatAvatarOverrides > 0;

    if (isInUse) {
      logger.debug('DELETE /api/images/[id] - Image is in use, cannot delete', {
        imageId: id,
        charactersUsingAsDefault,
        personasUsingAsDefault,
        chatAvatarOverrides,
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

    // Delete file and metadata
    const deleted = await deleteFile(id);

    if (!deleted) {
      logger.warn('DELETE /api/images/[id] - Failed to delete file', { imageId: id });
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
