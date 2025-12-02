/**
 * Chat Avatar Overrides API Routes
 * GET /api/chats/:id/avatars - Get avatar overrides for a chat
 * POST /api/chats/:id/avatars - Set avatar override for a character in this chat
 * DELETE /api/chats/:id/avatars - Remove avatar override
 *
 * Avatar overrides are stored on the Character entity in the avatarOverrides array,
 * not in a separate images table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRepositories } from '@/lib/json-store/repositories';
import { findFileById, getFileUrl } from '@/lib/file-manager';
import { logger } from '@/lib/logger';
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

    // Get all characters that have avatar overrides for this chat
    const allCharacters = await repos.characters.findByUserId(session.user.id);

    // Collect avatar overrides from all characters for this chat
    const enrichedOverrides = await Promise.all(
      allCharacters.flatMap(character =>
        (character.avatarOverrides || [])
          .filter(override => override.chatId === id)
          .map(async (override) => {
            const fileEntry = await findFileById(override.imageId);
            return {
              chatId: id,
              characterId: character.id,
              imageId: override.imageId,
              character: { id: character.id, name: character.name },
              image: fileEntry ? {
                id: fileEntry.id,
                filepath: getFileUrl(fileEntry.id, fileEntry.originalFilename),
                url: null,
              } : null,
            };
          })
      )
    );

    return NextResponse.json({ data: enrichedOverrides });
  } catch (error) {
    logger.error('Error fetching avatar overrides', { endpoint: '/api/chats/[id]/avatars', method: 'GET' }, error instanceof Error ? error : undefined);
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

    // Verify image exists in file-manager and belongs to user
    const fileEntry = await findFileById(imageId);

    if (!fileEntry || fileEntry.userId !== session.user.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Update character's avatarOverrides array
    const existingOverrides = character.avatarOverrides || [];
    const overrideIndex = existingOverrides.findIndex(o => o.chatId === id);

    let updatedOverrides;
    if (overrideIndex >= 0) {
      // Update existing override
      updatedOverrides = [...existingOverrides];
      updatedOverrides[overrideIndex] = { chatId: id, imageId };
    } else {
      // Add new override
      updatedOverrides = [...existingOverrides, { chatId: id, imageId }];
    }

    await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

    const override = {
      chatId: id,
      characterId,
      imageId,
      character: { id: character.id, name: character.name },
      image: {
        id: fileEntry.id,
        filepath: getFileUrl(fileEntry.id, fileEntry.originalFilename),
        url: null,
      },
    };

    return NextResponse.json({ data: override });
  } catch (error) {
    logger.error('Error setting avatar override', { endpoint: '/api/chats/[id]/avatars', method: 'POST' }, error instanceof Error ? error : undefined);

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

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId);

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    // Remove avatar override from character's avatarOverrides array
    const existingOverrides = character.avatarOverrides || [];
    const updatedOverrides = existingOverrides.filter(o => o.chatId !== id);

    await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    logger.error('Error removing avatar override', { endpoint: '/api/chats/[id]/avatars', method: 'DELETE' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to remove avatar override', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
