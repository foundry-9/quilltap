/**
 * Provider Failover Service
 *
 * Two kinds of failover, both landing in the same `StreamingState`:
 *
 *  - **Empty response** — the call succeeded and produced nothing. Retry the
 *    same provider once (usually transient), then, in Concierge Auto-Route
 *    territory, the uncensored profile, then the profile's own fallback chain.
 *  - **Hard error** — the call did not succeed at all (auth, rate limit,
 *    network, missing model, 5xx). Walk the profile's fallback chain.
 *
 * `state.effectiveProfile` / `state.effectiveApiKey` are the single mutable
 * seam every downstream stage already reads, so a swap made here composes with
 * message finalization, token accounting and the tool loop for free.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { describeModerationRefusal } from '@/lib/llm/moderation-finish-reason'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import {
  adaptMessagesForProfile,
  collectAttachmentMimeTypes,
} from '@/lib/chat/message-attachment-adapter'
import {
  buildFallbackChain,
  classifyFallbackTrigger,
  recordAttempt,
  type FallbackAttempt,
  type FallbackContext,
  type FallbackRepos,
} from '@/lib/llm/fallback'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

/**
 * Reads only. `findApiKeyById` is needed on top of the engine's own surface
 * because an understudy's key has to be decrypted before its call goes out.
 */
export type FailoverRepos = FallbackRepos & {
  connections: { findApiKeyById(id: string): Promise<{ key_value: string } | null> }
}

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
  /**
   * Reads only. Present enables the third and last recovery step: the
   * effective profile's own fallback chain. Optional so a caller that has no
   * repository handle (tests, and any future path that only wants the local
   * retries) keeps today's two-step behaviour.
   */
  repos?: FailoverRepos
  /** Capability flags for the chain. Required alongside `repos`. */
  fallbackContext?: Omit<FallbackContext, 'userId' | 'purpose' | 'alreadyTried'>
  /** Provider stop sequences to carry into a chain attempt. */
  stop?: string[]
}

