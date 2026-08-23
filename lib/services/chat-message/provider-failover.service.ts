/**
 * Provider Failover Service
 *
 * Handles empty-response retries: first retrying the same provider for likely transient
 * issues, then optionally failing over to an uncensored provider when Concierge
 * Auto-Route is enabled.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { describeModerationRefusal } from '@/lib/llm/moderation-finish-reason'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

import {
  streamMessage,
  encodeStatusEvent,
  safeEnqueue,
  encodeContentChunk,
  applyReasoningChunk,
  flushReasoningSegment,
} from './streaming.service'
import type { StreamingState } from './types'

const logger = createServiceLogger('ProviderFailover')

export interface AttemptEmptyResponseRecoveryOptions {
  state: StreamingState
  toolMessagesLength: number
  contentWasFlaggedDangerous: boolean
  dangerSettings: DangerousContentSettings
  connectionProfile: ConnectionProfile
  formattedMessages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    reasoningContent?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
}

export interface EmptyResponseRecoveryFlags {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
}

/**
 * Attempt to recover from an empty assistant response.
 * Mutates `state` directly — the caller reads updated values from the same object.
 */
export async function attemptEmptyResponseRecovery({
  state,
  toolMessagesLength,
  contentWasFlaggedDangerous,
  dangerSettings,
  connectionProfile,
  formattedMessages,
  modelParams,
  actualTools,
  useNativeWebSearch,
  userId,
  chatId,
  character,
  controller,
  encoder,
  preGeneratedAssistantMessageId,
}: AttemptEmptyResponseRecoveryOptions): Promise<EmptyResponseRecoveryFlags> {
  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false

  if (state.fullResponse.trim().length !== 0 || toolMessagesLength > 0) {
    return { uncensoredRetryAttempted, sameProviderRetryAttempted }
  }

  if (!contentWasFlaggedDangerous) {
    sameProviderRetryAttempted = true
    logger.warn('[EmptyResponse] Empty response from provider that passed moderation, retrying same provider', {
      chatId,
      provider: state.effectiveProfile.provider,
      model: state.effectiveProfile.modelName,
    })

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'retrying',
      message: 'Empty response received — retrying...',
      characterName: character.name,
      characterId: character.id,
    }))

    try {
      await restreamInto(state, {
        connectionProfile: state.effectiveProfile,
        apiKey: state.effectiveApiKey,
        formattedMessages,
        modelParams,
        actualTools,
        useNativeWebSearch,
        userId,
        chatId,
        character,
        controller,
        encoder,
        preGeneratedAssistantMessageId,
      })

      if (state.fullResponse.trim().length > 0) {
        logger.info('[EmptyResponse] Same-provider retry succeeded', {
          chatId,
          provider: state.effectiveProfile.provider,
          model: state.effectiveProfile.modelName,
          responseLength: state.fullResponse.length,
        })
      } else {
        logger.warn('[EmptyResponse] Same-provider retry also returned empty', {
          chatId,
          provider: state.effectiveProfile.provider,
          model: state.effectiveProfile.modelName,
        })
      }
    } catch (retryError) {
      logger.error('[EmptyResponse] Same-provider retry failed', {
        chatId,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      })
    }
  }

  if (
    state.fullResponse.trim().length === 0 &&
    dangerSettings.mode === 'AUTO_ROUTE' &&
    dangerSettings.uncensoredTextProfileId
  ) {
    uncensoredRetryAttempted = true
    logger.warn('[DangerousContent] Empty response detected, attempting uncensored retry', {
      chatId,
      originalProvider: state.effectiveProfile.provider,
      originalModel: state.effectiveProfile.modelName,
      contentWasFlaggedDangerous,
      sameProviderRetryAttempted,
    })

    try {
      const routeResult = await resolveProviderForDangerousContent(
        state.effectiveProfile,
        state.effectiveApiKey,
        dangerSettings,
        userId
      )

      if (routeResult.rerouted && routeResult.connectionProfile.id === state.effectiveProfile.id) {
      } else if (routeResult.rerouted) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'rerouting',
          message: 'Retrying with uncensored provider...',
          characterName: character.name,
          characterId: character.id,
        }))

        await restreamInto(state, {
          connectionProfile: routeResult.connectionProfile,
          apiKey: routeResult.apiKey,
          formattedMessages,
          modelParams,
          actualTools,
          useNativeWebSearch,
          userId,
          chatId,
          character,
          controller,
          encoder,
          preGeneratedAssistantMessageId,
        })

        if (state.fullResponse.trim().length > 0) {
          state.effectiveProfile = routeResult.connectionProfile
          state.effectiveApiKey = routeResult.apiKey

          logger.info('[DangerousContent] Uncensored retry succeeded', {
            chatId,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
            responseLength: state.fullResponse.length,
          })
        } else {
          logger.error('[DangerousContent] Both safe and uncensored providers returned empty', {
            chatId,
            safeProvider: connectionProfile.provider,
            safeModel: connectionProfile.modelName,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
          })
        }
      }
    } catch (retryError) {
      logger.error('[DangerousContent] Uncensored retry failed', {
        chatId,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      })
    }
  }

  return { uncensoredRetryAttempted, sameProviderRetryAttempted }
}

