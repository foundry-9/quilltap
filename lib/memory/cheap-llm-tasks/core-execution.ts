/**
 * Shared execution pipeline for cheap LLM tasks.
 */

import { createLLMProvider } from '@/lib/llm'
import type { LLMMessage, LLMResponse } from '@/lib/llm/base'
import { buildCharacterCacheKey } from '@/lib/llm/cache-key'
import { selectionFromProfile, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/promise-timeout'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import type { CheapLLMTaskResult, UncensoredFallbackOptions } from './types'
import { classifyFallbackTrigger } from '@/lib/llm/fallback'
import { buildCheapFallbackSelections } from './fallback'
import { trackActivity } from '@/lib/background-jobs/activity-registry'
import type { ActivityKind } from '@/lib/background-jobs/activity-kinds'

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
 *
 * **Set from the observed distribution, not from a round number** (bug 107).
 * The old 45s — a 40s provider budget after headroom — looked generous until
 * the `[CheapLLM] Task failed` counter made the losses visible. Across 1,971
 * completed non-compression calls on a live instance, not one had ever taken
 * more than 40,000 ms, and three separate task types peaked within 600 ms of
 * the wall: `MEMORY_EXTRACTION` at 39,936, `ANSWER_CONFIRMATION` at 39,789,
 * `SCENE_STATE_TRACKING` at 39,461. That is not a distribution, it is a
 * censored one — the maxima were the budget, not the work, and 61 of the 81
 * losses in the counter's first 60 hours landed under this tier.
 *
 * The true tail is therefore unknown, so this is deliberately set well clear
 * of it rather than just past the old wall: the point is to stop cutting the
 * curve so the histogram can be re-read honestly. It stays a real ceiling —
 * a provider that accepts and never answers is still abandoned, just not one
 * that is merely slow.
 */
export const CHEAP_LLM_TASK_TIMEOUT_MS = 90_000

/**
 * The same tier's budget when a human is waiting on the call.
 *
 * A handful of cheap tasks are awaited *inline* while a turn is being
 * assembled — the memory recap, the two memory compressions, the
 * cache-miss context compression — and there the budget is not protecting the
 * work, it is protecting the person watching "Recalling…". All of them produce
 * optional context: losing one costs the character some remembered flavour,
 * not the turn. So the generous background ceiling above would be spent in
 * exactly the place it should not be, and these keep the old 45s instead.
 *
 * This is the same asymmetry the compression override draws, generalised: the
 * ceiling should follow *who is waiting*, not only *which task it is*.
 */
export const CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS = 45_000

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

/**
 * Whether a human is waiting on this call.
 *
 * The two are budgeted differently on purpose (bug 107). Almost every cheap
 * task runs off the turn's critical path, where a generous ceiling costs
 * nothing but a slow background pass — and a stingy one permanently loses the
 * work, because there is no downstream retry. Compression is the exception:
 * it is pre-computed when a cached result is available and falls back to a
 * *synchronous inline* call when it isn't, and there the whole budget is
 * latency the operator sits through. One number cannot serve both.
 *
 * Callers that don't say default to `background`, which is what the great
 * majority of them are. Only the inline compression path declares `interactive`.
 */
export type CheapLLMLatencyClass = 'background' | 'interactive'

/**
 * Options bag for the trailing, rarely-set knobs on a cheap-LLM task.
 * Positional parameters ran out long ago; anything new goes here.
 */
export interface CheapLLMTaskOptions {
  /** Whether a human is waiting on this call. Defaults to `background`. */
  latency?: CheapLLMLatencyClass
}

/**
 * Per-task deadline overrides, keyed by the granular task type, then by
 * whether anyone is waiting.
 *
 * The default budget suits a cheap task whose prompt is a slice of a turn.
 * Compression is not that shape: it carries the whole conversation history, so
 * it is structurally the largest prompt any cheap task sends and it sits at the
 * slow end of the distribution as a matter of course, not as a stall.
 *
 * The numbers come from the measured curve rather than from round figures.
 * Over 256 `CONTEXT_COMPRESSION` calls on a live instance: p50 24.3s, p95
 * 49.6s, **p99 61.1s, max 67,733 ms** — against a 70s ceiling. A budget set
 * below its own task's p99 converts slow-but-healthy calls into permanent
 * losses at exactly the rate the tail crosses it, which is what the 20
 * `compress-conversation-history` failures in the counter's first 60 hours
 * were.
 *
 * `background` therefore clears that p99 with room to spare. `interactive`
 * keeps the old 75s, because there the ceiling is not protecting the work, it
 * is protecting the person watching an empty composer — and an uncompressed
 * history still produces a turn.
 */
const CHEAP_LLM_TASK_TIMEOUT_OVERRIDES_MS: Record<string, Record<CheapLLMLatencyClass, number>> = {
  'compress-conversation-history': { background: 120_000, interactive: 75_000 },
  'compress-system-prompt': { background: 120_000, interactive: 75_000 },
  'compress-memories': { background: 120_000, interactive: 75_000 },
}

/**
 * The deadline for one attempt. Local providers keep their own (larger) budget
 * regardless of task — a cold model load dwarfs any per-task difference.
 */
export function deadlineFor(
  selection: CheapLLMSelection,
  taskType?: string,
  latency: CheapLLMLatencyClass = 'background'
): number {
  if (selection.isLocal) return CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS
  const override = CHEAP_LLM_TASK_TIMEOUT_OVERRIDES_MS[taskType ?? '']
  if (override) return override[latency]
  return latency === 'interactive'
    ? CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS
    : CHEAP_LLM_TASK_TIMEOUT_MS
}

/** The hard per-request budget handed to the provider for a given attempt. */
function providerBudgetFor(
  selection: CheapLLMSelection,
  taskType?: string,
  latency: CheapLLMLatencyClass = 'background'
): number {
  return deadlineFor(selection, taskType, latency) - PROVIDER_BUDGET_HEADROOM_MS
}

/**
 * Did this attempt end because nobody answered in time?
 *
 * Two shapes mean the same thing and must be told apart from "the provider
 * said no": our own deadline firing, and the provider abandoning the socket on
 * the budget we handed it. The second is by far the more common — the
 * `withDeadline` backstop fired zero times across the whole window that
 * produced bug 107, because `requestTimeoutMs` always gives up first, by
 * design. Both are transient and worth one more attempt; a refusal, a parse
 * failure or a bad key is neither.
 */
export function isTimeoutFailure(error: unknown): boolean {
  if (error instanceof CheapLLMTimeoutError) return true
  const name = error instanceof Error ? error.name : ''
  if (name === 'CheapLLMTimeoutError' || name === 'AbortError' || name === 'TimeoutError') return true
  return /timed?\s?out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(getErrorMessage(error, ''))
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
  characterId?: string,
  latency: CheapLLMLatencyClass = 'background'
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
    requestTimeoutMs: providerBudgetFor(selection, taskType, latency),
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
  return selectionFromProfile(uncensoredProfile)
}

/**
 * Which toolbar chip each cheap-LLM task lights.
 *
 * Every cheap-LLM task funnels through {@link executeCheapLLMTask}, so this is
 * the one place that has to know. A task type absent from the map falls back to
 * "summary" rather than going uncounted — a chip that is slightly generous is
 * better than a chip that quietly lies.
 */
const TASK_TYPE_ACTIVITY: Record<string, ActivityKind> = {
  // Image pipelines — prompt crafting and appearance work is part of the image
  // the user is waiting on, so it belongs inside the same span.
  'craft-image-prompt': 'image',
  'craft-story-background-prompt': 'image',
  'derive-scene-context': 'image',
  'resolve-character-appearances': 'image',
  'sanitize-appearance': 'image',
  'describe-attachment': 'image',
  'outfit-selection': 'image',

  // the Commonplace Book
  'memory-extraction-self': 'memory',
  'memory-extraction-other': 'memory',
  'batch-memory-extraction': 'memory',
  'fold-episode-extraction': 'memory',
  'memory-keyword-extraction': 'memory',
  'memory-recap-summarization': 'memory',

  // Summarization and post-turn processing
  'fold-chat-summary': 'summary',
  'summarize-chat': 'summary',
  'update-context-summary': 'summary',
  'consider-title-update': 'summary',
  'consider-help-chat-title-update': 'summary',
  'scene-state-tracking': 'summary',
  'compress-conversation-history': 'summary',
  'compress-memories': 'summary',
  'compress-system-prompt': 'summary',
}

function activityKindForTask(taskType?: string): ActivityKind {
  return (taskType && TASK_TYPE_ACTIVITY[taskType]) || 'summary'
}

/**
 * Executes a cheap LLM task with the given messages
 *
 * Registers the call with the activity registry for its whole duration, so a
 * cheap-LLM task lights its chip whether it was queued as a job or run inline
 * in a request. Re-entrant by kind: a task running inside a job of the same
 * kind collapses into that job's count instead of doubling it.
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
  characterId?: string,
  options?: CheapLLMTaskOptions
): Promise<CheapLLMTaskResult<T>> {
  return trackActivity(activityKindForTask(taskType), () =>
    runCheapLLMTask(
      selection,
      messages,
      userId,
      parseResponse,
      taskType,
      chatId,
      messageId,
      uncensoredFallback,
      maxTokens,
      characterId,
      options
    )
  )
}

async function runCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  maxTokens?: number,
  characterId?: string,
  options?: CheapLLMTaskOptions
): Promise<CheapLLMTaskResult<T>> {
  // Each attempt gets its own budget rather than sharing one across the task:
  // the uncensored fallback below only fires after a *completed* call came back
  // empty, so it is a fresh attempt and deserves a fresh deadline.
  const latency: CheapLLMLatencyClass = options?.latency ?? 'background'

  const attempt = (route: CheapLLMSelection) =>
    withDeadline(
      sendToProvider(route, messages, userId, taskType, chatId, messageId, maxTokens, characterId, latency),
      deadlineFor(route, taskType, latency),
      taskType,
      { chatId, characterId, provider: route.provider, model: route.modelName }
    )

  try {
    let response: ProviderResponse
    try {
      response = await attempt(selection)
    } catch (firstError) {
      // One more go at a fresh socket, and only for a timeout.
      //
      // A timed-out cheap pass is permanently lost otherwise: the SDK is given
      // `maxRetries: 0`, nothing downstream re-queues the work, and the job
      // that asked for it goes on to report a clean finish. A second attempt
      // costs one call and recovers most of a fat-tail miss, which is the
      // cheapest half of bug 107's fix.
      //
      // Not on the interactive path: there the operator is already waiting out
      // the budget, and doubling it to rescue an optimisation they would never
      // have noticed missing is the wrong trade.
      if (!isTimeoutFailure(firstError) || latency === 'interactive') throw firstError

      logger.warn('[CheapLLM] Attempt timed out; retrying the same route once', {
        taskType,
        chatId,
        characterId,
        provider: selection.provider,
        model: selection.modelName,
        budgetMs: deadlineFor(selection, taskType, latency),
        error: getErrorMessage(firstError),
      })
      response = await attempt(selection)
    }

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

      const retryResponse = await attempt(uncensoredSelection)

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
    // Say so in the server log. `withDeadline` already reports the case where
    // *our* deadline fires, but a provider giving up on its own budget arrives
    // here as an ordinary provider error — and the plugin's own log line names
    // the provider without naming the task, so a timed-out extraction pass was
    // legible only in the debug logs stored on the message. One line here ties
    // the two together.
    logger.warn('[CheapLLM] Task failed', {
      taskType,
      chatId,
      characterId,
      provider: selection.provider,
      model: selection.modelName,
      error: getErrorMessage(error),
    })

    const fallbackResult = await attemptCheapFallbackChain(
      selection, messages, userId, parseResponse, error,
      { taskType, chatId, messageId, maxTokens, characterId, uncensoredFallback, latency }
    )
    if (fallbackResult) return fallbackResult

    // Say *how* it was lost, not just that it was. A refusal or a parse
    // failure is a finished pass with a disappointing answer; a timeout is
    // work that never happened, and a caller that treats the two alike reports
    // a clean finish over a hole in the data (bug 107).
    return {
      success: false,
      error: getErrorMessage(error),
      timedOut: isTimeoutFailure(error),
    }
  }
}

/**
 * Walk the failed route's fallback chain, re-issuing the task against each
 * stand-in with a **fresh deadline**.
 *
 * A fresh budget per attempt, not a shared one: the whole reason we are here
 * is that the previous route spent its budget without answering, and charging
 * the understudy for that would guarantee it fails too. This mirrors what the
 * uncensored empty-response fallback above already does.
 *
 * Returns null when nothing was attempted or nothing worked, leaving the
 * caller to fail exactly as it did before this feature existed. Background
 * work never toasts — the job logs its attempt trail and moves on.
 */
async function attemptCheapFallbackChain<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  error: unknown,
  meta: {
    taskType?: string
    chatId?: string
    messageId?: string
    maxTokens?: number
    characterId?: string
    uncensoredFallback?: UncensoredFallbackOptions
    latency: CheapLLMLatencyClass
  }
): Promise<CheapLLMTaskResult<T> | null> {
  const { taskType, chatId, messageId, maxTokens, characterId, uncensoredFallback, latency } = meta

  const trigger = classifyFallbackTrigger(error)
  if (!trigger) {
    logger.debug('[CheapLLM] Failure is not fallback-eligible', {
      taskType,
      chatId,
      error: getErrorMessage(error),
    })
    return null
  }

  let standIns: CheapLLMSelection[]
  try {
    standIns = await buildCheapFallbackSelections({
      selection,
      userId,
      // A stand-in for an uncensored route must itself be cleared for the
      // content, or the fallback hands it back to the moderation that refused.
      dangerous:
        uncensoredFallback?.isDangerousChat === true ||
        uncensoredFallback?.availableProfiles.find(
          (p) => p.id === selection.connectionProfileId
        )?.isDangerousCompatible === true,
      alreadyTried: selection.connectionProfileId ? [selection.connectionProfileId] : [],
      taskType,
    })
  } catch (chainError) {
    logger.warn('[CheapLLM] Could not build a fallback chain', {
      taskType,
      chatId,
      error: getErrorMessage(chainError),
    })
    return null
  }

  if (standIns.length === 0) return null

  for (const standIn of standIns) {
    logger.info('[CheapLLM] Retrying task with a stand-in', {
      taskType,
      chatId,
      trigger,
      failedProvider: selection.provider,
      failedModel: selection.modelName,
      standInProvider: standIn.provider,
      standInModel: standIn.modelName,
      standInProfileId: standIn.connectionProfileId,
    })

    try {
      const response = await withDeadline(
        sendToProvider(standIn, messages, userId, taskType, chatId, messageId, maxTokens, characterId, latency),
        deadlineFor(standIn, taskType, latency),
        taskType,
        { chatId, characterId, provider: standIn.provider, model: standIn.modelName }
      )

      if (response.content.trim() === '') {
        logger.warn('[CheapLLM] Stand-in returned an empty response', {
          taskType,
          chatId,
          standInProvider: standIn.provider,
          standInModel: standIn.modelName,
        })
        continue
      }

      const result = parseResponse(response.content)

      logger.info('[CheapLLM] Stand-in answered', {
        taskType,
        chatId,
        standInProvider: standIn.provider,
        standInModel: standIn.modelName,
        responseLength: response.content.length,
      })

      return { success: true, result, usage: response.usage }
    } catch (standInError) {
      logger.warn('[CheapLLM] Stand-in also failed', {
        taskType,
        chatId,
        standInProvider: standIn.provider,
        standInModel: standIn.modelName,
        error: getErrorMessage(standInError),
      })
    }
  }

  logger.warn('[CheapLLM] Fallback chain exhausted', {
    taskType,
    chatId,
    trigger,
    failedProvider: selection.provider,
    failedModel: selection.modelName,
    standInsTried: standIns.length,
  })

  return null
}

