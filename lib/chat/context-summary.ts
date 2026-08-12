/**
 * Context Summary Service
 * Sprint 5: Context Management
 *
 * Generates and updates conversation summaries for long chats.
 * Uses the cheap LLM system for efficient summarization.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { foldChatSummary, ChatMessage, generateTitleFromSummary, generateHelpChatTitleFromSummary } from '@/lib/memory/cheap-llm-tasks'
import { Provider, ConnectionProfile, CheapLLMSettings, ChatEvent, MessageEvent, isHelpLikeChatType } from '@/lib/schemas/types'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override'
import { logger } from '@/lib/logger'
import { createContextSummaryEvent, createTitleGenerationEvent } from '@/lib/services/system-events.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { enqueueTitleUpdate } from '@/lib/background-jobs/queue-service'
import { postLibrarianSummaryAnnouncement, SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import { writeConversationSummaryToVaults, computeConversationStats } from '@/lib/file-storage/conversation-summary-vault-bridge'
import { refreshRelevantConversationsOnFold } from '@/lib/services/commonplace-notifications/relevant-conversations-refresh'
import { runFoldEpisodePass } from '@/lib/memory/fold-episode-pass'

/**
 * Rolling-window summarization cadence.
 *
 * The chat-message LLM call sees `[running summary] + [last 5–10 turns]`. The
 * running summary lives as a Librarian whisper at the head of the kept
 * messages. Older USER + character messages get dropped from the LLM context
 * once a fold has covered them. Knobs:
 *
 *   - FOLD_TURN_BATCH: number of turns folded per fire (5).
 *   - FOLD_TAIL_FLOOR: minimum recent turns kept verbatim (5).
 *   - FOLD_TRIGGER_DELTA: turns of accumulated tail before a fold fires
 *     (FOLD_TAIL_FLOOR + FOLD_TURN_BATCH = 10). When `currentTurn -
 *     lastFoldedTurn > FOLD_TRIGGER_DELTA`, fold the next 5 turns.
 *   - T_HARD_TURN_THRESHOLD: periodic full from-scratch rebuild (50). Cheap
 *     insurance against accumulated paraphrase drift across many folds.
 *
 * `chat.lastSummaryTurn` is reused as the fold anchor (semantically:
 * "lastFoldedTurn" — the turn number through which the running summary has
 * already absorbed content). `chat.compactionGeneration` bumps on every fold
 * so the Librarian-whisper sweep and Phase 3 frozen-memory archive cache
 * invalidate together. `chat.lastFullRebuildTurn` anchors the T_hard window.
 */
export const FOLD_TURN_BATCH = 5
export const FOLD_TAIL_FLOOR = 5
export const FOLD_TRIGGER_DELTA = FOLD_TAIL_FLOOR + FOLD_TURN_BATCH
export const T_HARD_TURN_THRESHOLD = 50

export type SummarizationGateDecision = 'skip' | 'fold' | 'hard'

export interface SummarizationGateInputs {
  /** Current interchange count (output of calculateInterchangeCount). */
  currentTurn: number
  /** Turn through which the running summary has already absorbed content. */
  lastFoldedTurn: number
  /** Turn at which the last from-scratch rebuild fired. */
  lastFullRebuildTurn: number
}

/**
 * Decide whether to skip, fold the next batch, or do a full rebuild.
 * Pure function — no side effects.
 */
export function evaluateSummarizationGate(
  inputs: SummarizationGateInputs,
): SummarizationGateDecision {
  const { currentTurn, lastFoldedTurn, lastFullRebuildTurn } = inputs

  // Below the floor + batch threshold, no fold needs to happen — the LLM still
  // sees the full conversation as recent tail.
  if (currentTurn <= FOLD_TRIGGER_DELTA) return 'skip'

  // T_hard wins over the regular fold path. A from-scratch rebuild implicitly
  // satisfies any fold that was due.
  if (currentTurn - lastFullRebuildTurn >= T_HARD_TURN_THRESHOLD) {
    return 'hard'
  }

  if (currentTurn - lastFoldedTurn > FOLD_TRIGGER_DELTA) {
    return 'fold'
  }

  return 'skip'
}

