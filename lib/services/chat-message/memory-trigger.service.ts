/**
 * Memory Trigger Service
 *
 * Per-turn extraction trigger plus the post-finalizer fan-out
 * (context-summary check, danger classification, scene-state tracking,
 * conversation render) that has always been keyed off chat turns.
 *
 * Memory extraction runs once per closed turn — the orchestrator detects
 * the turn close via `turnInfo.isUsersTurn === true` on the finalizer's
 * last character and calls `triggerTurnMemoryExtraction`. The trigger
 * resolves the turn opener (the most recent non-system USER message),
 * enqueues a single MEMORY_EXTRACTION job keyed on
 * (chatId, turnOpenerMessageId), and lets the queue dedupe handle any
 * accidental re-fires within the same turn.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { isClassifierOnDuty } from '@/lib/services/dangerous-content/chat-override'
import {
  enqueueChatDangerClassification,
  enqueueSceneStateTracking,
  enqueueConversationRender,
  enqueueMemoryExtraction,
} from '@/lib/background-jobs/queue-service'
import { findTurnOpenerMessageId } from './turn-transcript'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ConnectionProfile, MessageEvent, CheapLLMSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('MemoryTriggerService')

export interface MemoryChatSettings {
  cheapLLMSettings?: CheapLLMSettings
  dangerSettings?: DangerousContentSettings
  isDangerousChat?: boolean
}

/**
 * Enqueue a per-turn memory extraction job for the closed turn.
 *
 * Caller must verify that the turn has actually closed (no more
 * participants will speak before the user) before invoking this; the
 * orchestrator does that via `turnInfo.isUsersTurn` on the last finalizer.
 *
 * The trigger pulls current chat history to find the turn opener (the
 * most recent non-system USER message). When no qualifying user message
 * exists (greeting-only chats, fresh chats), the trigger still enqueues
 * a job with `turnOpenerMessageId: null` so self-pass extraction still
 * runs against the assistant tail. For autonomous chats — which never
 * have a USER opener — the latest non-system ASSISTANT message ID is
 * passed as the dedupe anchor so successive triggers enqueue distinct
 * jobs instead of collapsing into a single (chatId, null) row.
 */
export async function triggerTurnMemoryExtraction(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  },
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {
      return
    }

    const messages = await repos.chats.getMessages(options.chatId)
    const messageEvents = messages.filter(
      (m): m is MessageEvent => m.type === 'message',
    ) as unknown as MessageEvent[]

    const turnOpenerMessageId = findTurnOpenerMessageId(messageEvents)

    let extractionAnchorMessageId: string | null = null
    if (turnOpenerMessageId === null) {
      for (let i = messageEvents.length - 1; i >= 0; i--) {
        const m = messageEvents[i]
        if (m.type !== 'message') continue
        if (m.role !== 'ASSISTANT') continue
        if (m.systemSender) continue
        if (m.isSilentMessage) continue
        if (!m.participantId) continue
        extractionAnchorMessageId = m.id
        break
      }
    }

    await enqueueMemoryExtraction(options.userId, {
      chatId: options.chatId,
      turnOpenerMessageId,
      extractionAnchorMessageId,
      connectionProfileId: options.connectionProfile.id,
    })
  } catch (error) {
    logger.error('Failed to enqueue per-turn memory extraction', {}, error as Error)
  }
}

/**
 * Trigger context summary check and generation if needed
 */
export async function triggerContextSummaryCheck(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    provider: string
    modelName: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  }
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {

      return
    }

    const availableProfiles = await repos.connections.findByUserId(options.userId)

    checkAndGenerateSummaryIfNeeded(
      options.chatId,
      options.provider,
      options.modelName,
      options.userId,
      options.connectionProfile,
      options.chatSettings.cheapLLMSettings,
      availableProfiles
    )
  } catch (error) {
    logger.error('Failed to trigger context summary check', {}, error as Error)
  }
}

/**
 * Trigger chat-level danger classification if needed
 *
 * Uses the compressed context summary to classify the entire chat.
 * Key behaviors:
 * - Bails if dangerous content mode is OFF
 * - Once classified as dangerous, stays dangerous (sticky) — never re-checks
 * - Once classified as safe, stays safe (sticky) unless new messages are added
 * - Skips if no context summary available yet
 */
export async function triggerChatDangerClassification(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  }
): Promise<void> {
  try {
    // Get the chat first so an operator override short-circuits before we do
    // any setting lookups.
    const chat = await repos.chats.findById(options.chatId)
    if (!chat) {
      return
    }

    // Once the operator has spoken — Vouched Safe or Uncensored — the
    // classifier is off the case, and the handler would discard the job at its
    // own guard. Bail here so an Uncensored chat stops enqueueing a doomed job
    // on every turn.
    if (!isClassifierOnDuty(chat)) {
      return
    }

    // Resolve danger settings — bail if mode is OFF. Passing `chat` collapses
    // to OFF for a moderation-exempt chat type (Help Chat, Brahma Console),
    // so those surfaces are never enqueued either.
    const chatSettings = await repos.chatSettings.findByUserId(options.userId)
    const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings, chat)
    if (dangerSettings.mode === 'OFF') {
      return
    }

    // Sticky: if already classified as dangerous, never re-check
    if (chat.isDangerousChat === true) {
      return
    }

    // If already classified at this message count, skip (no new messages)
    if (
      chat.dangerClassifiedAt &&
      chat.dangerClassifiedAtMessageCount === chat.messageCount
    ) {
      return
    }

    // No context summary → nothing to classify yet
    if (!chat.contextSummary) {
      return
    }

    // Enqueue the classification job
    await enqueueChatDangerClassification(options.userId, {
      chatId: options.chatId,
      connectionProfileId: options.connectionProfile.id,
    })

  } catch (error) {
    logger.error('Failed to trigger chat danger classification', {}, error as Error)
  }
}

/**
 * Trigger scene state tracking after a chat turn
 *
 * Enqueues a background job to derive the current scene state
 * (location, character actions, appearance, clothing) using the cheap LLM.
 */
export async function triggerSceneStateTracking(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
    characterIds: string[]
  }
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {
      return
    }

    await enqueueSceneStateTracking(options.userId, {
      chatId: options.chatId,
      characterIds: options.characterIds,
      connectionProfileId: options.connectionProfile.id,
    })
  } catch (error) {
    logger.error('Failed to trigger scene state tracking', {}, error as Error)
  }
}

/**
 * Trigger conversation rendering (Scriptorium)
 *
 * Enqueues a background job to deterministically render the conversation
 * to Markdown and update interchange chunks for embedding.
 */
export async function triggerConversationRender(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    userId: string
  }
): Promise<void> {
  try {
    await enqueueConversationRender(options.userId, {
      chatId: options.chatId,
    })
  } catch (error) {
    logger.error('Failed to trigger conversation render', {}, error as Error)
  }
}
