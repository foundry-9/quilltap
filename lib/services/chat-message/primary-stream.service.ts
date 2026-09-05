/**
 * Primary Stream Service
 *
 * Wraps the orchestrator's initial `streamMessage` call — the very first
 * LLM turn after the slate has been assembled — plus the two recovery
 * branches that fork off of its error path:
 *
 *   1. **Tool-unsupported retry.** If the upstream rejects function calling
 *      (e.g. some Gemini 3 variants), retry the exact same request with
 *      `tools: []` once before giving up.
 *   2. **Request-limit recovery.** If the upstream signals a recoverable
 *      request error (token-limit overrun, PDF page cap, etc.), delegate
 *      to `attemptRequestLimitRecovery`. On success that returns a fully-
 *      finalized message, so the orchestrator must short-circuit; this
 *      service surfaces that via the `earlyReturn` field on its result.
 *
 * The pre-stream "Sending to..." status, the streaming/responding status
 * gate that flips on the first content chunk, and the previousResponseId
 * extraction all live here. Mutations: `streaming.fullResponse`,
 * `streaming.usage`, `streaming.cacheUsage`, `streaming.attachmentResults`,
 * `streaming.rawResponse`, `streaming.thoughtSignature`, `streaming.reasoningContent`, and
 * `streaming.hasStartedStreaming` are written in place.
 *
 * `makePreservePartialOnError` builds the idempotent partial-preserver that
 * every streamMessage callsite in the orchestrator (and its extracted
 * siblings) shares. The closure preserves `streaming.fullResponse` (with an
 * OOC marker explaining the abrupt end) to the DB exactly once across the
 * whole turn — subsequent callers no-op.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeContentChunk,
  encodeStatusEvent,
  safeEnqueue,
  streamMessage,
  applyReasoningChunk,
  flushReasoningSegment,
  type StreamOptions,
} from './streaming.service'
import { saveAssistantMessage } from './message-finalizer.service'
import { attemptRequestLimitRecovery } from './recovery.service'
import { attemptHardErrorFailover } from './provider-failover.service'
import { collectAttachmentMimeTypes } from '@/lib/chat/message-attachment-adapter'
import { summarizeFallbackAttempts } from '@/lib/llm/fallback'
import { isRecoverableRequestError, isToolUnsupportedError } from '@/lib/llm/errors'
import { stripCharacterNamePrefix, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'

import type { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatMetadataBase, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { AttachedFile, ProcessMessageResult, StreamingState } from './types'

const logger = createServiceLogger('PrimaryStream')

export interface MakePreservePartialOnErrorOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  character: Character
  characterParticipant: { id: string }
  streaming: StreamingState
  preGeneratedAssistantMessageId: string
}

/**
 * Build the per-turn partial-response preserver. The returned closure is
 * idempotent across all callsites for the lifetime of the turn — the first
 * call that finds streamed content writes it to the DB with an OOC marker;
 * subsequent calls early-return so the original error still propagates.
 */
export function makePreservePartialOnError(
  opts: MakePreservePartialOnErrorOptions
): (error: unknown) => Promise<void> {
  const { repos, chatId, character, characterParticipant, streaming, preGeneratedAssistantMessageId } = opts
  let partialPreserved = false

  return async function preservePartialOnError(error: unknown): Promise<void> {
    if (partialPreserved) return
    if (!streaming.hasStartedStreaming || streaming.fullResponse.length === 0) {
      return
    }
    partialPreserved = true
    const errorReason = error instanceof Error ? error.message : String(error)
    const normalizedPartial = normalizeContentBlockFormat(streaming.fullResponse)
    const cleanedPartial = stripCharacterNamePrefix(normalizedPartial, character.name, character.aliases)
    const preservedContent = `${cleanedPartial.trimEnd()}\n\n{{OOC: stream ended abruptly (${errorReason})}}`

    try {
      const preservedMessageId = await saveAssistantMessage(
        repos,
        chatId,
        character,
        characterParticipant,
        preservedContent,
        streaming.usage,
        streaming.rawResponse,
        streaming.thoughtSignature,
        [],
        [],
        preGeneratedAssistantMessageId,
        streaming.effectiveProfile.provider,
        streaming.effectiveProfile.modelName,
        undefined,
        streaming.reasoningContent,
        streaming.reasoningSegments
      )
      logger.info('Preserved partial streamed response after upstream error', {
        chatId,
        messageId: preservedMessageId,
        characterId: character.id,
        characterName: character.name,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        partialLength: streaming.fullResponse.length,
        error: errorReason,
      })
    } catch (persistError) {
      logger.error('Failed to persist partial streamed response', {
        chatId,
        characterId: character.id,
        error: persistError instanceof Error ? persistError.message : String(persistError),
        originalError: errorReason,
      })
    }
  }
}

