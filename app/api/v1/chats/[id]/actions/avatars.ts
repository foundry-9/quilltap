/**
 * Chats API v1 - Avatar Actions
 *
 * Handles get-avatars, set-avatar, and remove-avatar actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary';
import { avatarOverrideSchema, removeAvatarSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Get all avatar overrides for a chat
 */
export async function handleGetAvatars(
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    // Get all characters that have avatar overrides for this chat
    const allCharacters = await repos.characters.findByUserId(user.id);

    // Collect avatar overrides from all characters for this chat
    const enrichedOverrides = await Promise.all(
      allCharacters.flatMap(character =>
        (character.avatarOverrides || [])
          .filter(override => override.chatId === chatId)
          .map(async (override) => {
            const resolved = await resolveCharacterAvatar(override.imageId, repos);
            const linkSummary = resolved?.sha256
              ? await getPhotoLinkSummaryBySha256(resolved.sha256, repos)
              : null;
            return {
              chatId,
              characterId: character.id,
              imageId: override.imageId,
              character: { id: character.id, name: character.name },
              image: resolved ? {
                id: resolved.id,
                filepath: resolved.url,
                url: null,
                sha256: resolved.sha256,
                linkSummary,
              } : null,
            };
          })
      )
    );

    return NextResponse.json({ data: enrichedOverrides });
  } catch (error) {
    logger.error('[Chats v1] Error fetching avatar overrides', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch avatar overrides');
  }
}

/**
 * Set an avatar override for a character in a chat
 */
export async function handleSetAvatar(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { characterId, imageId } = avatarOverrideSchema.parse(body);

  // Verify character exists and belongs to user
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Verify image exists (either as a vault link or a legacy files row).
  const resolved = await resolveCharacterAvatar(imageId, repos);
  if (!resolved) {
    return notFound('Image');
  }

  // Update character's avatarOverrides array
  const existingOverrides = character.avatarOverrides || [];
  const overrideIndex = existingOverrides.findIndex(o => o.chatId === chatId);

  let updatedOverrides;
  if (overrideIndex >= 0) {
    // Update existing override
    updatedOverrides = [...existingOverrides];
    updatedOverrides[overrideIndex] = { chatId, imageId };
  } else {
    // Add new override
    updatedOverrides = [...existingOverrides, { chatId, imageId }];
  }

  await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

  const linkSummary = resolved.sha256
    ? await getPhotoLinkSummaryBySha256(resolved.sha256, repos)
    : null;
  const override = {
    chatId,
    characterId,
    imageId,
    character: { id: character.id, name: character.name },
    image: {
      id: resolved.id,
      filepath: resolved.url,
      url: null,
      sha256: resolved.sha256,
      linkSummary,
    },
  };

  logger.info('[Chats v1] Avatar override set', { chatId, characterId, imageId });

  return NextResponse.json({ data: override });
}

/**
 * Remove an avatar override for a character in a chat
 */
export async function handleRemoveAvatar(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { characterId } = removeAvatarSchema.parse(body);

  // Verify character exists and belongs to user
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Remove avatar override from character's avatarOverrides array
  const existingOverrides = character.avatarOverrides || [];
  const updatedOverrides = existingOverrides.filter(o => o.chatId !== chatId);

  await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

  logger.info('[Chats v1] Avatar override removed', { chatId, characterId });

  return NextResponse.json({ data: { success: true } });
}
