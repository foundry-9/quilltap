/**
 * Character Avatar API Routes
 * PATCH /api/characters/:id/avatar - Set default avatar for character
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { z } from 'zod';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

/**
 * PATCH /api/characters/:id/avatar
 * Set or clear default avatar for a character
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const repos = getRepositories();

    const body = await request.json();
    const { imageId } = avatarSchema.parse(body);

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id);

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // If imageId is provided, verify it exists and belongs to user
    if (imageId) {
      const image = await repos.images.findById(imageId);

      if (!image || image.userId !== session.user.id) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }
    }

    // Update character avatar
    const updatedCharacter = await repos.characters.update(id, { defaultImageId: imageId });

    // Get the default image for response
    let defaultImage = null;
    if (updatedCharacter?.defaultImageId) {
      defaultImage = await repos.images.findById(updatedCharacter.defaultImageId);
    }

    return NextResponse.json({
      data: {
        ...updatedCharacter,
        defaultImage: defaultImage
          ? {
              id: defaultImage.id,
              filepath: defaultImage.relativePath,
              url: null,
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Avatar update validation error', { context: 'PATCH /api/characters/[id]/avatar', details: error.errors });
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    logger.error('Error updating character avatar', { context: 'PATCH /api/characters/[id]/avatar' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to update character avatar', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
