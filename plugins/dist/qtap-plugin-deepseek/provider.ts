/**
 * DeepSeek Provider Implementation for Quilltap Plugin
 *
 * Extends the shared OpenAICompatibleProvider base class from
 * @quilltap/plugin-utils to talk to DeepSeek's OpenAI-compatible
 * Chat Completions API at https://api.deepseek.com.
 *
 * The base class already handles message normalization, the OpenAI SDK
 * client, validateApiKey, and getAvailableModels. We override
 * sendMessage / streamMessage to:
 *
 *   - Forward function tools and tool_choice on `deepseek-chat`
 *   - Forward response_format (JSON mode / JSON Schema)
 *   - Surface DeepSeek's prompt-cache hit/miss tokens via cacheUsage
 *   - Accumulate streamed tool-call fragments
 */

import OpenAI from 'openai';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from '@quilltap/plugin-utils';
import type {
  LLMParams,
  LLMResponse,
  StreamChunk,
  LLMMessage,
} from './types';
import { STATIC_MODELS } from './models';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// DeepSeek-specific profile parameters we forward verbatim into the
// request body. Allow-listed so a misconfigured profile cannot override
// model, messages, stream, etc. See https://api-docs.deepseek.com —
// `frequency_penalty` and `presence_penalty` are standard OpenAI params
// but DeepSeek calls them out specifically; `logprobs` and `top_logprobs`
// are supported on chat completions. `thinking` toggles reasoning mode
// (`{ type: 'enabled' | 'disabled' }`); `reasoning_effort` is `'high'`
// or `'max'` on DeepSeek's scale (low/medium fold to high, xhigh to max).
const DEEPSEEK_PROFILE_PARAM_ALLOWLIST = [
  'frequency_penalty',
  'presence_penalty',
  'logprobs',
  'top_logprobs',
  'thinking',
  'reasoning_effort',
] as const;

/**
 * Whether the request we are about to send will be answered by a thinking
 * turn.
 *
 * Two facts, in that order — the same shape the host's `evaluateThinkingTurn`
 * uses, and for the same reason:
 *
 *   1. **The profile's explicit choice.** `thinking: { type: 'enabled' }` or
 *      `{ type: 'disabled' }`, already normalized onto the body by
 *      `normalizeProfileParam`.
 *   2. **The model's own habit.** Absent a choice, the V4 models reason
 *      anyway — `deepseek-v4-flash` returns `reasoning_content` on a profile
 *      carrying `parameters: {}`, which is the default state.
 *
 * Reading only the body was the bug (bug 86): it answers "what did we ask
 * for?" when the question is "what will the model do?", so a profile that had
 * never touched the thinking option was judged not to be thinking and the
 * params below were sent into a request that ignores them.
 *
 * The model lookup is an exact id match against the static catalogue, matching
 * the host. A model DeepSeek serves that the catalogue does not list (an
 * experimental id, say) contributes no habit and falls to `false`.
 */
function willRunThinkingTurn(body: Record<string, unknown>): boolean {
  const thinking = body.thinking;
  if (typeof thinking === 'object' && thinking !== null) {
    const type = (thinking as { type?: string }).type;
    if (type === 'enabled') return true;
    if (type === 'disabled') return false;
  }

  const model = typeof body.model === 'string' ? body.model : undefined;
  if (!model) return false;
  return STATIC_MODELS.find((m) => m.id === model)?.thinksByDefault === true;
}

/**
 * Strip the params DeepSeek ignores while thinking, so we don't send
 * conflicting signals. Call after the profile params have been applied — it
 * reads `body.thinking` and `body.model`.
 */
