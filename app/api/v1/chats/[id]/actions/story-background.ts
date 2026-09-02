/**
 * Chats API v1 - Story Background Actions
 *
 * POST /api/v1/chats/[id]?action=regenerate-background - Queue regeneration of story background
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import { enqueueStoryBackgroundGeneration } from '@/lib/background-jobs/queue-service';
import { resolveImageProfileForChat } from '@/lib/image-gen/profile-resolution';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

/**
 * Handle regenerate-background action
 * Queues a background job to regenerate the story background for the chat
 */
export async function handleRegenerateBackground(
  chatId: string,
  chat: ChatMetadata,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    // Get chat settings to check if story backgrounds are enabled
    const chatSettings = await repos.chatSettings.findByUserId(user.id);

    // Check if story backgrounds are enabled
    if (!chatSettings?.storyBackgroundsSettings?.enabled) {
      return badRequest('Story backgrounds are not enabled. Enable them in Settings > Chat Settings > Story Backgrounds.');
    }

    // Resolve the image profile to use
    const imageProfileId = await resolveImageProfileForChat(user.id, chat, chatSettings, repos);
    if (!imageProfileId) {
      return badRequest('No image profile available for story background generation. Configure an image profile in Chat Settings.');
    }

    // Get character IDs from participants who are actually in the scene. Absent
    // and (soft-)removed participants must never be painted into the background;
    // 'silent' counts as present — they are standing there, just not speaking.
    const characterIds = chat.participants
      .filter(p => isParticipantPresent(p.status) && p.characterId)
      .map(p => p.characterId!);

    if (characterIds.length === 0) {
      return badRequest('No characters present in chat to generate background for.');
    }

    // Queue the story background generation job
    const { jobId, isNew } = await enqueueStoryBackgroundGeneration(user.id, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: chat.title,
      projectId: chat.projectId ?? null,
    });

    if (isNew) {
      logger.info('[Chats v1] Queued story background regeneration', {
        chatId,
        jobId,
        imageProfileId,
        characterCount: characterIds.length,
      });
    } else {
      logger.info('[Chats v1] Story background generation already in progress', {
        chatId,
        jobId,
        imageProfileId,
      });
    }

    return successResponse({
      message: isNew ? 'Story background regeneration queued' : 'Story background generation already in progress',
      queued: true,
      jobId,
    });
  } catch (error) {
    logger.error('[Chats v1] Failed to queue story background regeneration', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to queue story background regeneration');
  }
}
