/**
 * Z.AI Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Z.AI's OpenAI-compatible
 * Chat Completions API at https://api.z.ai/api/paas/v4.
 * Supports the GLM family of models including text, vision, tool use,
 * and native web search via Z.AI's web_search tool.
 */

import OpenAI from 'openai';
import type {
  TextProvider,
  LLMParams,
  LLMResponse,
  StreamChunk,
  LLMMessage,
  FileAttachment,
} from './types';
import {
  applyProfileParameters,
  buildSdkClientOptions,
  createPluginLogger,
  getQuilltapUserAgent,
} from '@quilltap/plugin-utils';
import { STATIC_CHAT_MODEL_IDS, IMAGE_GEN_MODEL_PATTERN } from './models';

const logger = createPluginLogger('qtap-plugin-z-ai');

const Z_AI_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Keys in LLMParams.profileParameters that are forwarded verbatim to the Z.AI
// request body. Allow-listed so a misconfigured profile can't override model,
// messages, stream, etc. See https://docs.z.ai — `thinking` toggles reasoning
// on GLM-4.6V / GLM-4.5 family; `do_sample` disables sampling entirely;
// `reasoning_effort` dials back thinking effort on glm-5.2-and-newer (gated
// in applyProfileParameters — Z.AI only honors it on those models).
const Z_AI_PROFILE_PARAM_ALLOWLIST = ['thinking', 'do_sample', 'reasoning_effort'] as const;

