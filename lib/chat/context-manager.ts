/**
 * Context Manager
 * Sprint 5: Context Management
 * Phase 3: Multi-Character Context Building
 *
 * Intelligently builds LLM context within token budgets.
 * Handles system prompts, memory injection, conversation summaries,
 * and message selection to stay within model limits.
 *
 * Multi-character support:
 * - Formats messages with participant attribution (name field or prefix fallback)
 * - Respects hasHistoryAccess for late-joining participants
 * - Includes other participants in system prompt for context
 */

import { Provider, Character, ChatParticipantBase, ChatMetadataBase, TimestampConfig } from '@/lib/schemas/types'
import { estimateTokens, countMessagesTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation, calculateMaxAvailable, CONTEXT_HISTORY_BUDGET_RATIO, MEMORY_BUDGET_RATIO } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
import type { RecallContext, ContextTag, TemporalTag } from '@/lib/memory/recall-tags'
import {
  recentlyWhisperedIdSet,
  appendRecallTurn,
  appendRetroSignature,
  parseRetroSignatures,
} from '@/lib/memory/recall-history'
import {
  searchVaultConversationSummaries,
  renderRelevantConversationsBlock,
  READ_CONVERSATION_CALL_NOTE,
} from '@/lib/memory/conversation-summary-search'

/** Cap on entries in the retrospective mini-recap conversation list. */
const RETRO_MINI_RECAP_MAX_ENTRIES = 5

/**
 * Wall-clock ceiling on the whole memory-recap phase.
 *
 * Set above `CHEAP_LLM_TASK_TIMEOUT_MS` on purpose: the recap makes an
 * embedding call and a cheap-LLM call in sequence, each already deadlined, and
 * a recap that is merely slow in both places is still doing useful work. This
 * is the backstop that keeps a visible turn from sitting on "Recalling…" no
 * matter which leg misbehaves. The recap is optional context — losing it costs
 * the character some remembered flavour, not the turn.
 */
const MEMORY_RECAP_PHASE_TIMEOUT_MS = 60_000
import { getMemoryRecallSettings, getTabooSettings } from '@/lib/instance-settings'
import { generateMemoryRecap, type MemoryRecapResult } from '@/lib/memory/memory-recap'
import { withTimeout } from '@/lib/promise-timeout'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import { compressMemories } from '@/lib/memory/cheap-llm-tasks'
import type { ConnectionProfile } from '@/lib/schemas/types'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { extractVisibleConversation, stripToolArtifacts, extractMemorySearchKeywords, type MemorySearchExtraction } from '@/lib/memory/cheap-llm-tasks'

