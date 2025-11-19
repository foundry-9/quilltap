/**
 * Chat Avatar Overrides API Routes
 * GET /api/chats/:id/avatars - Get avatar overrides for a chat
 * POST /api/chats/:id/avatars - Set avatar override for a character in this chat
 * DELETE /api/chats/:id/avatars - Remove avatar override
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const avatarOverrideSchema = z.object({
  characterId: z.string(),
  imageId: z.string(),
});

/**
 * GET /api/chats/:id/avatars
 * Get all avatar overrides for a chat
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const overrides = await prisma.chatAvatarOverride.findMany({
      where: { chatId: id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
          },
        },
        image: true,
      },
    });

    return NextResponse.json({ data: overrides });
  } catch (error) {
    console.error('Error fetching avatar overrides:', error);
    return NextResponse.json(
      { error: 'Failed to fetch avatar overrides', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chats/:id/avatars
 * Set avatar override for a character in this chat
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { characterId, imageId } = avatarOverrideSchema.parse(body);

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Verify character exists and belongs to user
    const character = await prisma.character.findUnique({
      where: {
        id: characterId,
        userId: session.user.id,
      },
    });

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // Verify image exists and belongs to user
    const image = await prisma.image.findUnique({
      where: {
        id: imageId,
        userId: session.user.id,
      },
    });

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Create or update avatar override
    const override = await prisma.chatAvatarOverride.upsert({
      where: {
        chatId_characterId: {
          chatId: id,
          characterId,
        },
      },
      create: {
        chatId: id,
        characterId,
        imageId,
      },
      update: {
        imageId,
      },
      include: {
        character: {
          select: {
            id: true,
            name: true,
          },
        },
        image: true,
      },
    });

    return NextResponse.json({ data: override });
  } catch (error) {
    console.error('Error setting avatar override:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to set avatar override', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chats/:id/avatars
 * Remove avatar override for a character in this chat
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const characterId = searchParams.get('characterId');

    if (!characterId) {
      return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
    }

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Delete the override
    await prisma.chatAvatarOverride.deleteMany({
      where: {
        chatId: id,
        characterId,
      },
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('Error removing avatar override:', error);
    return NextResponse.json(
      { error: 'Failed to remove avatar override', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
