/**
 * Streaming Service
 *
 * Handles the streaming response from LLM providers,
 * including chunk processing and stream management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider, type LLMMessage } from '@/lib/llm'
import { buildToolsForProvider, checkModelSupportsTools } from '@/lib/tools'
import { getRepositories } from '@/lib/repositories/factory'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import { computeRequestPrefixHashes } from '@/lib/llm/cache-prefix-hashes'
import { buildCharacterCacheKey } from '@/lib/llm/cache-key'
import { extractFinishReason } from '@/lib/llm/extract-finish-reason'
import { resolveCustomToolRoster, type RosterContext, type DiscoveredCustomTool } from '@/lib/pascal/custom-tools'
import type { ConnectionProfile, ImageProfile, MessageEvent } from '@/lib/schemas/types'
import type { BuiltContext } from '@/lib/chat/context-manager'
import type { FallbackResult } from '@/lib/chat/file-attachment-fallback'
import type { StreamingResult, StreamingState, ReasoningSegment } from './types'

const logger = createServiceLogger('StreamingService')

/**
 * LLM streaming options
 */
export interface StreamOptions {
  messages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    reasoningContent?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    cacheControl?: { type: 'ephemeral' }
  }>
  connectionProfile: ConnectionProfile
  apiKey: string
  modelParams: Record<string, unknown>
  tools: unknown[]
  useNativeWebSearch: boolean
  userId?: string
  messageId?: string
  chatId?: string
  characterId?: string
  /** Previous response ID for conversation chaining (OpenAI Responses API) */
  previousResponseId?: string
  /** Optional provider stop sequences. Mapped per-provider into the SDK's
   * native equivalent (OpenAI/Ollama/OpenRouter: `stop`, Anthropic:
   * `stop_sequences`, Google: `stopSequences`). Pseudo-tool strategies that
   * want a hard termination on their closing marker set this. */
  stop?: string[]
}

/**
 * Debug info to send at start of stream
 */
export interface StreamDebugInfo {
  builtContext: BuiltContext
  connectionProfile: ConnectionProfile
  modelParams: Record<string, unknown>
  messages: Array<{ role: string; contentLength: number; hasAttachments: boolean }>
  tools: unknown[]
  enabledToolOptions?: Record<string, boolean>
  fallbackResults?: FallbackResult[]
}

/**
 * Stream chunk callback
 */
export type StreamChunkCallback = (chunk: {
  content?: string
  done?: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
  rawProviderUsage?: Record<string, unknown> | null
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] }
  rawResponse?: unknown
  thoughtSignature?: string
  reasoningContent?: string
}) => void

/**
 * Metadata about a tool's source for hierarchical filtering
 */
interface ToolSourceMetadata {
  pluginName?: string
  subgroupId?: string
}

/**
 * Check if a tool is disabled based on individual tool disabling or group patterns
 *
 * @param toolId The tool's ID (function name)
 * @param disabledTools List of individually disabled tool IDs
 * @param disabledToolGroups List of disabled group patterns (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem")
 * @param sourceMetadata Metadata about the tool's source (plugin name, subgroup)
 * @returns true if the tool is disabled
 */
function isToolDisabled(
  toolId: string,
  disabledTools: string[],
  disabledToolGroups: string[],
  sourceMetadata: ToolSourceMetadata
): boolean {
  // Never disable request_full_context - it's a critical safety valve
  if (toolId === 'request_full_context') return false

  // Check individual tool disable
  if (disabledTools.includes(toolId)) return true

  // Check plugin-level disable: "plugin:{pluginName}"
  if (sourceMetadata.pluginName) {
    if (disabledToolGroups.includes(`plugin:${sourceMetadata.pluginName}`)) {
      return true
    }

    // Check subgroup-level disable: "plugin:{pluginName}:subgroup:{subgroupId}"
    if (sourceMetadata.subgroupId) {
      if (disabledToolGroups.includes(`plugin:${sourceMetadata.pluginName}:subgroup:${sourceMetadata.subgroupId}`)) {
        return true
      }
    }
  }

  return false
}

/**
 * Build tools for the provider
 */