/**
 * Raised when a cheap-LLM pass was lost to a timeout and its caller cannot do
 * its job without it. Carries the task type so the job's `lastError` names the
 * pass rather than the provider.
 */
export class CheapLLMTaskLostError extends Error {
  constructor(taskType: string, providerError?: string) {
    super(
      `Cheap LLM task "${taskType}" timed out and was not retried successfully${providerError ? `: ${providerError}` : ''}`
    )
    this.name = 'CheapLLMTaskLostError'
  }
}

/**
 * Throw when a background job's cheap-LLM pass was lost to a timeout.
 *
 * The half of bug 107 that makes the other half measurable. A cheap task that
 * times out returns an unsuccessful result, and every job handler treated that
 * the same way it treats a refusal: log a warning, return, and be marked
 * COMPLETED. So the memory that was never extracted and the scene state that
 * was never derived looked, from every counter the operator has, exactly like
 * work that finished — 83 `MEMORY_EXTRACTION` and 99 `SCENE_STATE_TRACKING`
 * jobs COMPLETED in a window that lost 33 extraction passes and 12 scene ones.
 *
 * Throwing hands the job to `markFailed`, which already does the right thing:
 * exponential backoff, a retry, and DEAD with the reason attached once the
 * attempts run out. That is a third attempt at the pass on top of the
 * same-route retry, at no new machinery.
 *
 * **Only for timeouts.** A refusal, an unparseable answer or a missing key
 * would fail identically on every retry, and re-queuing those would spend the
 * backoff learning nothing. Those keep the old behaviour: log, return, done.
 */
export function throwIfLostToTimeout(
  result: Pick<CheapLLMTaskResult<unknown>, 'success' | 'timedOut' | 'error'>,
  taskType: string
): void {
  if (result.success || !result.timedOut) return
  throw new CheapLLMTaskLostError(taskType, result.error)
}
