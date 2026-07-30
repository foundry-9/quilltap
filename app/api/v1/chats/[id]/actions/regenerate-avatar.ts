/**
 * Chats API v1 - Regenerate Avatar Action
 *
 * POST /api/v1/chats/[id]?action=regenerate-avatar - Queue regeneration of character avatar
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import { triggerAvatarGeneration } from '@/lib/wardrobe/avatar-generation';
import type { RequestContext } from '@/lib/api/middleware';
import { EquippedSlotsSchema } from '@/lib/schemas/wardrobe.types';

const regenerateAvatarSchema = z.object({
  characterId: z.string().min(1, 'characterId is required'),
  /** One-shot image profile override; does not mutate the chat's default. */
  imageProfileId: z.string().min(1).optional(),
  /**
   * One-shot equipped-slots override (the dialog's "fitting room"). When
   * provided, the avatar is generated against these slots instead of the
   * chat's stored `equippedOutfit`. The chat's stored outfit is unchanged.
   */
  equippedSlots: EquippedSlotsSchema.optional(),
});

/**
 * Handle regenerate-avatar action
 * Queues a background job to regenerate the avatar for a specific character in the chat
 */
export async function handleRegenerateAvatar(
  req: NextRequest,
  chatId: string,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const body = await req.json();
    const { characterId, imageProfileId, equippedSlots } = regenerateAvatarSchema.parse(body);

    // Verify the character exists and is a participant in this chat.
    // The chat-level `avatarGenerationEnabled` toggle governs *automatic*
    // regeneration on outfit changes only — manual clicks always fire as
    // long as an image profile is configured.
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return badRequest('Chat not found');
    }

    const isParticipant = chat.participants.some(
      p => p.characterId === characterId
    );
    if (!isParticipant) {
      return badRequest('Character is not a participant in this chat.');
    }

    const result = await triggerAvatarGeneration(repos, {
      userId: user.id,
      chatId,
      characterId,
      callerContext: '[Chats v1] regenerate-avatar',
      imageProfileIdOverride: imageProfileId ?? null,
      equippedSlotsOverride: equippedSlots ?? null,
    });

    if (!result.queued) {
      return badRequest(result.message);
    }

    logger.info('[Chats v1] Avatar regeneration triggered', {
      chatId,
      characterId,
      context: 'character-avatar',
    });

    return successResponse({
      message: 'Avatar regeneration queued',
      queued: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map(e => e.message).join(', '));
    }
    logger.error('[Chats v1] Failed to trigger avatar regeneration', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to queue avatar regeneration');
  }
}
