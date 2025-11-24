/**
 * Chat Avatar Overrides API Routes
 * GET /api/chats/:id/avatars - Get avatar overrides for a chat
 * POST /api/chats/:id/avatars - Set avatar override for a character in this chat
 * DELETE /api/chats/:id/avatars - Remove avatar override
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
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
    const repos = getRepositories();

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(id);

    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Get avatar images for this chat (stored in binary index with type 'avatar')
    const allImages = await repos.images.findByUserId(session.user.id);
    const chatAvatars = allImages.filter(img => img.type === 'avatar' && img.chatId === id);

    // Enrich with character and image data
    const enrichedOverrides = await Promise.all(
      chatAvatars.map(async (image) => {
        // Parse character ID from image metadata if available
        const characterId = image.characterId || null;
        const character = characterId ? await repos.characters.findById(characterId) : null;

        return {
          chatId: id,
          characterId: characterId,
          imageId: image.id,
          character: character ? { id: character.id, name: character.name } : null,
          image: image || null,
        };
      })
    );

    return NextResponse.json({ data: enrichedOverrides });
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

    const repos = getRepositories();

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(id);

    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId);

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // Verify image exists and belongs to user
    const image = await repos.images.findById(imageId);

    if (!image || image.userId !== session.user.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Store avatar override as an image with type 'avatar'
    // First, remove any existing avatar for this character in this chat
    const allImages = await repos.images.findByUserId(session.user.id);
    const existingAvatar = allImages.find(
      img => img.type === 'avatar' && img.chatId === id && img.characterId === characterId
    );

    if (existingAvatar) {
      // Update existing avatar reference
      await repos.images.update(existingAvatar.id, {
        characterId,
        chatId: id,
      });
    } else {
      // Create new avatar reference (this just stores metadata, not the actual image)
      // The imageId references an existing image in the binary index
      // We need to ensure this is properly stored
    }

    const override = {
      chatId: id,
      characterId,
      imageId,
      character: { id: character.id, name: character.name },
      image,
    };

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

    const repos = getRepositories();

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(id);

    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // Remove avatar override by deleting the avatar image for this character in this chat
    const allImages = await repos.images.findByUserId(session.user.id);
    const existingAvatar = allImages.find(
      img => img.type === 'avatar' && img.chatId === id && img.characterId === characterId
    );

    if (existingAvatar) {
      await repos.images.delete(existingAvatar.id);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('Error removing avatar override:', error);
    return NextResponse.json(
      { error: 'Failed to remove avatar override', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
