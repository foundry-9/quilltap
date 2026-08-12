/**
 * Chat Message Service Types
 *
 * Shared interfaces for the chat message service layer.
 */

import type { ChatMetadataBase, ChatParticipantBase, Character, ChatSettings, ConnectionProfile, MessageEvent, TimestampConfig } from '@/lib/schemas/types'
import type { BuiltContext } from '@/lib/chat/context-manager'
import type { FallbackResult } from '@/lib/chat/file-attachment-fallback'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { DangerousContentSettings, ContextCompressionSettings } from '@/lib/schemas/settings.types'

/**
 * Context passed through the message handling pipeline
 */
export interface MessageServiceContext {
  /** Chat ID */
  chatId: string
  /** User ID */
  userId: string
  /** Repository access */
  repos: ReturnType<typeof getRepositories>
  /** Chat metadata */
  chat: ChatMetadataBase
  /** User participant (user-controlled character) */
  userParticipant: ChatParticipantBase | null
  /** Responding character participant */
  characterParticipant: ChatParticipantBase
  /** Character data */
  character: Character
  /** User character identity data (name and description of the user-controlled character) */
  userCharacter: { name: string; description: string } | null
  /** Connection profile for the LLM */
  connectionProfile: ConnectionProfile
  /** Decrypted API key (empty for providers that don't require it) */
  apiKey: string
  /** Image profile ID (if configured) */
  imageProfileId: string | null
  /** Whether this is a continue/nudge mode message */
  isContinueMode: boolean
  /** Whether this is a multi-character chat */
  isMultiCharacter: boolean
  /** All participants in multi-character chats */
  allParticipants?: ChatParticipantBase[]
  /** Map of character IDs to Character data */
  participantCharacters?: Map<string, Character>
  /** Timestamp configuration */
  timestampConfig?: TimestampConfig | null
  /** Chat settings */
  chatSettings?: {
    cheapLLMSettings?: {
      embeddingProfileId?: string
    }
    defaultRoleplayTemplateId?: string
    defaultTimestampConfig?: TimestampConfig | null
  } | null
  /** Roleplay template (if configured) */
  roleplayTemplate?: { systemPrompt: string } | null
}

/**
 * Pending tool result from user-initiated tool calls (shown in composer before sending)
 */
export interface PendingToolResultInput {
  tool: string
  success: boolean
  result: string
  prompt: string
  arguments: Record<string, unknown>
  createdAt: string
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** User message content (undefined in continue mode) */
  content?: string
  /** File IDs attached to the message */
  fileIds?: string[]
  /** Continue mode (nudge) - trigger character response without user message */
  continueMode?: boolean
  /** Specific participant to respond (for multi-character continue mode) */
  respondingParticipantId?: string
  /**
   * Nudge flag: the human explicitly summoned this specific character to speak
   * (Nudge button / queue). Distinct from an algorithm-picked chained turn.
   * When true, the "nothing to add" skip option is withheld — you don't offer
   * a pass to a voice the operator just called on.
   */
  nudge?: boolean
  /**
   * How a chained turn's speaker was chosen: `queue` (popped from the manual
   * turn queue — treated as summoned) or `algorithm` (weighted rotation — the
   * skip option is offered). Threaded from the turn orchestrator into chained
   * `processMessage` calls; undefined on the initial (non-chained) turn.
   */
  chainSelectionReason?: 'queue' | 'algorithm'
  /**
   * The user-controlled participant the human is "Speaking As" for this turn.
   * When several characters are user-controlled, this decides who a typed
   * message is attributed to (storage + LLM context). Falls back to the
   * persisted `chat.activeTypingParticipantId`, then the first user participant.
   */
  speakingAsParticipantId?: string | null
  /** Pending tool results to be saved as TOOL messages before the user message */
  pendingToolResults?: PendingToolResultInput[]
  /** Target participant IDs for whisper messages (null = visible to all) */
  targetParticipantIds?: string[] | null
  /** Browser User-Agent string from the originating request (scrubbed of Electron/Quilltap tokens) */
  browserUserAgent?: string
  /**
   * Autonomous-room turn flag: when true, the turn-chain pause threshold for
   * all-LLM chats (shouldPauseForAllLLM) is bypassed so the loop continues
   * indefinitely until budget caps or stop conditions fire. Set by the
   * autonomous-room turn handler in `lib/background-jobs/handlers/autonomous-room-turn.ts`.
   */
  neverPauseForUser?: boolean
  /**
   * Autonomous-room turn flag: when true, automatic image pipelines (the
   * Lantern story-background trigger and the wardrobe-driven avatar refresh)
   * are skipped for this turn. Character-invoked image-generation tool calls
   * are unaffected. Set by the autonomous-room turn handler.
   */
  suppressAutomaticImages?: boolean
  /**
   * Autonomous-room turn flag: when true, `executeTurnChain` returns
   * immediately after the initial turn instead of looping to depth-20. The
   * caller (currently the autonomous-room handler) is responsible for
   * enqueueing the next turn as a separate job — that's what gives us:
   *
   *   1. Per-turn flush of buffered writes from the forked job child, so the
   *      next turn's speaker selection sees the messages just written. Without
   *      this, `shouldChainNext` re-reads stale chat history (writes are
   *      buffered in AsyncLocalStorage until job end) and re-picks the same
   *      character every iteration — producing 20× "Friday → Friday → Friday"
   *      chains where Amy is never seen as having spoken.
   *   2. Per-turn budget enforcement. The autonomous-room handler's pre-turn
   *      budget check only fires between jobs, so a 20-deep chain can blow
   *      through caps before anyone notices.
   *
   * Set by `lib/background-jobs/handlers/autonomous-room-turn.ts`.
   */
  singleTurn?: boolean
  /**
   * Autonomous-room turn budget cap (tokens): the maximum context budget this
   * turn may consume, derived from the room's per-run token budget sliced
   * across the turns it should still span (`remaining / turnsLeft`). When set,
   * the context-manager clamps its model-derived `maxAvailable` down to this
   * value before computing the history/memory fold targets, so a token-budgeted
   * room paces itself across a run instead of spending most of the budget on a
   * single oversized turn. Undefined for non-autonomous turns and for rooms
   * without a token budget (`budgetMaxTokens == null`) → unchanged behavior.
   * Set by the autonomous-room turn handler.
   */
  autonomousContextCap?: number
}

