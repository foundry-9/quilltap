/**
 * Anthropic Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Anthropic's Claude API
 * Supports Claude models with multimodal capabilities (text + images + PDFs)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types'
import { buildSdkClientOptions, createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils'

const logger = createPluginLogger('qtap-plugin-anthropic')

// Anthropic supports images, PDFs, and plain text documents
const ANTHROPIC_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/**
 * A text-file attachment's `data` may hold either the raw text or a base64
 * encoding of it. `Buffer.from(s, 'base64')` never throws — it silently mangles
 * non-base64 input (`"hello"` → garbage, `"x=1"` → empty) — so a bare try/catch
 * can't tell the two apart. Round-trip instead: decode, re-encode, and compare
 * (normalizing padding/whitespace). A match means the input really was base64,
 * so return the decoded text; a mismatch means it was plain text all along, so
 * return it verbatim.
 */
function decodeBase64Text(data: string): string {
  const normalize = (s: string): string => s.replace(/\s+/g, '').replace(/=+$/, '')
  const decoded = Buffer.from(data, 'base64')
  if (normalize(decoded.toString('base64')) === normalize(data)) {
    return decoded.toString('utf-8')
  }
  return data
}

// Cache control type for prompt caching
// TTL: '5m' = 5 minutes (default, 1.25x write cost), '1h' = 1 hour (2x write cost)
// Reads are always 0.1x the base input token cost
type CacheControl = { type: 'ephemeral'; ttl?: '5m' | '1h' }

// Content blocks with optional cache_control
type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string }; cache_control?: CacheControl }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; cache_control?: CacheControl }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

// Anthropic profile parameters for cache control and extended thinking
interface AnthropicProfileParams {
  enableCacheBreakpoints?: boolean
  cacheStrategy?: 'system_only' | 'system_and_long_context'
  cacheTTL?: '5m' | '1h'
  // Extended thinking: number of budget tokens (min 1024). When set, enables thinking mode.
  thinkingBudget?: number
  // Alternative flag: enables thinking with a default 4096-token budget.
  extendedThinking?: boolean
}

