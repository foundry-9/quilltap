/**
 * Title Update Job Handler
 *
 * Handles TITLE_UPDATE background jobs by evaluating whether a chat
 * needs a new title based on recent conversation content.
 *
 * Driven by `checkAndGenerateSummaryIfNeeded` in `lib/chat/context-summary.ts`,
 * which enqueues one of these jobs at each title checkpoint
 * (see `shouldCheckTitleAtInterchange`). Running through the queue means the
 * cheap-LLM call and the resulting `repos.chats.update` flush back to the
 * parent via the child-write-buffer pattern — running this inline inside an
 * autonomous-room-turn handler used to drop the write on the floor.
 */

import { BackgroundJob, ChatSettings } from '@/lib/schemas/types';
import { isHelpLikeChatType, type ChatMetadata } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  considerTitleUpdate,
  considerHelpChatTitleUpdate,
  extractVisibleConversation,
  throwIfLostToTimeout,
} from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import { resolveImageProfileForChat } from '@/lib/image-gen/profile-resolution';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { createTitleGenerationEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import type { TitleUpdatePayload } from '../queue-service';
import { enqueueStoryBackgroundGeneration } from '../queue-service';

/**
 * Handle a title update job
 */
export async function handleTitleUpdate(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as TitleUpdatePayload;
  const repos = getRepositories();

  // Get the chat metadata
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // Respect the user's choice: a manually-renamed chat is never re-titled by
  // the cheap LLM. Still advance the checkpoint cursor so we don't keep
  // re-firing at the same interchange.
  if (chat.isManuallyRenamed) {
    await repos.chats.update(payload.chatId, {
      lastRenameCheckInterchange: payload.currentInterchange,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const isHelpChat = isHelpLikeChatType(chat.chatType);

  // Get connection profile
  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  // Get user's chat settings for cheap LLM config
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  // Get available profiles for cheap LLM selection
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Convert settings to config (handle null -> undefined conversion)
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings.cheapLLMSettings.strategy,
    userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
  };

  // Get cheap LLM selection
  let cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );
  if (!cheapLLMSelection) {
    logger.warn('[Title Update] No cheap LLM available', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    // Advance the cursor so a misconfigured / unavailable cheap LLM doesn't
    // re-fire this same job every following turn. The next checkpoint
    // (e.g., 3 → 5 → 7 → 10) will try again — by which point the
    // configuration may have been fixed.
    await repos.chats.update(payload.chatId, {
      lastRenameCheckInterchange: payload.currentInterchange,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // For dangerous chats, use uncensored provider to avoid content refusals.
  // Off-duty chats are explicitly opted out of uncensored routing.
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings, chat);
  if (shouldUseUncensoredRoute(chat)) {
    cheapLLMSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      availableProfiles
    );
  }

  // Get chat messages
  const allMessages = await repos.chats.getMessages(payload.chatId);

  // Extract only visible conversational messages (USER/ASSISTANT, tool artifacts stripped)
  const chatMessages = extractVisibleConversation(allMessages);

  // Use last 5 messages or fewer if the chat is shorter
  const recentMessages = chatMessages.slice(-5);

  if (recentMessages.length === 0) {
    return;
  }

  // Get existing summary for context
  const existingContext = chat.contextSummary || chat.title;

  // Evaluate whether title needs updating (help chats use a different prompt)
  const result = isHelpChat
    ? await considerHelpChatTitleUpdate(
        chat.title,
        recentMessages,
        existingContext,
        cheapLLMSelection,
        job.userId,
        payload.chatId,
      )
    : await considerTitleUpdate(
        chat.title,
        recentMessages,
        existingContext,
        cheapLLMSelection,
        job.userId,
        payload.chatId,
      );

  if (!result.success) {
    logger.warn(`[Title Update] Failed for chat ${payload.chatId}: ${result.error}`);
    // Before the cursor is burned: a timeout means the check never ran, and
    // burning the checkpoint over it would skip the rename entirely rather
    // than defer it (bug 107).
    throwIfLostToTimeout(result, 'title-update');
    // Advance the cursor so a persistently-failing cheap LLM (e.g., an
    // exhausted OpenAI quota) doesn't re-fire this same job every following
    // turn — `shouldCheckTitleAtInterchange` keeps crossing checkpoint 2 as
    // long as the cursor sits at 0. Burning the current checkpoint on a
    // failure means a transient one-off failure will skip this title check,
    // but the next checkpoint (3 → 5 → 7 → 10 → …) still gets its chance.
    await repos.chats.update(payload.chatId, {
      lastRenameCheckInterchange: payload.currentInterchange,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // Record the title-consideration LLM spend as a system event (matches the
  // legacy inline path so users still see the token / cost trace).
  if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
    try {
      const costResult = await estimateMessageCost(
        cheapLLMSelection.provider,
        cheapLLMSelection.modelName,
        result.usage.promptTokens,
        result.usage.completionTokens,
        job.userId,
      );
      await createTitleGenerationEvent(
        payload.chatId,
        result.usage,
        cheapLLMSelection.provider,
        cheapLLMSelection.modelName,
        costResult.cost,
      );
    } catch (e) {
      logger.error('[Title Update] Failed to create system event:', {}, e instanceof Error ? e : new Error(String(e)));
    }
  }

  if (!result.result || !result.result.needsNewTitle || !result.result.suggestedTitle) {
    // Distinguish a genuine "no" from a verdict we could not read. The cheap
    // LLM asking for a rename and handing us nothing usable is a defect, not a
    // decision (bug 96), and burning the checkpoint on it silently is how the
    // chat kept its generic title — and never got a story background, since
    // that queues off a successful rename below.
    if (result.result?.needsNewTitle && !result.result.suggestedTitle) {
      logger.warn('[Title Update] Rename requested with no usable title — checkpoint burned', {
        context: 'background-jobs.title-update',
        chatId: payload.chatId,
        currentInterchange: payload.currentInterchange,
        reason: result.result.reason,
      });
    }

    // No rename needed — but still advance the checkpoint so we don't
    // re-evaluate at the same interchange on every following turn.
    await repos.chats.update(payload.chatId, {
      lastRenameCheckInterchange: payload.currentInterchange,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  logger.info(
    `[Title Update] Chat ${payload.chatId} - needsNewTitle: true, reason: ${result.result.reason}`,
  );

  // Update the chat title
  await repos.chats.update(payload.chatId, {
    title: result.result.suggestedTitle,
    lastRenameCheckInterchange: payload.currentInterchange,
    updatedAt: new Date().toISOString(),
  });

  logger.info(`[Title Update] Updated title for chat ${payload.chatId} to: "${result.result.suggestedTitle}"`);

  // Story-background generation runs for normal chats only — help chats and
  // autonomous rooms are skipped (the latter inside queueStoryBackgroundIfEnabled).
  if (!isHelpChat) {
    // Re-fetch so the helper sees the freshly written title (the chat we
    // loaded above still has the old one in memory).
    const updatedChat = await repos.chats.findById(payload.chatId);
    if (updatedChat) {
      await queueStoryBackgroundIfEnabled(
        job.userId,
        updatedChat,
        chatSettings,
        result.result.suggestedTitle,
      );
    }
  }
}

/**
 * Queue a story background generation job if the feature is enabled
 */
export async function queueStoryBackgroundIfEnabled(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings,
  newTitle: string
): Promise<void> {

  // Check if story backgrounds are enabled
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings;
  if (!storyBackgroundsSettings?.enabled) {
    return;
  }

  // Autonomous rooms (4.6 Private Character Rooms): the Lantern's auto-trigger
  // is disabled. Backgrounds are token-budget-conscious; the user is not in
  // the room to see them, and a character can still deliberately invoke
  // image-generation tools when desired.
  if (chat.chatType === 'autonomous') {
    return;
  }

  // Determine the image profile to use
  const repos = getRepositories();
  const imageProfileId = await resolveImageProfileForChat(userId, chat, chatSettings, repos);
  if (!imageProfileId) {
    return;
  }

  // Get character IDs from participants
  const characterIds = chat.participants
    .filter(p => p.characterId)
    .map(p => p.characterId!);

  if (characterIds.length === 0) {
    return;
  }

  // Queue the story background generation job
  try {
    const { jobId, isNew } = await enqueueStoryBackgroundGeneration(userId, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: newTitle,
      projectId: chat.projectId ?? null,
    });

    if (isNew) {
      logger.info('[Title Update] Queued story background generation', {
        context: 'background-jobs.title-update',
        chatId: chat.id,
        jobId,
        imageProfileId,
        characterCount: characterIds.length,
      });
    }
  } catch (error) {
    logger.warn('[Title Update] Failed to queue story background generation', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