export async function buildTools(
  connectionProfile: ConnectionProfile,
  imageProfileId: string | null,
  imageProfile: ImageProfile | null,
  userId: string,
  /** Project ID if chat is associated with a project (enables project_info tool) */
  projectId?: string | null,
  /** Whether context compression is enabled (enables request_full_context tool) */
  requestFullContext?: boolean,
  /** List of tool IDs to disable (or undefined to return empty tools for this message) */
  disabledTools?: string[],
  /** List of disabled group patterns (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups?: string[],
  /** Whether agent mode is enabled (enables submit_final_response tool) */
  agentModeEnabled?: boolean,
  /** Whether this is a multi-character chat (enables whisper tool) */
  isMultiCharacter?: boolean,
  /** Whether help tools are enabled for this character (enables help_search and help_settings) */
  helpToolsEnabled?: boolean,
  /** Whether this character can dress themselves (enables wardrobe_list, wardrobe_read, wardrobe_wear, and wardrobe_take_off) */
  canDressThemselves?: boolean,
  /** Whether this character can create new outfits (enables wardrobe_create, wardrobe_update, and wardrobe_archive) */
  canCreateOutfits?: boolean,
  /** Whether document editing tools are enabled (project has linked document stores or files) */
  documentEditingEnabled?: boolean,
  /** Whether the ask_carina tool is enabled for this character */
  askCarinaEnabled?: boolean,
  /**
   * Whether to include the always-on "workspace" tool set (mail, annotations,
   * terminal, conversation reading, self-inventory, RNG/state). Defaults to
   * true. The Brahma Console passes false to strip them.
   */
  includeWorkspaceTools?: boolean,
  /**
   * When true, the `search` tool is built from its Brahma variant whose schema
   * omits the `memories` source (Brahma Console has no memory access).
   */
  excludeMemorySearch?: boolean,
  /**
   * When true, include the read-only `run_sql` tool (Brahma Console only).
   * Execution is additionally gated on `operatorSurface` in the tool executor.
   */
  sqlAccess?: boolean,
  /**
   * Pascal's custom-tool roster perspective — the RESPONDING character's, since
   * a character-tier store shadows the farther tiers. Pass it to offer
   * `run_custom`; omit it (the caller's `customTools` setting is off, or the
   * surface has no roster at all) and the tool is never built.
   *
   * The roster is resolved here rather than by the caller so the work happens
   * only once tools are actually being built — a Courier turn, a profile with
   * `allowToolUse: false`, or the legacy `disabledTools === undefined` bail all
   * return before a single mount is listed. Deliberately NOT cached across
   * turns: a `.tool.json` edited mid-chat must be live on the next call (see
   * the freshness note atop `lib/pascal/custom-tools.ts`).
   */
  customToolContext?: RosterContext | null
): Promise<{
  tools: unknown[]
  modelSupportsNativeTools: boolean
  useNativeWebSearch: boolean
}> {
  const provider = await createLLMProvider(
    connectionProfile.provider,
    connectionProfile.baseUrl || undefined
  )

  const modelSupportsNativeTools = await checkModelSupportsTools(
    connectionProfile.provider,
    connectionProfile.modelName,
    userId
  )

  // Native web search requires both the profile setting AND provider support
  const useNativeWebSearch = connectionProfile.useNativeWebSearch && provider.supportsWebSearch

  // Profile-level tool override - if allowToolUse is explicitly false, skip all tools
  if (connectionProfile.allowToolUse === false) {
    return { tools: [], modelSupportsNativeTools, useNativeWebSearch }
  }

  // Fetch user's plugin tool configurations from database
  let toolConfigs = new Map<string, Record<string, unknown>>()
  try {
    const repos = getRepositories()
    const userPluginConfigs = await repos.pluginConfigs.findByUserId(userId)
    for (const config of userPluginConfigs) {
      // Extract tool name from plugin name (e.g., 'qtap-plugin-curl' -> 'curl')
      const toolName = config.pluginName.replace(/^qtap-plugin-/, '')
      toolConfigs.set(toolName, config.config)
    }

  } catch (configError) {
    logger.warn('Failed to load plugin tool configs, using defaults', {
      userId,
      error: configError instanceof Error ? configError.message : String(configError),
    })
  }

  // If disabledTools is undefined (not an array), skip tools entirely for this message
  // This is a legacy fallback - tools are now always sent with every prompt
  if (disabledTools === undefined) {
    return { tools: [], modelSupportsNativeTools, useNativeWebSearch }
  }

  // Pascal's custom pseudo-tools. Resolved once per turn, at the last possible
  // moment (every early return above skips it entirely). A roster that comes
  // back empty leaves `run_custom` unbuilt — the tool list stays stable for
  // scenes that have no `.tool.json` at all.
  let customTools: DiscoveredCustomTool[] | undefined
  if (customToolContext) {
    try {
      const roster = await resolveCustomToolRoster(customToolContext)
      customTools = [...roster.tools.values()]
    } catch (rosterError) {
      // A broken vault must not take the whole turn down — the character simply
      // goes to the table without their custom tools.
      logger.warn('Failed to resolve custom-tool roster; run_custom withheld', {
        chatId: customToolContext.chatId,
        error: rosterError instanceof Error ? rosterError.message : String(rosterError),
      })
    }
  }

  // Web search tool is independent of native web search - user can enable both
  let tools = await buildToolsForProvider(connectionProfile.provider, {
    imageGeneration: !!imageProfileId,
    imageProviderType: imageProfile?.provider,
    webSearch: connectionProfile.allowWebSearch,
    projectInfo: !!projectId,
    requestFullContext: !!requestFullContext,
    agentMode: !!agentModeEnabled,
    helpSearch: !!helpToolsEnabled,
    helpSettings: !!helpToolsEnabled,
    helpNavigate: !!helpToolsEnabled,
    wardrobeList: canDressThemselves !== false,
    wardrobeRead: canDressThemselves !== false,
    wardrobeWear: canDressThemselves !== false,
    wardrobeTakeOff: canDressThemselves !== false,
    wardrobeCreate: canCreateOutfits !== false,
    wardrobeUpdate: canCreateOutfits !== false,
    wardrobeArchive: canCreateOutfits !== false,
    whisper: !!isMultiCharacter,
    documentEditing: !!documentEditingEnabled,
    askCarina: askCarinaEnabled,
    includeWorkspaceTools: includeWorkspaceTools !== false,
    excludeMemorySearch: !!excludeMemorySearch,
    sqlAccess: !!sqlAccess,
    customTools,
    toolConfigs,
  })

  // Filter out disabled tools (individual IDs and group patterns)
  const hasDisabledTools = disabledTools.length > 0
  const hasDisabledGroups = disabledToolGroups && disabledToolGroups.length > 0

  if (hasDisabledTools || hasDisabledGroups) {
    // Build a map of tool name -> source metadata for group filtering
    // We need to know which plugin/subgroup each tool came from
    const toolSourceMap = new Map<string, ToolSourceMetadata>()

    // Get hierarchy info from all plugins that support it
    const allPlugins = (await import('@/lib/plugins/tool-registry')).toolRegistry.getAllPlugins()
    for (const plugin of allPlugins) {
      if (typeof plugin.getToolHierarchy === 'function') {
        try {
          const pluginName = plugin.metadata.toolName
          const config = toolConfigs.get(pluginName) || {}
          const hierarchy = await plugin.getToolHierarchy(config)

          for (const info of hierarchy) {
            toolSourceMap.set(info.toolId, {
              pluginName,
              subgroupId: info.subgroupId,
            })
          }
        } catch (err) {
          logger.warn('Failed to get tool hierarchy for filtering', {
            plugin: plugin.metadata.toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    const originalCount = tools.length
    tools = tools.filter((tool: unknown) => {
      // Get tool name from the tool object (handle different formats)
      const toolObj = tool as { function?: { name?: string }; name?: string }
      const toolName = toolObj.function?.name || toolObj.name
      if (!toolName) return true // Keep tools without names

      // Get source metadata for this tool (may be empty for built-in tools)
      const sourceMetadata = toolSourceMap.get(toolName) || {}

      // Check if tool is disabled (handles both individual and group patterns)
      return !isToolDisabled(
        toolName,
        disabledTools,
        disabledToolGroups || [],
        sourceMetadata
      )
    })

  }

  return { tools, modelSupportsNativeTools, useNativeWebSearch }
}

/**
 * Stream a message from the LLM
 */
export async function* streamMessage(
  options: StreamOptions
): AsyncGenerator<{
  content?: string
  done?: boolean
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
  rawProviderUsage?: Record<string, unknown> | null
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] }
  rawResponse?: unknown
  thoughtSignature?: string
  reasoningContent?: string
}> {
  const { messages, connectionProfile, apiKey, modelParams, tools, useNativeWebSearch, userId, messageId, chatId, characterId, previousResponseId, stop } = options

  const provider = await createLLMProvider(
    connectionProfile.provider,
    connectionProfile.baseUrl || undefined
  )

  // Cast messages to LLMMessage[] - the role type is constrained to valid values
  const llmMessages = messages.map(m => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: m.content,
    attachments: m.attachments,
    name: m.name,
    thoughtSignature: m.thoughtSignature,
    reasoningContent: m.reasoningContent,
    toolCallId: m.toolCallId,
    toolCalls: m.toolCalls,
    cacheControl: m.cacheControl,
  })) as LLMMessage[]

  // Track timing and accumulated content
  const startTime = Date.now()
  let chunkCount = 0
  let totalContentLength = 0
  let accumulatedContent = ''
  let lastUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  let lastCacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | undefined
  let lastRawProviderUsage: Record<string, unknown> | null = null

  const cacheKey = buildCharacterCacheKey(characterId)

  for await (const chunk of provider.streamMessage(
    {
      messages: llmMessages,
      model: connectionProfile.modelName,
      temperature: modelParams.temperature as number | undefined,
      maxTokens: modelParams.maxTokens as number | undefined,
      topP: modelParams.topP as number | undefined,
      tools: tools.length > 0 ? tools : undefined,
      webSearchEnabled: useNativeWebSearch,
      profileParameters: modelParams,
      cacheKey,
      previousResponseId,
      stop,
    },
    apiKey
  )) {
    chunkCount++
    if (chunk.content) {
      // Normalize content that may be wrapped in content block format
      // e.g., [{'type': 'text', 'text': "actual content"}]
      const normalizedContent = normalizeContentBlockFormat(chunk.content)
      if (normalizedContent !== chunk.content) {
        chunk.content = normalizedContent
      }
      totalContentLength += chunk.content.length
      accumulatedContent += chunk.content
    }
    if (chunk.usage) {
      lastUsage = chunk.usage
    }
    if (chunk.cacheUsage) {
      lastCacheUsage = chunk.cacheUsage
    }
    // Snapshot the provider-shape `usage` object pre-normalization so future
    // plugin regressions (provider reports cached tokens but plugin never
    // reads the field) show up as `rawProviderUsage` populated while
    // `cacheUsage` is null. Each plugin populates this on its terminal chunk;
    // shape is provider-specific (OpenAI/Grok/Z.AI: `prompt_tokens_details`
    // or `input_tokens_details`; Anthropic: `cache_read_input_tokens`;
    // Google: `usageMetadata.cachedContentTokenCount`).
    if (chunk.rawProviderUsage && typeof chunk.rawProviderUsage === 'object') {
      lastRawProviderUsage = chunk.rawProviderUsage as Record<string, unknown>
    }
    if (chunk.done) {

      // Log the LLM call if userId is provided
      if (userId) {
        const durationMs = Date.now() - startTime
        const requestHashes = computeRequestPrefixHashes(llmMessages, tools.length > 0 ? tools : undefined)
        const finishReason = extractFinishReason(chunk.rawResponse)

        logLLMCall({
          userId,
          type: 'CHAT_MESSAGE',
          messageId,
          chatId,
          characterId,
          provider: connectionProfile.provider,
          modelName: connectionProfile.modelName,
          connectionProfileId: connectionProfile.id,
          request: {
            messages: llmMessages.map(m => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
            })),
            temperature: modelParams.temperature as number | undefined,
            maxTokens: modelParams.maxTokens as number | undefined,
            tools: tools.length > 0 ? tools : undefined,
          },
          response: {
            content: accumulatedContent,
            finishReason,
          },
          usage: lastUsage,
          cacheUsage: lastCacheUsage,
          rawProviderUsage: lastRawProviderUsage,
          requestHashes,
          durationMs,
        }).catch(err => {
          logger.warn('Failed to log LLM call from streaming service', {
            userId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }
    yield chunk
  }
}

/**
 * Send debug info at start of stream
 */
export function encodeDebugInfo(
  encoder: TextEncoder,
  debugInfo: StreamDebugInfo
): Uint8Array {
  const { builtContext, connectionProfile, modelParams, messages, tools } = debugInfo

  const llmRequestDetails = {
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    temperature: modelParams.temperature,
    maxTokens: modelParams.maxTokens,
    topP: modelParams.topP,
    messageCount: messages.length,
    hasTools: tools.length > 0,
    tools: tools.length > 0 ? tools : undefined,
    messages: messages,
    contextManagement: {
      tokenUsage: builtContext.tokenUsage,
      budget: {
        total: builtContext.budget.totalLimit,
        responseReserve: builtContext.budget.responseReserve,
      },
      memoriesIncluded: builtContext.memoriesIncluded,
      messagesIncluded: builtContext.messagesIncluded,
      messagesTruncated: builtContext.messagesTruncated,
      includedSummary: builtContext.includedSummary,
      debugMemories: builtContext.debugMemories,
      debugSummary: builtContext.debugSummary,
      debugSystemPrompt: builtContext.debugSystemPrompt,
    },
  }

  return encoder.encode(`data: ${JSON.stringify({ debugLLMRequest: llmRequestDetails })}\n\n`)
}

/**
 * Send fallback processing info
 */
export function encodeFallbackInfo(
  encoder: TextEncoder,
  fallbackResults: FallbackResult[]
): Uint8Array {
  const fallbackInfo = fallbackResults.map((result) => ({
    filename: result.processingMetadata?.originalFilename || 'Unknown',
    type: result.type,
    usedImageDescriptionLLM: result.processingMetadata?.usedImageDescriptionLLM || false,
    error: result.error,
  }))

  return encoder.encode(`data: ${JSON.stringify({ fileProcessing: fallbackInfo })}\n\n`)
}

/**
 * Encode a content chunk
 */
export function encodeContentChunk(encoder: TextEncoder, content: string): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
}

/**
 * Encode a live reasoning ("thinking") chunk for the client. The payload is the
 * CUMULATIVE reasoning text so far — the client replaces (not appends) its
 * buffer with each value. DISPLAY ONLY: the client decides whether to render it
 * based on the chat's thinking-visibility setting; it is never fed to a model.
 */
export function encodeReasoningChunk(encoder: TextEncoder, reasoning: string): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ reasoning })}\n\n`)
}

/**
 * Hand out the next turn-monotonic sequence number, shared between reasoning
 * segments and tool-call anchors so same-offset items keep their true emission
 * order when the Salon interleaves them.
 */
export function nextTurnSeq(streaming: Pick<StreamingState, 'nextTurnSeq'>): number {
  const seq = streaming.nextTurnSeq ?? 0
  streaming.nextTurnSeq = seq + 1
  return seq
}

/**
 * Capture reasoning from a stream chunk and forward it live to the client.
 *
 * Providers emit `reasoningContent` CUMULATIVELY (the full thinking-so-far on
 * each reasoning-bearing chunk), so we last-wins it onto the streaming state
 * and push the cumulative value down to the client. DISPLAY ONLY — the captured
 * value is never re-fed to a model except the in-turn tool round-trip, which
 * reads `streaming.reasoningContent` directly (not over SSE).
 */
export function applyReasoningChunk(
  streaming: Pick<StreamingState, 'reasoningContent'>,
  chunk: { reasoningContent?: string },
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): void {
  if (!chunk.reasoningContent) return
  if (chunk.reasoningContent === streaming.reasoningContent) return
  streaming.reasoningContent = chunk.reasoningContent
  safeEnqueue(controller, encodeReasoningChunk(encoder, chunk.reasoningContent))
}

/**
 * Close the current reasoning run into a positioned {@link ReasoningSegment} if
 * any reasoning has accumulated since the last flush. Call this at every
 * reasoning→non-reasoning boundary: when prose resumes, immediately before a
 * tool-call batch is anchored, and on the terminal chunk. Snapshots the prose
 * offset (`streaming.fullResponse.length`) at the flush instant and stamps the
 * shared turn sequence so interleaved thinking/tool/thinking renders in order.
 *
 * Cumulative reasoning means the un-flushed buffer is
 * `reasoningContent.slice(reasoningFlushedLen)`. DISPLAY ONLY.
 */
export function flushReasoningSegment(streaming: StreamingState): void {
  const full = streaming.reasoningContent ?? ''
  const flushed = streaming.reasoningFlushedLen ?? 0
  if (full.length <= flushed) return
  const content = full.slice(flushed)
  // Advance the cursor regardless so we never re-flush this span.
  streaming.reasoningFlushedLen = full.length
  if (content.trim().length === 0) return
  if (!streaming.reasoningSegments) streaming.reasoningSegments = []
  const segment: ReasoningSegment = {
    anchorOffset: streaming.fullResponse.length,
    content,
    seq: nextTurnSeq(streaming),
  }
  streaming.reasoningSegments.push(segment)
}

/**
 * Encode the done event
 */
export function encodeDoneEvent(
  encoder: TextEncoder,
  data: {
    messageId: string | null
    participantId?: string | null
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
    cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
    toolsExecuted: boolean
    turn?: {
      nextSpeakerId: string | null
      reason: string
      cycleComplete: boolean
      isUsersTurn: boolean
    }
    emptyResponse?: boolean
    emptyResponseReason?: string
    provider?: string
    modelName?: string
    isSilentMessage?: boolean
    /** The Courier: signals that this done event closes a parked placeholder turn,
     * not an actual streamed response. The Salon should skip its optimistic
     * assistant-message push and rely on the prior fetchChat() refresh. */
    pendingExternalTurn?: boolean
    /** Full reasoning ("thinking") text for the turn — DISPLAY ONLY. Lets the
     * client's optimistic assistant-message push carry thinking without a refetch. */
    reasoningContent?: string | null
    /** Positioned reasoning blocks — DISPLAY ONLY (see ReasoningSegment). */
    reasoningSegments?: ReasoningSegment[] | null
    /**
     * "Nothing to add" turn-skipping: this turn was passed. The client resets
     * its streaming buffer without appending a bubble or toasting (the Host
     * turn-pass announcement already carries the visible note).
     */
    skipped?: boolean
    /** Participant ID of the character who passed (set when `skipped` is true). */
    skippedParticipantId?: string | null
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ done: true, ...data })}\n\n`)
}