// Import from extracted modules
import {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  type OtherParticipantInfo,
} from './context/system-prompt-builder'
import {
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  formatFrozenMemoryArchive,
  formatDynamicMemoryHead,
  formatCurrentSceneState,
  DYNAMIC_HEAD_TOKEN_BUDGET,
  DYNAMIC_HEAD_DEFAULT_SIZE,
  RETRO_HEAD_TOKEN_BUDGET,
  RETRO_HEAD_SIZE,
  type DebugMemoryInfo,
  type DebugInterCharacterMemoryInfo,
  type SceneStateEmissionEntry,
} from './context/memory-injector'
import { SceneStateSchema, type SceneState } from '@/lib/schemas/chat.types'
import { describeOutfit, decorateOutfitItems } from '@/lib/wardrobe/outfit-description'
import { hashEquippedSlots, hasEquippedItems } from '@/lib/wardrobe/outfit-hash'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import {
  resolveTieredMountPool,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool'
import type { MessageEvent } from '@/lib/schemas/types'
import { getOrComputeFrozenArchive } from '@/lib/memory/frozen-archive-cache'
import {
  filterMessagesByHistoryAccess,
  filterWhisperMessages,
  getParticipantName,
  attributeMessagesForCharacter,
  findUserParticipantName,
  type MessageWithParticipant,
} from './context/message-attribution'
import {
  selectRecentMessages,
  type SelectableMessage,
} from './context/message-selector'
import {
  findMentionedCharacterIds,
} from './context/mentioned-characters'
import {
  retrieveKnowledgeForTurn,
  type KnowledgeDebugEntry,
} from './context/knowledge-injector'
import {
  shouldApplyCompression,
  shouldApplyBudgetCompression,
  splitMessagesForCompression,
  applyContextCompression,
  buildCompressedHistoryBlock,
  type ContextCompressionOptions,
  type ContextCompressionResult,
} from './context/compression'
import {
  buildCommonplacePersonaWhisper,
  buildCommonplaceLLMContext,
  postCommonplaceWhisper,
} from '@/lib/services/commonplace-notifications/writer'
import {
  buildSuparnaMailWhisper,
  buildSuparnaMailLLMContext,
  postSuparnaMailWhisper,
} from '@/lib/services/suparna-notifications/writer'
import { collectUnalertedMail, markAlerted } from '@/lib/post-office/mailbox'
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail'
import {
  assembleCorePacket,
  buildCoreWhisperContent,
  buildCoreWhisperLLMContext,
  buildCoreWhisperOpaqueContent,
  postCoreWhisper,
  resolveCoreWhisperConfig,
} from '@/lib/services/aurora-notifications/core-whisper'
import { shouldFireCoreWhisper } from '@/lib/chat/context/core-whisper-trigger'
import {
  postHostTimestampAnnouncement,
  buildTimestampContent,
  postHostOffSceneCharactersAnnouncement,
  findIntroducedOffSceneCharacterIds,
} from '@/lib/services/host-notifications/writer'
import { SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import {
  shouldInjectTimestamp,
  calculateCurrentTimestamp,
} from '@/lib/chat/timestamp-utils'
import { getCompiledIdentityStack } from '@/lib/services/system-prompt-compiler/compiler'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'

// Re-export types from extracted modules for backwards compatibility
export type { OtherParticipantInfo } from './context/system-prompt-builder'
export type { MessageWithParticipant } from './context/message-attribution'
export type { SelectableMessage } from './context/message-selector'
export type { ContextCompressionOptions, ContextCompressionResult } from './context/compression'

// Re-export functions from extracted modules for backwards compatibility
export {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  filterMessagesByHistoryAccess,
  filterWhisperMessages,
  getParticipantName,
  attributeMessagesForCharacter,
  selectRecentMessages,
}

// Per-character cap on the importance/recency half of inter-character memories.
// Top N by SQL ordering (importance DESC, lastReinforcedAt/createdAt DESC); the
// formatter then merges this with the relevance half and re-ranks inside each
// character's block. Halved from 10 so the freed budget goes to the relevance
// half below.
const INTER_CHAR_PER_CHARACTER_LIMIT = 5
// Per-character cap on the relevance half: memories the responding character
// holds about a present character that score highly for the current moment.
const INTER_CHAR_RELEVANCE_PER_CHARACTER_LIMIT = 5

/**
 * Message format expected by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Optional metadata for the message */
  metadata?: {
    messageId?: string
    tokenCount?: number
    isInjected?: boolean
  }
  /** Google Gemini thought signature for thinking models (e.g., gemini-3-pro) */
  thoughtSignature?: string | null
  /** Optional name for multi-character chats (provider-dependent support) */
  name?: string
  /**
   * Provider cache breakpoint marker. Set on the head Librarian summary
   * whisper so providers that support per-message caching (Anthropic) can
   * anchor a cache breakpoint there: system+tools stay hot across summary
   * folds; only the summary-and-after re-prefills.
   */
  cacheControl?: { type: 'ephemeral' }
}

/**
 * Context budget allocation
 */
export interface ContextBudget {
  /** Total context window size for the model */
  totalLimit: number
  /** Tokens allocated for system prompt */
  systemPromptBudget: number
  /** Tokens allocated for memories */
  memoryBudget: number
  /**
   * Tokens allocated for per-turn knowledge recall (responding character's
   * vault Knowledge/ folder). Independent of memoryBudget — knowledge is
   * first-class character canon and is not fed to the memory compressor.
   */
  knowledgeBudget: number
  /** Tokens allocated for conversation summary */
  summaryBudget: number
  /** Tokens allocated for recent messages */
  recentMessagesBudget: number
  /** Tokens reserved for response */
  responseReserve: number
}

/**
 * Result of context building
 */
export interface BuiltContext {
  /** Messages ready to send to LLM */
  messages: ContextMessage[]
  /** Token usage breakdown */
  tokenUsage: {
    systemPrompt: number
    memories: number
    /** Tokens spent on per-turn knowledge recall (responding character's vault Knowledge/ folder). */
    knowledge: number
    summary: number
    recentMessages: number
    total: number
  }
  /** Context budget that was used */
  budget: ContextBudget
  /** Whether a conversation summary was included */
  includedSummary: boolean
  /** Number of memories included */
  memoriesIncluded: number
  /** Number of messages included */
  messagesIncluded: number
  /** Whether messages were truncated to fit */
  messagesTruncated: boolean
  /** Warnings generated during context building */
  warnings: string[]
  /** Debug info: the actual memories that were included */
  debugMemories?: Array<{ summary: string; importance: number; score: number; effectiveWeight: number }>
  /** Debug info: the inter-character memories that were included (multi-character chats) */
  debugInterCharacterMemories?: Array<{ aboutCharacterName: string; summary: string; importance: number }>
  /** Debug info: the knowledge entries that were included for this turn */
  debugKnowledge?: Array<{ filePath: string; score: number; inline: boolean; tokenCount: number }>
  /** Debug info: the memory recap content injected on chat start / character join */
  debugMemoryRecap?: string
  /** Debug info: the conversation summary that was included */
  debugSummary?: string
  /** Debug info: the system prompt that was built (may be compressed) */
  debugSystemPrompt?: string
  /** Original uncompressed system prompt (for async pre-compression of next message) */
  originalSystemPrompt?: string
  /** Whether context compression was applied */
  compressionApplied?: boolean
  /** Details about the compression (if applied) */
  compressionDetails?: {
    originalMessageCount: number
    compressedMessageCount: number
    windowMessageCount: number
    originalHistoryTokens: number
    compressedHistoryTokens: number
    originalSystemPromptTokens: number
    compressedSystemPromptTokens: number
    totalSavings: number
  }
}

/**
 * Options for building context
 */
export interface BuildContextOptions {
  /** Provider for token estimation */
  provider: Provider
  /** Model name for context limit lookup */
  modelName: string
  /** User ID for memory access */
  userId: string
  /** Character for system prompt (the character who will respond) */
  character: Character
  /** User character information (optional) */
  userCharacter?: { name: string; description: string } | null
  /** Chat metadata */
  chat: ChatMetadataBase
  /** Existing messages in the conversation */
  existingMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  /** New user message being sent (optional for continue mode) */
  newUserMessage?: string
  /**
   * The user-controlled participant the human is "Speaking As" for this turn.
   * Labels the new user message with the chosen character's name in multi-
   * character context; falls back to the first user-controlled participant.
   */
  activeUserParticipantId?: string | null
  /** Roleplay template for formatting instructions (prepended to system prompt) */
  roleplayTemplate?: { systemPrompt: string } | null
  /** Embedding profile ID for semantic search */
  embeddingProfileId?: string
  /** Skip memory retrieval */
  skipMemories?: boolean
  /** Minimum importance for memories */
  minMemoryImportance?: number

  // ============================================================================
  // Multi-Character Context Building (Phase 3)
  // ============================================================================

  /** The participant who will respond (required for multi-character chats) */
  respondingParticipant?: ChatParticipantBase
  /** All active participants in the chat */
  allParticipants?: ChatParticipantBase[]
  /** Map of participant ID -> Character data (for characters) */
  participantCharacters?: Map<string, Character>
  /** Extended messages with participantId for attribution */
  messagesWithParticipants?: MessageWithParticipant[]

  // ============================================================================
  // Participant Status Notifications
  // ============================================================================

  /** Status change notifications since the responding character's last turn */
  statusChangeNotifications?: string[]
  /** Outfit change notifications from manual sidebar changes */
  outfitChangeNotifications?: string[]

  // ============================================================================
  // Tool Instructions (native tool rules or text-block tool instructions)
  // ============================================================================

  /** Tool instructions injected into system prompt (native tool rules or text-block tool instructions) */
  toolInstructions?: string

  // ============================================================================
  // Timestamp Injection
  // ============================================================================

  /** Timestamp configuration (from chat or user settings) */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first user message in the conversation */
  isInitialMessage?: boolean
  /** Resolved IANA timezone name for timestamp formatting */
  timezone?: string

  // ============================================================================
  // Connection Profile (for budget-driven compression)
  // ============================================================================

  /** The connection profile being used (provides maxContext/maxTokens for budget calculation) */
  connectionProfile?: ConnectionProfile

  // ============================================================================
  // Context Compression
  // ============================================================================

  /** Context compression settings */
  contextCompressionSettings?: ContextCompressionSettings | null
  /** Cheap LLM selection for compression (required if compression is enabled) */
  cheapLLMSelection?: CheapLLMSelection | null
  /** Whether to bypass compression for this request (e.g., requestFullContextOnNextMessage flag) */
  bypassCompression?: boolean
  /** Pre-computed compression result from async cache (avoids blocking on compression) */
  cachedCompressionResult?: ContextCompressionResult | null
  /**
   * Message count when the cached compression was computed.
   * Used to calculate dynamic window size when using a fallback cache.
   * If the cache was computed for fewer messages than we currently have,
   * the effective window must be larger to include all messages since
   * the compression point.
   */
  cachedCompressionMessageCount?: number

  // ============================================================================
  // Proactive Memory Recall
  // ============================================================================

  /** Pre-searched memories from proactive recall (skips internal memory search when provided) */
  preSearchedMemories?: SemanticSearchResult[]
  /**
   * Turn-level recall signals from the proactive keyword distillation
   * (retrospective / timeRange / entities / paraphrase). Drives the
   * retrospective cadence: enlarged dynamic head + scoped mini-recap. When
   * absent, the fallback distillation inside buildContext supplies them.
   */
  recallSignals?: MemorySearchExtraction

  // ============================================================================
  // Memory Recap (Chat Start / Character Join)
  // ============================================================================

  /** Whether to generate a memory recap for this character (first message or character join) */
  generateMemoryRecap?: boolean
  /** Uncensored fallback options for memory recap in dangerous chats */
  uncensoredFallbackOptions?: UncensoredFallbackOptions

  /**
   * Continue mode (also covers nudges and chained autonomous turns) — a
   * continuation of an existing response rather than a fresh turn. Used by
   * the Aurora Core whisper to skip re-firing on a continuation.
   */
  isContinueMode?: boolean

  // ============================================================================
  // Status Callback (for streaming status events to client)
  // ============================================================================

  /** Optional callback to emit status events during context building phases */
  onStatusChange?: (stage: string, message: string) => void

  // ============================================================================
  // Autonomous-Room Per-Turn Budget Cap
  // ============================================================================

  /**
   * Autonomous-room per-turn context cap (tokens). When set, the model-derived
   * `maxAvailable` budget is clamped down to this value before the history and
   * memory fold targets are computed, so a token-budgeted room paces its run
   * across multiple turns instead of spending most of the per-run budget on one
   * oversized turn. The caller (the autonomous-room turn handler) derives it as
   * `remaining_run_budget / turns_left`, floored at a minimum viable context.
   * Undefined for non-autonomous turns and rooms without a token budget →
   * unchanged behavior.
   */
  autonomousContextCap?: number

  // ============================================================================
  // "Nothing to add" turn-skipping
  // ============================================================================

  /**
   * Per-turn ephemeral instruction control for turn-skipping. When
   * `offerSkip` is true, a Turn note is appended to (or pushed after) the
   * outgoing messages inviting the character to pass with the
   * `[NOTHING TO ADD]` sentinel; `recentlyAddressed` adds a caution to answer
   * rather than pass. Never persisted. Undefined / `offerSkip: false` → no note.
   */
  turnSkip?: { offerSkip: boolean; recentlyAddressed: boolean; characterName: string }
}

/**
 * Build the ephemeral "you may pass this turn" Turn note. Not persisted — it
 * rides only in the outgoing LLM context for this single turn. The Host
 * announcement text deliberately never contains the sentinel, so history can't
 * teach the phrase; this note is the only place it appears.
 */
export function buildTurnSkipInstruction(
  characterName: string,
  recentlyAddressed: boolean,
): string {
  const base = `[Turn note from the Salon — not spoken by any character]
You are not obliged to speak this turn. If — and only if — you genuinely have
nothing substantive to add to the conversation right now, reply with exactly
this single line and nothing else:

[NOTHING TO ADD]

The floor will then pass to someone else and the scene continues without you
this turn. Do not use it to be coy or mysterious — a brief in-character
remark is always better than an empty pass. If you have anything worth
saying, write your reply as normal and ignore this note entirely.`

  if (!recentlyAddressed) return base

  return `${base}

One caution: ${characterName} appears to have been addressed or mentioned since you last spoke. If someone has spoken to you and you have not yet answered them, you should answer rather than pass.`
}

/**
 * Calculate context budget based on model limits
 */
export function calculateContextBudget(
  provider: Provider,
  modelName: string
): ContextBudget {
  const allocation = getRecommendedContextAllocation(provider, modelName)

  return {
    totalLimit: allocation.totalLimit,
    systemPromptBudget: allocation.systemPrompt,
    memoryBudget: allocation.memories,
    knowledgeBudget: allocation.knowledge,
    summaryBudget: allocation.conversationSummary,
    recentMessagesBudget: allocation.recentMessages,
    responseReserve: allocation.responseReserve,
  }
}

/** Max characters of recent-window prose used as the memory-search query. */
const RECENT_WINDOW_QUERY_MAX_CHARS = 600

/**
 * Build a sentence-shaped memory-search query from the recent conversation.
 *
 * Embedding a single one-line message ("ok, go on") or the last message alone
 * produces a near-useless query. Instead concatenate the tail of the
 * conversation — the last assistant turn and the last couple of user turns — as
 * prose, so the query represents *what this moment is about*. Cheap (no LLM) and
 * strictly better than the single-message base. The most-recent text is kept
 * when truncating (slice from the end).
 */
function buildRecentWindowQuery(
  existingMessages: Array<{ role: string; content: string }>,
  newUserMessage?: string,
): string {
  const parts: string[] = []
  // Walk backward collecting up to 3 non-empty user/assistant turns, then emit
  // them in chronological order so the prose reads naturally.
  for (let i = existingMessages.length - 1; i >= 0 && parts.length < 3; i--) {
    const m = existingMessages[i]
    const role = m.role.toLowerCase()
    if (role !== 'user' && role !== 'assistant') continue
    const content = role === 'assistant' ? (stripToolArtifacts(m.content || '') ?? '') : (m.content || '')
    const trimmed = content.trim()
    if (trimmed.length === 0) continue
    parts.unshift(trimmed)
  }
  if (newUserMessage && newUserMessage.trim().length > 0) {
    parts.push(newUserMessage.trim())
  }
  const joined = parts.join('\n')
  return joined.length > RECENT_WINDOW_QUERY_MAX_CHARS
    ? joined.slice(-RECENT_WINDOW_QUERY_MAX_CHARS)
    : joined
}

/**
 * Main context building function
 * Assembles all components into a context that fits within token limits
 * Supports both single-character and multi-character scenarios
 */
export async function buildContext(options: BuildContextOptions): Promise<BuiltContext> {
  const {
    provider,
    modelName,
    userId,
    character,
    userCharacter,
    chat,
    existingMessages,
    newUserMessage,
    activeUserParticipantId,
    roleplayTemplate,
    embeddingProfileId,
    skipMemories = false,
    minMemoryImportance = 0.5,
    // Multi-character options (Phase 3)
    respondingParticipant,
    allParticipants,
    participantCharacters,
    messagesWithParticipants,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
    // Continue / nudge / chained autonomous-turn signal (Aurora Core whisper)
    isContinueMode = false,
  } = options

  const warnings: string[] = []
  const budget = calculateContextBudget(provider, modelName)

  // Determine if this is a multi-character chat
  const isMultiCharacter = !!(
    respondingParticipant &&
    allParticipants &&
    allParticipants.length > 1 &&
    participantCharacters &&
    messagesWithParticipants
  )

  // 1. Build system prompt (with multi-character info if applicable)
  let otherParticipantsInfo: OtherParticipantInfo[] | undefined
  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters) {
    otherParticipantsInfo = buildOtherParticipantsInfo(
      respondingParticipant.id,
      allParticipants,
      participantCharacters
    )
  }

  // Get the selectedSystemPromptId from the responding participant
  const selectedSystemPromptId = respondingParticipant?.selectedSystemPromptId

  // EVERY_N_MINUTES gating: find the most recent Host timestamp announcement
  // in this chat so the gate can compare elapsed minutes to the configured
  // interval. `null` means "no prior announcement" → shouldInjectTimestamp
  // will fire. Resolved here, used at both the scene-state gate and the
  // emission site below.
  let minutesSinceLastTimestampAnnouncement: number | null = null
  if (options.timestampConfig?.mode === 'EVERY_N_MINUTES') {
    try {
      const repos = getRepositories()
      const allMessages = await repos.chats.getMessages(chat.id)
      let mostRecent: number | null = null
      for (const m of allMessages as Array<{
        type?: string
        systemSender?: string | null
        systemKind?: string | null
        createdAt?: string
      }>) {
        if (m.type !== 'message') continue
        if (m.systemSender !== 'host') continue
        if (m.systemKind !== 'timestamp') continue
        if (!m.createdAt) continue
        const t = new Date(m.createdAt).getTime()
        if (Number.isFinite(t) && (mostRecent === null || t > mostRecent)) {
          mostRecent = t
        }
      }
      if (mostRecent !== null) {
        minutesSinceLastTimestampAnnouncement = (Date.now() - mostRecent) / 60_000
      }
    } catch (error) {
      logger.warn('[ContextManager] Failed to resolve last timestamp announcement; allowing emission', {
        context: 'context-manager',
        chatId: chat.id,
        error: getErrorMessage(error),
      })
    }
  }

  // Phase D: wardrobe context (current outfit + available items) is now
  // delivered as Aurora whispers in the transcript, so the per-turn
  // system-prompt loading of equipped outfits has been removed.

  // Off-scene character introductions: scan the conversation for workspace
  // characters who are NOT current participants but get name-dropped in
  // history. The first time each one is named, the Host introduces them with
  // a public chat message — visible to the user, surfaced to every
  // character's LLM context via normal history. Subsequent turns recall the
  // particulars from history without re-injecting cards into the system
  // prompt every turn (which used to bisect provider prompt caching).
  //
  // Idempotent per character: prior Host announcements stamp the introduced
  // IDs onto `hostEvent.introducedCharacterIds`, so repeated mentions of
  // already-introduced characters are no-ops.
  //
  // Failures here must never break prompt assembly — log and skip on error.
  let pendingOffSceneAnnouncement: { content: string } | null = null
  try {
    const repos = getRepositories()
    const allUserCharacters = await repos.characters.findByUserId(userId)

    // Build the set of character IDs to exclude from the candidate pool.
    const excludedCharacterIds = new Set<string>()
    excludedCharacterIds.add(character.id)
    if (allParticipants) {
      for (const participant of allParticipants) {
        if (
          participant.type === 'CHARACTER' &&
          participant.characterId &&
          participant.status !== 'removed'
        ) {
          excludedCharacterIds.add(participant.characterId)
        }
      }
    }

    // Also exclude the user's persona by name (no ID is exposed via options).
    const userCharacterNameLower = userCharacter?.name?.trim().toLowerCase()

    const candidates = allUserCharacters.filter(c => {
      if (excludedCharacterIds.has(c.id)) return false
      if (userCharacterNameLower && c.name.trim().toLowerCase() === userCharacterNameLower) {
        return false
      }
      return true
    })

    if (candidates.length > 0) {
      // Build the scan corpus from things characters and the user actually
      // *said* — not from synthetic messages (Host/Lantern/Aurora/Librarian/
      // Concierge/Commonplace Book whispers and announcements) and not from
      // the conversation summary. Otherwise the Host introduces workspace
      // characters whose names only ever appeared in a memory whisper or a
      // summary, which the participants haven't actually talked about.
      //
      // `existingMessages` is the trimmed role/content view used for LLM
      // context and has already been stripped of systemSender/hostEvent, so
      // load the full chat history from the repo to read those fields — both
      // for filtering the scan corpus and for the introducedIds diff below.
      const fullChatMessages = await repos.chats.getMessages(chat.id)
      const corpusParts: string[] = []
      for (const m of fullChatMessages as Array<{
        type?: string
        role?: string
        content?: string
        systemSender?: string | null
      }>) {
        if (m.type !== undefined && m.type !== 'message') continue
        if (!m.content) continue
        // Skip synthetic system whispers/announcements (the Host, Commonplace
        // Book recall, Lantern story-background notes, etc.).
        if (m.systemSender) continue
        const role = (m.role || '').toUpperCase()
        if (role !== 'USER' && role !== 'ASSISTANT') continue
        if (role === 'ASSISTANT') {
          const cleaned = stripToolArtifacts(m.content)
          if (!cleaned) continue
          corpusParts.push(cleaned)
        } else {
          corpusParts.push(m.content)
        }
      }
      const scanCorpus = corpusParts.join('\n')

      const matchedIds = findMentionedCharacterIds(scanCorpus, candidates)
      if (matchedIds.size > 0) {
        // Diff against characters already introduced by prior Host
        // announcements in this chat — only newly-mentioned ones get a fresh
        // intro.
        const introducedIds = findIntroducedOffSceneCharacterIds(fullChatMessages)
        const newcomerIds = new Set<string>()
        for (const id of matchedIds) {
          if (!introducedIds.has(id)) newcomerIds.add(id)
        }

        if (newcomerIds.size > 0) {
          const newcomers = candidates.filter(c => newcomerIds.has(c.id))
          const announcement = await postHostOffSceneCharactersAnnouncement({
            chatId: chat.id,
            characters: newcomers.map(c => ({
              id: c.id,
              name: c.name,
              aliases: c.aliases ?? undefined,
              pronouns: c.pronouns ?? undefined,
              identity: c.identity ?? undefined,
              description: c.description ?? undefined,
            })),
          })
          if (announcement) {
            // Surface the announcement to THIS turn's LLM context so the
            // responding character sees the intro without a one-turn lag.
            // (It's already persisted to the chat for future turns.)
            pendingOffSceneAnnouncement = { content: announcement.content }
          }
        } else {
        }
      } else {
      }
    }
  } catch (error) {
    logger.warn('[ContextManager] Failed to compute off-scene character introductions', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }

  const tSystemPromptStart = performance.now()
  // Phase H: prefer the precompiled identity stack from
  // chats.compiledIdentityStacks when present. Falls back to a fresh build
  // inside `buildSystemPrompt` when missing or empty (legacy chats / cache
  // miss after a character edit).
  const precompiledIdentityStack = respondingParticipant
    ? getCompiledIdentityStack(chat, respondingParticipant.id)
    : null

  // Instance-wide Taboo list. `buildSystemPrompt` is synchronous by design, so
  // the read happens here and the phrases are handed down. A failure to read is
  // never worth losing the turn over — the section is style guidance.
  let tabooPhrases: string[] = []
  try {
    const tabooSettings = await getTabooSettings()
    tabooPhrases = tabooSettings.phrases
    if (tabooPhrases.length > 0) {
      logger.debug('[ContextManager] Taboo phrases applied to system prompt', {
        chatId: chat.id,
        phraseCount: tabooPhrases.length,
      })
    }
  } catch (error) {
    logger.warn('[ContextManager] Failed to read Taboo settings — continuing without them', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }

  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    timestampConfig: options.timestampConfig,
    isInitialMessage: options.isInitialMessage,
    timezone: options.timezone,
    scenarioText: options.chat.scenarioText ?? undefined,
    precompiledIdentityStack,
    tabooPhrases,
  })
  const systemPromptTokens = estimateTokens(systemPrompt, provider)

  // Log multi-character context info for debugging identity confusion
  if (isMultiCharacter && respondingParticipant) {
    logger.info('[ContextManager] Multi-character context built', {
      respondingCharacterName: character.name,
      respondingParticipantId: respondingParticipant.id,
      otherParticipantNames: otherParticipantsInfo?.map(p => p.name) || [],
      systemPromptContainsIdentity: systemPrompt.includes(`You are ${character.name}`),
    })
  }

  // Check if system prompt exceeds budget
  let finalSystemPrompt = systemPrompt
  if (systemPromptTokens > budget.systemPromptBudget) {
    warnings.push(`System prompt (${systemPromptTokens} tokens) exceeds budget (${budget.systemPromptBudget}). Truncating.`)
    finalSystemPrompt = truncateToTokenLimit(systemPrompt, budget.systemPromptBudget, provider)
  }

  // Off-scene character cards are no longer spliced into the system prompt
  // (they used to live here and broke prompt-cache prefixes whenever a new
  // workspace character got name-dropped). They now ride as Host
  // introductions in chat history; the per-turn announcement (when there's a
  // newcomer) is appended to `pendingOffSceneAnnouncement` above and pushed
  // into this turn's contextMessages alongside the timestamp whisper.

  const finalSystemPromptTokens = estimateTokens(finalSystemPrompt, provider)

  // ============================================================================
  // Context Compression (Budget-Driven)
  // ============================================================================

  // Extract compression options
  const { contextCompressionSettings, cheapLLMSelection, bypassCompression = false, connectionProfile } = options

  // Calculate budget-driven max_available
  const budgetInfo = connectionProfile
    ? calculateMaxAvailable(provider, modelName, connectionProfile)
    : null

  // Autonomous-room pacing: clamp the model-derived context budget down to this
  // turn's slice of the per-run token budget (`remaining / turns_left`, computed
  // by the turn handler). This shrinks the whole pie — the compression trigger,
  // the history fold, and the memory budget all derive from `maxAvailable` — so
  // the room spreads its run across multiple turns rather than letting a model
  // with a huge context window spend most of the per-run budget on one turn.
  // Only ever shrinks (guarded by `<`); undefined leaves behavior unchanged.
  if (budgetInfo && options.autonomousContextCap != null
      && options.autonomousContextCap < budgetInfo.maxAvailable) {
    logger.info('[ContextManager] Autonomous per-turn budget cap applied', {
      modelMaxAvailable: budgetInfo.maxAvailable,
      autonomousContextCap: options.autonomousContextCap,
    })
    budgetInfo.maxAvailable = options.autonomousContextCap
  }

  // Estimate total conversation tokens for budget check
  const tTokenCountStart = performance.now()
  const visibleConversation = extractVisibleConversation(existingMessages)
  const conversationTokens = countMessagesTokens(
    visibleConversation.map(m => ({ role: m.role, content: m.content })),
    provider
  )

  // Total estimated prompt = system prompt + conversation + a rough memory estimate
  // (Memories haven't been retrieved yet, but we use the budget allocation as an estimate)
  const totalEstimatedTokens = finalSystemPromptTokens + conversationTokens + budget.memoryBudget

  // Determine if budget-driven compression should be applied
  const compressionEnabled = !!(
    contextCompressionSettings &&
    cheapLLMSelection &&
    budgetInfo &&
    shouldApplyBudgetCompression(
      totalEstimatedTokens,
      budgetInfo.maxAvailable,
      contextCompressionSettings,
      bypassCompression
    )
  )

  // Emit status: budget check
  if (budgetInfo && options.onStatusChange) {
    options.onStatusChange('budget_check', 'Calculating context budget...')
  }

  // Log budget analysis
  if (budgetInfo) {
    logger.info('[ContextManager] Budget analysis', {
      maxContext: budgetInfo.maxContext,
      maxTokens: budgetInfo.maxTokens,
      maxAvailable: budgetInfo.maxAvailable,
      totalEstimatedTokens,
      compressionNeeded: compressionEnabled,
      systemPromptTokens: finalSystemPromptTokens,
      conversationTokens,
    })
  }

  // Initialize compression result
  let compressionResult: ContextCompressionResult | undefined
  let useCompressedContext = false

  if (compressionEnabled && contextCompressionSettings && cheapLLMSelection && budgetInfo) {
    const maxAvailable = budgetInfo.maxAvailable
    const contextHistoryBudget = Math.floor(maxAvailable * CONTEXT_HISTORY_BUDGET_RATIO)

    logger.info('[ContextManager] Budget-driven compression enabled', {
      messageCount: existingMessages.length,
      windowSize: contextCompressionSettings.windowSize,
      maxAvailable,
      contextHistoryBudget,
      conversationTokens,
    })

    // Phase 1: Compress conversation history if it exceeds 50% of max_available
    // (minus the last windowSize messages which are kept verbatim)
    const { messagesToCompress } = splitMessagesForCompression(
      visibleConversation,
      contextCompressionSettings.windowSize
    )
    const compressibleTokens = countMessagesTokens(
      messagesToCompress.map(m => ({ role: m.role, content: m.content })),
      provider
    )

    if (compressibleTokens > contextHistoryBudget) {
      // Emit status: Phase 1 compression
      if (options.onStatusChange) {
        options.onStatusChange('compressing_context', 'Compressing conversation history...')
      }

      logger.info('[ContextManager] Phase 1: Compressing conversation history', {
        compressibleTokens,
        contextHistoryBudget,
        compressibleMessageCount: messagesToCompress.length,
      })

      // Check for cached compression result first (async pre-compression)
      const { cachedCompressionResult } = options
      if (cachedCompressionResult && cachedCompressionResult.compressionApplied) {
        logger.info('[ContextManager] Using cached compression result (async pre-compression)', {
          messageCount: existingMessages.length,
          cachedSavings: cachedCompressionResult.compressionDetails?.totalSavings,
        })
        compressionResult = cachedCompressionResult
        useCompressedContext = true

        if (compressionResult.warnings.length > 0) {
          warnings.push(...compressionResult.warnings.map(w => `[Compression] ${w}`))
        }
      } else {
        // No cached result - perform synchronous compression
        logger.info('[ContextManager] No cached compression, performing sync compression', {
          messageCount: existingMessages.length,
          hasCachedResult: !!cachedCompressionResult,
        })

        const userName = userCharacter?.name || 'User'

        try {
          compressionResult = await applyContextCompression(
            visibleConversation,
            finalSystemPrompt,
            {
              enabled: contextCompressionSettings.enabled,
              windowSize: contextCompressionSettings.windowSize,
              compressionTargetTokens: contextHistoryBudget,
              systemPromptTargetTokens: contextCompressionSettings.systemPromptTargetTokens,
              selection: cheapLLMSelection,
              userId,
              chatId: chat.id,
              characterName: character.name,
              userName,
            }
          )

          useCompressedContext = compressionResult.compressionApplied

          if (compressionResult.warnings.length > 0) {
            warnings.push(...compressionResult.warnings.map(w => `[Compression] ${w}`))
          }

          logger.info('[ContextManager] Phase 1 compression result', {
            compressionApplied: compressionResult.compressionApplied,
            compressionDetails: compressionResult.compressionDetails,
          })
        } catch (error) {
          warnings.push(`Failed to apply context compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Context compression error', {}, error instanceof Error ? error : undefined)
        }
      }
    } else {
      logger.info('[ContextManager] Phase 1 skipped: conversation history within budget', {
        compressibleTokens,
        contextHistoryBudget,
      })
    }
  }

  // If using compressed context, emit the rolling summary as its own system
  // block (block 3) and filter messages down to the recent window. The persona
  // prompt itself stays byte-identical across turns so block 1 keeps caching;
  // the summary churns in its own block where churn is expected.
  let compressedHistoryBlock: string | null = null
  let effectiveMessages = existingMessages

  if (useCompressedContext && compressionResult) {
    compressedHistoryBlock = buildCompressedHistoryBlock(compressionResult.compressedHistory)

    // Only keep window messages (the ones that weren't compressed)
    // Extract visible messages first since we need the count for dynamic window sizing
    const visibleMessages = extractVisibleConversation(existingMessages)

    // Calculate effective window size
    // When using a fallback cache (older compression), we need to include all
    // messages since the compression point, not just the standard windowSize.
    // This ensures no messages are lost when the async compression wasn't ready.
    const standardWindowSize = contextCompressionSettings?.windowSize || 5
    const { cachedCompressionMessageCount } = options

    let effectiveWindowSize = standardWindowSize
    if (cachedCompressionMessageCount !== undefined && cachedCompressionMessageCount < visibleMessages.length) {
      // Cache was computed for fewer visible messages than we have now
      // The compressed history covers messages up to (cachedCount - standardWindowSize)
      // So we need to include all messages after that point
      // Use visibleMessages.length to match the count domain used by triggerAsyncCompression
      const messagesSinceCache = visibleMessages.length - cachedCompressionMessageCount
      effectiveWindowSize = standardWindowSize + messagesSinceCache

      logger.info('[ContextManager] Using dynamic window size for fallback cache', {
        standardWindowSize,
        cachedMessageCount: cachedCompressionMessageCount,
        currentVisibleMessageCount: visibleMessages.length,
        messagesSinceCache,
        effectiveWindowSize,
      })
    }
    const { windowMessages } = splitMessagesForCompression(
      visibleMessages,
      effectiveWindowSize
    )

    // Map back to the original format with all metadata
    // We need to find the corresponding existingMessages for the window
    // Walk backwards through existingMessages to find the last N visible messages
    const windowCount = windowMessages.length
    let found = 0
    let windowStartIndex = existingMessages.length
    for (let i = existingMessages.length - 1; i >= 0 && found < windowCount; i--) {
      const msg = existingMessages[i]
      const role = (msg.role || '').toUpperCase()
      const isVisible = (msg as { type?: string }).type === undefined || (msg as { type?: string }).type === 'message'
      if (isVisible && (role === 'USER' || role === 'ASSISTANT')) {
        found++
        windowStartIndex = i
      }
    }
    effectiveMessages = existingMessages.slice(windowStartIndex)

  }

  // System-prompt token count = persona prompt (always) + compressed-history
  // block (only when compression fired). The two are emitted as separate
  // system messages so their cache lifetimes are decoupled.
  const compressedHistoryBlockTokens = compressedHistoryBlock
    ? estimateTokens(compressedHistoryBlock, provider)
    : 0
  const effectiveSystemPromptTokens = finalSystemPromptTokens + compressedHistoryBlockTokens

  // 1b. Generate memory recap on chat start or character join
  let memoryRecapContent = ''
  let memoryRecapTokens = 0

  if (options.generateMemoryRecap && character.id && options.cheapLLMSelection) {
    // Emit status: memory recap generation (can be slow — involves an LLM call)
    if (options.onStatusChange) {
      options.onStatusChange('generating_recap', `Recalling ${character.name}'s memories...`)
    }

    // Query for the recap's relevant-conversations list: the present moment, as
    // best we can sketch it at chat-start / character-join. Falls back through
    // the freshest signal available.
    const recapRelevanceQuery =
      newUserMessage ||
      (existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].content : '') ||
      chat.scenarioText ||
      chat.contextSummary ||
      ''

    try {
      // The recap is the one context step awaited inline on a visible turn that
      // makes several independent network calls — an embedding for the
      // relevant-conversations search, then the cheap-LLM summarization. Each
      // leg carries its own deadline; this bounds the phase as a whole so no
      // combination of slow legs can leave the turn sitting on "Recalling…".
      // Deliberately above the per-leg budget: a recap that is merely slow in
      // two places is still working, and the recap is optional context.
      const recapResult = await withTimeout(
        generateMemoryRecap(
          character.id,
          character.name,
          options.cheapLLMSelection,
          userId,
          chat.id,
          options.uncensoredFallbackOptions,
          budgetInfo?.maxContext,
          recapRelevanceQuery,
          embeddingProfileId,
        ),
        MEMORY_RECAP_PHASE_TIMEOUT_MS,
        `Memory recap exceeded its ${MEMORY_RECAP_PHASE_TIMEOUT_MS}ms phase budget`,
      )

      if (recapResult.content) {
        memoryRecapContent = recapResult.content
        memoryRecapTokens = estimateTokens(memoryRecapContent, provider)
      }
    } catch (error) {
      warnings.push(`Failed to generate memory recap: ${error instanceof Error ? error.message : 'Unknown error'}`)
      logger.error('[ContextManager] Memory recap generation failed', {
        characterId: character.id,
      }, error instanceof Error ? error : undefined)
    }
  }

  // Emit status: assembling context (after recap, before memory retrieval)
  if (options.onStatusChange) {
    options.onStatusChange('assembling_context', 'Assembling context...')
  }

  // 2. Retrieve and format relevant memories
  let memoryContent = ''
  let memoryTokens = 0
  let memoriesIncluded = 0
  let debugMemories: DebugMemoryInfo[] = []

  // Sentence-shaped recent-window query (item 3): the tail of the conversation
  // as prose rather than a single one-line message, so the embedding represents
  // what this moment is about. Works in continue mode too (no newUserMessage).
  const memorySearchQuery = buildRecentWindowQuery(existingMessages, newUserMessage)

  const tMemoryStart = performance.now()
  let memoryPath: 'skipped' | 'pre-searched' | 'two-pool' = 'skipped'
  let frozenArchiveCount = 0
  let dynamicHeadCount = 0
  // Memory IDs whispered in the dynamic head this turn — persisted to the recall
  // history ring buffer (anti-repetition, item F4) after the build completes.
  let whisperedMemoryIds: string[] = []
  // Turn-level recall signals (retrospective / timeRange / entities) — set by
  // the proactive path via options or by the fallback distillation; consumed
  // by the retrospective head sizing above and the mini-recap below.
  let turnRecallSignals: MemorySearchExtraction | null = null
  if (!skipMemories && character.id) {
    try {
      // Phase 3a/3b: two-pool architecture.
      //
      // The frozen archive (top-N by effective weight at the current
      // compaction generation) is sorted by memory.id so its bytes are
      // identical across turns within a generation — the prefix-cache prize.
      // The dynamic head is the per-turn relevance ranking, capped at a
      // small token budget; entries already in the archive are filtered out
      // so the LLM doesn't see the same memory twice.
      const compactionGen = chat.compactionGeneration ?? 0

      const frozenArchive = await getOrComputeFrozenArchive(character.id, compactionGen)
      const archiveIds = new Set(frozenArchive.map(m => m.id))
      let dynamicHeadResults: SemanticSearchResult[] = []

      // Episodic recall: the turn-level recall signals. The proactive path
      // hands them in via options; the fallback distillation below fills them
      // when the proactive path didn't run. They drive the retrospective
      // cadence — enlarged head here, mini-recap after the whisper assembles.
      turnRecallSignals = options.recallSignals ?? null

      if (options.preSearchedMemories && options.preSearchedMemories.length > 0) {
        memoryPath = 'pre-searched'
        dynamicHeadResults = options.preSearchedMemories.filter(
          r => !archiveIds.has(r.memory.id),
        )
      } else if (memorySearchQuery) {
        memoryPath = 'two-pool'

        // Query unification (item 3): route the dynamic head through the SAME
        // cheap-LLM keyword distillation the proactive path uses, instead of
        // embedding the raw last user message verbatim. The distillation also
        // emits a best-guess turn-level temporal/context, which drives context
        // steering. This branch is the fallback (first turn / continue mode /
        // empty proactive result), so the extra cheap-LLM call is rare — and it
        // degrades gracefully: no cheap-LLM selection, or an empty/failed
        // distillation, falls back to the raw query and today's behavior.
        let distilledQuery = memorySearchQuery
        let turnContext: ContextTag | null = null
        let turnTemporal: TemporalTag | null = null
        if (options.cheapLLMSelection) {
          try {
            // existingMessages here is the trimmed role/content view (not the
            // ChatEvent shape), so map it directly.
            const recentForDistill = existingMessages
              .slice(-12)
              .map(m => {
                const role = m.role.toLowerCase() as 'user' | 'assistant' | 'system'
                const content = role === 'assistant' ? (stripToolArtifacts(m.content || '') ?? '') : (m.content || '')
                return { role, content }
              })
              .filter(m => m.content.length > 0)
            if (newUserMessage) recentForDistill.push({ role: 'user', content: newUserMessage })

            const distill = await extractMemorySearchKeywords(
              recentForDistill,
              character.name,
              options.cheapLLMSelection,
              userId,
              chat.id,
              character.id,
              {
                nowIso: new Date().toISOString(),
                timelineMode: chat.timelineMode ?? 'realtime',
              },
            )
            if (distill.success && distill.result) {
              // Prefer the natural-language paraphrase as the embedding query —
              // a keyword bag throws away the sentence structure the embedding
              // model is trained on and lands in a mushy region of the space.
              // Fall back to the recent-window prose (already in distilledQuery)
              // when the model omits a paraphrase.
              if (distill.result.paraphrase) {
                distilledQuery = distill.result.paraphrase
              } else if (distill.result.keywords.length > 0) {
                distilledQuery = distill.result.keywords.join(' ')
              }
              turnContext = distill.result.context ?? null
              turnTemporal = distill.result.temporal ?? null
              turnRecallSignals = distill.result
            }
          } catch (error) {
            logger.debug('[ContextManager] Dynamic-head keyword distillation failed; using raw query', {
              characterId: character.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        // Characters present in the room this turn (responding character + every
        // other character participant) for the participant-aware boost (item 4).
        // Mirrors the set the orchestrator computes for the proactive path.
        const presentAboutCharacterIds = Array.from(
          new Set(
            [character.id, ...(participantCharacters?.keys() ?? [])].filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          ),
        )

        // Read the instance-wide recall settings and assemble the full per-turn
        // recall context so the dynamic head reads the targeting tags back
        // (see lib/memory/recall-tags.ts). chat.projectId is the rename-proof
        // comparand for scope: narrow gating.
        const recallSettings = await getMemoryRecallSettings()
        const fallbackRetro = turnRecallSignals?.retrospective === true
        const recallContext: RecallContext = {
          currentProjectId: chat.projectId ?? null,
          scopePolicy: recallSettings.scopePolicy,
          turnContext,
          turnTemporal,
          turnRetrospective: fallbackRetro,
          presentAboutCharacterIds,
          expandRelated: recallSettings.expandRelated,
          recentlyWhisperedIds: recentlyWhisperedIdSet(chat.commonplaceRecallHistory),
          // Fresh-event boost (mirrors the proactive path): recent events keep
          // their footing against evergreen memories whatever the retrospective
          // classifier decided; the chat id is the echo guard.
          currentChatId: chat.id,
          nowMs: Date.now(),
        }
        // Retrospective multi-probe (mirrors the proactive path).
        const extraProbes: string[] = []
        if (fallbackRetro && turnRecallSignals) {
          const entityProbe = (turnRecallSignals.entities ?? []).join(' ').trim()
          if (entityProbe) extraProbes.push(entityProbe)
          if (turnRecallSignals.paraphrase && turnRecallSignals.timeRange) {
            extraProbes.push(
              `${turnRecallSignals.paraphrase} (around ${turnRecallSignals.timeRange.from.slice(0, 10)} to ${turnRecallSignals.timeRange.to.slice(0, 10)})`,
            )
          }
        }
        const memoryResults = await searchMemoriesSemantic(
          character.id,
          distilledQuery,
          {
            userId,
            embeddingProfileId,
            // Pull a few more than the head size so the archive-overlap filter
            // still leaves enough candidates to fill the head. Retrospective
            // turns run the enlarged head, so pull proportionally more.
            limit: (fallbackRetro ? RETRO_HEAD_SIZE : DYNAMIC_HEAD_DEFAULT_SIZE) * 3,
            minImportance: minMemoryImportance,
            recallContext,
            entityAnchors: turnRecallSignals?.entities,
            // Ungated from the retrospective flag: a resolved window is useful
            // either way, and the two-stage filter in `searchMemoriesSemantic`
            // (hard filter only when enough hits survive, else the bounded soft
            // boost) makes it starvation-safe. The flag still gates the
            // temporal flip, anti-repetition suspension, and the probes above.
            occurredWithin: turnRecallSignals?.timeRange ?? null,
            extraProbes: extraProbes.length > 0 ? extraProbes : undefined,
          },
        )
        dynamicHeadResults = memoryResults.filter(r => !archiveIds.has(r.memory.id))
      }

      // Recall-on-reference (fourth cadence, part 1): a retrospective turn
      // gets an enlarged head — the turn that needs rich recall is exactly
      // the turn that otherwise gets the smallest window. Budgets decided
      // here, AFTER the signals are known, so the archive takes what's left.
      const isRetrospectiveTurn = turnRecallSignals?.retrospective === true
      const dynamicHeadBudget = Math.min(
        isRetrospectiveTurn ? RETRO_HEAD_TOKEN_BUDGET : DYNAMIC_HEAD_TOKEN_BUDGET,
        budget.memoryBudget,
      )
      const archiveBudget = Math.max(0, budget.memoryBudget - dynamicHeadBudget)
      const archiveFormatted = formatFrozenMemoryArchive(frozenArchive, archiveBudget, provider)
      frozenArchiveCount = archiveFormatted.memoriesUsed

      const headFormatted = formatDynamicMemoryHead(dynamicHeadResults, provider, {
        maxTokens: dynamicHeadBudget,
        maxEntries: isRetrospectiveTurn ? RETRO_HEAD_SIZE : DYNAMIC_HEAD_DEFAULT_SIZE,
      })
      dynamicHeadCount = headFormatted.memoriesUsed

      // The IDs actually whispered this turn (those that cleared the head's
      // token budget), recorded for anti-repetition (item F4).
      whisperedMemoryIds = headFormatted.debugMemories
        .map(d => d.memoryId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)

      const sections: string[] = []
      if (archiveFormatted.content) sections.push(archiveFormatted.content)
      if (headFormatted.content) sections.push(headFormatted.content)
      memoryContent = sections.join('\n\n')
      memoryTokens = archiveFormatted.tokenCount + headFormatted.tokenCount
      memoriesIncluded = archiveFormatted.memoriesUsed + headFormatted.memoriesUsed
      debugMemories = [...archiveFormatted.debugMemories, ...headFormatted.debugMemories]
    } catch (error) {
      warnings.push(`Failed to retrieve memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // 2a-bis. Render the latest scene-state snapshot as the `## Current State`
  // section that prefaces the Commonplace Book whisper. Time is included only
  // when the chat would also announce it via the Host (matches the gate at
  // postHostTimestampAnnouncement below).
  //
  // The Commonplace Book scene-state cache keys per recipient: a participant
  // ID in multi-character chats, the sentinel `__public__` for single-char
  // chats (which post untargeted whispers). When the same target sees the
  // same character with the same action+clothing two turns in a row, the
  // character's block collapses to `### Name — _unchanged_` to keep the
  // whisper from re-establishing several hundred tokens of unchanged
  // wardrobe prose every turn.
  const cacheTargetKey: string =
    isMultiCharacter && respondingParticipant
      ? respondingParticipant.id
      : '__public__'
  const priorCache = chat.commonplaceSceneCache as
    | Record<string, Record<string, SceneStateEmissionEntry>>
    | null
    | undefined
  const priorEmissionByCharacter = new Map<string, SceneStateEmissionEntry>(
    Object.entries(priorCache?.[cacheTargetKey] ?? {}),
  )
  // The tri-tier mount pool (character vault / project stores / Quilltap
  // General) is needed by both the live-wardrobe resolution below and the
  // knowledge retrieval further down. Resolve it at most once per turn, lazily,
  // so turns that need neither pay nothing.
  let _turnMountPool: TieredMountPool | null = null
  const getTurnMountPool = async (): Promise<TieredMountPool> => {
    if (!_turnMountPool) {
      _turnMountPool = await resolveTieredMountPool({
        userId,
        // characterId is REQUIRED for the group tier to resolve — the group
        // tier is keyed on the responding character's own group memberships
        // (never the chat). characterMountPointId remains the fast path for the
        // character vault so the vault lookup is still skipped.
        characterId: character.id ?? null,
        characterMountPointId: character.characterDocumentMountPointId ?? null,
        projectId: options.chat.projectId ?? null,
      })
    }
    return _turnMountPool
  }

  let currentStateContent = ''
  let currentStateTokens = 0
  let emittedSceneStateByCharacter: Map<string, SceneStateEmissionEntry> | null = null
  try {
    const rawScene = (chat as { sceneState?: unknown }).sceneState
    let parsedScene: SceneState | null = null
    if (rawScene) {
      const candidate = typeof rawScene === 'string'
        ? (() => { try { return JSON.parse(rawScene) } catch { return null } })()
        : rawScene
      if (candidate) {
        const result = SceneStateSchema.safeParse(candidate)
        if (result.success) parsedScene = result.data
      }
    }
    let sceneTime: string | null = null
    if (
      options.timestampConfig?.autoPrepend &&
      shouldInjectTimestamp(options.timestampConfig, options.isInitialMessage ?? false, minutesSinceLastTimestampAnnouncement)
    ) {
      sceneTime = calculateCurrentTimestamp(options.timestampConfig, options.timezone).formatted
    }

    // The scene-state tracker owns a concise, salience-based clothing summary
    // (cached in `c.clothing`, keyed by the equipped-outfit hash in
    // `c.clothingHash`). It only re-runs at turn boundaries, so the cached
    // summary can lag a mid-turn wardrobe edit or `wardrobe_*` tool call.
    // Detect that by hashing the live equipped slots and comparing against the
    // hash the cached summary was derived from: only when they differ do we
    // override — and then with a CONCISE title-only description, never the
    // verbose per-item prose. When the wardrobe is unchanged (or the character
    // has none equipped), the cached concise summary stands.
    const liveClothingByCharacterId = new Map<string, string>()
    if (parsedScene && parsedScene.characters.length > 0) {
      const repos = getRepositories()
      await Promise.all(parsedScene.characters.map(async (c) => {
        if (!c.characterId) return
        try {
          const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chat.id, c.characterId)
          if (!hasEquippedItems(equippedSlots)) return
          const liveHash = hashEquippedSlots(equippedSlots)
          // Wardrobe unchanged since the cached summary was derived — keep it.
          if (liveHash === (c.clothingHash ?? null)) return
          const { projectMountPointIds } = await getTurnMountPool()
          const resolved = await resolveEquippedOutfitForCharacter(repos, c.characterId, equippedSlots!, {
            projectMountPointIds,
          })
          const description = describeOutfit({
            top: decorateOutfitItems(resolved.leafItemsBySlot.top, { titleOnly: true }),
            bottom: decorateOutfitItems(resolved.leafItemsBySlot.bottom, { titleOnly: true }),
            footwear: decorateOutfitItems(resolved.leafItemsBySlot.footwear, { titleOnly: true }),
            accessories: decorateOutfitItems(resolved.leafItemsBySlot.accessories, { titleOnly: true }),
          })
          if (description) liveClothingByCharacterId.set(c.characterId, description)
        } catch (error) {
          logger.warn('Failed to read live wardrobe for scene-state clothing override', {
            chatId: chat.id,
            characterId: c.characterId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }))
    }

    const formatted = formatCurrentSceneState(
      parsedScene,
      sceneTime,
      provider,
      liveClothingByCharacterId,
      priorEmissionByCharacter,
    )
    currentStateContent = formatted.content
    currentStateTokens = formatted.tokenCount
    emittedSceneStateByCharacter = formatted.emittedByCharacter
  } catch (error) {
    warnings.push(`Failed to format current scene state: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // 2b. Retrieve inter-character memories in multi-character chats
  let interCharacterMemoryContent = ''
  let interCharacterMemoryTokens = 0
  let interCharacterMemoriesIncluded = 0
  let debugInterCharacterMemories: DebugInterCharacterMemoryInfo[] = []

  const tInterStart = performance.now()
  let interCharacterLoadedCount = 0
  if (!skipMemories && isMultiCharacter && character.id && participantCharacters && allParticipants) {
    try {
      const repos = getRepositories()

      // Get IDs of other characters in this chat (excluding the responding character)
      const otherCharacterIds: string[] = []
      const otherCharacterNames = new Map<string, string>()

      for (const participant of allParticipants) {
        if (participant.type === 'CHARACTER' && participant.characterId && participant.characterId !== character.id) {
          const otherCharacter = participantCharacters.get(participant.characterId)
          if (otherCharacter) {
            otherCharacterIds.push(otherCharacter.id)
            otherCharacterNames.set(otherCharacter.id, otherCharacter.name)
          }
        }
      }

      // Half the remaining memory budget is reserved for inter-character
      // whispers. Current State (rendered above the memory sections) is
      // accounted for here so it doesn't crowd out inter-character lines.
      const interCharacterBudget = Math.floor(
        (budget.memoryBudget - memoryTokens - currentStateTokens) / 2,
      )

      if (otherCharacterIds.length > 0 && interCharacterBudget > 0) {
        // Importance/recency half — direct DB query, top-N per other character.
        const interCharacterMemories = await repos.memories.findByCharacterAboutCharacters(
          character.id,
          otherCharacterIds,
          INTER_CHAR_PER_CHARACTER_LIMIT,
        )

        // Relevance half — semantic search per other character filtered by
        // aboutCharacterId, ranking by relevance to the current moment. Skipped
        // when there is no search query (e.g. continue-mode first turn). Runs
        // concurrently across the present characters.
        let interCharacterRelevance: SemanticSearchResult[] = []
        if (memorySearchQuery) {
          const relevanceLists = await Promise.all(
            otherCharacterIds.map(async (otherId) => {
              try {
                return await searchMemoriesSemantic(character.id!, memorySearchQuery, {
                  userId,
                  embeddingProfileId,
                  limit: INTER_CHAR_RELEVANCE_PER_CHARACTER_LIMIT,
                  minImportance: minMemoryImportance,
                  aboutCharacterId: otherId,
                })
              } catch (relevanceError) {
                logger.warn('[ContextManager] Inter-character relevance search failed', {
                  characterId: character.id,
                  aboutCharacterId: otherId,
                  error: relevanceError instanceof Error ? relevanceError.message : String(relevanceError),
                })
                return [] as SemanticSearchResult[]
              }
            }),
          )
          interCharacterRelevance = relevanceLists.flat()
        }

        interCharacterLoadedCount = interCharacterMemories.length + interCharacterRelevance.length

        if (interCharacterMemories.length > 0 || interCharacterRelevance.length > 0) {
          const formatted = formatInterCharacterMemoriesForContext(
            interCharacterMemories,
            otherCharacterNames,
            interCharacterBudget,
            provider,
            interCharacterRelevance,
          )

          interCharacterMemoryContent = formatted.content
          interCharacterMemoryTokens = formatted.tokenCount
          interCharacterMemoriesIncluded = formatted.memoriesUsed
          debugInterCharacterMemories = formatted.debugMemories

        }
      }
    } catch (error) {
      warnings.push(`Failed to retrieve inter-character memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  if (isMultiCharacter) {
  }

  // 2c. Retrieve relevant knowledge from all three tiers available to the
  // responding character: their own vault, every document store linked to
  // the active project, and the instance-wide Quilltap General mount.
  // Independent of memory retrieval and intentionally NOT fed to the
  // Phase-2 memory compressor below — knowledge files are first-class
  // canon and shouldn't be lossy-summarised. Each tier silently no-ops
  // when its mount(s) aren't available.
  let knowledgeContent = ''
  let knowledgeTokens = 0
  let debugKnowledge: KnowledgeDebugEntry[] = []

  if (
    !skipMemories &&
    character.id &&
    memorySearchQuery &&
    budget.knowledgeBudget > 0
  ) {
    try {
      const { characterMountPointId, groupMountPointIds, projectMountPointIds, globalMountPointId } =
        await getTurnMountPool()

      if (
        characterMountPointId ||
        groupMountPointIds.length > 0 ||
        projectMountPointIds.length > 0 ||
        globalMountPointId
      ) {
        const result = await retrieveKnowledgeForTurn({
          characterId: character.id,
          userId,
          embeddingProfileId,
          query: memorySearchQuery,
          characterMountPointId,
          groupMountPointIds,
          projectMountPointIds,
          globalMountPointId,
          budgetTokens: budget.knowledgeBudget,
          provider,
        })
        knowledgeContent = result.content
        knowledgeTokens = result.tokenCount
        debugKnowledge = result.debug
      }
    } catch (error) {
      warnings.push(
        `Failed to retrieve knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  // ============================================================================
  // Phase 2: Memory Compression (Budget-Driven)
  // ============================================================================

  // If budget-driven compression is active and memories exceed 20% of max_available, compress them
  const totalMemoryTokensBeforeCompression = memoryTokens + interCharacterMemoryTokens
  if (
    compressionEnabled &&
    budgetInfo &&
    cheapLLMSelection &&
    totalMemoryTokensBeforeCompression > 0
  ) {
    const memoryBudget = Math.floor(budgetInfo.maxAvailable * MEMORY_BUDGET_RATIO)

    if (totalMemoryTokensBeforeCompression > memoryBudget) {
      // Emit status: Phase 2 memory compression
      if (options.onStatusChange) {
        options.onStatusChange('compressing_memories', 'Compressing memories...')
      }

      logger.info('[ContextManager] Phase 2: Compressing memories', {
        totalMemoryTokens: totalMemoryTokensBeforeCompression,
        memoryBudget,
        semanticMemoryTokens: memoryTokens,
        interCharacterMemoryTokens,
      })

      // Build uncensored fallback options
      const uncensoredFallback: UncensoredFallbackOptions | undefined =
        options.uncensoredFallbackOptions

      // Compress semantic memories if they exceed their share of the budget
      const semanticMemoryBudget = interCharacterMemoryTokens > 0
        ? Math.floor(memoryBudget * 0.7) // 70% for semantic, 30% for inter-character
        : memoryBudget

      if (memoryContent && memoryTokens > semanticMemoryBudget) {
        try {
          const memCompResult = await compressMemories(
            memoryContent,
            character.name,
            semanticMemoryBudget,
            cheapLLMSelection,
            userId,
            uncensoredFallback,
            chat.id
          )

          if (memCompResult.success && memCompResult.result) {
            logger.info('[ContextManager] Semantic memories compressed', {
              originalTokens: memCompResult.result.originalTokens,
              compressedTokens: memCompResult.result.compressedTokens,
            })
            memoryContent = memCompResult.result.compressedText
            memoryTokens = estimateTokens(memoryContent, provider)
          } else {
            warnings.push(`Failed to compress memories: ${memCompResult.error}`)
          }
        } catch (error) {
          warnings.push(`Error during memory compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Memory compression error', {}, error instanceof Error ? error : undefined)
        }
      }

      // Compress inter-character memories if they exceed their share
      const interCharBudget = memoryBudget - Math.min(memoryTokens, semanticMemoryBudget)
      if (interCharacterMemoryContent && interCharacterMemoryTokens > interCharBudget && interCharBudget > 0) {
        try {
          const interCompResult = await compressMemories(
            interCharacterMemoryContent,
            character.name,
            interCharBudget,
            cheapLLMSelection,
            userId,
            uncensoredFallback,
            chat.id
          )

          if (interCompResult.success && interCompResult.result) {
            logger.info('[ContextManager] Inter-character memories compressed', {
              originalTokens: interCompResult.result.originalTokens,
              compressedTokens: interCompResult.result.compressedTokens,
            })
            interCharacterMemoryContent = interCompResult.result.compressedText
            interCharacterMemoryTokens = estimateTokens(interCharacterMemoryContent, provider)
          } else {
            warnings.push(`Failed to compress inter-character memories: ${interCompResult.error}`)
          }
        } catch (error) {
          warnings.push(`Error during inter-character memory compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Inter-character memory compression error', {}, error instanceof Error ? error : undefined)
        }
      }
    } else {
      logger.info('[ContextManager] Phase 2 skipped: memories within budget', {
        totalMemoryTokens: totalMemoryTokensBeforeCompression,
        memoryBudget,
      })
    }
  }

  // 3. Conversation summary now rides as a Librarian whisper in the
  // transcript (Phase F), so it no longer occupies its own system-prompt
  // section. The chat-level `contextSummary` field is still maintained for
  // other consumers (title generation, danger classification, etc.).
  const summaryTokens = 0

  // 4. Calculate remaining budget for messages
  // Use effective (possibly compressed) system prompt tokens
  const usedTokens = effectiveSystemPromptTokens + memoryRecapTokens + memoryTokens + interCharacterMemoryTokens + summaryTokens
  const remainingBudget = budget.totalLimit - usedTokens - budget.responseReserve

  // 5. Prepare messages based on single vs multi-character mode
  let messagesToProcess: SelectableMessage[]

  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters && messagesWithParticipants) {
    // Multi-character mode: filter by history access, then attribute messages

    // 5a. Filter messages by history access
    const filteredMessages = filterMessagesByHistoryAccess(messagesWithParticipants, respondingParticipant)

    // 5a-bis. Filter whisper messages not visible to this participant
    const whisperFiltered = filterWhisperMessages(filteredMessages, respondingParticipant.id)

    // 5b. Attribute messages for the responding character's perspective
    // (Phase C: join-scenario context for participants without history access
    // is now delivered as a Host whisper at the moment they join, not as a
    // per-turn system-prompt insertion.)
    const attributedMessages = attributeMessagesForCharacter(
      whisperFiltered,
      respondingParticipant.id,
      participantCharacters,
      allParticipants
    )

    // Convert to SelectableMessage format
    messagesToProcess = attributedMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))
  } else {
    // Single-character mode: use effective messages (possibly filtered by compression)
    messagesToProcess = effectiveMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      thoughtSignature: msg.thoughtSignature,
    }))
  }

  // Drop messages already absorbed into the running summary. The Librarian
  // summary whisper survives: it is posted after the fold and its id is not
  // in the anchor set, so the surviving tail begins with the most recent
  // summary whisper followed by post-fold turns. Empty anchor set (fresh
  // chat or post-invalidation) leaves messagesToProcess unchanged.
  const summaryAnchorIds = chat.summaryAnchorMessageIds ?? []
  if (summaryAnchorIds.length > 0) {
    const anchorSet = new Set(summaryAnchorIds)
    const before = messagesToProcess.length
    messagesToProcess = messagesToProcess.filter(m => !m.id || !anchorSet.has(m.id))
  }

  // 6. Select recent messages to fit budget
  const { messages: selectedMessages, tokenCount: messagesTokens, truncated } = selectRecentMessages(
    messagesToProcess,
    Math.min(remainingBudget, budget.recentMessagesBudget),
    provider
  )

  if (truncated) {
    // Check if we should recommend summarization
    const totalMessageTokens = countMessagesTokens(
      messagesToProcess.map(m => ({ role: m.role, content: m.content })),
      provider
    )
    if (shouldSummarizeConversation(messagesToProcess.length, totalMessageTokens, budget.totalLimit)) {
      warnings.push('Conversation is getting long. Consider generating a summary for better context management.')
    }
  }

  // 7. Add new user message (only if provided - not in continue mode)
  const newUserMessageTokens = newUserMessage ? estimateTokens(newUserMessage, provider) + 4 : 0

  // 8. Assemble final context
  const contextMessages: ContextMessage[] = []

  // System block 1 — stable identity stack: character + roleplay template +
  // tool prose. Memories ride as Commonplace Book whispers and conversation
  // summary as a Librarian whisper, so they are NOT here. Across turns of the
  // same character this content is byte-identical (modulo edits to the
  // character) and forms the cacheable prefix for provider prompt caching
  // (Anthropic ephemeral cache, OpenAI automatic prefix cache, etc.).
  contextMessages.push({
    role: 'system',
    content: finalSystemPrompt,
    metadata: { isInjected: true },
  })

  // System block 2 — fully static identity reinforcement. Emitted as a
  // separate system message so block 1 can be marked with a cache breakpoint
  // without the reinforcement's content changes invalidating it. (The
  // reinforcement no longer names individual participants — that list used
  // to live here and bisected the cacheable region; participant attribution
  // now comes from Host roster announcements + per-message `name` fields.)
  const identityReminder = buildIdentityReinforcement(character.name)
  contextMessages.push({
    role: 'system',
    content: identityReminder,
    metadata: { isInjected: true },
  })

  // System block 3 — compressed-history rolling summary, only when budget
  // compression fired. Lives in its own block so its churn (refreshed every
  // few turns by the async compressor) does not invalidate the persona
  // prefix that blocks 1 and 2 form.
  if (compressedHistoryBlock) {
    contextMessages.push({
      role: 'system',
      content: compressedHistoryBlock,
      metadata: { isInjected: true },
    })
  }

  // Add selected conversation messages.
  // The first surviving Librarian summary whisper (after the running-summary
  // fold drops earlier turns) gets a cache breakpoint so the system+tools
  // prefix stays hot across fold events.
  let summaryBreakpointPlaced = false
  for (const msg of selectedMessages) {
    const isSummaryHead = !summaryBreakpointPlaced &&
      typeof msg.content === 'string' &&
      msg.content.startsWith(SUMMARY_CONTENT_PREFIX)
    contextMessages.push({
      role: msg.role.toLowerCase() as 'user' | 'assistant',
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
      cacheControl: isSummaryHead ? { type: 'ephemeral' } : undefined,
    })
    if (isSummaryHead) summaryBreakpointPlaced = true
  }

  // Off-scene character introduction: when a workspace character is
  // name-dropped for the first time in this chat, the Host posts a public
  // introduction. The announcement is persisted to chat history (above) and
  // surfaced to THIS turn's LLM context here so the responding character
  // sees the intro without a one-turn lag.
  if (pendingOffSceneAnnouncement) {
    // Push as 'user' rather than 'assistant': this is a Host voice (external
    // annotation to the responding character), and Anthropic Sonnet 4.6+
    // rejects requests whose final message is role=assistant ("does not
    // support assistant message prefill"). In continue/nudge mode there's
    // no trailing user message to bury this behind, so role mismatch here
    // becomes the prefill 400. Matches the systemSender role-flip in
    // buildMessageContext for the same reason.
    contextMessages.push({
      role: 'user',
      content: pendingOffSceneAnnouncement.content,
    })
  }

  // Phase G: timestamp whisper. When `timestampConfig.autoPrepend` is set and
  // the mode says to inject this turn (`START_ONLY` + isInitialMessage, or
  // `EVERY_MESSAGE`), the Host narrates the current time. The whisper is
  // persisted into the transcript (visible to the user with the Host avatar)
  // and added to this turn's `contextMessages` so the LLM sees it without a
  // one-turn lag. The `{{timestamp}}` template variable path is unaffected.
  if (
    options.timestampConfig?.autoPrepend &&
    shouldInjectTimestamp(options.timestampConfig, options.isInitialMessage ?? false, minutesSinceLastTimestampAnnouncement)
  ) {
    const timestamp = calculateCurrentTimestamp(options.timestampConfig, options.timezone)
    await postHostTimestampAnnouncement({
      chatId: chat.id,
      formatted: timestamp.formatted,
    })
    // Push as 'user' rather than 'assistant': Host timestamps are external
    // annotations, not the character's own speech. Anthropic Sonnet 4.6+
    // rejects role=assistant tails (no prefill), and in continue/nudge mode
    // there is no trailing user message to follow this one. Matches the
    // systemSender role-flip in buildMessageContext.
    contextMessages.push({
      role: 'user',
      content: buildTimestampContent(timestamp.formatted),
    })
  }

  // ORDERING: Core whisper precedes the Commonplace Book whisper, intentionally.
  // You need to know who you are before you can correctly interpret what you
  // remember. If memory arrives first, it can flood identity — the character
  // starts performing the person who had those experiences rather than being
  // the person who grew from them. Identity grounds the speaker; memory then
  // situates them in the moment. Do not reorder these two blocks without
  // re-reading docs/feature-requests/aurora-core-whisper.md first.
  let coreWhisperLLMContext = ''
  if (respondingParticipant && !isContinueMode) {
    try {
      const userChatSettings = await getRepositories().chatSettings.findByUserId(userId)
      const coreCfg = resolveCoreWhisperConfig(
        chat,
        character,
        userChatSettings?.coreWhisper ?? null,
      )
      if (coreCfg.enabled) {
        const eventsForTrigger = await getRepositories().chats.getMessages(chat.id)
        const decision = shouldFireCoreWhisper({
          events: eventsForTrigger,
          respondingParticipantId: respondingParticipant.id,
          isContinue: isContinueMode,
          isNudge: false,
          interval: coreCfg.interval,
          silenceThreshold: coreCfg.silenceThreshold,
          fireOnContextTransition: coreCfg.fireOnContextTransition,
        })
        if (decision.fire) {
          const packet = await assembleCorePacket(character.id, coreCfg.packetTokenBudget)
          if (packet) {
            const personaContent = buildCoreWhisperContent(packet)
            const opaqueContent = buildCoreWhisperOpaqueContent(packet)
            coreWhisperLLMContext = buildCoreWhisperLLMContext(packet)
            const posted = await postCoreWhisper({
              chatId: chat.id,
              targetParticipantId: respondingParticipant.id,
              content: personaContent,
              opaqueContent,
            })
            if (posted) {
              try {
                const refreshed = await getRepositories().chats.getMessages(chat.id)
                const stale = refreshed
                  .filter((m): m is MessageEvent => m.type === 'message')
                  .filter(m =>
                    m.systemSender === 'aurora'
                    && m.systemKind === 'core-whisper'
                    && m.id !== posted.id
                    && Array.isArray(m.targetParticipantIds)
                    && m.targetParticipantIds.includes(respondingParticipant.id)
                  )
                  .map(m => m.id)
                if (stale.length > 0) {
                  const removed = await getRepositories().chats.deleteMessagesByIds(chat.id, stale)
                  logger.info('[CoreWhisper] Swept stale whispers', {
                    chatId: chat.id,
                    messageId: posted.id,
                    targetParticipantId: respondingParticipant.id,
                    deletedCount: removed,
                  })
                }
              } catch (sweepError) {
                logger.error('[CoreWhisper] Failed to sweep stale whispers', {
                  chatId: chat.id,
                  targetParticipantId: respondingParticipant.id,
                  error: getErrorMessage(sweepError),
                }, sweepError as Error)
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('[CoreWhisper] Failed to offer Core packet', {
        chatId: chat.id,
        respondingParticipantId: respondingParticipant.id,
        error: getErrorMessage(error),
      }, error as Error)
    }
  }

  // Recall-on-reference (fourth cadence, part 2): on a retrospective turn,
  // build the scoped mini-recap — a dated, drillable Relevant Past
  // Conversations list from the vault summaries, scoped by the turn's
  // timeRange/entities and closed by the read_conversation call note. Spam
  // guard: skip when a block with the same timeRange/entity signature was
  // emitted within the last few turns (piggybacking the recall-history ring
  // buffer), and dedup conversation IDs against the current on-fold
  // relevant-conversations whisper. Best-effort — never blocks the turn.
  let retrospectiveRecallContent = ''
  let emittedRetroSignature: string | null = null
  if (turnRecallSignals?.retrospective && character.id) {
    try {
      const signals = turnRecallSignals
      const signature = [
        signals.timeRange ? `${signals.timeRange.from}→${signals.timeRange.to}` : '∅',
        ...(signals.entities ?? []).map(e => e.toLowerCase()).sort(),
      ].join('|')
      const recentSignatures = parseRetroSignatures(chat.commonplaceRecallHistory)
      if (!recentSignatures.includes(signature)) {
        const queryParts = [
          signals.paraphrase ?? memorySearchQuery ?? '',
          (signals.entities ?? []).join(', '),
        ].filter(part => part.trim().length > 0)
        const query = queryParts.join(' — ')
        if (query.trim()) {
          const matches = await searchVaultConversationSummaries({
            characterId: character.id,
            query,
            userId,
            embeddingProfileId,
            limit: RETRO_MINI_RECAP_MAX_ENTRIES,
            excludeConversationId: chat.id,
            timeRange: signals.timeRange ?? null,
          })
          // Dedup against the standing on-fold relevant-conversations whisper
          // for the same target — no point listing the same UUID twice.
          const foldWhisperIds = new Set<string>()
          try {
            const messages = await getRepositories().chats.getMessages(chat.id)
            const targetId = isMultiCharacter ? respondingParticipant?.id ?? null : null
            for (const m of messages) {
              if (m.type !== 'message') continue
              const msg = m as MessageEvent
              if (msg.systemSender !== 'commonplaceBook' || msg.systemKind !== 'relevant-conversations') continue
              const ids = msg.targetParticipantIds
              const matchesTarget =
                targetId === null ? ids === null || ids === undefined : Array.isArray(ids) && ids.includes(targetId)
              if (!matchesTarget) continue
              for (const uuid of (msg.content ?? '').matchAll(/`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`/gi)) {
                foldWhisperIds.add(uuid[1])
              }
            }
          } catch {
            // Dedup is best-effort; a duplicate UUID listing is harmless.
          }
          const filtered = matches
            .filter(m => !foldWhisperIds.has(m.conversationId))
            .slice(0, RETRO_MINI_RECAP_MAX_ENTRIES)
          if (filtered.length > 0) {
            retrospectiveRecallContent = `${renderRelevantConversationsBlock(filtered)}\n\n${READ_CONVERSATION_CALL_NOTE}`
            emittedRetroSignature = signature
          }
        }
      } else {
        logger.debug('[CommonplaceWhisper] Retrospective mini-recap suppressed (recent same-signature block)', {
          chatId: chat.id,
          signature,
        })
      }
    } catch (retroError) {
      logger.warn('[CommonplaceWhisper] Retrospective mini-recap failed (non-fatal)', {
        chatId: chat.id,
        characterId: character.id,
        error: getErrorMessage(retroError),
      })
    }
  }

  // Memory tail: persist a single consolidated Commonplace Book whisper to the
  // transcript (visible in the salon UI with the Commonplace Book avatar) AND
  // inline plain "you remember…" framing into the new user message body for
  // this turn's LLM call. The Staff persona stays in the transcript; the LLM
  // receives clean second-person recall, not meta-narrative. The retrospective
  // mini-recap rides the LLM recall text here but is posted as its OWN
  // `retrospective-recall` whisper below (never inside the consolidated body).
  const cmpbParts = {
    currentState: currentStateContent || undefined,
    recap: memoryRecapContent || undefined,
    relevant: memoryContent || undefined,
    interChar: interCharacterMemoryContent || undefined,
    knowledge: knowledgeContent || undefined,
  }
  const personaWhisper = buildCommonplacePersonaWhisper(cmpbParts)
  const llmRecallText = buildCommonplaceLLMContext({
    ...cmpbParts,
    retrospectiveRecall: retrospectiveRecallContent || undefined,
  })

  if (personaWhisper) {
    // Persist the persona-voiced whisper. Targeted to the responding character
    // in multi-character chats; untargeted in single-character (only one
    // character anyway, so no privacy concern).
    const targetParticipantId = isMultiCharacter ? respondingParticipant?.id ?? null : null
    const posted = await postCommonplaceWhisper({
      chatId: chat.id,
      targetParticipantId,
      content: personaWhisper,
      kind: 'consolidated',
    })

    // The Commonplace Book whisper is a snapshot reminder, not a permanent
    // record — once a fresher one lands for this character, every prior
    // commonplaceBook whisper targeted at the same scope is stale. Sweep
    // them after the new one is durably posted (so a write failure on the
    // new one cannot orphan the character with no whisper at all).
    if (posted) {
      // Persist the per-target scene-state emission cache so the NEXT
      // whisper for the same recipient can short-circuit unchanged
      // character sections. Fire-and-forget — a cache-write failure is
      // benign (next turn will re-emit full and reset the cache anyway).
      if (emittedSceneStateByCharacter && emittedSceneStateByCharacter.size > 0) {
        try {
          const slice: Record<string, SceneStateEmissionEntry> = {}
          for (const [characterId, entry] of emittedSceneStateByCharacter) {
            slice[characterId] = entry
          }
          const nextCache: Record<string, Record<string, SceneStateEmissionEntry>> = {
            ...(priorCache ?? {}),
            [cacheTargetKey]: slice,
          }
          await getRepositories().chats.update(chat.id, {
            commonplaceSceneCache: nextCache,
          } as Partial<typeof chat>)
        } catch (cacheError) {
          logger.warn('[CommonplaceWhisper] Failed to persist scene-state cache', {
            chatId: chat.id,
            targetKey: cacheTargetKey,
            error: getErrorMessage(cacheError),
          })
        }
      }

      // Record this turn's whispered memory IDs into the recall-history ring
      // buffer so the next turn's recall can apply the anti-repetition penalty
      // (item F4), plus the retrospective mini-recap signature (spam guard for
      // the fourth cadence). Fire-and-forget — a write failure just means one
      // un-penalized turn.
      if (whisperedMemoryIds.length > 0 || emittedRetroSignature) {
        try {
          let nextHistory = appendRecallTurn(chat.commonplaceRecallHistory, whisperedMemoryIds)
          if (emittedRetroSignature) {
            nextHistory = appendRetroSignature(nextHistory, emittedRetroSignature)
          }
          await getRepositories().chats.update(chat.id, {
            commonplaceRecallHistory: nextHistory,
          } as unknown as Partial<typeof chat>)
        } catch (historyError) {
          logger.warn('[CommonplaceWhisper] Failed to persist recall history', {
            chatId: chat.id,
            error: getErrorMessage(historyError),
          })
        }
      }

      try {
        const refreshed = await getRepositories().chats.getMessages(chat.id)
        const stale = refreshed
          .filter((m): m is MessageEvent => m.type === 'message')
          // Sweep prior consolidated whispers, but NOT the fold-posted
          // `relevant-conversations` whisper — it persists across turns and is
          // swept on its own cadence by the fold refresh.
          .filter(m =>
            m.systemSender === 'commonplaceBook' &&
            m.systemKind !== 'relevant-conversations' &&
            m.id !== posted.id,
          )
          .filter(m => {
            const ids = m.targetParticipantIds
            if (targetParticipantId === null) {
              return ids === null || ids === undefined
            }
            return Array.isArray(ids) && ids.includes(targetParticipantId)
          })
          .map(m => m.id)

        if (stale.length > 0) {
          const removed = await getRepositories().chats.deleteMessagesByIds(chat.id, stale)
          logger.info('[CommonplaceWhisper] Swept stale whispers', {
            chatId: chat.id,
            messageId: posted.id,
            targetParticipantId,
            deletedCount: removed,
          })
        }
      } catch (sweepError) {
        logger.error('[CommonplaceWhisper] Failed to sweep stale whispers', {
          chatId: chat.id,
          targetParticipantId,
          error: getErrorMessage(sweepError),
        }, sweepError as Error)
      }
    }
  }

  // Recall-on-reference: post the mini-recap as its OWN whisper (kind
  // `retrospective-recall`) so the salon shows the dated conversation list
  // distinctly. Posted AFTER the consolidated sweep snapshot so it survives
  // this turn; the next turn's sweep removes it (turn-specific by design —
  // unlike `relevant-conversations`, which the sweep exempts).
  if (retrospectiveRecallContent) {
    try {
      const targetParticipantId = isMultiCharacter ? respondingParticipant?.id ?? null : null
      await postCommonplaceWhisper({
        chatId: chat.id,
        targetParticipantId,
        content: buildCommonplacePersonaWhisper({ retrospectiveRecall: retrospectiveRecallContent }),
        kind: 'retrospective-recall',
      })
    } catch (retroPostError) {
      logger.warn('[CommonplaceWhisper] Failed to post retrospective-recall whisper', {
        chatId: chat.id,
        error: getErrorMessage(retroPostError),
      })
    }
  }

  // Post Office: after the Commonplace Book whisper, check this character's
  // mailbox for letters Suparṇā has not yet announced. Each new letter triggers
  // a Suparṇā whisper — EVENT-like, not a snapshot, so we never sweep prior mail
  // whispers — and is then marked `alerted`.
  //
  // Parent-vs-child write boundary: buildContext runs in both the parent (HTTP)
  // and the forked background-jobs child. The `alerted` flip is a CONTENT update
  // to an existing file (no link/folder deletion, no GC), routed through
  // writeDatabaseDocument; the mount-index partition's writes buffer over IPC in
  // the child and commit parent-side, so the flip replays correctly there too.
  // The whole check is wrapped warn-only — a mail failure must never break the turn.
  let suparnaMailLLMContext = ''
  const mailVaultId = character.characterDocumentMountPointId ?? null
  if (mailVaultId) {
    try {
      const unalerted = await collectUnalertedMail(mailVaultId)
      if (unalerted.length > 0) {
        const targetParticipantId = isMultiCharacter ? respondingParticipant?.id ?? null : null
        await postSuparnaMailWhisper({
          chatId: chat.id,
          targetParticipantId,
          content: buildSuparnaMailWhisper(unalerted),
        })
        suparnaMailLLMContext = buildSuparnaMailLLMContext(unalerted)
        for (const letter of unalerted) {
          await markAlerted(mailVaultId, letter.path)
        }
      }
    } catch (mailError) {
      logger.warn('[Suparna] Mail check failed; turn continues', {
        chatId: chat.id,
        characterId: character.id,
        vaultId: mailVaultId,
        error: getErrorMessage(mailError),
      })
    }
  }

  // Post Office: the block above only covers the RESPONDING (LLM) character's
  // own mailbox. The operator is always playing a character too, and that
  // character never takes an LLM turn — so a letter addressed to it would never
  // be announced. Sweep the operator's character vault(s) as well, posting a
  // whisper targeted at the operator's participant (visible to them, private
  // from the others). Idempotent (markAlerted) and warn-only inside, so it
  // never breaks the turn; the chat-load GET runs the same sweep for idle rooms.
  await surfaceOperatorMailForChat(chat.id, chat.participants)

  // "Nothing to add" turn-skipping: build the ephemeral Turn note when the
  // orchestrator has decided this character may pass. Injected as a trailing
  // context section on the new user message when there is one, or as its own
  // trailing user message on chained/continue turns (no newUserMessage). Never
  // persisted.
  const turnSkipInstruction = options.turnSkip?.offerSkip
    ? buildTurnSkipInstruction(options.turnSkip.characterName, options.turnSkip.recentlyAddressed)
    : ''

  // Add new user message (only if provided - not in continue mode)
  // In multi-character mode, include the user's character name
  if (newUserMessage) {
    let newUserMsgName: string | undefined
    if (isMultiCharacter && allParticipants && participantCharacters) {
      newUserMsgName = findUserParticipantName(allParticipants, participantCharacters, activeUserParticipantId, chat.impersonatingParticipantIds)
    }

    const trailingContextSections: string[] = []
    if (coreWhisperLLMContext) trailingContextSections.push(coreWhisperLLMContext)
    if (llmRecallText) trailingContextSections.push(llmRecallText)
    if (suparnaMailLLMContext) trailingContextSections.push(suparnaMailLLMContext)
    if (turnSkipInstruction) trailingContextSections.push(turnSkipInstruction)
    const composedUserContent = trailingContextSections.length > 0
      ? `${newUserMessage}\n\n---\n\n${trailingContextSections.join('\n\n---\n\n')}`
      : newUserMessage

    contextMessages.push({
      role: 'user',
      content: composedUserContent,
      name: newUserMsgName,
    })
  } else if (turnSkipInstruction) {
    // Chained / continue turns carry no new user message, so the note can't
    // ride as a trailing section above. Push it as its own trailing user
    // message (same off-scene/timestamp pattern) so the model sees it this
    // turn. Anthropic 4.6+ rejects role=assistant tails, so 'user' is required.
    contextMessages.push({
      role: 'user',
      content: turnSkipInstruction,
    })
  }

  // Calculate final token usage
  // Use effective system prompt tokens (possibly compressed)
  const totalMemoryTokens = memoryRecapTokens + memoryTokens + interCharacterMemoryTokens
  const totalUsed = effectiveSystemPromptTokens + totalMemoryTokens + knowledgeTokens + summaryTokens + messagesTokens + newUserMessageTokens
  const totalMemoriesIncluded = memoriesIncluded + interCharacterMemoriesIncluded

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: effectiveSystemPromptTokens,
      memories: totalMemoryTokens,
      knowledge: knowledgeTokens,
      summary: summaryTokens,
      recentMessages: messagesTokens + newUserMessageTokens,
      total: totalUsed,
    },
    budget,
    includedSummary: summaryTokens > 0,
    memoriesIncluded: totalMemoriesIncluded,
    messagesIncluded: selectedMessages.length + (newUserMessage ? 1 : 0), // +1 for new message if provided
    messagesTruncated: truncated,
    warnings,
    // Debug info for the debug panel
    debugMemories,
    debugInterCharacterMemories: debugInterCharacterMemories.length > 0 ? debugInterCharacterMemories : undefined,
    debugKnowledge: debugKnowledge.length > 0 ? debugKnowledge : undefined,
    debugMemoryRecap: memoryRecapContent || undefined,
    debugSummary: chat.contextSummary || undefined,
    debugSystemPrompt: compressedHistoryBlock
      ? `${finalSystemPrompt}\n\n${compressedHistoryBlock}`
      : finalSystemPrompt,
    // Original uncompressed system prompt (for async pre-compression)
    originalSystemPrompt: finalSystemPrompt,
    // Compression info
    compressionApplied: useCompressedContext,
    compressionDetails: compressionResult?.compressionDetails,
  }
}

/**
 * Quick check if context building will likely exceed limits
 * Useful for UI warnings before sending
 */
export function willExceedContextLimit(
  existingMessages: Array<{ content: string }>,
  newMessage: string,
  provider: Provider,
  modelName: string,
  systemPromptEstimate: number = 2000
): { willExceed: boolean; estimatedUsage: number; limit: number; percentUsed: number } {
  const limit = getModelContextLimit(provider, modelName)
  const responseReserve = 4096

  const messagesTokens = countMessagesTokens(
    existingMessages.map(m => ({ role: 'user', content: m.content })),
    provider
  )
  const newMessageTokens = estimateTokens(newMessage, provider)

  const estimatedUsage = systemPromptEstimate + messagesTokens + newMessageTokens + responseReserve
  const percentUsed = Math.round((estimatedUsage / limit) * 100)

  return {
    willExceed: estimatedUsage > limit,
    estimatedUsage,
    limit,
    percentUsed,
  }
}

/**
 * Get context usage status for UI display
 */
export function getContextStatus(
  usedTokens: number,
  totalLimit: number
): {
  level: 'ok' | 'warning' | 'critical'
  percentUsed: number
  remainingTokens: number
  message: string
} {
  const percentUsed = Math.round((usedTokens / totalLimit) * 100)
  const remainingTokens = totalLimit - usedTokens

  if (percentUsed >= 95) {
    return {
      level: 'critical',
      percentUsed,
      remainingTokens,
      message: 'Context nearly full. Consider starting a new conversation or generating a summary.',
    }
  }

  if (percentUsed >= 80) {
    return {
      level: 'warning',
      percentUsed,
      remainingTokens,
      message: 'Context filling up. Older messages may be dropped soon.',
    }
  }

  return {
    level: 'ok',
    percentUsed,
    remainingTokens,
    message: `Using ${percentUsed}% of context window.`,
  }
}