export interface RunPrimaryStreamOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string }
  userParticipantId: string | null
  isMultiCharacter: boolean
  formattedMessages: StreamOptions['messages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  previousResponseId?: string
  /** Optional provider stop sequences (e.g. simple-json's `</tool_call>`). */
  stop?: string[]
  preGeneratedAssistantMessageId: string
  attachedFiles: AttachedFile[]
  originalMessage?: string
  /** Connection profile used for recovery (matches `streaming.effectiveProfile`). */
  connectionProfile: ConnectionProfile
  /**
   * Whether this turn is running in dangerous-routed territory. Threaded into
   * the fallback chain so an auto-picked stand-in stays `isDangerousCompatible`
   * — a reroute that quietly drafts a mainstream model hands the content back
   * to the moderation that refused it.
   */
  isDangerousRouted?: boolean
  /** Mutated in place. */
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preservePartialOnError: (error: unknown) => Promise<void>
}

export interface PrimaryStreamResult {
  /** Set when `attemptRequestLimitRecovery` handled the whole request and
   * the orchestrator should short-circuit instead of continuing into the
   * native tool loop. */
  earlyReturn?: ProcessMessageResult
}

/**
 * Run the orchestrator's primary (post-context-build) stream, including the
 * tool-unsupported retry-without-tools and the request-limit recovery
 * branches.
 */