// Per-character caching is handled here via content-hashed `cache_control`
// breakpoints in `buildCacheControl` and the message-formatting path —
// `params.cacheKey` (Quilltap's per-character routing hint for OpenAI / Grok /
// DeepSeek) is intentionally unused.
export class AnthropicProvider implements TextProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = ANTHROPIC_SUPPORTED_MIME_TYPES
  readonly supportsWebSearch = false

  // Claude Sonnet 5, Claude Opus 5, the Opus 4.7/4.8 family, and Fable/Mythos
  // models remove
  // temperature/top_p/top_k entirely — sending either returns
  // "`temperature` is deprecated for this model" (400), independent of
  // whether extended thinking is enabled. Matched by prefix since these are
  // stable aliases (no dated snapshots).
  private static readonly SAMPLING_PARAMS_REJECTED_MODELS = [
    /^claude-sonnet-5(-|$)/,
    /^claude-opus-5(-|$)/,
    /^claude-opus-4-7(-|$)/,
    /^claude-opus-4-8(-|$)/,
    /^claude-fable-5(-|$)/,
    /^claude-mythos-5(-|$)/,
    /^claude-mythos-preview(-|$)/,
  ]

  private modelRejectsSamplingParams(model: string): boolean {
    return AnthropicProvider.SAMPLING_PARAMS_REJECTED_MODELS.some(re => re.test(model))
  }

  /**
   * Helper to build cache_control object with optional TTL
   * TTL is only included if it's '1h' since '5m' is the default
   */
  private buildCacheControl(ttl?: '5m' | '1h'): CacheControl {
    if (ttl === '1h') {
      return { type: 'ephemeral', ttl: '1h' }
    }
    return { type: 'ephemeral' }
  }

  /**
   * Place a second cache_control breakpoint mid-history when the conversation
   * is long enough that the last-user-message breakpoint can fall outside
   * Anthropic's 20-block lookback. The mid-history index is rounded down to
   * the nearest multiple of MID_BREAKPOINT_STEP so the breakpoint stays at the
   * same content block for several turns, avoiding cache rewrites every turn.
   *
   * Stepping at K=15: between 20–34 messages the breakpoint sits at index 0,
   * between 35–49 at index 15, between 50–64 at index 30, etc.
   */
  private applyMidHistoryBreakpoint(
    messages: AnthropicMessage[],
    ttl?: '5m' | '1h',
  ): void {
    const MIN_MESSAGES_FOR_MID_BREAKPOINT = 20
    const MID_BREAKPOINT_STEP = 15

    if (messages.length < MIN_MESSAGES_FOR_MID_BREAKPOINT) return

    const offsetFromTail = MID_BREAKPOINT_STEP
    const rawIndex = messages.length - offsetFromTail
    const steppedIndex = Math.floor(rawIndex / MID_BREAKPOINT_STEP) * MID_BREAKPOINT_STEP
    if (steppedIndex < 0 || steppedIndex >= messages.length) return

    const target = messages[steppedIndex]
    const targetContent = target.content

    // For string-content messages, lift to a single-block array so we can
    // attach cache_control. For block-array content, decorate the last block.
    if (typeof targetContent === 'string') {
      messages[steppedIndex] = {
        role: target.role,
        content: [{
          type: 'text',
          text: targetContent,
          cache_control: this.buildCacheControl(ttl),
        }],
      }
    } else if (Array.isArray(targetContent) && targetContent.length > 0) {
      const lastBlock = targetContent[targetContent.length - 1]
      const updatedContent = [...targetContent]
      updatedContent[updatedContent.length - 1] = {
        ...lastBlock,
        cache_control: this.buildCacheControl(ttl),
      } as AnthropicContentBlock
      messages[steppedIndex] = { ...target, content: updatedContent }
    }
  }

  private formatMessagesWithAttachments(
    messages: LLMMessage[],
    cacheOptions?: { enableCaching: boolean; strategy: 'system_only' | 'system_and_long_context'; ttl?: '5m' | '1h' }
  ): { messages: AnthropicMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    // Filter out system messages (handled separately in Anthropic)
    // Also filter out tool messages without toolCallId (backward compatibility)
    const nonSystemMessages = messages.filter(m => {
      if (m.role === 'system') return false
      if (m.role === 'tool' && !m.toolCallId) return false
      return true
    })

    // Find last user message index for caching (used in system_and_long_context strategy)
    // Only consider actual user messages, not tool results mapped to user role
    const lastUserMessageIndex = cacheOptions?.enableCaching && cacheOptions.strategy === 'system_and_long_context'
      ? nonSystemMessages.findLastIndex(m => m.role === 'user')
      : -1

    // Build formatted messages, batching consecutive tool results into single user messages
    const formattedMessages: AnthropicMessage[] = []

    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i]

      // Handle tool result messages — batch consecutive ones into a single user message
      if (msg.role === 'tool') {
        const toolResultBlocks: AnthropicContentBlock[] = [
          { type: 'tool_result', tool_use_id: msg.toolCallId!, content: msg.content },
        ]
        // Consume any consecutive tool messages
        while (i + 1 < nonSystemMessages.length && nonSystemMessages[i + 1].role === 'tool') {
          i++
          const nextMsg = nonSystemMessages[i]
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: nextMsg.toolCallId!,
            content: nextMsg.content,
          })
        }
        formattedMessages.push({ role: 'user', content: toolResultBlocks })
        continue
      }

      // Handle assistant messages with toolCalls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const content: AnthropicContentBlock[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.toolCalls) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(tc.function.arguments)
          } catch (e) {
            logger.error('Failed to parse tool call arguments', {
              context: 'AnthropicProvider.formatMessagesWithAttachments',
              toolCallId: tc.id,
              name: tc.function.name,
            }, e instanceof Error ? e : undefined)
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
        formattedMessages.push({ role: 'assistant', content })
        continue
      }

      // Standard user/assistant message handling
      const role = msg.role === 'user' ? 'user' : 'assistant'
      const isLastUserMessage = i === lastUserMessageIndex
      // Honor caller-supplied cacheControl (e.g., the running summary head)
      // even when long-context strategy is off — gives the running-summary
      // path a stable mid-array breakpoint independent of the last-user
      // breakpoint.
      const honorMsgCacheControl = cacheOptions?.enableCaching === true && msg.cacheControl?.type === 'ephemeral'

      // If no attachments, check if we need to add cache control
      if (!msg.attachments || msg.attachments.length === 0) {
        if (isLastUserMessage || honorMsgCacheControl) {
          formattedMessages.push({
            role,
            content: [{
              type: 'text' as const,
              text: msg.content,
              cache_control: this.buildCacheControl(cacheOptions?.ttl),
            }],
          })
        } else {
          formattedMessages.push({
            role,
            content: msg.content,
          })
        }
        continue
      }

      // Build multimodal content array
      const content: AnthropicContentBlock[] = []

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Add file attachments
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Anthropic supports: ${this.supportedMimeTypes.join(', ')}`,
          })
          continue
        }

        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: 'File data not loaded',
          })
          continue
        }

        if (attachment.mimeType === 'application/pdf') {
          // PDF document
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.data,
            },
          })
        } else if (attachment.mimeType === 'text/plain') {
          // Plain text document - use text source type, not base64.
          // `data` may be raw text or base64; only base64-charset, newline-free
          // data is a decode candidate, and decodeBase64Text round-trips to
          // confirm it (a bare decode would mangle already-plain text).
          let textContent = attachment.data
          if (attachment.data && !attachment.data.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(attachment.data)) {
            textContent = decodeBase64Text(attachment.data)
          }
          content.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: textContent,
            },
          })
        } else {
          // Image - mimeType is validated above to be one of the supported image types
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType as ImageMediaType,
              data: attachment.data,
            },
          })
        }
        sent.push(attachment.id)
      }

      // For system_and_long_context, add cache_control to the last content block of the last user message.
      // Also honor caller-supplied cacheControl (running-summary head).
      if ((isLastUserMessage || honorMsgCacheControl) && content.length > 0) {
        const lastBlock = content[content.length - 1]
        content[content.length - 1] = {
          ...lastBlock,
          cache_control: this.buildCacheControl(cacheOptions?.ttl),
        } as AnthropicContentBlock
      }

      formattedMessages.push({
        role,
        content: content.length > 0 ? content : msg.content,
      })
    }

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {

    const client = new Anthropic({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    })

    // Anthropic requires system messages separate from the messages array.
    // Quilltap may emit multiple system messages (a stable identity stack
    // followed by a static identity reminder); concatenate their contents
    // into ordered text blocks below.
    const systemMessages = params.messages.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 0)

    // Extract profile parameters for cache control and extended thinking
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Determine thinking budget: prefer explicit thinkingBudget, fall back to
    // extendedThinking flag with a 4096-token default.
    const rawThinkingBudget = profileParams?.thinkingBudget
    const thinkingBudget = typeof rawThinkingBudget === 'number' && rawThinkingBudget >= 1024
      ? rawThinkingBudget
      : (profileParams?.extendedThinking === true ? 4096 : 0)
    const thinkingEnabled = thinkingBudget > 0

    // Sonnet 5 / Opus 5 / Opus 4.7+ / Fable / Mythos reject both fixed-budget thinking
    // and sampling params (temperature/top_p/top_k) — computed once and used
    // for both decisions below.
    const samplingParamsRejected = this.modelRejectsSamplingParams(params.model)

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    // Long conversations need a second mid-history breakpoint so the active
    // breakpoint never falls outside Anthropic's 20-block lookback.
    if (cachingEnabled) {
      this.applyMidHistoryBreakpoint(messages, cacheTTL)
    }

    // When thinking is enabled, max_tokens must exceed the budget.
    const baseMaxTokens = params.maxTokens ?? 4096
    const effectiveMaxTokens = thinkingEnabled
      ? Math.max(baseMaxTokens, thinkingBudget + 1024)
      : baseMaxTokens

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: effectiveMaxTokens,
    }

    // Enable extended thinking if requested. Sonnet 5 / Opus 4.7+ / Fable /
    // Mythos removed fixed-budget thinking entirely — "thinking.type.enabled"
    // 400s on those models; they require adaptive thinking instead, which has
    // no token budget to set. These models also default thinking.display to
    // "omitted" (empty thinking text) — request "summarized" explicitly so
    // Quilltap's reasoningContent capture keeps working.
    if (thinkingEnabled) {
      requestParams.thinking = samplingParamsRejected
        ? { type: 'adaptive', display: 'summarized' }
        : { type: 'enabled', budget_tokens: thinkingBudget }
    }

    // Handle system messages with optional cache control.
    //
    // When caching is enabled we emit one text block per Quilltap system
    // message and place the cache breakpoint on the FIRST block (the stable
    // identity stack — every byte before this checkpoint becomes the cached
    // prefix). Subsequent system blocks (identity reminder, etc.) follow
    // outside the cached prefix and don't invalidate it on edits.
    //
    // When caching is disabled and there's exactly one system message, we
    // keep the simpler string form for backward-compatibility with logs and
    // upstream tests.
    if (systemMessages.length > 0) {
      if (cachingEnabled) {
        requestParams.system = systemMessages.map((m, i) => {
          const block: AnthropicContentBlock = {
            type: 'text',
            text: m.content as string,
          }
          if (i === 0) {
            block.cache_control = this.buildCacheControl(cacheTTL)
          }
          return block
        })
      } else if (systemMessages.length === 1) {
        requestParams.system = systemMessages[0].content as string
      } else {
        // Multiple system messages without caching: still send as blocks so
        // none get silently dropped.
        requestParams.system = systemMessages.map(m => ({
          type: 'text',
          text: m.content as string,
        }))
      }
    }

    // Anthropic API requires either temperature OR top_p, not both.
    // Extended thinking forbids temperature and top_p — omit them entirely.
    // Sonnet 5 / Opus 4.7+ / Fable / Mythos reject sampling params outright,
    // even with thinking disabled — omit for those models too.
    if (!thinkingEnabled && !samplingParamsRejected) {
      if (params.temperature !== undefined) {
        requestParams.temperature = params.temperature
      } else if (params.topP !== undefined) {
        requestParams.top_p = params.topP
      } else {
        requestParams.temperature = 1.0
      }
    }

    // Build tools array with optional cache control on last tool
    // Tools are cached first in Anthropic's hierarchy: tools → system → messages
    const tools: any[] = params.tools ? [...params.tools] : []

    if (tools.length > 0) {

      // Add cache_control to the last tool when caching is enabled
      if (cachingEnabled) {
        const lastTool = tools[tools.length - 1]
        tools[tools.length - 1] = {
          ...lastTool,
          cache_control: this.buildCacheControl(cacheTTL),
        }

      }

      requestParams.tools = tools
    }

    if (params.stop) {
      const stopArr = (Array.isArray(params.stop) ? params.stop : [params.stop]).filter(Boolean)
      if (stopArr.length > 0) {
        // Anthropic accepts at most 4 stop sequences.
        requestParams.stop_sequences = stopArr.slice(0, 4)
        if (stopArr.length > 4) {
          logger.warn('Anthropic accepts at most 4 stop sequences; truncating', {
            context: 'AnthropicProvider.sendMessage',
            requested: stopArr.length,
          })
        }
      }
    }

    const response = await client.messages.create(requestParams)

    // Extract text by concatenating all text blocks (skip thinking/redacted_thinking/tool_use).
    // When thinking is enabled, content[0] may be a thinking block — indexing [0] would return ''.
    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text as string)
      .join('')

    // Collect thinking block text for reasoningContent
    const thinkingContent = response.content
      .filter((block: any) => block.type === 'thinking')
      .map((block: any) => block.thinking as string)
      .join('')


    // Extract cache usage if available (when prompt caching is enabled)
    const rawUsage = response.usage as any
    const cacheUsage = (rawUsage.cache_creation_input_tokens !== undefined || rawUsage.cache_read_input_tokens !== undefined)
      ? {
          cacheCreationInputTokens: rawUsage.cache_creation_input_tokens,
          cacheReadInputTokens: rawUsage.cache_read_input_tokens,
        }
      : undefined

    return {
      content: textContent,
      finishReason: response.stop_reason ?? 'stop',
      usage: {
        // Anthropic reports input_tokens SEPARATELY from cache_read_input_tokens
        // (and cache_creation_input_tokens), so prompt/total already exclude
        // cache reads — no subtraction needed here, unlike the OpenAI-family
        // plugins. cacheUsage below still reports cache reads for display.
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      raw: response,
      attachmentResults,
      cacheUsage,
      ...(thinkingContent ? { reasoningContent: thinkingContent } : {}),
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {

    const client = new Anthropic({
      apiKey,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    })

    // Quilltap may emit multiple system messages (a stable identity stack
    // followed by a static identity reminder); collect all so block 2 is not
    // silently dropped.
    const systemMessages = params.messages.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 0)

    // Extract profile parameters for cache control and extended thinking
    const profileParams = params.profileParameters as AnthropicProfileParams | undefined
    const cachingEnabled = profileParams?.enableCacheBreakpoints ?? false
    const cacheStrategy = profileParams?.cacheStrategy || 'system_and_long_context'
    const cacheTTL = profileParams?.cacheTTL

    // Determine thinking budget (mirrors sendMessage logic)
    const streamRawThinkingBudget = profileParams?.thinkingBudget
    const streamThinkingBudget = typeof streamRawThinkingBudget === 'number' && streamRawThinkingBudget >= 1024
      ? streamRawThinkingBudget
      : (profileParams?.extendedThinking === true ? 4096 : 0)
    const streamThinkingEnabled = streamThinkingBudget > 0

    // Sonnet 5 / Opus 5 / Opus 4.7+ / Fable / Mythos reject both fixed-budget thinking
    // and sampling params (temperature/top_p/top_k) — computed once and used
    // for both decisions below.
    const streamSamplingParamsRejected = this.modelRejectsSamplingParams(params.model)

    // Format messages with optional cache control
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(
      params.messages,
      cachingEnabled ? { enableCaching: true, strategy: cacheStrategy, ttl: cacheTTL } : undefined
    )

    if (cachingEnabled) {
      this.applyMidHistoryBreakpoint(messages, cacheTTL)
    }

    // When thinking is enabled, max_tokens must exceed the budget.
    const streamBaseMaxTokens = params.maxTokens ?? 4096
    const streamEffectiveMaxTokens = streamThinkingEnabled
      ? Math.max(streamBaseMaxTokens, streamThinkingBudget + 1024)
      : streamBaseMaxTokens

    const requestParams: any = {
      model: params.model,
      messages,
      max_tokens: streamEffectiveMaxTokens,
      stream: true,
    }

    // Enable extended thinking if requested. Sonnet 5 / Opus 4.7+ / Fable /
    // Mythos removed fixed-budget thinking entirely — "thinking.type.enabled"
    // 400s on those models; they require adaptive thinking instead, which has
    // no token budget to set. These models also default thinking.display to
    // "omitted" (empty thinking text) — request "summarized" explicitly so
    // Quilltap's reasoningContent capture keeps working.
    if (streamThinkingEnabled) {
      requestParams.thinking = streamSamplingParamsRejected
        ? { type: 'adaptive', display: 'summarized' }
        : { type: 'enabled', budget_tokens: streamThinkingBudget }
    }

    // Handle system messages with optional cache control. Mirrors the
    // sendMessage path — emit one text block per Quilltap system message and
    // place cache_control on the FIRST block when caching is enabled.
    if (systemMessages.length > 0) {
      if (cachingEnabled) {
        requestParams.system = systemMessages.map((m, i) => {
          const block: AnthropicContentBlock = {
            type: 'text',
            text: m.content as string,
          }
          if (i === 0) {
            block.cache_control = this.buildCacheControl(cacheTTL)
          }
          return block
        })
      } else if (systemMessages.length === 1) {
        requestParams.system = systemMessages[0].content as string
      } else {
        requestParams.system = systemMessages.map(m => ({
          type: 'text',
          text: m.content as string,
        }))
      }
    }

    // Extended thinking forbids temperature and top_p — omit them when enabled.
    // Sonnet 5 / Opus 4.7+ / Fable / Mythos reject sampling params outright,
    // even with thinking disabled — omit for those models too.
    if (!streamThinkingEnabled && !streamSamplingParamsRejected) {
      if (params.temperature !== undefined) {
        requestParams.temperature = params.temperature
      } else if (params.topP !== undefined) {
        requestParams.top_p = params.topP
      } else {
        requestParams.temperature = 1.0
      }
    }

    // Build tools array with optional cache control on last tool
    // Tools are cached first in Anthropic's hierarchy: tools → system → messages
    const tools: any[] = params.tools ? [...params.tools] : []

    if (tools.length > 0) {

      // Add cache_control to the last tool when caching is enabled
      if (cachingEnabled) {
        const lastTool = tools[tools.length - 1]
        tools[tools.length - 1] = {
          ...lastTool,
          cache_control: this.buildCacheControl(cacheTTL),
        }

      }

      requestParams.tools = tools
    }

    if (params.stop) {
      const stopArr = (Array.isArray(params.stop) ? params.stop : [params.stop]).filter(Boolean)
      if (stopArr.length > 0) {
        requestParams.stop_sequences = stopArr.slice(0, 4)
        if (stopArr.length > 4) {
          logger.warn('Anthropic accepts at most 4 stop sequences; truncating', {
            context: 'AnthropicProvider.streamMessage',
            requested: stopArr.length,
          })
        }
      }
    }

    const stream = (await client.messages.create(requestParams)) as unknown as AsyncIterable<any>

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let fullContent = ''
    let stopReason: string | null = null
    let messageId: string | null = null
    let model: string | null = null
    let cacheCreationInputTokens: number | undefined
    let cacheReadInputTokens: number | undefined
    let rawProviderUsage: Record<string, unknown> | null = null
    // Accumulated reasoning from thinking blocks (cumulative)
    let streamReasoning = ''

    // Track all content blocks (text, tool_use, and thinking) for proper detection
    const contentBlocks: Array<{
      type: 'text' | 'tool_use' | 'thinking'
      text?: string
      thinking?: string
      signature?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      partialJson?: string
    }> = []

    for await (const event of stream) {
      // Handle content_block_start - initializes a new content block
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'text') {
          contentBlocks[event.index] = { type: 'text', text: block.text || '' }
        } else if (block.type === 'thinking') {
          // ThinkingBlock: has thinking + signature fields
          contentBlocks[event.index] = { type: 'thinking', thinking: '', signature: '' }
        } else if (block.type === 'tool_use') {

          contentBlocks[event.index] = {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: {},
            partialJson: '',
          }
        }
      }

      // Handle content_block_delta - updates an existing content block
      if (event.type === 'content_block_delta') {
        const delta = event.delta
        const blockIndex = event.index

        if (delta?.type === 'text_delta' && delta?.text) {

          fullContent += delta.text
          // Update the content block
          if (contentBlocks[blockIndex]) {
            contentBlocks[blockIndex].text = (contentBlocks[blockIndex].text || '') + delta.text
          }
          yield {
            content: delta.text,
            done: false,
          }
        } else if (delta?.type === 'thinking_delta' && delta?.thinking) {
          // Accumulate thinking text (cumulative semantics: emit full string each time)
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'thinking') {
            contentBlocks[blockIndex].thinking = (contentBlocks[blockIndex].thinking || '') + delta.thinking
          }
          streamReasoning += delta.thinking
          yield { content: '', done: false, reasoningContent: streamReasoning }
        } else if (delta?.type === 'signature_delta' && delta?.signature) {
          // Accumulate the signature for the current thinking block (needed for tool round-trips)
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'thinking') {
            contentBlocks[blockIndex].signature = (contentBlocks[blockIndex].signature || '') + delta.signature
          }
        } else if (delta?.type === 'input_json_delta' && delta?.partial_json) {
          // Accumulate partial JSON for tool_use blocks
          if (contentBlocks[blockIndex] && contentBlocks[blockIndex].type === 'tool_use') {
            contentBlocks[blockIndex].partialJson = (contentBlocks[blockIndex].partialJson || '') + delta.partial_json

          }
        }
      }

      // Handle content_block_stop - finalize the content block
      if (event.type === 'content_block_stop') {
        const blockIndex = event.index
        const block = contentBlocks[blockIndex]
        // Parse accumulated JSON for tool_use blocks
        if (block && block.type === 'tool_use' && block.partialJson) {
          try {
            block.input = JSON.parse(block.partialJson)

          } catch (e) {
            logger.error('Failed to parse tool use input JSON', {
              context: 'AnthropicProvider.streamMessage',
              index: blockIndex,
              partialJson: block.partialJson,
            }, e instanceof Error ? e : undefined)
          }
          // Clean up partialJson field as it's not part of the API response format
          delete block.partialJson
        }
      }

      // Track usage from message_start event
      if (event.type === 'message_start') {
        totalInputTokens = event.message.usage.input_tokens
        messageId = event.message.id
        model = event.message.model
        // Track cache usage if available
        const rawUsage = event.message.usage as any
        cacheCreationInputTokens = rawUsage.cache_creation_input_tokens
        cacheReadInputTokens = rawUsage.cache_read_input_tokens
        // Snapshot the provider-shape usage object pre-normalization so the
        // logger can detect cache-field-mapping regressions in a SQL query.
        rawProviderUsage = { ...rawUsage }
      }

      // Track usage and stop reason from message_delta event
      if (event.type === 'message_delta') {
        totalOutputTokens = event.usage.output_tokens
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason
        }
        // Merge the delta usage (carries output_tokens and may carry updated
        // cache_*_input_tokens) into the snapshot so the terminal yield
        // surfaces the full provider-shape usage including cache fields.
        if (rawProviderUsage) {
          rawProviderUsage = { ...rawProviderUsage, ...(event.usage as Record<string, unknown>) }
        } else {
          rawProviderUsage = { ...(event.usage as Record<string, unknown>) }
        }
      }

      // Final event
      if (event.type === 'message_stop') {
        // Build cache usage object if available
        const cacheUsage = (cacheCreationInputTokens !== undefined || cacheReadInputTokens !== undefined)
          ? {
              cacheCreationInputTokens,
              cacheReadInputTokens,
            }
          : undefined

        // Count tool_use blocks for logging
        const toolUseCount = contentBlocks.filter(b => b.type === 'tool_use').length

        // Build the full message object for tool call detection.
        // Include thinking blocks with their signatures so multi-turn tool rounds
        // can echo the thinking content back as required by Anthropic's API.
        const fullMessageContent = contentBlocks.length > 0
          ? contentBlocks.map(b => {
              if (b.type === 'thinking') {
                return { type: 'thinking' as const, thinking: b.thinking || '', signature: b.signature || '' }
              }
              if (b.type === 'tool_use') {
                return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input }
              }
              return { type: 'text' as const, text: b.text || '' }
            })
          : [{ type: 'text' as const, text: fullContent }]

        const fullMessage = {
          id: messageId,
          type: 'message' as const,
          role: 'assistant' as const,
          content: fullMessageContent,
          model: model,
          stop_reason: stopReason,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
          },
        }

        yield {
          content: '',
          done: true,
          usage: {
            // input_tokens already excludes cache reads (Anthropic reports them
            // separately), so prompt/total exclude cache reads with no
            // subtraction — see sendMessage. cacheUsage reports them for display.
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          },
          attachmentResults,
          rawResponse: fullMessage,
          rawProviderUsage,
          cacheUsage,
          ...(streamReasoning ? { reasoningContent: streamReasoning } : {}),
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {

      const client = new Anthropic({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      })
      // Anthropic doesn't have a direct validation endpoint, so we make a minimal request
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })

      return true
    } catch (error) {
      logger.error('Anthropic API key validation failed', { context: 'AnthropicProvider.validateApiKey' }, error instanceof Error ? error : undefined)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {

    try {
      const client = new Anthropic({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      })
      const response = await client.models.list()

      // Extract model IDs from the response
      const models: string[] = []
      for await (const model of response) {
        models.push(model.id)
      }

      return models
    } catch (error) {
      logger.error('Failed to fetch Anthropic models from API, using fallback list',
        { context: 'AnthropicProvider.getAvailableModels' },
        error instanceof Error ? error : undefined
      )
      // Fallback to known models if API fails
      const fallbackModels = [
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307',
      ]

      return fallbackModels
    }
  }

}
