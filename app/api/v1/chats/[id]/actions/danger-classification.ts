/**
 * Chats API v1 - Danger Classification Actions
 *
 * POST /api/v1/chats/[id]?action=reclassify-danger - Reset and re-queue danger classification
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { enqueueChatDangerClassification } from '@/lib/background-jobs/queue-service';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadataBase } from '@/lib/schemas/types';

/**
 * Reset danger classification and re-queue for this chat
 */
export async function handleReclassifyDanger(
  chatId: string,
  chat: ChatMetadataBase,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    // Clear all danger classification fields
    await repos.chats.update(chatId, {
      isDangerousChat: null,
      dangerScore: null,
      dangerCategories: [],
      dangerClassifiedAt: null,
      dangerClassifiedAtMessageCount: null,
    });

    // Find a connection profile to use for the classification
    // Use the first active LLM participant's connection profile
    const participant = chat.participants.find(
      p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.connectionProfileId
    );

    if (participant?.connectionProfileId) {
      // Enqueue a new classification job
      const result = await enqueueChatDangerClassification(user.id, {
        chatId,
        connectionProfileId: participant.connectionProfileId,
      });

      logger.info('[ChatDangerClassification] Reclassification queued', {
        chatId,
        jobId: result.jobId,
        isNew: result.isNew,
      });

      return successResponse({
        message: 'Danger classification reset and re-queued',
        jobId: result.jobId,
      });
    }

    logger.info('[ChatDangerClassification] Classification reset (no connection profile for re-queue)', {
      chatId,
    });

    return successResponse({
      message: 'Danger classification reset (no active connection profile to re-queue)',
    });
  } catch (error) {
    logger.error('[ChatDangerClassification] Failed to reclassify', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to reset danger classification');
  }
}
