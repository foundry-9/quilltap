/**
 * Shared execution pipeline for cheap LLM tasks.
 */

import { createLLMProvider } from '@/lib/llm'
import type { LLMMessage, LLMResponse } from '@/lib/llm/base'
import { buildCharacterCacheKey } from '@/lib/llm/cache-key'
import { profileParams, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/promise-timeout'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import type { CheapLLMTaskResult, UncensoredFallbackOptions } from './types'

/**
 * Internal type for provider response
 */
interface ProviderResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Wall-clock budget for a single cheap-LLM attempt against a remote provider.
 *
 * Cheap tasks are small — a few hundred completion tokens — and several of them
 * (the memory recap in particular) are awaited *inline* on a user-visible turn.
 * Provider SDKs default to a 10-minute request timeout, so a provider that
 * accepts the connection and then never answers wedges the whole turn behind it
 * with no log output. This budget abandons the attempt instead: the task fails
 * soft, its caller drops the optional content, and the turn moves on.
 */
export const CHEAP_LLM_TASK_TIMEOUT_MS = 45_000

/**
 * Longer budget for local providers (Ollama and friends), where a cold model
 * load or a CPU-bound machine can legitimately take far longer than a remote
 * API would. A local endpoint that is merely slow is still working.
 */
export const CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS = 180_000

/**
 * How far inside the caller's deadline the provider's own budget sits.
 *
 * The provider should give up first so the failure arrives as an ordinary
 * provider error with the socket closed, rather than as our deadline firing
 * while an orphaned request runs on.
 */
const PROVIDER_BUDGET_HEADROOM_MS = 5_000

/** The hard per-request budget handed to the provider for a given selection. */
function providerBudgetFor(selection: CheapLLMSelection): number {
  const deadline = selection.isLocal ? CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS : CHEAP_LLM_TASK_TIMEOUT_MS
  return deadline - PROVIDER_BUDGET_HEADROOM_MS
}

/**
 * Error thrown when a cheap-LLM attempt exceeds its deadline. Distinct from a
 * provider error so callers (and the logs) can tell "the provider never
 * answered" apart from "the provider said no".
 */
export class CheapLLMTimeoutError extends Error {
  constructor(public readonly timeoutMs: number, taskType?: string) {
    super(`Cheap LLM task${taskType ? ` (${taskType})` : ''} exceeded its ${timeoutMs}ms budget`)
    this.name = 'CheapLLMTimeoutError'
  }
}

/**
 * Bounds a cheap-LLM attempt by its deadline, and says so in the log when it
 * fires — a stall used to be completely silent, which is what made the original
 * incident so hard to see.
 *
 * The abandoned request is left to finish on its own; the provider SDK owns its
 * socket and gives up on its own schedule. We only stop *waiting* on it, which
 * is the part that blocks the turn.
 */
async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  taskType: string | undefined,
  context: Record<string, unknown>
): Promise<T> {
  const startedAt = Date.now()

  // The abandoned attempt must not surface as an unhandled rejection when it
  // eventually fails on its own, long after we stopped listening.
  void work.catch(() => {})

  try {
    return await withTimeout(work, timeoutMs, () => new CheapLLMTimeoutError(timeoutMs, taskType))
  } catch (error) {
    if (error instanceof CheapLLMTimeoutError) {
      logger.warn('[CheapLLM] Abandoned a stalled provider call', {
        ...context,
        taskType,
        timeoutMs,
        elapsed: Date.now() - startedAt,
      })
    }
    throw error
  }
}

/**
 * Session-level cache for profiles that don't support custom temperature
 */
const profilesWithoutCustomTemp = new Set<string>()

/**
 * Maps a cheap LLM task type to an LLM log type for logging
 */