/**
 * File attachment with loaded data
 */
export interface AttachedFile {
  id: string
  filepath: string
  filename: string
  mimeType: string
  size: number
}

/**
 * Tool message saved to the chat
 */
export interface ToolMessage {
  toolName: string
  success: boolean
  content: string
  arguments?: Record<string, unknown>
  /** Provider-assigned call ID for native tool result formatting */
  callId?: string
  /**
   * Character offset into the assistant turn's prose at which this tool call
   * fired — i.e. the length of the accumulated response text emitted before
   * the model paused to call the tool. Lets the Salon UI splice the tool block
   * back into the prose at the point it was invoked instead of dumping every
   * call at the bottom of the bubble. Captured in the tool loops against the
   * running `streaming.fullResponse`, then re-based into final stored-content
   * coordinates by the finalizer. Undefined when the position can't be tracked
   * (e.g. agent-mode `submit_final_response` overwrites the whole response).
   */
  anchorOffset?: number
  /**
   * Turn-monotonic sequence number, shared with reasoning segments, that
   * disambiguates ordering when a tool call and a reasoning block land at the
   * same `anchorOffset` (e.g. Anthropic interleaved thinking: thinking → tool →
   * thinking, all before the first prose). The renderer sorts anchored items by
   * `(anchorOffset, seq)` so they appear in true emission order. Undefined on
   * legacy rows, in which case the renderer falls back to array order.
   */
  seq?: number
  metadata?: {
    provider?: string
    model?: string
    expandedPrompt?: string
  }
}

/**
 * One captured reasoning / chain-of-thought block, positioned in the assistant
 * turn's prose the same way tool calls are (see `ToolMessage.anchorOffset`).
 * `content` is the raw reasoning text for this block; `anchorOffset` is the
 * length of the accumulated prose emitted before the block fired; `seq` is the
 * turn-monotonic counter shared with tool anchors for stable interleaving.
 *
 * IMPORTANT: reasoning segments are DISPLAY-ONLY. They are persisted solely so
 * the Salon can show the model's thinking; they are never re-fed to any model
 * as history, summary, or memory. The only place reasoning re-enters a provider
 * request is the in-turn tool round-trip, which uses the in-memory flat
 * `reasoningContent`, never these stored segments.
 */
export interface ReasoningSegment {
  anchorOffset: number
  content: string
  seq: number
}

/**
 * Generated image metadata
 */
export interface GeneratedImage {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  width?: number
  height?: number
  sha256?: string
}

/**
 * Result of processing tool calls
 */
export interface ToolProcessingResult {
  toolMessages: ToolMessage[]
  generatedImagePaths: GeneratedImage[]
}

/**
 * Streaming result data
 */
export interface StreamingResult {
  fullResponse: string
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
  /**
   * Reasoning / chain-of-thought content captured from the stream (DeepSeek
   * `reasoning_content`, etc.). Carried through the in-turn native-tool loop
   * so providers that require it on tool-call round-trips don't 400 on the
   * next request.
   */
  reasoningContent?: string
  /**
   * Positioned reasoning blocks for DISPLAY ONLY (see {@link ReasoningSegment}).
   * Persisted on the assistant message so the Salon can splice thinking into
   * the prose; never re-fed to any model.
   */
  reasoningSegments?: ReasoningSegment[]
}

/**
 * Next speaker information for multi-character chats
 */
export interface NextSpeakerInfo {
  nextSpeakerId: string | null
  reason: string
  cycleComplete: boolean
  isUsersTurn: boolean
}

/**
 * Result returned by the core message processor for chain orchestration
 */