/**
 * Encode an error event
 */
export function encodeErrorEvent(
  encoder: TextEncoder,
  error: string,
  errorType: string,
  details: string
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ error, errorType, details })}\n\n`)
}

/**
 * Encode a keep-alive/heartbeat ping
 * SSE comment lines (starting with :) are ignored by clients but keep the connection alive
 */
export function encodeKeepAlive(encoder: TextEncoder): Uint8Array {
  return encoder.encode(': keep-alive\n\n')
}

/**
 * Encode a status update event for UI feedback during response generation
 */
export function encodeStatusEvent(
  encoder: TextEncoder,
  status: {
    stage: string
    message: string
    toolName?: string
    characterName?: string
    characterId?: string
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ status })}\n\n`)
}

/**
 * Encode a Courier "pending external turn" event. The Salon uses this to
 * surface the placeholder bubble with a copy-out / paste-back affordance.
 */
export function encodePendingExternalTurnEvent(
  encoder: TextEncoder,
  data: { messageId: string; participantId: string; characterName: string }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ pendingExternalTurn: true, ...data })}\n\n`)
}

/**
 * Encode a turn start event (chained character about to respond)
 */
export function encodeTurnStartEvent(
  encoder: TextEncoder,
  data: { participantId: string; characterName: string; chainDepth: number }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ turnStart: true, ...data })}\n\n`)
}