export interface EmptyResponseRecoveryFlags {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  /** Whether the profile's fallback chain was walked after the two local
   *  retries came back empty. */
  chainFallbackAttempted: boolean
  /** The failed attempts from that chain walk, for the log and the message. */
  chainAttempts: FallbackAttempt[]
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
  repos,
  fallbackContext,
  stop,
}: AttemptEmptyResponseRecoveryOptions): Promise<EmptyResponseRecoveryFlags> {
  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false

  // Profiles this recovery has already spent. The chain walk at the bottom
  // reads it so a route that has already come back empty isn't asked twice.
  const triedProfileIds: string[] = []

  const flags = (): EmptyResponseRecoveryFlags => ({
    uncensoredRetryAttempted,
    sameProviderRetryAttempted,
    chainFallbackAttempted: false,
    chainAttempts: [],
  })

  if (state.fullResponse.trim().length !== 0 || toolMessagesLength > 0) {
    return flags()
  }

  if (!contentWasFlaggedDangerous) {
    sameProviderRetryAttempted = true
    triedProfileIds.push(state.effectiveProfile.id)
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
        userId,
        // What the array is actually carrying, so the scan does not offer a
        // substitute the payload rules out (bug 106).
        collectAttachmentMimeTypes(formattedMessages)
      )

      if (routeResult.rerouted && routeResult.connectionProfile.id === state.effectiveProfile.id) {
      } else if (routeResult.rerouted) {
        triedProfileIds.push(routeResult.connectionProfile.id)

        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'rerouting',
          message: 'Retrying with uncensored provider...',
          characterName: character.name,
          characterId: character.id,
        }))

        // The array was built for the profile that just refused. An explicitly
        // configured uncensored profile is honoured ahead of the scan, so it
        // may still be one that cannot read this turn's images — re-decide
        // before spending the attempt, or the gateway 400s and the last line
        // of defence never runs (bug 106).
        const reroutedMessages = repos
          ? await adaptMessagesForProfile(
              formattedMessages,
              routeResult.connectionProfile,
              repos,
              userId,
              { chatId },
            )
          : formattedMessages

        await restreamInto(state, {
          connectionProfile: routeResult.connectionProfile,
          apiKey: routeResult.apiKey,
          formattedMessages: reroutedMessages,
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

  // Third and last: the effective profile's own fallback chain.
  //
  // Deliberately last. An empty body is usually transient (the same-profile
  // retry above catches that), and when it isn't it is usually a refusal —
  // a *content* problem, which the uncensored reroute exists to answer. Only
  // once both have come back empty is it worth concluding the route itself is
  // no good and calling for the understudy.
  //
  // Note `state.effectiveProfile` may by now be the uncensored profile: it is
  // a connection profile like any other and carries its own understudy, whose
  // chain then runs with `dangerous: true` so tier picks stay cleared for the
  // content.
  if (state.fullResponse.trim().length === 0 && repos && fallbackContext) {
    const chainResult = await attemptEmptyResponseChainFallback({
      state,
      repos,
      context: {
        ...fallbackContext,
        userId,
        purpose: 'chat',
        // An uncensored reroute already happened, or the content was flagged:
        // either way a stand-in must be cleared for this content.
        dangerous: fallbackContext.dangerous || uncensoredRetryAttempted || contentWasFlaggedDangerous,
        alreadyTried: triedProfileIds,
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

    return {
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      chainFallbackAttempted: true,
      chainAttempts: chainResult.attempts,
    }
  }

  return flags()
}

export function getEmptyResponseReason({
  uncensoredRetryAttempted,
  sameProviderRetryAttempted,
  contentWasFlaggedDangerous,
  chainAttempts = [],
  finishReason,
  provider,
  modelName,
}: {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  contentWasFlaggedDangerous: boolean
  /** Failed attempts from the fallback chain, when one was walked. */
  chainAttempts?: FallbackAttempt[]
  /** Provider-reported finish reason from the final chunk, when known. */
  finishReason?: string | null
  provider?: string
  modelName?: string
}): string {
  // The understudies get named first when there were any: "and the stand-ins
  // failed too" is the part that tells the user where to look, and it would be
  // lost inside the generic advice below.
  const understudies = chainAttempts.slice(1)
  const understudyRoll =
    understudies.length > 0
      ? ` The fallback chain was tried as well: ${understudies
          .map((a) => `${a.profileName} (${a.trigger})`)
          .join(', ')}.`
      : ''
  // A provider that named its refusal outright gets to say so. Everything
  // below this point is inference from an empty body; this is testimony, and
  // it changes the advice — "try resending" is wrong for a moderation stop
  // (bug 93).
  const refusal = describeModerationRefusal(finishReason, provider ?? 'The provider', modelName ?? 'model')
  if (refusal) {
    if (uncensoredRetryAttempted) {
      return `${refusal} An uncensored provider was tried as well and also returned empty.${understudyRoll}`
    }
    return `${refusal}${understudyRoll}`
  }

  if (uncensoredRetryAttempted && sameProviderRetryAttempted) {
    return `The AI model returned an empty response after retrying, and an uncensored provider also returned empty. This may indicate the content was filtered by both providers.${understudyRoll}`
  }

  if (uncensoredRetryAttempted) {
    return `The AI model returned an empty response, and retrying with an uncensored provider also returned empty. This may indicate the content was filtered by both providers.${understudyRoll}`
  }

  if (contentWasFlaggedDangerous) {
    return `The AI model returned an empty response, likely because the Concierge flagged this content as dangerous and the provider refused to generate a response. Consider enabling Auto-Route mode in the Concierge settings to automatically reroute dangerous content to an uncensored provider.${understudyRoll}`
  }

  if (sameProviderRetryAttempted) {
    return `The AI model returned an empty response twice. This may be a temporary issue with the provider. Please try resending your message.${understudyRoll}`
  }

  return `The AI model returned an empty response. This is a known issue with some providers. Please try resending your message.${understudyRoll}`
}

export interface RestreamOptions {
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
  /**
   * Provider stop sequences (e.g. simple-json's `</tool_call>`). Optional so
   * the empty-response callers above keep their existing behaviour; the
   * hard-error failover path passes the primary call's sequences so a
   * pseudo-tool profile's framing survives the swap.
   *
   * Note there is deliberately no `previousResponseId` here: it is an OpenAI
   * Responses-API chaining token, and handing it to a different account —
   * never mind a different provider — is meaningless at best.
   */
  stop?: string[]
}

/**
 * Re-stream a response into the mutable StreamingState.
 *
 * Appends to `state.fullResponse` rather than replacing it. Callers that are
 * *substituting* a response rather than continuing one must clear the
 * streaming buffers first — see `resetStreamingBuffersForSwap`.
 */
export async function restreamInto(
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
    characterId: opts.character.id,
    stop: opts.stop,
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

// ============================================================================
// FALLBACK CHAINS
// ============================================================================

/**
 * Clear the streaming buffers so a re-stream *substitutes* a response instead
 * of continuing one.
 *
 * `restreamInto` appends, which is right when it is retrying a call that
 * produced nothing. A chain walk is different: the failed attempt may have
 * left reasoning in the buffers before it died, and the understudy's answer
 * must not be glued onto the corpse of the one before it.
 *
 * Reasoning is display-only and the client replaces its buffer wholesale on
 * each cumulative update, so clearing it server-side and re-streaming lands
 * correctly on the client too.
 */
function resetStreamingBuffersForSwap(state: StreamingState): void {
  state.fullResponse = ''
  state.usage = null
  state.cacheUsage = null
  state.attachmentResults = null
  state.rawResponse = undefined
  state.thoughtSignature = undefined
  state.reasoningContent = ''
  state.reasoningSegments = []
  state.reasoningFlushedLen = 0
}

export interface WalkFallbackChainOptions {
  state: StreamingState
  /**
   * Reads only. `findApiKeyById` is needed on top of the engine's own surface
   * because an understudy's key has to be decrypted before its call goes out.
   */
  repos: FailoverRepos
  /**
   * Everything a stand-in needs from this call.
   *
   * `context.alreadyTried` matters more here than it looks: the
   * empty-response path may have burned the uncensored profile before the
   * chain is even reached, and a chain that re-offered it would spend a whole
   * attempt re-learning what it already knows. The failing profile itself is
   * added by the walk, so callers need only list the *extra* ones.
   */
  context: FallbackContext
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  stop?: string[]
}

export interface FallbackChainResult {
  /** True when some understudy answered; `state` now holds their response. */
  recovered: boolean
  /** Every failed attempt in order, starting with the profile that opened the
   *  chain. Empty when no chain was walked at all. */
  attempts: FallbackAttempt[]
  /** Whether the chain offered an auto-picked tier candidate. Feeds the
   *  "no tier replacement qualified" half of the user-facing summary. */
  tierPickWasOffered: boolean
}

/**
 * Walk a profile's fallback chain, streaming the first answer that arrives
 * into `state`.
 *
 * `openingFailure` is the attempt that sent us here — the primary's error, or
 * its empty response. It leads the attempt trail and seeds the loop guard, so
 * the chain never re-offers the profile that just failed.
 *
 * On success `state.effectiveProfile` / `effectiveApiKey` are swapped to the
 * understudy: that pair is the seam every downstream stage reads, so
 * finalization, token accounting and the tool loop all attribute the message
 * to whoever actually wrote it. On exhaustion the buffers are left empty — a
 * stray fragment from a dead understudy is not this character's words.
 */
async function walkFallbackChain(
  opts: WalkFallbackChainOptions,
  openingFailure: FallbackAttempt
): Promise<FallbackChainResult> {
  const {
    state, repos, context, formattedMessages, modelParams, actualTools,
    useNativeWebSearch, chatId, character, controller, encoder,
    preGeneratedAssistantMessageId, stop,
  } = opts

  const failedProfile = state.effectiveProfile
  const attempts: FallbackAttempt[] = [openingFailure]

  const chain = await buildFallbackChain(failedProfile, repos, {
    ...context,
    alreadyTried: [...context.alreadyTried, failedProfile.id],
  })

  const tierPickWasOffered = chain.some((c) => c.kind === 'tier-pick')

  for (const candidate of chain) {
    const understudy = candidate.profile

    const keyResolution = await resolveConnectionProfileApiKey(repos, understudy)
    if (!keyResolution.ok) {
      logger.warn('[Failover] Understudy has no usable API key; moving on', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        reason: keyResolution.reason,
      })
      attempts.push(recordAttempt(understudy, 'auth', new Error(keyResolution.reason)))
      continue
    }

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'failing-over',
      message: `${understudy.name} is standing in for ${character.name}...`,
      characterName: character.name,
      characterId: character.id,
    }))

    resetStreamingBuffersForSwap(state)

    try {
      await restreamInto(state, {
        connectionProfile: understudy,
        apiKey: keyResolution.apiKey,
        formattedMessages,
        modelParams,
        actualTools,
        useNativeWebSearch,
        userId: context.userId,
        chatId,
        character,
        controller,
        encoder,
        preGeneratedAssistantMessageId,
        stop,
      })
    } catch (understudyError) {
      const understudyTrigger = classifyFallbackTrigger(understudyError) ?? 'provider-error'
      attempts.push(recordAttempt(understudy, understudyTrigger, understudyError))
      logger.warn('[Failover] Understudy also failed', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        provider: understudy.provider,
        model: understudy.modelName,
        kind: candidate.kind,
        trigger: understudyTrigger,
        error: understudyError instanceof Error ? understudyError.message : String(understudyError),
      })
      continue
    }

    if (state.fullResponse.trim().length === 0) {
      attempts.push(recordAttempt(understudy, 'empty-response', new Error('empty response')))
      logger.warn('[Failover] Understudy returned an empty response', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        kind: candidate.kind,
      })
      continue
    }

    state.effectiveProfile = understudy
    state.effectiveApiKey = keyResolution.apiKey

    logger.info('[Failover] Understudy answered', {
      chatId,
      understudyId: understudy.id,
      understudyName: understudy.name,
      provider: understudy.provider,
      model: understudy.modelName,
      kind: candidate.kind,
      responseLength: state.fullResponse.length,
      failedAttemptsBefore: attempts.length,
    })

    return { recovered: true, attempts, tierPickWasOffered }
  }

  logger.error('[Failover] Fallback chain exhausted', {
    chatId,
    profileId: failedProfile.id,
    purpose: context.purpose,
    tierPickWasOffered,
    attempts: attempts.map((a) => ({
      profileName: a.profileName,
      provider: a.provider,
      trigger: a.trigger,
    })),
  })

  resetStreamingBuffersForSwap(state)

  return { recovered: false, attempts, tierPickWasOffered }
}

