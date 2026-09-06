import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
  isAllLLMChat,
  shouldPauseForAllLLM,
  isUserDrivenSeat,
} from '@/lib/chat/turn-manager'
import type { Character, MessageEvent } from '@/lib/schemas/types'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ProcessMessageResult } from './types'
import {
  encodeTurnStartEvent,
  encodeTurnCompleteEvent,
  encodeChainCompleteEvent,
  safeEnqueue,
} from './streaming.service'

/**
 * Guards on a multi-character chain: how many turns it may run and for how
 * long. Nothing here is about retrying a *failed* turn — that is the fallback
 * chain's job (`lib/llm/fallback/`), and it is per-call rather than per-chain.
 * (`maxRetries` / `retryDelayMs` used to sit here, declared and never read.)
 */
export interface ChainConfig {
  maxChainDepth: number      // default 20
  maxChainTimeMs: number     // default 300000 (5 minutes)
}

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  maxChainDepth: 20,
  maxChainTimeMs: 300000,
}

export interface ChainDecision {
  chain: boolean
  participantId?: string
  characterName?: string
  reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete' | 'continue'
  /**
   * How this turn's speaker was chosen — `queue` (popped from the manual turn
   * queue) or `algorithm` (weighted rotation). Threaded into the chained
   * `processMessage` so the "nothing to add" skip option is withheld for
   * queue-popped (summoned) turns. Only set when `chain` is true.
   */
  selectionReason?: 'queue' | 'algorithm'
}

const logger = createServiceLogger('TurnOrchestrator')

export interface ChainGuards {
  /**
   * Autonomous-room flag: when true, the all-LLM pause threshold
   * (`shouldPauseForAllLLM`) is bypassed and the chat is not marked
   * `isPaused`. The autonomous-room runner enforces its own budget caps
   * and lifecycle transitions; the in-chain pause would short-circuit it.
   */
  neverPauseForUser?: boolean
}