/**
 * Encode a turn complete event (chained character finished responding)
 */
export function encodeTurnCompleteEvent(
  encoder: TextEncoder,
  data: { participantId: string; messageId: string; chainDepth: number; skipped?: boolean }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ turnComplete: true, ...data })}\n\n`)
}

/**
 * Encode a chain complete event (all chained turns done)
 */
export function encodeChainCompleteEvent(
  encoder: TextEncoder,
  data: {
    reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete'
    nextSpeakerId: string | null
    chainDepth: number
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ chainComplete: true, ...data })}\n\n`)
}

/**
 * Encode a Carina reference-answer event.
 *
 * Emitted the instant a Carina answer is persisted (the user's `@Name:`/`@Name?`
 * markup, a character's `@Name:` markup, or the `ask_carina` tool) so the Salon
 * can surface the answer bubble immediately rather than waiting for the post-turn
 * `fetchChat()` refresh. Carries the full posted message so the client can insert
 * it — and render it with the answerer's own avatar — without an extra round-trip.
 *
 * The client inserts optimistically and dedupes by `id`; the end-of-turn
 * `fetchChat()` replaces the array with the authoritative, pre-rendered copy
 * (same `id`), so there is no duplicate.
 */
export function encodeCarinaAnswerEvent(
  encoder: TextEncoder,
  message: MessageEvent
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ carinaAnswer: message })}\n\n`)
}

/**
 * Encode a Host announcement event.
 *
 * Emitted the instant a Host announcement is persisted mid-turn — currently
 * the "nothing to add" turn-pass note — so the Salon can surface the Host
 * bubble immediately rather than waiting for the post-turn `fetchChat()`
 * refresh. Carries the full posted message; the client inserts optimistically
 * and dedupes by `id`, and the end-of-turn refresh replaces it with the
 * authoritative pre-rendered copy (same `id`), so there is no duplicate.
 */
export function encodeHostAnnouncementEvent(
  encoder: TextEncoder,
  message: MessageEvent
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ hostAnnouncement: message })}\n\n`)
}

