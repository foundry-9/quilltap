/**
 * Image Tags API Routes
 * POST /api/images/:id/tags - Add tag to image
 * DELETE /api/images/:id/tags - Remove tag from image
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const tagSchema = z.object({
  tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
  tagId: z.string(),
});

/**
 * POST /api/images/:id/tags
 * Add a tag to an image
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { tagType, tagId } = tagSchema.parse(body);

    const repos = getRepositories();

    // Verify image exists
    const image = await repos.images.findById(id);

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Verify the tagged entity exists
    if (tagType === 'CHARACTER') {
      const character = await repos.characters.findById(tagId);
      if (!character) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 });
      }
    } else if (tagType === 'PERSONA') {
      const persona = await repos.personas.findById(tagId);
      if (!persona) {
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      }
    } else if (tagType === 'CHAT') {
      const chat = await repos.chats.findById(tagId);
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
    }

    // Check if tag already exists - if it does, just return success (idempotent)
    if (image.tags.includes(tagId)) {
      return NextResponse.json({
        data: {
          imageId: id,
          tagType,
          tagId,
          alreadyTagged: true,
        }
      });
    }

    // Add tag to image
    await repos.images.addTag(id, tagId);

    return NextResponse.json({
      data: {
        imageId: id,
        tagType,
        tagId,
      }
    });
  } catch (error) {
    console.error('Error adding tag:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to add tag', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/images/:id/tags
 * Remove a tag from an image
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const tagType = searchParams.get('tagType') as 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME' | null;
    const tagId = searchParams.get('tagId');

    if (!tagType || !tagId) {
      return NextResponse.json({ error: 'tagType and tagId are required' }, { status: 400 });
    }

    const repos = getRepositories();

    // Verify image exists
    const image = await repos.images.findById(id);

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Remove the tag
    await repos.images.removeTag(id, tagId);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('Error removing tag:', error);
    return NextResponse.json(
      { error: 'Failed to remove tag', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
