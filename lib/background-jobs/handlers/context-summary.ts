/**
 * Context Summary Job Handler
 *
 * Handles CONTEXT_SUMMARY background jobs by updating the running
 * context summary for a chat conversation.
 *
 * Delegates to the in-process `generateContextSummary` so that the
 * background path and the live message-loop path share one source of
 * truth — turn-based folds anchored on `lastSummaryTurn`, never the
 * title-check cursor (`lastRenameCheckInterchange`).
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { generateContextSummary } from '@/lib/chat/context-summary';
import { throwIfLostToTimeout } from '@/lib/memory/cheap-llm-tasks';
import { enqueueChatDangerClassification } from '../queue-service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { ContextSummaryPayload } from '../queue-service';

/**
 * Handle a context summary update job
 */
export async function handleContextSummary(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ContextSummaryPayload;
  const repos = getRepositories();

  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  const availableProfiles = await repos.connections.findByUserId(job.userId);

  const result = await generateContextSummary({
    userId: job.userId,
    chatId: payload.chatId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    forceRegenerate: payload.forceRegenerate ?? false,
  });

  if (!result.success || !result.wasGenerated) {
    logger.warn('[ContextSummary] Summary update did not run', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
      timedOut: result.timedOut === true,
    });
    // The summary was never produced — not produced and found wanting. Fail
    // the job so it is retried and, failing that, visible (bug 107).
    throwIfLostToTimeout(result, 'update-context-summary');
    return;
  }

  logger.info('[ContextSummary] Summary updated', {
    jobId: job.id,
    chatId: payload.chatId,
    summaryLength: result.summary?.length ?? 0,
  });

  // Chain: enqueue danger classification after successful summary update
  try {
    const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
    if (dangerSettings.mode !== 'OFF') {
      await enqueueChatDangerClassification(
        job.userId,
        {
          chatId: payload.chatId,
          connectionProfileId: payload.connectionProfileId,
        },
        { priority: -2 }
      );
    }
  } catch (chainError) {
    logger.warn('[ContextSummary] Failed to chain danger classification job', {
      jobId: job.id,
      chatId: payload.chatId,
      error: chainError instanceof Error ? chainError.message : String(chainError),
    });
  }
}
