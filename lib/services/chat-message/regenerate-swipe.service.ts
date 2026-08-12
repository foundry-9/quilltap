/**
 * Regenerate-Swipe Service
 *
 * Generates an alternative ("swipe") for an existing assistant message and
 * stores it as a properly-attributed variant of that message.
 *
 * Unlike the legacy in-route generator this replaced, it runs through the same
 * context engine a normal turn uses (`resolveRespondingParticipant` +
 * `buildMessageContext`), so the regeneration gets the responder's real system
 * prompt, multi-character attribution, and memory recall — and the new swipe is
 * attributed to the *same participant* as the message being regenerated, grouped
 * in place rather than appended as a stray new message.
 *
 * Generation itself is a single non-streaming provider call (no tools): a swipe
 * is one alternative line, and keeping it off the streaming/turn-chain path means
 * the live send path is untouched.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import { deleteMemoriesBySourceMessageWithVectors } from '@/lib/memory/memory-service'
import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import { buildMessageContext } from './context-builder.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, MessageEvent } from '@/lib/schemas/types'
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('RegenerateSwipeService')

export interface RegenerateSwipeOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  /** The chat the message lives in (already loaded by the caller) */
  chat: ChatMetadataBase
  /** The assistant message being regenerated */
  targetMessage: MessageEvent
  /** All events in the chat (already loaded by the caller) */
  allMessages: MessageEvent[]
  /** The user-controlled participant the human is "Speaking As" (optional override) */
  activeUserParticipantId?: string | null
}

/**
 * Generate a fresh response for an existing assistant message and persist it as
 * a swipe variant. Returns the new swipe message.
 */
export async function regenerateMessageAsSwipe({
  repos,
  userId,
  chat,
  targetMessage,
  allMessages,
  activeUserParticipantId,
}: RegenerateSwipeOptions): Promise<MessageEvent> {
  if (targetMessage.role !== 'ASSISTANT') {
    throw new Error('Only assistant messages can be regenerated')
  }
  // Staff/system-authored messages (Lantern, Host, Prospero, etc.) are not
  // character turns — they have no responder to regenerate from.
  if (targetMessage.systemSender) {
    throw new Error('Staff and system messages cannot be regenerated')
  }

  // Resolve the responder from the message's own participant so the regeneration
  // speaks as the same character. A null participant (legacy/single-character
  // message) falls back to weighted first-responder selection.
  const requestedParticipantId = targetMessage.participantId ?? undefined
  const participantResult = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    requestedParticipantId,
    !!requestedParticipantId
  )
  const {
    characterParticipant,
    character,
    connectionProfile,
    apiKey,
    isMultiCharacter,
  } = participantResult

  // User identity (honors "Speaking As") + per-character map + template + settings.
  const speakingAsId = activeUserParticipantId ?? chat.activeTypingParticipantId ?? null
  const resolvedIdentity = await resolveUserIdentity(repos, userId, chat, speakingAsId)
  const userCharacter = { name: resolvedIdentity.name, description: resolvedIdentity.description }
  const { participantCharacters } = await loadAllParticipantData(repos, chat, character)
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const roleplayTemplate = await getRoleplayTemplate(
    repos,
    chat,
    chatSettings ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined } : null
  )

  // Context = everything strictly before the message being regenerated. Sibling
  // swipes share the original's timestamp, so a strict `<` also drops them.
  const targetTime = new Date(targetMessage.createdAt).getTime()
  const previousMessages = allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && new Date(m.createdAt).getTime() < targetTime
  )

  // Build the full provider-ready context (system prompt, multi-char attribution,
  // memory recall) — continue mode, no new user message.
  const { formattedMessages } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile,
      userCharacter,
      isMultiCharacter,
      participantCharacters,
      roleplayTemplate,
      chatSettings,
      newUserMessage: undefined,
      activeUserParticipantId: speakingAsId,
      isContinueMode: true,
      contextCompressionSettings: null,
    },
    previousMessages,
    []
  )

  // Single non-streaming generation.
  const provider = await createLLMProvider(connectionProfile.provider, connectionProfile.baseUrl || undefined)
  const params = (connectionProfile.parameters || {}) as Record<string, unknown>
  const response = await provider.sendMessage(
    {
      messages: formattedMessages.map(m => ({
        role: m.role.toLowerCase() as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        name: m.name,
        attachments: m.attachments as never,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      })),
      model: connectionProfile.modelName,
      temperature: params.temperature as number | undefined,
      maxTokens: params.max_tokens as number | undefined,
      topP: params.top_p as number | undefined,
      profileParameters: params,
      cacheKey: character.id,
    },
    apiKey
  )

  // Persist the grouping. The original anchors the group at index 0; on the first
  // regeneration its swipeGroupId must be written back (the legacy path only
  // mutated an in-memory copy, so the variant ended up orphaned and rendered as a
  // separate, mis-attributed message).
  const swipeGroupId = targetMessage.swipeGroupId || `swipe-${targetMessage.id}`
  if (!targetMessage.swipeGroupId) {
    await repos.chats.updateMessage(chat.id, targetMessage.id, { swipeGroupId, swipeIndex: 0 })
  }

  const groupMembers = allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && (m.swipeGroupId === swipeGroupId || m.id === targetMessage.id)
  )
  const newSwipeIndex = groupMembers.reduce((max, m) => Math.max(max, m.swipeIndex || 0), 0) + 1

  const newSwipe: MessageEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: response.content,
    // Attribute to the same participant that authored the original — this is the
    // fix for the regenerated-message-shows-the-wrong-character bug.
    participantId: characterParticipant.id,
    swipeGroupId,
    swipeIndex: newSwipeIndex,
    tokenCount: response.usage?.totalTokens ?? null,
    promptTokens: response.usage?.promptTokens ?? null,
    completionTokens: response.usage?.completionTokens ?? null,
    rawResponse: (response.raw as Record<string, unknown>) ?? null,
    reasoningContent: response.reasoningContent ?? null,
    thoughtSignature: response.thoughtSignature ?? null,
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    attachments: [],
    // Keep the original's timestamp so the group stays in place in the transcript.
    createdAt: targetMessage.createdAt,
  } as MessageEvent

  await repos.chats.addMessage(chat.id, newSwipe)
  await repos.chats.update(chat.id, {})

  // Memory cascade: the variant being replaced may have seeded memories.
  const cascadeAction: MemoryCascadeAction =
    chatSettings?.memoryCascadePreferences?.onSwipeRegenerate || 'DELETE_MEMORIES'
  if (cascadeAction !== 'KEEP_MEMORIES') {
    try {
      const memoryCount = await repos.memories.countBySourceMessageId(targetMessage.id)
      if (memoryCount > 0) {
        await deleteMemoriesBySourceMessageWithVectors(targetMessage.id)
      }
    } catch (error) {
      logger.warn('[RegenerateSwipe] Memory cascade failed; swipe kept', {
        chatId: chat.id,
        targetMessageId: targetMessage.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('[RegenerateSwipe] Generated swipe', {
    chatId: chat.id,
    targetMessageId: targetMessage.id,
    participantId: characterParticipant.id,
    characterName: character.name,
    swipeGroupId,
    newSwipeIndex,
  })

  return newSwipe
}