/**
 * Calculates the number of interchanges in a chat.
 *
 * For normal chats an interchange is one user message + one assistant
 * response — count is the minimum of the two so partial pairs don't tick the
 * meter. Autonomous rooms have no human user, so that floor is permanently
 * zero; instead, count each assistant turn as one interchange so the title
 * check and summarization gate fire on the natural cadence of the room.
 *
 * Staff whispers (`systemSender` set — host/prospero/aurora/commonplaceBook/
 * librarian/etc.) carry role ASSISTANT but are synthetic system messages, not
 * real turns. They are excluded from the count: each autonomous turn drags
 * along several whispers, so counting them inflated the meter by ~5/turn and
 * collapsed the title-check / summarization cadence (meant to fire roughly
 * every 10 interchanges) down to nearly every turn.
 */
export function calculateInterchangeCount(
  messages: Array<{ role?: string; type?: string; systemSender?: string | null }>,
  chatType?: string,
): number {
  let userMessages = 0
  let assistantMessages = 0

  for (const msg of messages) {
    // Skip non-message types (like context-summary, tool-result, etc.)
    if (msg.type && msg.type !== 'message') {
      continue
    }

    // Skip staff whispers — they are not interchange-bearing turns.
    if (msg.systemSender) {
      continue
    }

    const role = msg.role?.toUpperCase()
    if (role === 'USER') {
      userMessages++
    } else if (role === 'ASSISTANT') {
      assistantMessages++
    }
  }

  if (chatType === 'autonomous') {
    return assistantMessages
  }

  // An interchange is complete when both user and assistant have spoken
  // Return the minimum of the two (limiting factor)
  return Math.min(userMessages, assistantMessages)
}

/**
 * Determines if we should check for title update at this interchange count.
 *
 * - Regular chats: checks at 2, 3, 5, 7, 10, then every 10 after
 * - Help chats: checks at 1, 2, 3, 5, 7, 10, then every 10 after (fires
 *   immediately after first Q&A)
 *
 * Crossing semantics: each checkpoint fires when the counter has *reached
 * or passed* it since the last check. This matters for autonomous rooms,
 * where the interchange counter is "assistant messages including staff
 * whispers" and a single character turn can bump the count by 5+ — easily
 * skipping past exact 10/20/30 marks. Using `>=` here means the check
 * fires on the first turn after we cross 10, then again after 20, etc.
 */
export function shouldCheckTitleAtInterchange(
  currentInterchange: number,
  lastCheckedInterchange: number,
  chatType?: string
): boolean {
  const isHelpChat = isHelpLikeChatType(chatType)

  // Help-like chats (Help Chat, Brahma Console) fire at interchange 1 (right
  // after first Q&A). Regular chats never check before interchange 2
  const minimumInterchange = isHelpChat ? 1 : 2
  if (currentInterchange < minimumInterchange) {
    return false
  }

  // Fire if we've crossed any not-yet-checked early checkpoint.
  const earlyCheckpoints = isHelpChat ? [1, 2, 3, 5, 7, 10] : [2, 3, 5, 7, 10]
  for (const checkpoint of earlyCheckpoints) {
    if (currentInterchange >= checkpoint && lastCheckedInterchange < checkpoint) {
      return true
    }
  }

  // After 10, fire if the most recently crossed multiple of 10 is one we
  // haven't checked yet. `Math.floor(n / 10) * 10` is the highest multiple
  // of 10 ≤ n; if that's greater than `lastCheckedInterchange`, we've
  // crossed a new boundary since the last check.
  if (currentInterchange >= 10) {
    const lastCrossedMultipleOf10 = Math.floor(currentInterchange / 10) * 10
    if (lastCrossedMultipleOf10 > lastCheckedInterchange) {
      return true
    }
  }

  return false
}