export async function shouldChainNext(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userParticipantId: string | null,
  chainDepth: number,
  chainStartTime: number,
  config: ChainConfig = DEFAULT_CHAIN_CONFIG,
  guards: ChainGuards = {}
): Promise<ChainDecision> {
  // Re-read chat for fresh state (isPaused may have been set by stop button)
  const freshChat = await repos.chats.findById(chatId)
  if (!freshChat) {
    logger.warn('[TurnOrchestrator] Chat not found during chain', { chatId })
    return { chain: false, reason: 'error' }
  }

  // Check pause
  if (freshChat.isPaused) {
    logger.info('[TurnOrchestrator] Chat paused, stopping chain', { chatId, chainDepth })
    return { chain: false, reason: 'paused' }
  }

  // Check max depth
  if (chainDepth >= config.maxChainDepth) {
    logger.info('[TurnOrchestrator] Max chain depth reached', { chatId, chainDepth, maxChainDepth: config.maxChainDepth })
    return { chain: false, reason: 'max_depth' }
  }

  // Check max time
  const elapsed = Date.now() - chainStartTime
  if (elapsed >= config.maxChainTimeMs) {
    logger.info('[TurnOrchestrator] Max chain time reached', { chatId, chainDepth, elapsedMs: elapsed })
    return { chain: false, reason: 'max_time' }
  }

  // Get messages and compute turn state
  const messages = await repos.chats.getMessages(chatId)
  const messageEvents = messages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]

  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: freshChat.participants,
    userParticipantId,
    spokenThisCycleParticipantIds: freshChat.spokenThisCycleParticipantIds,
  })

  // Check all-LLM pause thresholds
  // A chat is only truly all-LLM if there's no user-controlled participant AND
  // no USER messages in history (a user typing messages means a human is present)
  const isAllLLM = isAllLLMChat(freshChat.participants)
  const hasUserPresence = userParticipantId !== null
    || messageEvents.some(m => m.role === 'USER')
  const effectiveAllLLM = isAllLLM && !hasUserPresence
  if (effectiveAllLLM) {
    // Count assistant messages since last user message. Staff messages
    // (systemSender set — Host turn-pass notes, Lantern/Librarian whispers,
    // etc.) are ASSISTANT-role but are not character turns, so they must not
    // inflate the pause counter.
    let turnCount = 0
    for (let i = messageEvents.length - 1; i >= 0; i--) {
      if (messageEvents[i].role === 'USER') break
      if (messageEvents[i].systemSender) continue
      if (messageEvents[i].role === 'ASSISTANT') turnCount++
    }

    if (shouldPauseForAllLLM(turnCount) && turnCount > 0 && !guards.neverPauseForUser) {
      logger.info('[TurnOrchestrator] All-LLM pause threshold reached', { chatId, turnCount, chainDepth })
      // Pause the chat
      await repos.chats.update(chatId, { isPaused: true })
      return { chain: false, reason: 'paused' }
    }
  }

  // Check turn queue (persisted in DB)
  let turnQueue: string[] = []
  try {
    turnQueue = JSON.parse(freshChat.turnQueue || '[]')
  } catch {
    turnQueue = []
  }

  let nextParticipantId: string | null = null
  let selectionReason: string = ''

  if (turnQueue.length > 0) {
    // Pop from the front of the queue, but skip any entry that matches
    // the participant who just spoke — otherwise a nudge (which both queues
    // the participant AND triggers an immediate response) would cause a
    // duplicate response from the chain loop.
    while (turnQueue.length > 0) {
      const candidate = turnQueue[0]
      turnQueue = turnQueue.slice(1)
      if (candidate !== turnState.lastSpeakerId) {
        nextParticipantId = candidate
        selectionReason = 'queue'
        break
      }
    }
    // Persist updated queue (even if we skipped entries)
    await repos.chats.update(chatId, { turnQueue: JSON.stringify(turnQueue) })
  }

  if (!nextParticipantId && selectionReason !== 'queue') {
    // Use turn selection algorithm
    const activeCharacterParticipants = getActiveCharacterParticipants(freshChat.participants)
    const charactersMap = new Map<string, Character>()

    for (const p of activeCharacterParticipants) {
      if (p.characterId) {
        const char = await repos.characters.findById(p.characterId)
        if (char) {
          charactersMap.set(p.characterId, char)
        }
      }
    }

    const result = selectNextSpeaker(
      freshChat.participants,
      charactersMap,
      turnState,
      userParticipantId,
      freshChat.impersonatingParticipantIds
    )

    nextParticipantId = result.nextSpeakerId
    selectionReason = result.reason
  }

  // No next speaker
  if (!nextParticipantId) {
    const mappedReason = selectionReason === 'cycle_complete' ? 'cycle_complete' as const
      : selectionReason === 'user_turn' ? 'user_turn' as const
      : 'no_next_speaker' as const
    return { chain: false, reason: mappedReason }
  }

  // Check if next speaker is user-controlled
  const nextParticipant = freshChat.participants.find(p => p.id === nextParticipantId)
  if (!nextParticipant) {
    logger.warn('[TurnOrchestrator] Next participant not found', { chatId, nextParticipantId })
    return { chain: false, reason: 'error' }
  }

  if (isUserDrivenSeat(nextParticipant, freshChat.impersonatingParticipantIds)) {
    // Surface which user character is "up" so the salon UI can label the
    // pause and offer a Skip button targeted at that participant. A seat the
    // human is impersonating (Bug 44 overlay — `controlledBy` still `'llm'`)
    // pauses the chain just like a genuine user seat, so the operator types
    // the character's line instead of the model generating it.
    let characterName: string | undefined
    if (nextParticipant.characterId) {
      const char = await repos.characters.findById(nextParticipant.characterId)
      if (char) characterName = char.name
    }
    return {
      chain: false,
      reason: 'user_turn',
      participantId: nextParticipantId,
      characterName,
    }
  }

  // Find character name for logging/events
  let characterName = 'Unknown'
  if (nextParticipant.characterId) {
    const char = await repos.characters.findById(nextParticipant.characterId)
    if (char) characterName = char.name
  }

  logger.info('[TurnOrchestrator] Chain decision: continue', {
    chatId,
    chainDepth,
    nextParticipantId,
    characterName,
    selectionReason,
  })

  return {
    chain: true,
    participantId: nextParticipantId,
    characterName,
    reason: 'continue',
    selectionReason: selectionReason === 'queue' ? 'queue' : 'algorithm',
  }
}

/**
 * Persist the last turn participant ID for turn state restoration on page reload
 */