function mapTaskTypeToLogType(taskType?: string): LLMLogType {
  const mapping: Record<string, LLMLogType> = {
    'memory-extraction-self': 'MEMORY_EXTRACTION',
    'memory-extraction-other': 'MEMORY_EXTRACTION',
    'batch-memory-extraction': 'MEMORY_EXTRACTION',
    'memory-keyword-extraction': 'MEMORY_EXTRACTION',
    'title-chat': 'TITLE_GENERATION',
    'title-from-summary': 'TITLE_GENERATION',
    'consider-title-update': 'TITLE_GENERATION',
    'compress-conversation-history': 'CONTEXT_COMPRESSION',
    'compress-system-prompt': 'CONTEXT_COMPRESSION',
    'compress-memories': 'CONTEXT_COMPRESSION',
    'summarize-chat': 'SUMMARIZATION',
    'update-context-summary': 'SUMMARIZATION',
    'fold-chat-summary': 'SUMMARIZATION',
    'memory-recap-summarization': 'SUMMARIZATION',
    'derive-scene-context': 'SUMMARIZATION',
    'outfit-selection': 'SUMMARIZATION',
    'craft-image-prompt': 'IMAGE_PROMPT_CRAFTING',
    'craft-story-background-prompt': 'IMAGE_PROMPT_CRAFTING',
    'describe-attachment': 'IMAGE_DESCRIPTION',
    'resolve-character-appearances': 'APPEARANCE_RESOLUTION',
    'sanitize-appearance': 'APPEARANCE_RESOLUTION',
    'scene-state-tracking': 'SCENE_STATE_TRACKING',
    'answer-confirmation': 'ANSWER_CONFIRMATION',
    'answer-reaffirmation': 'ANSWER_CONFIRMATION',
    'custom-tool-consult': 'CUSTOM_TOOL_CONSULT',
  }
  return mapping[taskType || ''] || 'SUMMARIZATION'
}

/**
 * Sends messages to a cheap LLM provider with temperature handling and logging
 * Extracted from executeCheapLLMTask to avoid tripling the code for each temperature path
 */