/**
 * Options for generating a context summary
 */
export interface GenerateSummaryOptions {
  /** User ID for API access */
  userId: string
  /** Chat ID to summarize */
  chatId: string
  /** Current connection profile being used */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for fallback */
  availableProfiles: ConnectionProfile[]
  /** Force regeneration even if summary exists */
  forceRegenerate?: boolean
}

/**
 * Result of summary generation
 */
export interface SummaryGenerationResult {
  success: boolean
  summary?: string
  error?: string
  /** Whether the summary was newly generated or already existed */
  wasGenerated: boolean
  /** Token usage for the generation */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

interface FoldedTurn {
  /** 1-indexed turn number. */
  turnNumber: number
  /** USER + non-staff ASSISTANT messages composing this turn, chronological. */
  messages: MessageEvent[]
  /** IDs of those messages, for summaryAnchorMessageIds. */
  ids: string[]
}

/**
 * Walk chat history in chronological order, grouping messages into turns.
 * A turn begins on a USER message; trailing non-staff ASSISTANT messages
 * before the next USER message belong to that turn. Staff-authored messages
 * (`systemSender` set) are excluded from summary input but do not affect
 * turn numbering. ASSISTANT-only greeting messages before any USER message
 * are folded into turn 1.
 */
export function partitionMessagesIntoTurns(
  allMessages: ChatEvent[],
  chatType?: string,
): FoldedTurn[] {
  const turns: FoldedTurn[] = []
  let currentTurn: FoldedTurn | null = null
  let leadingAssistant: { messages: MessageEvent[]; ids: string[] } | null = null
  // Autonomous rooms have no USER pivot — partition on each character-
  // attributed ASSISTANT message instead. Without this, `turns.length` is
  // permanently 0 for autonomous chats and summarisation always bails with
  // "No messages to summarize". Staff whispers (systemSender set) are still
  // skipped by the filter below.
  const isAutonomous = chatType === 'autonomous'

  for (const msg of allMessages) {
    if (msg.type !== 'message') continue
    const m = msg as MessageEvent
    if (m.role !== 'USER' && m.role !== 'ASSISTANT') continue
    if (m.systemSender) continue

    const startsNewTurn = m.role === 'USER'
      || (isAutonomous && m.role === 'ASSISTANT')

    if (startsNewTurn) {
      const turnNumber = turns.length + 1
      const startMessages = leadingAssistant ? [...leadingAssistant.messages, m] : [m]
      const startIds = leadingAssistant ? [...leadingAssistant.ids, m.id] : [m.id]
      currentTurn = { turnNumber, messages: startMessages, ids: startIds }
      turns.push(currentTurn)
      leadingAssistant = null
    } else if (currentTurn) {
      currentTurn.messages.push(m)
      currentTurn.ids.push(m.id)
    } else {
      leadingAssistant = leadingAssistant ?? { messages: [], ids: [] }
      leadingAssistant.messages.push(m)
      leadingAssistant.ids.push(m.id)
    }
  }

  return turns
}

function turnsToChatMessages(turns: FoldedTurn[]): Array<ChatMessage & { createdAt?: string | null }> {
  const result: Array<ChatMessage & { createdAt?: string | null }> = []
  for (const t of turns) {
    for (const m of t.messages) {
      result.push({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
        // Message dates feed the fold summary's Timeline section.
        createdAt: m.createdAt ?? null,
      })
    }
  }
  return result
}

/**
 * Generate or update a context summary for a chat using the rolling-window
 * fold cadence. Caller is expected to have run the gate (or to set
 * `forceRegenerate` for an unconditional T_hard rebuild).
 */
export async function generateContextSummary(
  options: GenerateSummaryOptions
): Promise<SummaryGenerationResult> {
  const {
    userId,
    chatId,
    connectionProfile,
    cheapLLMSettings,
    availableProfiles,
    forceRegenerate = false,
  } = options

  const repos = getRepositories()

  try {
    const chat = await repos.chats.findById(chatId)
    if (!chat) {
      return { success: false, error: 'Chat not found', wasGenerated: false }
    }

    let cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    )

    if (!cheapLLM) {
      return { success: false, error: 'No cheap LLM provider available', wasGenerated: false }
    }

    if (isChatActiveDangerous(chat)) {
      const chatSettingsForDanger = await repos.chatSettings.findByUserId(userId)
      const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettingsForDanger, chat)
      cheapLLM = resolveUncensoredCheapLLMSelection(
        cheapLLM,
        true,
        dangerSettings,
        availableProfiles
      )
    }