function stripThinkingIncompatibleParams(body: Record<string, unknown>): void {
  if (!willRunThinkingTurn(body)) return;
  delete body.temperature;
  delete body.top_p;
  delete body.frequency_penalty;
  delete body.presence_penalty;
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(config?: Partial<OpenAICompatibleProviderConfig>) {
    super({
      baseUrl: config?.baseUrl ?? DEEPSEEK_BASE_URL,
      providerName: config?.providerName ?? 'DeepSeek',
      requireApiKey: config?.requireApiKey ?? true,
      attachmentErrorMessage:
        config?.attachmentErrorMessage ??
        'DeepSeek models do not accept file attachments. Send text-only messages.',
    });
  }

  /**
   * Map LLMMessages to OpenAI chat-completion format, preserving
   * assistant tool_calls and tool-result messages so multi-turn tool
   * loops survive a round-trip through DeepSeek.
   */
  private formatMessages(messages: LLMMessage[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        if (!msg.toolCallId) continue;
        out.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // DeepSeek thinking-mode rule: when the assistant turn carries tool
        // calls, `reasoning_content` from the original response MUST be sent
        // back on this turn or the next request 400s. See
        // https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
        const assistantMessage: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
        if (msg.reasoningContent) {
          assistantMessage.reasoning_content = msg.reasoningContent;
        }
        // Deliberate widening: the message is built as a Record so it can carry
        // DeepSeek's non-OpenAI `reasoning_content`, which means it no longer
        // overlaps ChatMessage's discriminated union. Route through unknown.
        out.push(assistantMessage as unknown as ChatMessage);
        continue;
      }

      if (msg.role === 'system') {
        out.push({ role: 'system', content: msg.content });
        continue;
      }

      if (msg.role === 'assistant') {
        out.push({ role: 'assistant', content: msg.content });
        continue;
      }

      // user — DeepSeek does not accept attachments, so we drop them and
      // surface the failure through attachmentResults on the response.
      out.push({ role: 'user', content: msg.content });
    }
    return out;
  }

  /**
   * The base class copies these off `params.profileParameters` (allow-listed;
   * undefined, null and the empty string omit the key). DeepSeek is the one
   * plugin that extends the base, so it inherits the mechanism rather than
   * reaching it by composition the way Z.AI and Ollama do.
   */
  protected override readonly profileParamAllowlist = DEEPSEEK_PROFILE_PARAM_ALLOWLIST;

  protected override normalizeProfileParam(key: string, value: unknown): unknown | undefined {
    // The schema-driven editor stores `thinking` as a flat string
    // ("enabled" / "disabled"); normalize to DeepSeek's wire shape
    // `{ type: ... }`. Pre-existing profiles that already stored the
    // object form continue to work unchanged.
    if (key === 'thinking' && typeof value === 'string') {
      return { type: value };
    }
    return value;
  }

  private extractCacheUsage(usage: DeepSeekUsage | null | undefined) {
    const hit = usage?.prompt_cache_hit_tokens;
    if (hit === undefined || hit <= 0) return undefined;
    return { cacheReadInputTokens: hit, cachedTokens: hit };
  }

  override async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);
    const messages = this.formatMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: false,
    };

    if (params.stop) body.stop = params.stop;

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.toolChoice) body.tool_choice = params.toolChoice;
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: params.responseFormat.jsonSchema,
        };
      }
    }

    // DeepSeek V4+: user_id provides per-character KV-cache isolation
    // (https://api-docs.deepseek.com/quick_start/rate_limit). Quilltap
    // already builds a per-character key in lib/llm/cache-key.ts.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user_id = params.cacheKey;
    }

    this.applyProfileParams(body, params);
    stripThinkingIncompatibleParams(body);

    try {
      const response = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        this.buildRequestOptions(params)
      )) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = response.choices[0];
      const msg = choice.message;
      const reasoningContent = (msg as { reasoning_content?: string }).reasoning_content;

      const toolCalls = (msg.tool_calls ?? [])
        .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          (tc as { type?: string }).type === 'function' || 'function' in tc
        )
        .map((tc) => {
          const rawArgs = tc.function.arguments as unknown;
          const argsString = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
          return {
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: argsString,
            },
          };
        });

      const cacheUsage = this.extractCacheUsage(response.usage as DeepSeekUsage | undefined);

      return {
        content: msg.content ?? '',
        finishReason: choice.finish_reason,
        usage: {
          // Exclude cache-read tokens from prompt/total so cached input is not
          // charged against budgets or cost; cacheUsage still reports them for
          // display. (DeepSeek's prompt_tokens = cache_hit + cache_miss.)
          promptTokens: Math.max(0, (response.usage?.prompt_tokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? 0)),
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: Math.max(0, (response.usage?.total_tokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? 0)),
        },
        raw: response,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        attachmentResults,
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(cacheUsage ? { cacheUsage } : {}),
      };
    } catch (error) {
      this.logger.error(
        'DeepSeek API error in sendMessage',
        { context: 'DeepSeekProvider.sendMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  override async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);
    const messages = this.formatMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.stop) body.stop = params.stop;

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.toolChoice) body.tool_choice = params.toolChoice;
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: params.responseFormat.jsonSchema,
        };
      }
    }

    // DeepSeek V4+: user_id provides per-character KV-cache isolation
    // (https://api-docs.deepseek.com/quick_start/rate_limit). Quilltap
    // already builds a per-character key in lib/llm/cache-key.ts.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user_id = params.cacheKey;
    }

    this.applyProfileParams(body, params);
    stripThinkingIncompatibleParams(body);

    try {
      const stream = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        this.buildRequestOptions(params)
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let finishReason: string | null = null;
      let usage: DeepSeekUsage | null = null;
      let reasoningContent = '';

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          if (chunk.usage) usage = chunk.usage as DeepSeekUsage;
          continue;
        }
        const delta = choice.delta;

        if (delta?.content) {
          yield { content: delta.content, done: false };
        }

        const deltaReasoning = (delta as { reasoning_content?: string } | undefined)?.reasoning_content;
        if (deltaReasoning) {
          reasoningContent += deltaReasoning;
          yield { content: '', done: false, reasoningContent };
        }

        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            const existing = toolCallAccumulator.get(idx) ?? { id: '', name: '', arguments: '' };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.arguments += tcDelta.function.arguments;
            toolCallAccumulator.set(idx, existing);
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage as DeepSeekUsage;
      }

      const toolCalls = Array.from(toolCallAccumulator.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));

      const rawResponse = {
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
              ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            },
            finish_reason: finishReason,
          },
        ],
        usage,
      };

      const cacheUsage = this.extractCacheUsage(usage);

      yield {
        content: '',
        done: true,
        usage: {
          // Cache-read tokens excluded from prompt/total (see sendMessage).
          promptTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? 0)),
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: Math.max(0, (usage?.total_tokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? 0)),
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        attachmentResults,
        rawResponse,
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(cacheUsage ? { cacheUsage } : {}),
      };
    } catch (error) {
      this.logger.error(
        'DeepSeek API error in streamMessage',
        { context: 'DeepSeekProvider.streamMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }
}