export async function persistTurnParticipantId(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  participantId: string | null
): Promise<void> {
  try {
    await repos.chats.update(chatId, { lastTurnParticipantId: participantId })
  } catch (error) {
    logger.warn('[TurnOrchestrator] Failed to persist turn participant ID', {
      chatId,
      participantId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface ExecuteTurnChainOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  initialResult: ProcessMessageResult
  initialContinueMode: boolean
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  processChainedMessage: (options: {
    continueMode: true
    respondingParticipantId: string
    /** How this speaker was chosen — threaded so the skip option is withheld for queue-popped (summoned) turns. */
    chainSelectionReason?: 'queue' | 'algorithm'
  }) => Promise<ProcessMessageResult>
  decideNextTurn?: typeof shouldChainNext
  persistTurnParticipant?: typeof persistTurnParticipantId
  /**
   * Autonomous-room flag passed through to `shouldChainNext` so the all-LLM
   * pause threshold is bypassed for the duration of the chain. The autonomous-
   * room runner is responsible for its own budget caps and lifecycle.
   */
  neverPauseForUser?: boolean
  /**
   * When true, skip the chain loop entirely — the caller will enqueue the
   * next character turn as a separate job. Used by the autonomous-room
   * handler so each turn is one job (buffered writes flush at job end →
   * `shouldChainNext` would otherwise see stale history and re-pick the
   * same speaker; per-turn budget checks would otherwise be bypassed for
   * up to 20 chain iterations).
   */
  singleTurn?: boolean
}

/**
 * Continue multi-character turn chains inside a single SSE stream.
 */
export async function executeTurnChain({
  repos,
  chatId,
  userId,
  initialResult,
  initialContinueMode,
  controller,
  encoder,
  processChainedMessage,
  decideNextTurn = shouldChainNext,
  persistTurnParticipant = persistTurnParticipantId,
  neverPauseForUser = false,
  singleTurn = false,
}: ExecuteTurnChainOptions): Promise<void> {
  // A skipped initial turn ("nothing to add") is NOT terminal — it advanced the
  // rotation via a Host turn-pass record, so the chain must continue to the next
  // speaker. Only a genuinely empty (no content, no skip) initial turn stops here.
  if (!initialResult.isMultiCharacter || (!initialResult.hasContent && !initialResult.skipped)) {
    return
  }

  // Single-turn callers (currently the autonomous-room handler) are
  // responsible for enqueueing the next turn themselves. Skip the chain loop
  // entirely so the buffered writes from this turn flush at job end before
  // the next speaker is picked. See `SendMessageOptions.singleTurn` for
  // background.
  if (singleTurn) {
    logger.info('[TurnOrchestrator] singleTurn: skipping chain loop', {
      chatId,
      userId,
    })
    return
  }

  // A paused chat stops here too — but never silently. The flag may have been
  // set by the Pause button, by the all-LLM threshold, or by the chain-error
  // handler below on an earlier turn, and the client's copy of it can be stale
  // (bug 123: a re-pause that fetched as paused→paused never reached the Salon,
  // so every later message got exactly one reply and no explanation). Emit the
  // same `paused` chain-complete a mid-chain pause decision would, so the client
  // refetches, reconciles its pause state, and can tell the user.
  if (initialResult.isPaused) {
    logger.info('[TurnOrchestrator] Chat paused, not chaining after initial turn', { chatId, userId })
    await persistTurnParticipant(repos, chatId, null)
    safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
      reason: 'paused',
      nextSpeakerId: null,
      chainDepth: 0,
      paused: true,
    }))
    return
  }

  const chainStartTime = Date.now()
  let chainDepth = 0

  const effectiveUserParticipantId = initialResult.userParticipantId
    ?? (initialContinueMode ? null : '__user__')

  while (true) {
    const decision = await decideNextTurn(
      repos,
      chatId,
      effectiveUserParticipantId,
      chainDepth,
      chainStartTime,
      DEFAULT_CHAIN_CONFIG,
      { neverPauseForUser }
    )

    if (!decision.chain || !decision.participantId) {
      const finalNextSpeaker = decision.participantId || null
      await persistTurnParticipant(repos, chatId, finalNextSpeaker)

      safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
        reason: decision.reason as 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete',
        nextSpeakerId: finalNextSpeaker,
        chainDepth,
        paused: decision.reason === 'paused',
      }))
      break
    }

    chainDepth++

    safeEnqueue(controller, encodeTurnStartEvent(encoder, {
      participantId: decision.participantId,
      characterName: decision.characterName || 'Unknown',
      chainDepth,
    }))

    try {
      const chainResult = await processChainedMessage({
        continueMode: true,
        respondingParticipantId: decision.participantId,
        chainSelectionReason: decision.selectionReason,
      })

      safeEnqueue(controller, encodeTurnCompleteEvent(encoder, {
        participantId: decision.participantId,
        messageId: chainResult.messageId || '',
        chainDepth,
        skipped: chainResult.skipped === true,
      }))

      // A skipped turn advanced the rotation (Host turn-pass record) — fall
      // through to the next decideNextTurn iteration. Only a genuinely empty
      // response (no content, no skip) stops the chain.
      if (!chainResult.hasContent && !chainResult.skipped) {
        logger.info('[TurnOrchestrator] Chain stopped: empty response', { chatId, chainDepth, userId })
        await persistTurnParticipant(repos, chatId, null)
        safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
          reason: 'error',
          nextSpeakerId: null,
          chainDepth,
          // An empty reply stops the chain but does NOT pause the chat — the
          // next user message chains normally. Said explicitly so the client
          // never infers a pause from `reason: 'error'` alone.
          paused: false,
        }))
        break
      }
    } catch (chainError) {
      logger.error('[TurnOrchestrator] Chain error, stopping', {
        chatId,
        chainDepth,
        userId,
        error: chainError instanceof Error ? chainError.message : String(chainError),
      })

      // Safety stop: pause so a failing provider cannot be re-polled turn after
      // turn. The pause outlives this stream — the user lifts it with Resume —
      // so it must be announced (`paused: true`), not just recorded (bug 123).
      await repos.chats.update(chatId, { isPaused: true })
      await persistTurnParticipant(repos, chatId, null)
      safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
        reason: 'error',
        nextSpeakerId: null,
        chainDepth,
        paused: true,
      }))
      break
    }
  }
}