    const allChatMessages = await repos.chats.getMessages(chatId)
    const allTurns = partitionMessagesIntoTurns(allChatMessages, chat.chatType)
    const currentTurn = allTurns.length

    if (currentTurn === 0) {
      return { success: false, error: 'No messages to summarize', wasGenerated: false }
    }

    const lastFoldedTurn = chat.lastSummaryTurn ?? 0

    // Decide what range of turns to fold. T_hard absorbs everything up to the
    // tail floor in a single from-scratch call; the regular fold path takes
    // the next FOLD_TURN_BATCH turns and updates the prior summary.
    const isHardRebuild = forceRegenerate
    let foldFromTurn: number
    let foldThroughTurn: number
    if (isHardRebuild) {
      foldFromTurn = 1
      foldThroughTurn = Math.max(1, currentTurn - FOLD_TAIL_FLOOR)
    } else {
      foldFromTurn = lastFoldedTurn + 1
      foldThroughTurn = Math.min(lastFoldedTurn + FOLD_TURN_BATCH, currentTurn - FOLD_TAIL_FLOOR)
    }

    if (foldThroughTurn < foldFromTurn) {
      return { success: false, error: 'Not enough turns to fold', wasGenerated: false }
    }

    const turnsToFold = allTurns.slice(foldFromTurn - 1, foldThroughTurn)
    const newTurnsContent = turnsToChatMessages(turnsToFold)

    if (newTurnsContent.length === 0) {
      return { success: false, error: 'No content in turns to fold', wasGenerated: false }
    }

    const priorSummary = isHardRebuild ? null : (chat.contextSummary ?? null)

    const foldResult = await foldChatSummary(
      { priorSummary, newTurns: newTurnsContent },
      cheapLLM,
      userId,
      chatId,
    )

    if (!foldResult.success || !foldResult.result) {
      return {
        success: false,
        error: foldResult.error || 'Failed to fold summary',
        wasGenerated: false,
      }
    }

    const newSummary: string = foldResult.result
    const result: SummaryGenerationResult = {
      success: true,
      summary: newSummary,
      wasGenerated: true,
      usage: foldResult.usage,
    }

    const newGeneration = (chat.compactionGeneration ?? 0) + 1
    const newLastFoldedTurn = foldThroughTurn

    // Anchor every conversation message in turns 1 through newLastFoldedTurn
    // so the edit-aware invalidation hook clears the summary when a covered
    // message is touched. Recompute (don't append) so the set is always
    // consistent with the current fold boundary.
    const summaryAnchorMessageIds = allTurns
      .slice(0, newLastFoldedTurn)
      .flatMap(t => t.ids)

    await repos.chats.update(chatId, {
      contextSummary: newSummary,
      compactionGeneration: newGeneration,
      lastSummaryTurn: newLastFoldedTurn,
      summaryAnchorMessageIds,
      ...(isHardRebuild ? { lastFullRebuildTurn: currentTurn } : {}),
      updatedAt: new Date().toISOString(),
    })

    const summaryEvent = {
      type: 'context-summary' as const,
      id: crypto.randomUUID(),
      context: newSummary,
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chatId, summaryEvent)