/**
 * Encode a Pascal custom-tool outcome event.
 *
 * Emitted the instant Pascal's outcome is persisted mid-turn — a character
 * reached for a `run_custom` tool and the dice have fallen — so the Salon can
 * surface the outcome bubble immediately rather than waiting for the post-turn
 * `fetchChat()` refresh. Carries the full posted message (`pascalMeta` and all)
 * so the client can insert it without an extra round-trip.
 *
 * The client inserts optimistically and dedupes by `id`; the end-of-turn
 * `fetchChat()` replaces the array with the authoritative, pre-rendered copy
 * (same `id`), so there is no duplicate.
 */
export function encodePascalResultEvent(
  encoder: TextEncoder,
  message: MessageEvent
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ pascalResult: message })}\n\n`)
}

/**
 * Emitted once the answer-confirmation check resolves for a just-streamed
 * message. Carries the confirmation state for the badge, and — only when the
 * re-affirmation rewrote the reply — the replacement `content` so the client
 * can swap the optimistic bubble text in place. The visible swap is a
 * deliberate transparency feature, not a glitch to hide.
 */
export function encodeConfirmationResultEvent(
  encoder: TextEncoder,
  result: {
    messageId: string
    confirmed: boolean | null
    revised: boolean
    notes: string | null
    content?: string
  }
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ confirmationResult: result })}\n\n`)
}

/**
 * Safely enqueue data to a stream controller
 * Returns true if successful, false if the controller is already closed
 */
export function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  data: Uint8Array
): boolean {
  try {
    controller.enqueue(data)
    return true
  } catch (error) {
    // Controller is already closed (client disconnected, timeout, etc.)

    return false
  }
}

/**
 * Safely close a stream controller
 */
export function safeClose(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close()
  } catch {
    // Already closed - ignore
  }
}

/**
 * Create streaming response result
 */
export function createStreamingResult(
  fullResponse: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null,
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null,
  rawResponse: unknown,
  thoughtSignature?: string,
  reasoningContent?: string,
  reasoningSegments?: ReasoningSegment[]
): StreamingResult {
  return {
    fullResponse,
    usage,
    cacheUsage,
    attachmentResults,
    rawResponse,
    thoughtSignature,
    reasoningContent,
    reasoningSegments,
  }
}
