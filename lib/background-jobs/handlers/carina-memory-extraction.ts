/**
 * Carina Memory Extraction Job Handler
 *
 * Forms memories for a Carina answerer from a single isolated reference Q&A.
 *
 * A Carina answer is posted as a `systemSender: 'carina'` message, which the
 * per-turn transcript builder deliberately skips (every systemSender message is
 * excluded) — and the answerer is frequently not even a participant in the
 * chat. So the ordinary MEMORY_EXTRACTION path can never see it. This handler
 * is the dedicated route: it loads the posted carina message, reconstructs a
 * one-slice TurnTranscript (the question as the turn opener, the answer as the
 * answerer's sole contribution), and runs the standard per-turn extractor.
 *
 * With no user-controlled character in the synthetic transcript, the OTHER pass
 * finds no subjects and self-skips, so only SELF memories form — the answerer
 * remembers what it was asked and what it answered, nothing about the asker.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { processTurnForMemory } from '@/lib/memory/memory-processor';
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import { getMemoryExtractionLimits } from '@/lib/instance-settings';
import type { Character, MessageEvent } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import type { CarinaMemoryExtractionPayload } from '../queue-service';

export async function handleCarinaMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CarinaMemoryExtractionPayload;
  const repos = getRepositories();

  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[CarinaMemoryExtraction] Chat not found at job execution; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  const answerer: Character | null = await repos.characters.findById(payload.answererId);
  if (!answerer) {
    logger.warn('[CarinaMemoryExtraction] Answerer character not found; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      answererId: payload.answererId,
    });
    return;
  }

  // Locate the posted carina message: its content is the answer, its
  // carinaMeta.question the prompt that was put to the answerer.
  const allRawMessages = await repos.chats.getMessages(payload.chatId);
  const carinaMessage = allRawMessages.find(
    (m): m is MessageEvent =>
      m.type === 'message' && m.id === payload.carinaMessageId,
  ) as MessageEvent | undefined;

  if (!carinaMessage) {
    logger.warn('[CarinaMemoryExtraction] Carina message not found; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      carinaMessageId: payload.carinaMessageId,
    });
    return;
  }

  const question = carinaMessage.carinaMeta?.question?.trim() ?? '';
  const answer = carinaMessage.content?.trim() ?? '';
  if (!answer) {
    logger.info('[CarinaMemoryExtraction] Carina message has no answer text; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      carinaMessageId: payload.carinaMessageId,
    });
    return;
  }

  // Synthetic one-slice transcript: the question opens the turn, the answer is
  // the answerer's only contribution. No user-controlled character, so the
  // OTHER pass finds no subjects and only SELF memories form.
  const transcript: TurnTranscript = {
    turnOpenerMessageId: null,
    userMessage: question.length > 0 ? question : null,
    userCharacterId: undefined,
    userCharacterName: undefined,
    userCharacterPronouns: null,
    characterSlices: [
      {
        characterId: answerer.id,
        characterName: answerer.name,
        characterPronouns: answerer.pronouns ?? null,
        text: answer,
        contributingMessageIds: [carinaMessage.id],
        lastMessageCreatedAt: carinaMessage.createdAt ?? null,
      },
    ],
    latestAssistantMessageId: carinaMessage.id,
    turnTimestamp: carinaMessage.createdAt ?? null,
  };

  const participantCharacters = new Map<string, Character>([[answerer.id, answerer]]);

  const availableProfiles = await repos.connections.findByUserId(job.userId);
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings, chat);
  const memoryExtractionLimits = await getMemoryExtractionLimits();

  // Anchor derived memories to the carina message's own timestamp rather than
  // "now" — mirrors handleMemoryExtraction's chronology handling.
  const sourceMessageTimestamp = carinaMessage.createdAt ?? chat.createdAt;

  const result = await processTurnForMemory({
    transcript,
    participantCharacters,
    chatId: payload.chatId,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    dangerSettings,
    isDangerousChat: isChatActiveDangerous(chat),
    memoryExtractionLimits,
    sourceMessageTimestamp,
    // Episodic spine: which clock the chat's story runs on.
    timelineMode: chat.timelineMode ?? 'realtime',
    // A Carina answerer in an autonomous room earns the same user-absence
    // provenance as any other extraction there.
    inAutonomousRoom: chat.chatType === 'autonomous',
  });

  if (!result.success) {
    logger.warn('[CarinaMemoryExtraction] Processing did not succeed', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
    });
  } else {
    logger.info('[CarinaMemoryExtraction] Reference answer processed', {
      jobId: job.id,
      chatId: payload.chatId,
      carinaMessageId: carinaMessage.id,
      answererId: answerer.id,
      created: result.memoriesCreatedCount,
      reinforced: result.memoriesReinforcedCount,
    });
  }

  // Persist debug logs onto the carina message so the operator can pop the
  // debug panel and see what the extraction pass did.
  if (result.debugLogs.length > 0 && result.sourceMessageId) {
    try {
      await repos.chats.updateMessage(
        payload.chatId,
        result.sourceMessageId,
        { debugMemoryLogs: result.debugLogs },
      );
    } catch (e) {
      logger.warn('[CarinaMemoryExtraction] Failed to store debug logs', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Token-tracking event mirroring the per-turn extractor.
  if (result.usage.promptTokens || result.usage.completionTokens) {
    try {
      const costResult = await estimateMessageCost(
        connectionProfile.provider,
        connectionProfile.modelName,
        result.usage.promptTokens,
        result.usage.completionTokens,
        job.userId,
      );
      await createMemoryExtractionEvent(
        payload.chatId,
        result.usage,
        connectionProfile.provider,
        connectionProfile.modelName,
        costResult.cost,
      );
    } catch (e) {
      logger.warn('[CarinaMemoryExtraction] Failed to emit token tracking event', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
