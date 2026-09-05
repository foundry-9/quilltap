/**
 * Chat Danger Classification Job Handler
 *
 * Handles CHAT_DANGER_CLASSIFICATION background jobs by classifying
 * the chat's content for dangerous content using the gatekeeper service.
 *
 * Key behaviors:
 * - Prefers compressed chat contextSummary as input
 * - Falls back to concatenated raw messages (truncated to 4000 chars) when no summary exists
 * - Once classified as dangerous, stays dangerous (sticky) — never re-checks
 * - Once classified as safe, stays safe (sticky) unless new messages are added
 * - Bails if mode is OFF or no content available (no summary AND no messages)
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { isModerationExemptChatType } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { isClassifierOnDuty } from '@/lib/services/dangerous-content/chat-override';
import { postConciergeDangerAnnouncement } from '@/lib/services/concierge-notifications/writer';
import { createSystemEvent } from '@/lib/services/system-events.service';
import { createServiceLogger } from '@/lib/logging/create-logger';
import type { ChatDangerClassificationPayload } from '../queue-service';

const logger = createServiceLogger('ChatDangerClassificationHandler');

/**
 * Handle a chat danger classification job
 */
export async function handleChatDangerClassification(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ChatDangerClassificationPayload;
  const repos = getRepositories();

  // Get the chat metadata
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[ChatDangerClassification] Chat not found, skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // Moderation-exempt chat types (Help Chat, Brahma Console) are never
  // classified, flagged, or announced on. The scan and post-turn trigger
  // already skip these; this is a backstop for any job enqueued before this
  // rule existed, so no Concierge announcement is ever posted to them.
  if (isModerationExemptChatType(chat.chatType)) {
    return;
  }

  // Vouched Safe / Uncensored: the operator has already returned the verdict
  // for this chat. A job may already be in the queue from before that flip —
  // bail.
  if (!isClassifierOnDuty(chat)) {
    return;
  }

  // Sticky: if already classified as dangerous, never re-check
  if (chat.isDangerousChat === true) {
    return;
  }

  // Sticky: if already classified as safe and no new messages, skip re-check
  if (chat.isDangerousChat === false &&
      chat.dangerClassifiedAtMessageCount != null &&
      (chat.messageCount ?? 0) <= chat.dangerClassifiedAtMessageCount) {
    return;
  }

  // Determine classification input: prefer context summary, fall back to raw messages
  let classificationInput: string;
  let inputSource: 'summary' | 'messages';

  if (chat.contextSummary) {
    classificationInput = chat.contextSummary;
    inputSource = 'summary';
  } else {
    // No context summary — fall back to concatenated raw messages.
    // Exclude:
    //   - SYSTEM role: persona prompts skew classification toward their themes
    //   - TOOL role: tool outputs aren't conversational content
    //   - systemSender != null: Staff-authored announcements (Concierge,
    //     Lantern, Host, etc.) describe events, not user/character speech
    const allMessages = await repos.chats.getMessages(payload.chatId);
    const messageEvents = allMessages.filter(
      (m): m is MessageEvent =>
        m.type === 'message' &&
        m.role !== 'SYSTEM' &&
        m.role !== 'TOOL' &&
        (m.systemSender == null)
    );

    if (messageEvents.length === 0) {
      return;
    }

    // Concatenate messages as "ROLE: content" format, truncated to 4000 chars
    const MAX_INPUT_LENGTH = 4000;
    let concatenated = '';
    for (const msg of messageEvents) {
      const line = `${(msg.role || 'unknown').toUpperCase()}: ${msg.content}\n`;
      if (concatenated.length + line.length > MAX_INPUT_LENGTH) {
        concatenated += line.substring(0, MAX_INPUT_LENGTH - concatenated.length);
        break;
      }
      concatenated += line;
    }

    classificationInput = concatenated;
    inputSource = 'messages';
  }

  // Get user's chat settings for danger mode check
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);

  // Resolve danger settings — bail if mode is OFF
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  if (dangerSettings.mode === 'OFF') {
    return;
  }

  // Get available profiles for cheap LLM selection
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Get connection profile, falling back to first available if the original was deleted
  let connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    logger.warn('[ChatDangerClassification] Connection profile not found, trying fallback', {
      jobId: job.id,
      chatId: payload.chatId,
      connectionProfileId: payload.connectionProfileId,
    });

    if (availableProfiles.length > 0) {
      connectionProfile = availableProfiles[0];
    } else {
      logger.warn('[ChatDangerClassification] No available connection profiles, skipping', {
        jobId: job.id,
        chatId: payload.chatId,
      });
      return;
    }
  }

  // Convert settings to config
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings?.cheapLLMSettings?.strategy || 'PROVIDER_CHEAPEST',
    userDefinedProfileId: chatSettings?.cheapLLMSettings?.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings?.cheapLLMSettings?.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings?.cheapLLMSettings?.fallbackToLocal ?? true,
  };

  // Get cheap LLM selection
  const cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );

  // Classify the chat content
  const result = await classifyContent(
    classificationInput,
    cheapLLMSelection,
    job.userId,
    dangerSettings,
    payload.chatId
  );

  // Create a system event for tracking FIRST, since addMessage increments messageCount.
  // We need to store dangerClassifiedAtMessageCount AFTER the system event so the
  // count includes the classification event itself — otherwise the +1 from the system
  // event triggers an infinite re-classification loop on every startup scan.
  if (result.usage) {
    await createSystemEvent(payload.chatId, {
      systemEventType: 'DANGER_CLASSIFICATION',
      description: `Chat-level danger classification: ${result.isDangerous ? 'dangerous' : 'safe'} (score: ${result.score.toFixed(2)})`,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
    });
  }

  // Re-read chat to get the updated messageCount (after system event was added)
  const updatedChat = await repos.chats.findById(payload.chatId);
  const finalMessageCount = updatedChat?.messageCount ?? chat.messageCount ?? 0;

  // Update chat with classification results
  const now = new Date().toISOString();
  await repos.chats.update(payload.chatId, {
    isDangerousChat: result.isDangerous,
    dangerScore: result.score,
    dangerCategories: result.categories.map(c => c.category),
    dangerClassifiedAt: now,
    dangerClassifiedAtMessageCount: finalMessageCount,
  });

  // Sticky-true: the early-return at the top of this handler ensures we only
  // reach this point when the chat newly transitions to dangerous, so the
  // Concierge announces exactly once per chat.
  if (result.isDangerous) {
    await postConciergeDangerAnnouncement({
      chatId: payload.chatId,
      details: {
        score: result.score,
        threshold: dangerSettings.threshold,
        categories: result.categories,
        source: result.source,
        providerName: result.providerName,
      },
    });
  }

  logger.info('[ChatDangerClassification] Chat classified', {
    jobId: job.id,
    chatId: payload.chatId,
    isDangerous: result.isDangerous,
    score: result.score,
    categories: result.categories.map(c => c.category),
    messageCount: chat.messageCount,
    inputSource,
  });
}