export function getEmptyResponseReason({
  uncensoredRetryAttempted,
  sameProviderRetryAttempted,
  contentWasFlaggedDangerous,
  finishReason,
  provider,
  modelName,
}: {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  contentWasFlaggedDangerous: boolean
  /** Provider-reported finish reason from the final chunk, when known. */
  finishReason?: string | null
  provider?: string
  modelName?: string
}): string {
  // A provider that named its refusal outright gets to say so. Everything
  // below this point is inference from an empty body; this is testimony, and
  // it changes the advice — "try resending" is wrong for a moderation stop
  // (bug 93).
  const refusal = describeModerationRefusal(finishReason, provider ?? 'The provider', modelName ?? 'model')
  if (refusal) {
    if (uncensoredRetryAttempted) {
      return `${refusal} An uncensored provider was tried as well and also returned empty.`
    }
    return refusal
  }

  if (uncensoredRetryAttempted && sameProviderRetryAttempted) {
    return 'The AI model returned an empty response after retrying, and an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
  }

  if (uncensoredRetryAttempted) {
    return 'The AI model returned an empty response, and retrying with an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
  }

  if (contentWasFlaggedDangerous) {
    return 'The AI model returned an empty response, likely because the Concierge flagged this content as dangerous and the provider refused to generate a response. Consider enabling Auto-Route mode in the Concierge settings to automatically reroute dangerous content to an uncensored provider.'
  }

  if (sameProviderRetryAttempted) {
    return 'The AI model returned an empty response twice. This may be a temporary issue with the provider. Please try resending your message.'
  }

  return 'The AI model returned an empty response. This is a known issue with some providers. Please try resending your message.'
}

interface RestreamOptions {
  connectionProfile: ConnectionProfile
  apiKey: string
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
}

/**
 * Re-stream a response into the mutable StreamingState.
 */
async function restreamInto(
  state: StreamingState,
  opts: RestreamOptions
): Promise<void> {
  for await (const chunk of streamMessage({
    messages: opts.formattedMessages,
    connectionProfile: opts.connectionProfile,
    apiKey: opts.apiKey,
    modelParams: opts.modelParams,
    tools: opts.actualTools,
    useNativeWebSearch: opts.useNativeWebSearch,
    userId: opts.userId,
    messageId: opts.preGeneratedAssistantMessageId,
    chatId: opts.chatId,
  })) {
    applyReasoningChunk(state, chunk, opts.controller, opts.encoder)
    if (chunk.content) {
      if (!state.hasStartedStreaming) {
        safeEnqueue(opts.controller, encodeStatusEvent(opts.encoder, {
          stage: 'streaming',
          message: `${opts.character.name} is responding...`,
          characterName: opts.character.name,
          characterId: opts.character.id,
        }))
        state.hasStartedStreaming = true
      }
      flushReasoningSegment(state)
      state.fullResponse += chunk.content
      opts.controller.enqueue(encodeContentChunk(opts.encoder, chunk.content))
    }

    if (chunk.done) {
      state.usage = chunk.usage || null
      state.cacheUsage = chunk.cacheUsage || null
      state.attachmentResults = chunk.attachmentResults || null
      state.rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) {
        state.thoughtSignature = chunk.thoughtSignature
      }
      flushReasoningSegment(state)
    }
  }
}