export async function runPrimaryStream(opts: RunPrimaryStreamOptions): Promise<PrimaryStreamResult> {
  const {
    chatId, userId, chat, character, characterParticipant, userParticipantId, isMultiCharacter,
    formattedMessages, modelParams, actualTools, useNativeWebSearch,
    previousResponseId, stop, preGeneratedAssistantMessageId,
    attachedFiles, originalMessage, connectionProfile, isDangerousRouted,
    streaming, controller, encoder, preservePartialOnError,
    repos,
  } = opts

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile: streaming.effectiveProfile,
      apiKey: streaming.effectiveApiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
      characterId: character.id,
      previousResponseId,
      stop,
    })) {
      // Capture + live-forward reasoning ("thinking") on any chunk. DISPLAY ONLY.
      applyReasoningChunk(streaming, chunk, controller, encoder)
      if (chunk.content) {
        if (!streaming.hasStartedStreaming) {
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'streaming',
            message: `${character.name} is responding...`,
            characterName: character.name,
            characterId: character.id,
          }))
          streaming.hasStartedStreaming = true
        }
        // Prose resumed — close any pending reasoning run into a positioned segment.
        flushReasoningSegment(streaming)
        streaming.fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        streaming.usage = chunk.usage || null
        streaming.cacheUsage = chunk.cacheUsage || null
        streaming.attachmentResults = chunk.attachmentResults || null
        streaming.rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          streaming.thoughtSignature = chunk.thoughtSignature
        }
        // Flush any trailing reasoning that arrived without subsequent prose.
        flushReasoningSegment(streaming)
      }
    }
  } catch (streamingError) {
    // Tool-unsupported retry: e.g. Gemini 3 variants reject function calling.
    // Retry the same request with `tools: []` once before giving up.
    if (isToolUnsupportedError(streamingError) && actualTools.length > 0) {
      logger.warn('Model does not support function calling, retrying without tools', {
        chatId,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        toolCount: actualTools.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'sending',
        message: `Retrying without tools for ${character.name}...`,
        characterName: character.name,
        characterId: character.id,
      }))

      try {
        for await (const chunk of streamMessage({
          messages: formattedMessages,
          connectionProfile: streaming.effectiveProfile,
          apiKey: streaming.effectiveApiKey,
          modelParams,
          tools: [],
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          applyReasoningChunk(streaming, chunk, controller, encoder)
          if (chunk.content) {
            if (!streaming.hasStartedStreaming) {
              safeEnqueue(controller, encodeStatusEvent(encoder, {
                stage: 'streaming',
                message: `${character.name} is responding...`,
                characterName: character.name,
                characterId: character.id,
              }))
              streaming.hasStartedStreaming = true
            }
            flushReasoningSegment(streaming)
            streaming.fullResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streaming.usage = chunk.usage || null
            streaming.cacheUsage = chunk.cacheUsage || null
            streaming.attachmentResults = chunk.attachmentResults || null
            streaming.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streaming.thoughtSignature = chunk.thoughtSignature
            }
            flushReasoningSegment(streaming)
          }
        }

        logger.info('Tool-unsupported retry succeeded. Consider configuring text-block tools for this model.', {
          chatId,
          provider: streaming.effectiveProfile.provider,
          model: streaming.effectiveProfile.modelName,
          responseLength: streaming.fullResponse.length,
        })
        return {}
      } catch (retryError) {
        logger.error('Tool-unsupported retry also failed', {
          chatId,
          provider: streaming.effectiveProfile.provider,
          model: streaming.effectiveProfile.modelName,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        await preservePartialOnError(retryError)
        throw retryError
      }
    }
    // Request-limit recovery: token-limit / PDF-page-cap / etc. attemptRequestLimitRecovery
    // produces a fully-finalized assistant message on success, so the
    // orchestrator must short-circuit via earlyReturn.
    else if (isRecoverableRequestError(streamingError)) {
      logger.info('Recoverable request error detected, attempting recovery', {
        chatId,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        attachmentCount: attachedFiles.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      const recoveryResult = await attemptRequestLimitRecovery({
        controller,
        encoder,
        character,
        connectionProfile,
        apiKey: streaming.effectiveApiKey,
        attachedFiles,
        originalMessage,
        error: streamingError,
        repos,
        chatId,
        userId,
        characterParticipantId: characterParticipant.id,
      })

      if (recoveryResult.success) {
        logger.info('Request limit recovery successful', {
          chatId,
          messageId: recoveryResult.messageId,
          isStaticFallback: recoveryResult.isStaticFallback,
        })
        return {
          earlyReturn: {
            isMultiCharacter,
            hasContent: true,
            messageId: recoveryResult.messageId || null,
            userParticipantId,
            isPaused: chat.isPaused,
          },
        }
      }

      logger.warn('Request limit recovery failed, propagating error', { chatId })
    }

    // Fallback chain. The profile named an understudy, or is willing to have
    // one drafted; give them the turn before the error reaches the user. Not
    // reached for a token-limit overrun or a tool-unsupported rejection —
    // `classifyFallbackTrigger` refuses those, so the two branches above keep
    // their exclusive claim on them.
    const failover = await attemptHardErrorFailover({
      state: streaming,
      error: streamingError,
      repos,
      context: {
        userId,
        purpose: 'chat',
        dangerous: isDangerousRouted === true,
        // What the array carries, not what the user uploaded — see the same
        // note in the orchestrator's empty-response call.
        needsVision: collectAttachmentMimeTypes(formattedMessages).some((m) => m.startsWith('image/')),
        needsTools: actualTools.length > 0,
        alreadyTried: [],
      },
      formattedMessages,
      modelParams,
      actualTools,
      useNativeWebSearch,
      chatId,
      character,
      controller,
      encoder,
      preGeneratedAssistantMessageId,
      stop,
    })

    if (failover.recovered) {
      return {}
    }

    await preservePartialOnError(streamingError)

    // Name the understudies in the error the user sees. Without this the
    // chain is invisible: the message would blame the primary for a failure
    // three providers deep.
    if (failover.attempts.length > 1) {
      const summary = summarizeFallbackAttempts(failover.attempts, failover.tierPickWasOffered)
      const original = streamingError instanceof Error ? streamingError : new Error(String(streamingError))
      original.message = `${original.message} (${summary})`
      throw original
    }

    throw streamingError
  }

  return {}
}

/**
 * Convenience: extract the OpenAI Responses API previousResponseId from the
 * most recent assistant message in `existingMessages`. Returns `undefined`
 * for any other provider or when no chainable response is found.
 */
export function findPreviousResponseId(
  provider: string,
  existingMessages: MessageEvent[]
): string | undefined {
  if (provider !== 'OPENAI') return undefined
  for (let i = existingMessages.length - 1; i >= 0; i--) {
    const msg = existingMessages[i]
    if (msg.type === 'message' && msg.role === 'ASSISTANT' && msg.rawResponse) {
      const raw = msg.rawResponse as Record<string, unknown>
      if (typeof raw.id === 'string' && raw.id.startsWith('resp_')) {
        return raw.id
      }
    }
  }
  return undefined
}