    // Sweep prior Librarian summary whispers from older generations, then
    // post the fresh one. Whispers from the new generation are left
    // untouched. Legacy unanchored whispers are identified by content prefix.
    try {
      const refreshedMessages = await repos.chats.getMessages(chatId)
      const priorSummaryIds = refreshedMessages
        .filter((m): m is MessageEvent => m.type === 'message')
        .filter(m => {
          if (m.systemSender !== 'librarian') return false
          if (m.summaryAnchor) {
            return m.summaryAnchor.compactionGeneration < newGeneration
          }
          return typeof m.content === 'string' && m.content.startsWith(SUMMARY_CONTENT_PREFIX)
        })
        .map(m => m.id)

      if (priorSummaryIds.length > 0) {
        const removed = await repos.chats.deleteMessagesByIds(chatId, priorSummaryIds)
        logger.info('[Context Summary] Swept prior broadcast summary whispers', {
          chatId, removed, newGeneration,
        })
      }

      await postLibrarianSummaryAnnouncement({
        chatId,
        summary: newSummary,
        targetParticipantIds: null,
        summaryAnchor: { compactionGeneration: newGeneration },
      })
    } catch (e) {
      logger.error('[Context Summary] Failed to post broadcast summary whisper:', { chatId }, e instanceof Error ? e : new Error(String(e)))
    }

