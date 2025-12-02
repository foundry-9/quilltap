/**
 * Persona Avatar API Routes
 * PATCH /api/personas/:id/avatar - Set default avatar for persona
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
 * PATCH /api/personas/:id/avatar
 * Set or clear default avatar for a persona
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

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id);

    if (!persona || persona.userId !== session.user.id) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // If imageId is provided, verify it exists and belongs to user
    if (imageId) {
      const image = await repos.images.findById(imageId);

      if (!image || image.userId !== session.user.id) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }
    }

    // Update persona avatar
    const updatedPersona = await repos.personas.update(id, { defaultImageId: imageId });

    // Get the default image for response
    let defaultImage = null;
    if (updatedPersona?.defaultImageId) {
      defaultImage = await repos.images.findById(updatedPersona.defaultImageId);
    }

    return NextResponse.json({
      data: {
        ...updatedPersona,
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
      logger.warn('Validation error updating persona avatar', { context: 'personas-avatar-PATCH', id: context.params })
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    logger.error('Error updating persona avatar', { context: 'personas-avatar-PATCH' }, error instanceof Error ? error : undefined);

    return NextResponse.json(
      { error: 'Failed to update persona avatar', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
