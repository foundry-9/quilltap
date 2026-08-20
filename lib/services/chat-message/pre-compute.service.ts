/**
 * Pre-Compute Service
 *
 * Runs the two pre-context-build tasks the orchestrator needs in parallel:
 *
 *   1. Compression cache check — see if the cheap LLM already produced a
 *      compressed history for this chat at the current message count.
 *   2. Proactive memory recall — extract keywords from messages since the
 *      character last spoke, then semantic-search this character's memories.
 *
 * Both feed into `buildMessageContext`. The service also sets up a 15-second
 * keep-alive ping interval so proxies/load balancers don't drop the SSE
 * connection during long compression. The interval is only armed when
 * compression is enabled AND the cache miss path is taken; the caller is
 * handed a `stopKeepAlive` callback to release it after `buildMessageContext`
 * returns (and after any error path).
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeKeepAlive,
  encodeStatusEvent,
  safeEnqueue,
} from './streaming.service'
import {
  getCachedCompression,
  invalidateCompressionCache,
  type CachedCompressionResponse,
} from './compression-cache.service'
import { extractMemorySearchKeywords, extractVisibleConversation, stripToolArtifacts, type MemorySearchExtraction } from '@/lib/memory/cheap-llm-tasks'
import {
  searchMemoriesSemantic,
  type SemanticSearchResult,
  type SearchQueryEmbedding,
} from '@/lib/memory/memory-service'
import type { RecallContext } from '@/lib/memory/recall-tags'
import { recentlyWhisperedIdSet } from '@/lib/memory/recall-history'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override'

import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ChatMetadataBase, Character, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ChatEvent } from '@/lib/schemas/chat.types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('PreContextPreCompute')

export interface RunPreContextPreComputeOptions {
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string }
  isMultiCharacter: boolean
  /**
   * IDs of the characters present in the room this turn (responding character +
   * other character participants). Threaded into the recall context so the
   * proactive path applies the same participant-aware boost (item 4) the dynamic
   * head does. Empty/undefined → no participant boost.
   */
  presentAboutCharacterIds?: readonly string[]
  isContinueMode: boolean
  /** Verbatim user-message text for this turn (empty in continue mode). */
  content: string
  existingMessages: ChatEvent[]
  compressionEnabled: boolean
  bypassCompression: boolean
  cheapLLMSelection: CheapLLMSelection | null
  dangerSettings: DangerousContentSettings
  allProfiles: ConnectionProfile[]
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

export interface PreContextPreComputeResult {
  cachedCompressionResponse: CachedCompressionResponse | undefined
  preSearchedMemories: SemanticSearchResult[] | undefined
  /**
   * The query text and vector the proactive memory search embedded. Threaded
   * into buildContext so the per-turn conversation-summary list (when the
   * instance-wide `memoryRecall.perTurnConversationSummaries` setting is on)
   * rides the same vector instead of paying for a second embedding call.
   * Undefined when the proactive path didn't run or its embedding failed.
   */
  preSearchedQueryEmbedding: SearchQueryEmbedding | undefined
  /**
   * The turn-level recall signals the proactive keyword distillation emitted
   * (retrospective / timeRange / entities / paraphrase). Threaded into
   * buildContext so the retrospective cadence (enlarged head + mini-recap)
   * fires without re-running the distillation. Undefined when the proactive
   * path didn't run or its extraction failed.
   */
  recallSignals: MemorySearchExtraction | undefined
  /** Caller MUST invoke after buildMessageContext returns (or on error)
   * to release the keep-alive interval. Idempotent. */
  stopKeepAlive: () => void
}

export async function runPreContextPreCompute(
  opts: RunPreContextPreComputeOptions
): Promise<PreContextPreComputeResult> {
  const [cachedCompressionResponse, recallOutcome] = await Promise.all([
    compressionTask(opts),
    proactiveRecallTask(opts),
  ])
  const preSearchedMemories = recallOutcome?.memories
  const recallSignals = recallOutcome?.signals
  const preSearchedQueryEmbedding = recallOutcome?.queryEmbedding

  // Keep-alive pings during the upcoming buildMessageContext (especially long
  // when compression is regenerating). Only armed when compression is enabled
  // AND we missed the cache — there's nothing slow to ping over otherwise.
  let keepAliveInterval: ReturnType<typeof setInterval> | null = null
  if (opts.compressionEnabled && !cachedCompressionResponse) {
    keepAliveInterval = setInterval(() => {
      if (!safeEnqueue(opts.controller, encodeKeepAlive(opts.encoder))) {
        // Stream closed — stop pinging.
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval)
          keepAliveInterval = null
        }
      }
    }, 15000)
  }

  return {
    cachedCompressionResponse,
    preSearchedMemories,
    recallSignals,
    preSearchedQueryEmbedding,
    stopKeepAlive: () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval)
        keepAliveInterval = null
      }
    },
  }
}