export interface AttemptHardErrorFailoverOptions extends WalkFallbackChainOptions {
  /** The error that ended the primary attempt. */
  error: unknown
}

/**
 * Walk the effective profile's fallback chain after a hard error.
 *
 * Returns `recovered: false` with no attempts when the failure is not
 * fallback-eligible — a token-limit overrun, a tool-unsupported rejection, one
 * of our own validation bugs — so the caller rethrows exactly as it did before
 * this feature existed.
 *
 * **Only runs before the first content chunk.** Once prose has reached the
 * user, a partial answer is worth more than a substituted one: the client has
 * already rendered the text, and `preservePartialOnError` will save it with an
 * OOC marker explaining the abrupt end. Nearly every hard error worth failing
 * over for — auth, rate limit, model-missing, connection refused — arrives
 * before a single token does.
 */
export async function attemptHardErrorFailover(
  opts: AttemptHardErrorFailoverOptions
): Promise<FallbackChainResult> {
  const { state, error, chatId, context } = opts
  const trigger = classifyFallbackTrigger(error)

  if (!trigger) {
    logger.debug('[Failover] Error is not fallback-eligible; leaving it to the caller', {
      chatId,
      profileId: state.effectiveProfile.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return { recovered: false, attempts: [], tierPickWasOffered: false }
  }

  if (state.hasStartedStreaming) {
    logger.info('[Failover] Skipping chain: content already reached the user', {
      chatId,
      profileId: state.effectiveProfile.id,
      trigger,
      partialLength: state.fullResponse.length,
    })
    return { recovered: false, attempts: [], tierPickWasOffered: false }
  }

  logger.warn('[Failover] Primary call failed; walking the fallback chain', {
    chatId,
    profileId: state.effectiveProfile.id,
    provider: state.effectiveProfile.provider,
    model: state.effectiveProfile.modelName,
    trigger,
    purpose: context.purpose,
    error: error instanceof Error ? error.message : String(error),
  })

  return walkFallbackChain(opts, recordAttempt(state.effectiveProfile, trigger, error))
}

/**
 * Walk the effective profile's fallback chain after an *empty* response.
 *
 * Runs last in the empty-response order — after the same-profile retry and,
 * in Auto-Route territory, after the uncensored reroute. Those two come first
 * on purpose: an empty body is usually transient, and when it isn't it is
 * usually a refusal, which is a content problem the uncensored profile exists
 * to answer. Only once both have come back empty is it worth concluding the
 * route itself is no good and calling for the understudy.
 *
 * Note this runs against `state.effectiveProfile`, which by then may be the
 * *uncensored* profile rather than the one the chat started with — that
 * profile carries its own `fallbackProfileId`/`allowTierFallback`, and its
 * chain runs with `dangerous: true` so tier picks stay cleared for the
 * content.
 */
export async function attemptEmptyResponseChainFallback(
  opts: WalkFallbackChainOptions
): Promise<FallbackChainResult> {
  const { state, chatId, context } = opts

  logger.warn('[Failover] Empty response survived local recovery; walking the fallback chain', {
    chatId,
    profileId: state.effectiveProfile.id,
    provider: state.effectiveProfile.provider,
    model: state.effectiveProfile.modelName,
    purpose: context.purpose,
    dangerous: context.dangerous,
  })

  return walkFallbackChain(
    opts,
    recordAttempt(state.effectiveProfile, 'empty-response', new Error('empty response'))
  )
}