    // Mirror the fresh summary into every participant character's vault under
    // "Conversation Summaries/" (Commonplace Book retrieval — Part A). The UUID
    // in the file's frontmatter lets this replace its own prior file across
    // renames. Best-effort: a vault-write failure must never fail the summary.
    try {
      const participantCharacterIds = Array.from(
        new Set(chat.participants.map(p => p.characterId))
      )
      const stats = computeConversationStats(allChatMessages)
      await writeConversationSummaryToVaults({
        chatId,
        chatTitle: chat.title,
        summary: newSummary,
        summaryGeneration: newGeneration,
        participantCharacterIds,
        messageCount: stats.messageCount,
        firstMessageAt: stats.firstMessageAt,
        lastMessageAt: stats.lastMessageAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (e) {
      logger.error('[Context Summary] Failed to mirror summary into character vaults:', { chatId }, e instanceof Error ? e : new Error(String(e)))
    }

    // Relevance drifts as the conversation advances, so re-run ONLY the
    // relevant-past-conversations search against the fresh summary and post a
    // refreshed Commonplace Book whisper to each present character. Ordering is
    // deliberate: the vault summary above is written first, so this search reads
    // the fresh corpus rather than racing it. Best-effort — never fails a fold.
    try {
      await refreshRelevantConversationsOnFold({
        chatId,
        summary: newSummary,
        userId,
        embeddingProfileId: undefined,
        maxContext: connectionProfile.maxContext ?? null,
      })
    } catch (e) {
      logger.error('[Context Summary] Failed to refresh relevant conversations:', { chatId }, e instanceof Error ? e : new Error(String(e)))
    }

    // Episodic spine: fold-time episode pass. Over the just-folded window, ask
    // the cheap LLM for 0–2 consolidated episode records and write them as
    // dated `kind: 'episodic'` memories linked to the window's per-turn
    // fragments. Piggybacks the fold cadence — no new trigger. Best-effort:
    // a failed episode pass never fails the fold.
    try {
      const windowMessages = turnsToFold.flatMap(t => t.messages)
      await runFoldEpisodePass({
        chatId,
        userId,
        windowMessages,
        cheapLLM,
        timelineMode: chat.timelineMode ?? 'realtime',
        projectId: chat.projectId ?? null,
        inAutonomousRoom: chat.chatType === 'autonomous',
      })
    } catch (e) {
      logger.error('[Context Summary] Fold episode pass failed:', { chatId }, e instanceof Error ? e : new Error(String(e)))
    }

    if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
      try {
        const costResult = await estimateMessageCost(
          cheapLLM.provider,
          cheapLLM.modelName,
          result.usage.promptTokens,
          result.usage.completionTokens,
          userId
        )
        await createContextSummaryEvent(
          chatId,
          result.usage,
          cheapLLM.provider,
          cheapLLM.modelName,
          costResult.cost
        )
      } catch (e) {
        logger.error('[Context Summary] Failed to create system event:', {}, e instanceof Error ? e : new Error(String(e)))
      }
    }

    try {
      const titleResult = isHelpLikeChatType(chat.chatType)
        ? await generateHelpChatTitleFromSummary(newSummary, cheapLLM, userId, chatId)
        : await generateTitleFromSummary(newSummary, cheapLLM, userId, chatId)
      if (titleResult.success && titleResult.result) {
        await repos.chats.update(chatId, {
          title: titleResult.result,
          updatedAt: new Date().toISOString(),
        })
        logger.info(`[Context Summary] Generated title for chat ${chatId}: ${titleResult.result}`)

        if (titleResult.usage && (titleResult.usage.promptTokens > 0 || titleResult.usage.completionTokens > 0)) {
          try {
            const titleCostResult = await estimateMessageCost(
              cheapLLM.provider,
              cheapLLM.modelName,
              titleResult.usage.promptTokens,
              titleResult.usage.completionTokens,
              userId
            )
            await createTitleGenerationEvent(
              chatId,
              titleResult.usage,
              cheapLLM.provider,
              cheapLLM.modelName,
              titleCostResult.cost
            )
          } catch (e) {
            logger.error('[Context Summary] Failed to create title generation system event:', {}, e instanceof Error ? e : new Error(String(e)))
          }
        }
      } else {
        logger.warn(`[Context Summary] Failed to generate title for chat ${chatId}: ${titleResult.error}`)
      }
    } catch (titleError) {
      logger.error(`[Context Summary] Error generating title for chat ${chatId}:`, {}, titleError instanceof Error ? titleError : new Error(String(titleError)))
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      wasGenerated: false,
    }
  }
}


/**
 * Edit/delete invalidation hook. When a conversation message is edited or
 * deleted, clear the running summary if the changed message ID was part of
 * the set that fed it. Resets `lastSummaryTurn` (the fold anchor) and
 * `lastFullRebuildTurn` so the next fold rebuilds from scratch. Bumps
 * `compactionGeneration` so downstream caches and Librarian-whisper sweeps
 * refresh in step.
 *
 * Called with one or more message IDs (a single edit, or the swipe-group
 * IDs the delete path collects). Returns true when the summary was
 * invalidated; false when none of the IDs were covered.
 */
export async function invalidateContextSummaryIfMessageCovered(
  chatId: string,
  messageIds: string[],
): Promise<boolean> {
  if (messageIds.length === 0) return false
  const repos = getRepositories()

  try {
    const chat = await repos.chats.findById(chatId)
    if (!chat || !chat.contextSummary) return false

    const covered = chat.summaryAnchorMessageIds ?? []
    if (covered.length === 0) return false

    const coveredSet = new Set(covered)
    const intersects = messageIds.some(id => coveredSet.has(id))
    if (!intersects) return false

    await repos.chats.update(chatId, {
      contextSummary: null,
      summaryAnchorMessageIds: [],
      compactionGeneration: (chat.compactionGeneration ?? 0) + 1,
      lastSummaryTurn: 0,
      lastFullRebuildTurn: 0,
      updatedAt: new Date().toISOString(),
    })

    logger.info('[Context Summary] Invalidated on covered message change', {
      chatId,
      changedMessageCount: messageIds.length,
      coveredCount: covered.length,
      newGeneration: (chat.compactionGeneration ?? 0) + 1,
    })
    return true
  } catch (error) {
    logger.error('[Context Summary] Invalidation hook failed', { chatId },
      error instanceof Error ? error : new Error(String(error)))
    return false
  }
}

/**
 * Generate summary in the background (non-blocking)
 * Used after message exchanges to keep summaries up to date
 */
export function generateContextSummaryAsync(options: GenerateSummaryOptions): void {
  // Run in background without waiting
  generateContextSummary(options)
    .then(result => {
      if (result.success && result.wasGenerated) {
        logger.info(`[Context Summary] Generated summary for chat ${options.chatId}`)
      } else if (!result.success) {
        logger.warn(`[Context Summary] Failed for chat ${options.chatId}: ${result.error}`)
      }
    })
    .catch(error => {
      logger.error(`[Context Summary] Error for chat ${options.chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    })
}

/**
 * Check and generate summary if needed after a message
 * Also checks if title should be updated based on interchange count
 * Call this after message exchanges to maintain context
 */
export async function checkAndGenerateSummaryIfNeeded(
  chatId: string,
  provider: Provider,
  modelName: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  cheapLLMSettings: CheapLLMSettings,
  availableProfiles: ConnectionProfile[],
  options: { awaitFold?: boolean } = {}
): Promise<void> {
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)

  if (!chat) {

    return
  }

  // Get all messages to calculate interchange count
  const allMessages = await repos.chats.getMessages(chatId)
  const currentInterchange = calculateInterchangeCount(allMessages, chat.chatType)

  // Check if we should consider updating the title
  const lastCheckedInterchange = chat.lastRenameCheckInterchange || 0

  const isAtTitleCheckpoint = shouldCheckTitleAtInterchange(currentInterchange, lastCheckedInterchange, chat.chatType)

  if (isAtTitleCheckpoint) {
    logger.info(`[Title Update] Checking title at interchange ${currentInterchange} for ${isHelpLikeChatType(chat.chatType) ? 'help-like ' : ''}chat ${chatId}`)

    // Enqueue a TITLE_UPDATE job rather than running the cheap-LLM call
    // inline. Inline used to leak writes when this path ran inside the
    // forked job-runner child (autonomous rooms): the title update's
    // `repos.chats.update` was detached from the handler's write-buffer
    // flush, so the rename happened in the LLM but never reached the DB.
    // The job gets its own AsyncLocalStorage scope, so its writes flush
    // back to the parent normally. Dedup on chatId folds repeat firings
    // at the same checkpoint into a single pending job.
    try {
      await enqueueTitleUpdate(userId, {
        chatId,
        connectionProfileId: connectionProfile.id,
        currentInterchange,
      })
    } catch (error) {
      logger.error(`[Title Update] Failed to enqueue title-update job for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    }
  }

  const decision = evaluateSummarizationGate({
    currentTurn: currentInterchange,
    lastFoldedTurn: chat.lastSummaryTurn ?? 0,
    lastFullRebuildTurn: chat.lastFullRebuildTurn ?? 0,
  })

  if (decision !== 'skip') {
    logger.info('[Context Summary] Gate fired', {
      chatId,
      decision,
      currentInterchange,
      lastFoldedTurn: chat.lastSummaryTurn ?? 0,
      lastFullRebuildTurn: chat.lastFullRebuildTurn ?? 0,
    })
    const summaryOptions = {
      userId,
      chatId,
      connectionProfile,
      cheapLLMSettings,
      availableProfiles,
      forceRegenerate: decision === 'hard',
    }
    if (options.awaitFold) {
      // Autonomous rooms call this from the forked job child, where a
      // fire-and-forget fold settles *after* the job's write-buffer flush and
      // its writes are silently dropped (the fold anchor then never advances).
      // Awaiting the fold keeps `repos.chats.update`/`addMessage`/`delete...`
      // inside the buffer so they reach the parent. The caller invokes this
      // OUTSIDE the autonomous-run-id scope, so the fold's cheap-LLM tokens are
      // not billed against the per-run budget.
      await generateContextSummary(summaryOptions)
    } else {
      generateContextSummaryAsync(summaryOptions)
    }
  } else {
  }
}