async function compressionTask(
  opts: RunPreContextPreComputeOptions
): Promise<CachedCompressionResponse | undefined> {
  const {
    chatId, character, characterParticipant, isMultiCharacter,
    existingMessages, compressionEnabled, bypassCompression,
    controller, encoder,
  } = opts

  if (compressionEnabled && !bypassCompression) {
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'compressing',
      message: 'Checking context cache...',
      characterName: character.name,
      characterId: character.id,
    }))

    // Count only visible USER/ASSISTANT messages — must match what
    // triggerAsyncCompression uses. A broader filter inflates the count
    // and causes the dynamic window to grow excessively.
    const visibleMessages = extractVisibleConversation(existingMessages)
    const actualMessageCount = visibleMessages.length
    const participantIdForCache = isMultiCharacter ? characterParticipant.id : undefined
    const result = await getCachedCompression(chatId, actualMessageCount, participantIdForCache)
    if (result) {
      logger.info('Using cached compression from async pre-computation', {
        chatId,
        messageCount: actualMessageCount,
        cachedMessageCount: result.cachedMessageCount,
        isFallback: result.isFallback,
        savings: result.result.compressionDetails?.totalSavings,
      })
    }
    return result
  } else if (bypassCompression) {
    invalidateCompressionCache(chatId)
  }
  return undefined
}

interface ProactiveRecallOutcome {
  memories: SemanticSearchResult[] | undefined
  signals: MemorySearchExtraction | undefined
  /** The vector this task embedded for `searchQuery`, for downstream reuse. */
  queryEmbedding: SearchQueryEmbedding | undefined
}

