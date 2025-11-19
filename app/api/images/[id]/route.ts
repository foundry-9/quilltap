/**
 * Individual Image API Routes
 * GET /api/images/:id - Get single image
 * DELETE /api/images/:id - Delete image
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { deleteImage } from '@/lib/images';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const image = await prisma.image.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        tags: true,
        _count: {
          select: {
            charactersUsingAsDefault: true,
            personasUsingAsDefault: true,
            chatAvatarOverrides: true,
          },
        },
      },
    });

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    return NextResponse.json({ data: image });
  } catch (error) {
    console.error('Error fetching image:', error);
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    // Check if image exists and belongs to user
    const image = await prisma.image.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        _count: {
          select: {
            charactersUsingAsDefault: true,
            personasUsingAsDefault: true,
            chatAvatarOverrides: true,
          },
        },
      },
    });

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Check if image is being used
    const isInUse =
      image._count.charactersUsingAsDefault > 0 ||
      image._count.personasUsingAsDefault > 0 ||
      image._count.chatAvatarOverrides > 0;

    if (isInUse) {
      return NextResponse.json(
        {
          error: 'Image is in use',
          details:
            'This image is currently being used as an avatar or in chat overrides. Please remove all usages before deleting.',
        },
        { status: 400 }
      );
    }

    // Delete from database (this will cascade delete tags)
    await prisma.image.delete({
      where: { id },
    });

    // Delete file from filesystem (if not a URL import)
    if (!image.url) {
      await deleteImage(image.filepath);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { error: 'Failed to delete image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
