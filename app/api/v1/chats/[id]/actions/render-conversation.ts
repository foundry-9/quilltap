/**
 * Chats API v1 - Render Conversation Action (Scriptorium)
 *
 * POST /api/v1/chats/[id]?action=render-conversation - Queue on-demand conversation render with full re-embed
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Queue a conversation render job with full re-embedding of all chunks
 */
export async function handleRenderConversation(
  chatId: string,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user } = ctx;

  try {
    const result = await enqueueConversationRender(user.id, {
      chatId,
      fullReembed: true,
    });

    logger.info('[RenderConversation] Conversation render queued', {
      chatId,
      jobId: result.jobId,
      isNew: result.isNew,
    });

    return successResponse({
      message: 'Conversation rendering queued',
      jobId: result.jobId,
      isNew: result.isNew,
    });
  } catch (error) {
    logger.error('[RenderConversation] Failed to queue conversation render', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to queue conversation rendering');
  }
}