async function proactiveRecallTask(
  opts: RunPreContextPreComputeOptions
): Promise<ProactiveRecallOutcome | undefined> {
  const {
    chatId, userId, chat, character, characterParticipant,
    presentAboutCharacterIds, isContinueMode, content, existingMessages,
    cheapLLMSelection, dangerSettings, allProfiles,
    controller, encoder,
  } = opts

  if (!cheapLLMSelection || !character.id) return undefined

  // Filter to actual message events with proper type narrowing.
  const messageEvents = existingMessages
    .filter((m): m is MessageEvent => m.type === 'message' && 'role' in m && 'content' in m)

  // Find messages since this character last spoke.
  const characterMessages = messageEvents.filter(
    m => m.role === 'ASSISTANT' && m.participantId === characterParticipant.id
  )

  if (characterMessages.length === 0) {
    return undefined
  }

  const lastCharacterMessage = characterMessages[characterMessages.length - 1]
  const lastCharacterMessageIndex = messageEvents.lastIndexOf(lastCharacterMessage)
  const messagesSinceLastSpoke = messageEvents
    .slice(lastCharacterMessageIndex + 1)
    .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')

  // Include the new user message that was just saved but isn't in the
  // existingMessages snapshot.
  if (!isContinueMode && content) {
    messagesSinceLastSpoke.push({
      role: 'USER',
      content,
    } as MessageEvent)
  }

  if (messagesSinceLastSpoke.length === 0) {
    return undefined
  }

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'recalling_keywords',
    message: 'Analyzing recent conversation...',
    characterName: character.name,
    characterId: character.id,
  }))

  // For dangerous chats, use uncensored provider for keyword extraction.
  // Gate on the canonical accessor so an Off-duty chat never reroutes here,
  // independent of how `dangerSettings` was resolved upstream.
  let recallSelection = cheapLLMSelection
  if (isChatActiveDangerous(chat)) {
    recallSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      allProfiles
    )
  }

  // Extract keywords via cheap LLM, stripping tool artifacts from assistant
  // messages so the keyword extractor sees only narrative content.
  const keywordResult = await extractMemorySearchKeywords(
    messagesSinceLastSpoke.reduce<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>((acc, m) => {
      const role = m.role.toLowerCase() as 'user' | 'assistant' | 'system'
      if (role === 'assistant') {
        const cleaned = stripToolArtifacts(m.content || '')
        if (cleaned) acc.push({ role, content: cleaned })
      } else {
        acc.push({ role, content: m.content || '' })
      }
      return acc
    }, []),
    character.name,
    recallSelection,
    userId,
    chatId,
    character.id,
    // Episodic recall: the distillation resolves "last week" into an absolute
    // timeRange against this clock.
    {
      nowIso: new Date().toISOString(),
      timelineMode: chat.timelineMode ?? 'realtime',
    }
  )

  if (!keywordResult.success || !keywordResult.result || keywordResult.result.keywords.length === 0) {
    return undefined
  }
  const signals = keywordResult.result

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'recalling_memories',
    message: `Searching ${character.name}'s memories...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Prefer the natural-language paraphrase as the embedding query (item 3); a
  // keyword bag throws away the sentence structure the embedding model is
  // trained on. Fall back to the keyword join when the model omits a paraphrase.
  const searchQuery = keywordResult.result.paraphrase || keywordResult.result.keywords.join(' ')
  // Same per-turn recall context the dynamic head uses, so the proactive path
  // gets identical scope gating, temporal down-weighting, context steering,
  // participant boost, and anti-repetition (see lib/memory/recall-tags.ts).
  // chat.projectId is the rename-proof comparand; the turn's temporal/context
  // guess and present-character set drive items 3–4.
  const recallSettings = await getMemoryRecallSettings()
  const retrospective = signals.retrospective === true
  const recallContext: RecallContext = {
    currentProjectId: chat.projectId ?? null,
    scopePolicy: recallSettings.scopePolicy,
    turnContext: signals.context ?? null,
    turnTemporal: signals.temporal ?? null,
    turnRetrospective: retrospective,
    presentAboutCharacterIds,
    expandRelated: recallSettings.expandRelated,
    recentlyWhisperedIds: recentlyWhisperedIdSet(chat.commonplaceRecallHistory),
    // Fresh-event boost: memories of the last 24/48h keep their footing against
    // evergreen entries whatever the retrospective classifier decided. The chat
    // id is the echo guard — this chat's own memories are already in context.
    currentChatId: chatId,
    nowMs: Date.now(),
  }

  // Retrospective turns: multi-probe (entity string; paraphrase + resolved
  // date phrase) so a "remember Lighthouse Point last week?" turn probes the
  // vector space from every angle the reference offers.
  const extraProbes: string[] = []
  if (retrospective) {
    const entityProbe = (signals.entities ?? []).join(' ').trim()
    if (entityProbe) extraProbes.push(entityProbe)
    if (signals.paraphrase && signals.timeRange) {
      extraProbes.push(
        `${signals.paraphrase} (around ${signals.timeRange.from.slice(0, 10)} to ${signals.timeRange.to.slice(0, 10)})`,
      )
    }
  }

  // Captured by `searchMemoriesSemantic` the moment it embeds `searchQuery`.
  let queryEmbedding: SearchQueryEmbedding | undefined

  try {
    const memoryResults = await searchMemoriesSemantic(
      character.id,
      searchQuery,
      {
        userId,
        limit: 20,
        captureQueryEmbedding: captured => {
          queryEmbedding = captured
        },
        minImportance: 0.3,
        recallContext,
        // Episodic recall: entity anchoring always (a verbatim place name
        // cannot be sliced off by the cosine floor); window + probes only on
        // retrospective turns.
        entityAnchors: signals.entities,
        // A resolved window is useful whether or not the turn reads as
        // retrospective — the classifier misses same-day references, and
        // `searchMemoriesSemantic`'s two-stage semantics (hard filter only when
        // enough hits survive, else the bounded soft boost) make it
        // starvation-safe. The retrospective flag still gates the temporal
        // flip, anti-repetition suspension, and the multi-probe block below.
        occurredWithin: signals.timeRange ?? null,
        extraProbes: extraProbes.length > 0 ? extraProbes : undefined,
      }
    )

    if (memoryResults.length > 0) {
      return { memories: memoryResults.slice(0, 10), signals, queryEmbedding }
    }
  } catch (error) {
    logger.warn('Proactive memory recall: memory search failed, falling back to default', {
      chatId,
      characterId: character.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { memories: undefined, signals, queryEmbedding }
}
