/**
 * Persona Avatar API Routes
 * PATCH /api/personas/:id/avatar - Set default avatar for persona
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';

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
    const body = await request.json();
    const { imageId } = avatarSchema.parse(body);

    // Verify persona exists and belongs to user
    const persona = await prisma.persona.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // If imageId is provided, verify it exists and belongs to user
    if (imageId) {
      const image = await prisma.image.findUnique({
        where: {
          id: imageId,
          userId: session.user.id,
        },
      });

      if (!image) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }
    }

    // Update persona avatar
    const updatedPersona = await prisma.persona.update({
      where: { id },
      data: { defaultImageId: imageId },
      include: {
        defaultImage: true,
      },
    });

    return NextResponse.json({ data: updatedPersona });
  } catch (error) {
    console.error('Error updating persona avatar:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to update persona avatar', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