// reasoning_effort is a GLM-5.2-and-newer capability. Parse the
// major[.minor] generation from the model id and compare against 5.2.
// Accepts glm-5.2, glm-5.3, glm-6, glm-5.2-0626, etc.; rejects glm-5.1,
// glm-5, glm-5-turbo, glm-4.x, and the glm-Nv vision family. Parsing the
// numeric generation (rather than matching a fixed id) survives Z.AI
// revisioning the id or shipping a newer generation without a code change.
export function supportsReasoningEffort(model: string): boolean {
  const m = /^glm-(\d+)(?:\.(\d+))?/i.exec(model.trim().toLowerCase());
  if (!m) return false;
  // Exclude the vision family (e.g. glm-5v-turbo): a 'v' immediately
  // follows the major number with no decimal point.
  if (/^glm-\d+v/i.test(model.trim())) return false;
  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  if (major > 5) return true;          // glm-6+, glm-7, …
  if (major < 5) return false;         // glm-4.x and below
  return minor >= 2;                   // glm-5.2, glm-5.3, … (not 5.1, 5, 5-turbo)
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

export class ZAIProvider implements TextProvider {
  private readonly baseUrl = 'https://api.z.ai/api/paas/v4';
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = Z_AI_SUPPORTED_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * @param apiKey - Z.AI API key
   * @param params - Request the client is being built for, so a caller-supplied
   *   budget applies. Omit for metadata calls (model listing, key validation),
   *   which fall back to the shared default rather than the SDK's 10 minutes.
   */
  private createClient(apiKey: string, params: Pick<LLMParams, 'requestTimeoutMs'> = {}): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      ...buildSdkClientOptions(params),
    });
  }

  /**
   * Build a user message's content array with any image attachments.
   * Returns either a plain string (no attachments) or an array of parts.
   *
   * The plugin deliberately does NOT keep its own list of which GLM models
   * read pictures. It kept one until 1.1.24, matching only ids with a `v`
   * immediately after the generation (`glm-4.6v`, `glm-5v`) — and `glm-5.3-flash`
   * reads images without one, so every attachment sent to it was dropped with
   * "does not support image input" while the host had already asserted the
   * opposite. That is bug 91's shape exactly, and the fix is bug 91's fix: one
   * question, one answer. The host has already made the call — a connection
   * profile only carries image attachments this far when its
   * `supportsImageUpload` flag is set, and when it isn't, the describe-fallback
   * has replaced the bytes with text long before the request is built. So an
   * attachment arriving here means the operator has asserted this model reads
   * images, and the plugin's job is to send it.
   */
  private buildUserContent(
    msg: LLMMessage,
    sent: string[],
    failed: { id: string; error: string }[]
  ): string | ChatContentPart[] {
    const attachments = msg.attachments ?? [];

    if (attachments.length === 0) {
      return msg.content;
    }

    const parts: ChatContentPart[] = [];
    if (msg.content) {
      parts.push({ type: 'text', text: msg.content });
    }

    for (const attachment of attachments) {
      if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
        failed.push({
          id: attachment.id,
          error: `Unsupported file type: ${attachment.mimeType}. Z.AI supports: ${this.supportedMimeTypes.join(', ')}`,
        });
        continue;
      }

      const url = this.attachmentToImageUrl(attachment);
      if (!url) {
        failed.push({
          id: attachment.id,
          error: 'Attachment missing data or URL',
        });
        continue;
      }

      parts.push({ type: 'image_url', image_url: { url } });
      sent.push(attachment.id);
    }

    if (parts.length === 0) {
      parts.push({ type: 'text', text: '' });
    }

    return parts;
  }

  private attachmentToImageUrl(attachment: FileAttachment): string | null {
    if (attachment.url) return attachment.url;
    if (attachment.data) return `data:${attachment.mimeType};base64,${attachment.data}`;
    return null;
  }

  private formatMessages(
    messages: LLMMessage[]
  ): { messages: ChatMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];
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

      if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // GLM thinking-mode parity with DeepSeek: when an assistant turn
          // carries tool calls, echo the model's own current-turn
          // `reasoning_content` back so the continuation call keeps a coherent
          // chain. Harmless when thinking is off (field is simply absent).
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
          // Deliberate widening: the message is built as a Record so it can
          // carry Z.AI's non-OpenAI `reasoning_content`, which means it no
          // longer overlaps ChatMessage's discriminated union.
          out.push(assistantMessage as unknown as ChatMessage);
        } else {
          out.push({
            role: 'assistant',
            content: msg.content,
          });
        }
        continue;
      }

      if (msg.role === 'system') {
        out.push({
          role: 'system',
          content: msg.content,
        });
        continue;
      }

      // user
      out.push({
        role: 'user',
        content: this.buildUserContent(msg, sent, failed),
      });
    }

    return { messages: out, attachmentResults: { sent, failed } };
  }

  /**
   * Forward allow-listed Z.AI-specific parameters from the profile into the
   * request body. Caller supplies the `body` object; we mutate it in place.
   */
  private applyProfileParameters(body: Record<string, unknown>, params: LLMParams): void {
    // The copy loop lives in @quilltap/plugin-utils (allow-list, skip
    // undefined/null/empty-string); what stays here is the Z.AI-specific
    // reshaping. This class implements TextProvider directly rather than
    // extending OpenAICompatibleProvider, so it reaches the mechanism by
    // composition — which is why the helper is an exported function.
    applyProfileParameters(body, params, Z_AI_PROFILE_PARAM_ALLOWLIST, (key, value) => {
      // `reasoning_effort` is only honored by glm-5.2-and-newer; never
      // forward it to a model that ignores it (or worse, errors on it).
      if (key === 'reasoning_effort' && !supportsReasoningEffort(params.model)) {
        return undefined;
      }
      // The schema-driven editor stores `thinking` as a flat string
      // ("enabled" / "disabled"); Z.AI's wire shape is `{ type: ... }`
      // (https://docs.z.ai/guides/llm/glm-4.6). Pre-existing profiles that
      // already stored the object form continue to work unchanged.
      if (key === 'thinking' && typeof value === 'string') {
        return { type: value };
      }
      return value;
    });

    // Default to `high` reasoning effort on glm-5.2-and-newer unless thinking
    // is explicitly disabled and no explicit effort was set. GLM-5.2 thinks
    // compulsorily — the `thinking` field defaults to enabled server-side, so
    // a profile left at "(model default)" still thinks, and that is exactly
    // the config that burns output tokens at the API's `max` default. We
    // therefore apply `high` whenever thinking is NOT explicitly disabled
    // (not only when it is explicitly enabled). Read `body.thinking` AFTER the
    // loop above so we see the normalized `{ type }` shape.
    if (supportsReasoningEffort(params.model) && body.reasoning_effort === undefined) {
      const thinkingDisabled = (body.thinking as { type?: string } | undefined)?.type === 'disabled';
      if (!thinkingDisabled) {
        body.reasoning_effort = 'high';
      }
    }
  }

  /**
   * Build the z.ai web_search tool definition.
   * This is Z.AI-specific — it coexists with normal function tools in the tools array.
   * See: https://docs.z.ai/guides/tools/web-search
   */
  private buildWebSearchTool(): Record<string, unknown> {
    return {
      type: 'web_search',
      web_search: {
        enable: 'True',
        search_engine: 'search-prime',
        search_result: 'True',
      },
    };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Z.AI provider requires an API key');
    }

    const client = this.createClient(apiKey, params);
    const { messages, attachmentResults } = this.formatMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: false,
    };

    if (params.stop) {
      body.stop = params.stop;
    }

    const tools: unknown[] = [];
    if (params.webSearchEnabled) {
      tools.push(this.buildWebSearchTool());
    }
    if (params.tools && params.tools.length > 0) {
      tools.push(...params.tools);
    }
    if (tools.length > 0) {
      body.tools = tools;
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

    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
    }

    this.applyProfileParameters(body, params);

    const response = (await client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )) as OpenAI.Chat.Completions.ChatCompletion;

    const choice = response.choices[0];
    const msg = choice.message;

    const reasoningContent = (msg as { reasoning_content?: string }).reasoning_content;

    const toolCalls = (msg.tool_calls ?? [])
      .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        (tc as { type?: string }).type === 'function' || 'function' in tc
      )
      .map((tc) => {
        // z.ai may return arguments as an object instead of a JSON string; normalize it.
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

    const cachedTokens = (response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
      ?.prompt_tokens_details?.cached_tokens;
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined;

    return {
      content: msg.content ?? '',
      finishReason: choice.finish_reason,
      usage: {
        // Exclude cache-read tokens from prompt/total so cached input is not
        // charged against budgets or cost; cacheUsage still reports them for
        // display. (Z.AI folds cached_tokens into prompt_tokens.)
        promptTokens: Math.max(0, (response.usage?.prompt_tokens ?? 0) - (cachedTokens ?? 0)),
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: Math.max(0, (response.usage?.total_tokens ?? 0) - (cachedTokens ?? 0)),
      },
      raw: response,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      attachmentResults,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(cacheUsage ? { cacheUsage } : {}),
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
      throw new Error('Z.AI provider requires an API key');
    }

    const client = this.createClient(apiKey, params);
    const { messages, attachmentResults } = this.formatMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.stop) {
      body.stop = params.stop;
    }

    const tools: unknown[] = [];
    if (params.webSearchEnabled) {
      tools.push(this.buildWebSearchTool());
    }
    if (params.tools && params.tools.length > 0) {
      tools.push(...params.tools);
    }
    if (tools.length > 0) {
      body.tools = tools;
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

    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
    }

    this.applyProfileParameters(body, params);

    const stream = (await client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    // Accumulate tool-call fragments across chunks (same as OpenAI streaming)
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finishReason: string | null = null;
    let usage: OpenAI.Completions.CompletionUsage | null = null;
    // GLM reasoning streams as `delta.reasoning_content` (same field name as
    // DeepSeek) when `thinking: { type: 'enabled' }` is set. Accumulate it and
    // emit cumulatively; the host pipeline treats it as DISPLAY-ONLY.
    let reasoningContent = '';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) {
        if (chunk.usage) usage = chunk.usage;
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

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
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

    const cachedTokens = (usage as { prompt_tokens_details?: { cached_tokens?: number } } | null)
      ?.prompt_tokens_details?.cached_tokens;
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined;

    yield {
      content: '',
      done: true,
      usage: {
        // Cache-read tokens excluded from prompt/total (see sendMessage).
        promptTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - (cachedTokens ?? 0)),
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: Math.max(0, (usage?.total_tokens ?? 0) - (cachedTokens ?? 0)),
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      attachmentResults,
      rawResponse,
      rawProviderUsage: (usage ?? null) as Record<string, unknown> | null,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(cacheUsage ? { cacheUsage } : {}),
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) return false;
    try {
      const client = this.createClient(apiKey);
      await client.models.list();
      return true;
    } catch (error) {
      logger.error(
        'Z.AI API key validation failed',
        { context: 'ZAIProvider.validateApiKey' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    // Z.AI's /models endpoint doesn't always list vision-capable models
    // (e.g. glm-4.5v, glm-4.6v family). Union the API list with our static
    // chat-model catalog, filtering image-generation IDs which are owned by
    // the image provider.
    let apiIds: string[] = [];
    try {
      const client = this.createClient(apiKey);
      const models = await client.models.list();
      apiIds = models.data.map((m) => m.id);
    } catch (error) {
      logger.warn(
        'Failed to fetch Z.AI models dynamically; falling back to static list',
        { context: 'ZAIProvider.getAvailableModels' }
      );
    }
    const merged = new Set<string>(apiIds.filter((id) => !IMAGE_GEN_MODEL_PATTERN.test(id)));
    for (const id of STATIC_CHAT_MODEL_IDS) merged.add(id);
    return Array.from(merged).sort();
  }
}