async function sendToProvider(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  maxTokens?: number,
  characterId?: string
): Promise<ProviderResponse> {
  const apiKey = await getApiKeyForCheapLLMSelection(selection, userId)
  if (apiKey === null) {
    throw new Error('No API key available for cheap LLM provider')
  }

  const provider = await createLLMProvider(
    selection.provider,
    selection.baseUrl
  )

  const profileKey = `${selection.provider}:${selection.modelName}`
  const effectiveMaxTokens = Math.max(maxTokens ?? 2048, 2048)

  // `durationMs` is the wall-clock of the provider call this row describes.
  // This shared path covers MEMORY_EXTRACTION, TITLE_GENERATION, SUMMARIZATION,
  // CONTEXT_COMPRESSION, SCENE_STATE_TRACKING and IMAGE_PROMPT_CRAFTING — a
  // large share of all llm_logs rows — so leaving it null used to hollow out
  // every latency average the Almanack draws.
  const logCall = (response: LLMResponse, temperature: number | undefined, durationMs: number) => {
    logLLMCall({
      userId,
      type: mapTaskTypeToLogType(taskType),
      chatId,
      messageId,
      characterId,
      provider: selection.provider,
      modelName: selection.modelName,
      connectionProfileId: selection.connectionProfileId ?? null,
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens: effectiveMaxTokens,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('Failed to log cheap LLM call', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  // Cheap LLM tasks use strictMaxTokens to prevent providers from applying
  // model-specific minimums (e.g. reasoning model floors) that would cause
  // unnecessary verbosity and latency for background tasks
  const strictMaxTokens = true
  const cacheKey = buildCharacterCacheKey(characterId)

  const baseParams = {
    messages,
    model: selection.modelName,
    maxTokens: effectiveMaxTokens,
    strictMaxTokens,
    cacheKey,
    profileParameters: selection.profileParameters,
    // Give the provider a hard budget of its own, slightly inside the caller's
    // deadline, so a stalled request is aborted at the socket rather than left
    // running while we walk away from it. `withDeadline` remains the backstop
    // for providers that ignore this.
    requestTimeoutMs: providerBudgetFor(selection),
  }

  // Check if we already know this profile doesn't support custom temperature
  if (profilesWithoutCustomTemp.has(profileKey)) {
    const startedAt = Date.now()
    const response: LLMResponse = await provider.sendMessage(baseParams, apiKey)
    logCall(response, undefined, Date.now() - startedAt)
    return { content: response.content, usage: response.usage }
  }

  // Try with lower temperature for more consistent outputs
  const firstAttemptStartedAt = Date.now()
  try {
    const response: LLMResponse = await provider.sendMessage({ ...baseParams, temperature: 0.3 }, apiKey)
    logCall(response, 0.3, Date.now() - firstAttemptStartedAt)
    return { content: response.content, usage: response.usage }
  } catch (error) {
    // If temperature is not supported, cache it and retry with default temperature
    const errorMessage = getErrorMessage(error, '')
    if (errorMessage.includes('temperature') || errorMessage.includes('does not support')) {
      profilesWithoutCustomTemp.add(profileKey)

      const retryStartedAt = Date.now()
      const response: LLMResponse = await provider.sendMessage(baseParams, apiKey)
      logCall(response, undefined, Date.now() - retryStartedAt)
      return { content: response.content, usage: response.usage }
    }
    throw error
  }
}

/**
 * Checks if an uncensored fallback should be attempted for an empty response
 * Returns a CheapLLMSelection for the uncensored provider, or null if fallback should not be attempted
 */
function shouldAttemptUncensoredFallback(
  responseContent: string,
  currentSelection: CheapLLMSelection,
  uncensoredFallback?: UncensoredFallbackOptions
): CheapLLMSelection | null {
  // No fallback if response is not empty
  if (responseContent.trim() !== '') return null

  // No fallback options provided
  if (!uncensoredFallback) return null

  const { dangerSettings, availableProfiles } = uncensoredFallback

  // Only attempt in AUTO_ROUTE mode
  if (dangerSettings.mode !== 'AUTO_ROUTE') return null

  // Need an uncensored text profile configured
  if (!dangerSettings.uncensoredTextProfileId) return null

  // Check if current profile is already dangerous-compatible
  // For dangerous chats, allow uncensored→uncensored fallback on empty (the configured
  // fallback provider may be more reliable than the current one)
  const currentProfile = availableProfiles.find(p => p.id === currentSelection.connectionProfileId)
  if (currentProfile?.isDangerousCompatible && !uncensoredFallback?.isDangerousChat) return null

  // Find the uncensored profile
  const uncensoredProfile = availableProfiles.find(p => p.id === dangerSettings.uncensoredTextProfileId)
  if (!uncensoredProfile) return null

  // Build a CheapLLMSelection for the uncensored profile
  return {
    provider: uncensoredProfile.provider,
    modelName: uncensoredProfile.modelName,
    baseUrl: uncensoredProfile.baseUrl || undefined,
    connectionProfileId: uncensoredProfile.id,
    isLocal: false,
    profileParameters: profileParams(uncensoredProfile),
  }
}

/**
 * Executes a cheap LLM task with the given messages
 */
export async function executeCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  maxTokens?: number,
  characterId?: string
): Promise<CheapLLMTaskResult<T>> {
  // Each attempt gets its own budget rather than sharing one across the task:
  // the uncensored fallback below only fires after a *completed* call came back
  // empty, so it is a fresh attempt and deserves a fresh deadline.
  const deadlineFor = (s: CheapLLMSelection) =>
    s.isLocal ? CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS : CHEAP_LLM_TASK_TIMEOUT_MS

  try {
    let response = await withDeadline(
      sendToProvider(selection, messages, userId, taskType, chatId, messageId, maxTokens, characterId),
      deadlineFor(selection),
      taskType,
      { chatId, characterId, provider: selection.provider, model: selection.modelName }
    )

    // Check if we should retry with an uncensored provider
    const uncensoredSelection = shouldAttemptUncensoredFallback(response.content, selection, uncensoredFallback)
    if (uncensoredSelection) {
      logger.warn('[CheapLLM] Empty response detected, retrying with uncensored provider', {
        taskType,
        chatId,
        originalProvider: selection.provider,
        originalModel: selection.modelName,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
      })

      const retryResponse = await withDeadline(
        sendToProvider(uncensoredSelection, messages, userId, taskType, chatId, messageId, maxTokens, characterId),
        deadlineFor(uncensoredSelection),
        taskType,
        { chatId, characterId, provider: uncensoredSelection.provider, model: uncensoredSelection.modelName }
      )

      if (retryResponse.content.trim() === '') {
        throw new Error(`Empty response from both safe provider (${selection.provider}/${selection.modelName}) and uncensored provider (${uncensoredSelection.provider}/${uncensoredSelection.modelName})`)
      }

      logger.info('[CheapLLM] Uncensored fallback succeeded', {
        taskType,
        chatId,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
        responseLength: retryResponse.content.length,
      })

      response = retryResponse
    }

    const result = parseResponse(response.content)

    return {
      success: true,
      result,
      usage: response.usage,
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    }
  }
}