export interface ProcessMessageResult {
  /** Whether the chat has multiple characters */
  isMultiCharacter: boolean
  /** Whether the response had content (non-empty) */
  hasContent: boolean
  /** The assistant message ID (if content was generated) */
  messageId: string | null
  /** User participant ID for turn calculations */
  userParticipantId: string | null
  /** Whether the chat is paused */
  isPaused: boolean
  /**
   * "Nothing to add" turn-skipping: the character passed this turn (posted a
   * Host turn-pass record, persisted no reply). The chain continuation treats
   * this like a content turn — it advances the rotation rather than stopping.
   */
  skipped?: boolean
  /** Participant ID of the character who passed (set when `skipped` is true). */
  skippedParticipantId?: string | null
  /** Scene tracking context for the orchestrator to trigger after chain completion */
  sceneTrackingContext?: {
    connectionProfile: ConnectionProfile
    memoryChatSettings: import('./memory-trigger.service').MemoryChatSettings
    characterIds: string[]
  }
}

/**
 * Resolved dangerous-content state for a message send.
 */
export interface DangerResolutionResult {
  dangerSettings: import('@/lib/schemas/settings.types').DangerousContentSettings
  dangerFlags?: import('@/lib/schemas/chat.types').DangerFlag[]
  effectiveProfile: ConnectionProfile
  effectiveApiKey: string
}

/**
 * Mutable streaming state threaded through the message processing pipeline.
 * Passed by reference to sub-services (failover, finalizer) which mutate it directly,
 * eliminating large destructure/reassign patterns.
 */
export interface StreamingState {
  fullResponse: string
  effectiveProfile: ConnectionProfile
  effectiveApiKey: string
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
  /** Reasoning / chain-of-thought content (DeepSeek thinking mode, etc.). */
  reasoningContent?: string
  /**
   * Positioned reasoning blocks accumulated during the turn, for DISPLAY ONLY
   * (see {@link ReasoningSegment}). Built by the streaming helper as reasoning
   * runs close at prose-resume / tool-call / done boundaries.
   */
  reasoningSegments?: ReasoningSegment[]
  /**
   * How many characters of the cumulative `reasoningContent` have already been
   * flushed into a `reasoningSegments` entry. The un-flushed buffer for the next
   * segment is `reasoningContent.slice(reasoningFlushedLen)`.
   */
  reasoningFlushedLen?: number
  /**
   * Turn-monotonic counter handed out to both reasoning segments and tool
   * anchors so same-offset items keep their true emission order.
   */
  nextTurnSeq?: number
  hasStartedStreaming: boolean
}

/**
 * Compression-related context for message finalization.
 */
export interface CompressionContext {
  existingMessages: MessageEvent[]
  content: string
  builtContext: BuiltContext
  compressionEnabled: boolean
  cheapLLMSelection: CheapLLMSelection | null
  contextCompressionSettings: ContextCompressionSettings
  allProfiles: ConnectionProfile[]
}

/**
 * Background trigger context for memory, danger classification, and scene tracking.
 */
export interface TriggerContext {
  dangerSettings: DangerousContentSettings
  chatSettings: ChatSettings | null
  participantCharacters: Map<string, Character>
  resolvedIdentity: { name: string; description: string; characterId?: string | null }
  userCharacterId?: string
}

/**
 * SSE event: A chained turn is starting for a new character
 */
export interface TurnStartEvent {
  turnStart: true
  participantId: string
  characterName: string
  chainDepth: number
}

/**
 * SSE event: A chained turn completed for a character
 */
export interface TurnCompleteEvent {
  turnComplete: true
  participantId: string
  messageId: string
  chainDepth: number
}

/**
 * SSE event: The chain of turns has finished
 */
export interface ChainCompleteEvent {
  chainComplete: true
  reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete'
  nextSpeakerId: string | null
  chainDepth: number
}

/**
 * Data sent to the client via SSE stream
 */
export interface StreamChunkData {
  content?: string
  /**
   * Cumulative reasoning / chain-of-thought text so far this turn (DISPLAY
   * ONLY). Sent live so the Salon can show the model thinking before/while it
   * answers. The client replaces (not appends) its buffer with each value.
   */
  reasoning?: string
  done?: boolean
  messageId?: string | null
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] } | null
  toolsExecuted?: boolean
  toolsDetected?: number
  toolNames?: string[]
  toolArguments?: Record<string, unknown>[]
  toolResult?: {
    index: number
    name: string
    success: boolean
    result: unknown
  }
  turn?: NextSpeakerInfo
  emptyResponse?: boolean
  emptyResponseReason?: string
  error?: string
  errorType?: string
  details?: string
  debugLLMRequest?: Record<string, unknown>
  fileProcessing?: Array<{
    filename: string
    type: string
    usedImageDescriptionLLM: boolean
    error?: string
  }>
  turnStart?: TurnStartEvent
  turnComplete?: TurnCompleteEvent
  chainComplete?: ChainCompleteEvent
}

/**
 * Context for tool execution within a message
 */
export type { ToolExecutionContext }

/**
 * Built context from context manager
 */
export type { BuiltContext }

/**
 * Fallback result from file attachment processing
 */
export type { FallbackResult }

/**
 * Recovery context and result types
 */
export type { RecoveryContext, RecoveryResult } from './recovery.service'
