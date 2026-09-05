/**
 * OpenRouter Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenRouter's API
 * Supports 100+ models including GPT-4, Claude, Gemini, Llama and more
 *
 * Updated to use SDK v0.8.0 with callModel() and getTextStream() for improved streaming
 */

import { OpenRouter } from '@openrouter/sdk';
import { fromChatMessages } from '@openrouter/sdk/lib/chat-compat';
import type { ChatMessages, ChatResult, OpenResponsesResult } from '@openrouter/sdk/models';
import type {
  TextProvider,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from './types';
import { buildRequestAbortSignal, createPluginLogger, getQuilltapUserAgent, resolveRequestTimeoutMs } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

/**
 * OpenRouter provider preferences for fine-grained provider control
 */
interface OpenRouterProviderPreferences {
  order?: string[];              // Provider priority: ["Anthropic", "AWS Bedrock"]
  allowFallbacks?: boolean;      // Allow fallback to other providers (default: true)
  requireParameters?: boolean;   // Only use providers supporting all params
  dataCollection?: 'allow' | 'deny';  // ZDR privacy control
  ignore?: string[];             // Providers to skip
  only?: string[];               // Use only these providers
}

/**
 * OpenRouter-specific profile parameters
 *
 * Two shapes are accepted for backward compatibility:
 * - The original nested `providerPreferences` object — still written by
 *   profiles that predate the provider-options-schema refactor.
 * - The flat keys (`enableZDR`, `useCustomModel`, etc.) written by the
 *   schema-driven profile editor. `useCustomModel` is a UI directive and
 *   is intentionally not consumed here.
 */
interface OpenRouterProfileParams {
  fallbackModels?: string[];
  providerPreferences?: OpenRouterProviderPreferences;
  enableZDR?: boolean;
  useCustomModel?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoningEffort?: string;
}

/**
 * Merge the legacy nested `providerPreferences` shape with the flat keys
 * written by the schema-driven profile editor. Flat keys take precedence
 * because they are what the new UI emits.
 */
function resolveProviderPrefs(
  profileParams: OpenRouterProfileParams | undefined
): OpenRouterProviderPreferences | undefined {
  if (!profileParams) return undefined;
  const merged: OpenRouterProviderPreferences = { ...(profileParams.providerPreferences ?? {}) };
  if (profileParams.enableZDR === true) {
    merged.dataCollection = 'deny';
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Image MIME types OpenRouter will serialise as `image_url` content-parts and
 * forward to the routed model. This is the single source of truth: `index.ts`
 * imports it for `attachmentSupport.supportedMimeTypes`, so the declaration
 * the plugin registry reads can no longer drift from what the wire actually
 * carries (bug 97).
 */
export const SUPPORTED_IMAGE_MIME_TYPES: string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export class OpenRouterProvider implements TextProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes: string[] = SUPPORTED_IMAGE_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * Build the OpenAI Chat Completions content field for a message.
   * Returns a plain string when there are no image attachments, or a
   * content-parts array (text + image_url) for vision-model requests.
   */
  private buildMessageContent(m: LLMMessage): string | OpenAIContentPart[] {
    const images = (m.attachments ?? []).filter(
      (a) => SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType) && (a.data || a.url)
    );
    if (images.length === 0) return m.content;

    const parts: OpenAIContentPart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of images) {
      const url = img.url ?? `data:${img.mimeType};base64,${img.data}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return parts;
  }

  /**
   * Categorize attachments into sent (image attachments now formatted
   * inline as content parts) and failed (everything else — non-image
   * MIME types and image rows missing both data and url).
   */
  private collectAttachmentResults(params: LLMParams): {
    sent: string[];
    failed: { id: string; error: string }[];
  } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      for (const a of msg.attachments ?? []) {
        if (SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType)) {
          if (a.data || a.url) {
            sent.push(a.id);
          } else {
            failed.push({ id: a.id, error: 'Image attachment missing data and url' });
          }
        } else {
          failed.push({
            id: a.id,
            error: `OpenRouter ${a.mimeType} attachments are not yet implemented`,
          });
        }
      }
    }
    return { sent, failed };
  }

  private hasImageAttachments(params: LLMParams): boolean {
    return params.messages.some((m) =>
      (m.attachments ?? []).some(
        (a) => SUPPORTED_IMAGE_MIME_TYPES.includes(a.mimeType) && (a.data || a.url)
      )
    );
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentResults(params);

    // Vision (image attachment) sends can't go through the SDK's non-streaming
    // request path: @openrouter/sdk's chat.send() rejects OpenAI content-parts
    // (image_url) messages at client-side input validation, so the image never
    // reaches the model. Route those around the SDK through a direct Chat
    // Completions fetch — the same escape hatch streamMessage() already uses for
    // image/tool requests. No-image sends keep the SDK path unchanged.
    if (this.hasImageAttachments(params)) {
      return this.sendViaChatCompletions(params, apiKey, attachmentResults);
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
      // Non-streaming, so bounding the whole request is right. Without this the
      // SDK default would let a silent endpoint hold a turn open indefinitely.
      timeoutMs: resolveRequestTimeoutMs(params),
    });

    // Convert messages to OpenRouter format, formatting image attachments
    // as inline content parts when present (OpenAI Chat Completions vision
    // schema). Non-image attachments are surfaced via attachmentResults.failed.
    const messages = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: this.buildMessageContent(m) as any,
        };
      });

    const requestParams: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stop: params.stop,
      stream: false,
    };

    // Forward Quilltap's per-character cache identifier as `user`. OpenAI-
    // routed downstreams use it as a sticky-routing hint; other downstreams
    // (Anthropic, etc.) ignore it.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.user = params.cacheKey;
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto';
    }

    // Add web search plugin if enabled
    if (params.webSearchEnabled) {
      requestParams.plugins = [{ id: 'web', maxResults: 5 }];
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        requestParams.responseFormat = {
          type: 'json_schema',
          jsonSchema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema,
          },
        };
      } else if (params.responseFormat.type !== 'text') {
        requestParams.responseFormat = { type: params.responseFormat.type };
      }
    }

    // Handle OpenRouter-specific profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Add model fallbacks if configured
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = 'fallback';
      delete requestParams.model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = resolveProviderPrefs(profileParams);
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    // Enable reasoning output for models that support it in the non-streaming path.
    const sendReasoningEffort = profileParams?.reasoningEffort;
    if (typeof sendReasoningEffort === 'string' && sendReasoningEffort.length > 0) {
      requestParams.reasoning = { effort: sendReasoningEffort, exclude: false };
    } else {
      requestParams.reasoning = { exclude: false };
    }

    // Non-streaming send: @openrouter/sdk 0.13 types chat.send() as a
    // ChatResult | EventStream union, so narrow to ChatResult here (a
    // request without st:true always resolves to a ChatResult at runtime).
    const response = (await client.chat.send({
      chatRequest: requestParams,
    })) as ChatResult;

    const choice = response.choices[0];
    const content = choice.message.content;
    const contentStr = typeof content === 'string' ? content : '';

    // Extract reasoning from the message if available
    const sendReasoningContent = (choice.message as any)?.reasoning;

    // Extract cache usage if available
    const usageAny = response.usage as any;
    const cacheUsage = usageAny?.cachedTokens || usageAny?.cacheDiscount
      ? {
          cachedTokens: usageAny.cachedTokens,
          cacheDiscount: usageAny.cacheDiscount,
          cacheCreationInputTokens: usageAny.cacheCreationInputTokens,
          cacheReadInputTokens: usageAny.cacheReadInputTokens,
        }
      : undefined;
    return {
      content: contentStr,
      finishReason: choice.finishReason || 'stop',
      usage: {
        // Exclude cache-read tokens from prompt/total so cached input is not
        // charged against budgets or cost; cacheUsage still reports them for
        // display. (OpenRouter normalizes cached tokens into promptTokens.)
        promptTokens: Math.max(0, (response.usage?.promptTokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? cacheUsage?.cachedTokens ?? 0)),
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: Math.max(0, (response.usage?.totalTokens ?? 0) - (cacheUsage?.cacheReadInputTokens ?? cacheUsage?.cachedTokens ?? 0)),
      },
      raw: response,
      attachmentResults,
      cacheUsage,
      ...(sendReasoningContent && typeof sendReasoningContent === 'string' ? { reasoningContent: sendReasoningContent } : {}),
    };
  }

  /**
   * Non-streaming send via the OpenAI Chat Completions endpoint using a direct
   * fetch, bypassing the SDK's client-side validation that rejects image
   * content-parts. Used for the vision (image attachment) send path — the
   * non-streaming counterpart to {@link streamViaChatCompletions}. Feature
   * parity with the SDK path in {@link sendMessage}: cache key, tools, web
   * search, structured output, fallback models, provider preferences (incl.
   * ZDR), and reasoning are all forwarded.
   */
  private async sendViaChatCompletions(
    params: LLMParams,
    apiKey: string,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
  ): Promise<LLMResponse> {
    // Build messages in OpenAI Chat Completions format, formatting image
    // attachments inline as content parts (buildMessageContent).
    const messages = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role,
          content: this.buildMessageContent(m) as any,
        };
      });

    const body: any = {
      model: params.model,
      messages,
      stream: false,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stop: params.stop,
    };

    // Forward Quilltap's per-character cache identifier as `user` (sticky
    // routing hint), matching the SDK path.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = 'auto';
    }

    if (params.webSearchEnabled) {
      body.plugins = [{ id: 'web', max_results: 5 }];
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema,
          },
        };
      } else if (params.responseFormat.type !== 'text') {
        body.response_format = { type: params.responseFormat.type };
      }
    }

    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Model fallbacks (`models` + `route: 'fallback'`; can't send both `model`
    // and `models`).
    if (profileParams?.fallbackModels?.length) {
      body.models = [params.model, ...profileParams.fallbackModels];
      body.route = 'fallback';
      delete body.model;
    }

    // Provider preferences (snake_case wire shape). ZDR is load-bearing here:
    // dropping data_collection on the vision path would leak prompts.
    const providerPrefs = resolveProviderPrefs(profileParams);
    if (providerPrefs) {
      body.provider = {};
      if (providerPrefs.order) body.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) body.provider.allow_fallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) body.provider.require_parameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) body.provider.data_collection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) body.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) body.provider.only = providerPrefs.only;
    }

    // Enable reasoning output for models that support it.
    const reasoningEffort = profileParams?.reasoningEffort;
    if (typeof reasoningEffort === 'string' && reasoningEffort.length > 0) {
      body.reasoning = { effort: reasoningEffort, exclude: false };
    } else {
      body.reasoning = { exclude: false };
    }

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
          'X-Title': 'Quilltap',
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify(body),
        // Non-streaming: the whole exchange is one JSON blob, so bounding the
        // entire request (headers + body) is correct.
        signal: buildRequestAbortSignal(params),
      });
    } catch (error) {
      logger.error('Error in sendViaChatCompletions', {
        context: 'OpenRouterProvider.sendViaChatCompletions',
      }, error instanceof Error ? error : undefined);
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenRouter API error', {
        context: 'OpenRouterProvider.sendViaChatCompletions',
        status: response.status,
        error: errorText,
      });
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const contentStr = typeof content === 'string' ? content : '';
    const finishReason = choice?.finish_reason || 'stop';
    const reasoningContent = choice?.message?.reasoning;

    // Exclude cache-read tokens from prompt/total so cached input is not charged
    // against budgets or cost; cacheUsage still reports them for display.
    const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined;
    const cacheRead = cachedTokens ?? 0;

    return {
      content: contentStr,
      finishReason,
      usage: {
        promptTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cacheRead),
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: Math.max(0, (data.usage?.total_tokens ?? 0) - cacheRead),
      },
      raw: data,
      attachmentResults,
      ...(cacheUsage ? { cacheUsage } : {}),
      ...(reasoningContent && typeof reasoningContent === 'string' ? { reasoningContent } : {}),
    };
  }

  async *streamMessage(
    params: LLMParams,
    apiKey: string
  ): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentResults(params);

    // Tool-enabled and vision (image attachment) requests go through the
    // direct Chat Completions fetch path, which matches the OpenAI schema
    // OpenRouter expects for function calls and multimodal content parts.
    // The SDK's callModel/OpenResponses path doesn't round-trip image_url
    // parts reliably, so route those requests around it.
    const hasTools = params.tools && params.tools.length > 0;
    const hasImages = this.hasImageAttachments(params);
    if (hasTools || hasImages) {
      yield* this.streamViaChatCompletions(params, apiKey, attachmentResults);
      return;
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
      // Streaming: only an explicit caller budget is honored. The SDK's
      // timeoutMs bounds the whole request rather than stopping at the response
      // headers, so a default here could cut off a long generation mid-answer.
      // Background work, which is what the budget exists for, never streams.
      ...(params.requestTimeoutMs ? { timeoutMs: params.requestTimeoutMs } : {}),
    });

    // Convert messages to SDK format for the no-tools, no-images path.
    const messages: ChatMessages[] = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as any, tool_call_id: m.toolCallId, content: m.content } as any;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          } as any;
        }
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        };
      });

    // Convert chat messages to OpenResponses input format for callModel()
    const input = fromChatMessages(messages);

    // Build the request for callModel()
    const requestParams: any = {
      model: params.model,
      input,
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stop: params.stop,
    };

    // Forward Quilltap's per-character cache identifier as `user`. OpenAI-
    // routed downstreams use it as a sticky-routing hint; other downstreams
    // (Anthropic, etc.) ignore it.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.user = params.cacheKey;
    }

    // Add web search tool if enabled
    if (params.webSearchEnabled) {
      requestParams.tools = requestParams.tools || [];
      requestParams.tools.push({ type: 'web_search_preview' });
    }

    // Add structured output format if specified
    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        requestParams.text = {
          format: {
            type: 'json_schema',
            jsonSchema: {
              name: params.responseFormat.jsonSchema.name,
              strict: params.responseFormat.jsonSchema.strict ?? true,
              schema: params.responseFormat.jsonSchema.schema,
            },
          },
        };
      } else if (params.responseFormat.type === 'json_object') {
        requestParams.text = { format: { type: 'json_object' } };
      }
    }

    // Handle OpenRouter-specific profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;

    // Add model fallbacks if configured
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      delete requestParams.model; // Can't have both model and models
    }

    // Add provider preferences if configured
    const providerPrefs = resolveProviderPrefs(profileParams);
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== undefined) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }

    // Enable reasoning output for models that support it.
    const sdkReasoningEffort = profileParams?.reasoningEffort;
    if (typeof sdkReasoningEffort === 'string' && sdkReasoningEffort.length > 0) {
      requestParams.reasoning = { effort: sdkReasoningEffort, exclude: false };
    } else {
      requestParams.reasoning = { exclude: false };
    }

    // Use callModel() which returns ModelResult with streaming capabilities
    // SDK v0.4.0 provides getTextStream() for cleaner text delta streaming
    const result = client.callModel(requestParams);

    // Stream text deltas using the new getTextStream() API
    // This is cleaner than manually extracting from chunk.choices[0].delta.content
    for await (const textDelta of result.getTextStream()) {
      if (textDelta) {
        yield {
          content: textDelta,
          done: false,
        };
      }
    }

    // After text stream ends, get the complete response with usage data
    // The ReusableReadableStream allows concurrent consumption patterns
    let response: OpenResponsesResult;
    try {
      response = await result.getResponse();
    } catch (error) {
      logger.error('Failed to get response after stream', {
        context: 'OpenRouterProvider.streamMessage',
      }, error instanceof Error ? error : undefined);
      // Yield final chunk without usage data
      yield {
        content: '',
        done: true,
        attachmentResults,
      };
      return;
    }

    // Extract usage from response. Exclude cache-read tokens from prompt/total
    // so cached input is not charged against budgets or cost; cacheUsage below
    // still reports them for display.
    const responseCacheRead = (response.usage as any)?.cacheReadInputTokens ?? (response.usage as any)?.cachedTokens ?? 0;
    const usage = response.usage ? {
      promptTokens: Math.max(0, (response.usage.inputTokens ?? 0) - responseCacheRead),
      completionTokens: response.usage.outputTokens ?? 0,
      totalTokens: Math.max(0, ((response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0)) - responseCacheRead),
    } : undefined;

    // Extract reasoning from the response output (reasoning items contain summary text)
    let sdkReasoning = '';
    if (response.output && Array.isArray(response.output)) {
      for (const item of response.output) {
        if ((item as any).type === 'reasoning' && (item as any).summary) {
          for (const summaryPart of (item as any).summary) {
            if (summaryPart.type === 'summary_text' && summaryPart.text) {
              sdkReasoning += summaryPart.text;
            }
          }
        }
      }
    }

    // Extract cache usage if available
    const responseUsage = response.usage as any;
    const cacheUsage = responseUsage?.cachedTokens || responseUsage?.cacheDiscount
      ? {
          cachedTokens: responseUsage.cachedTokens,
          cacheDiscount: responseUsage.cacheDiscount,
          cacheCreationInputTokens: responseUsage.cacheCreationInputTokens,
          cacheReadInputTokens: responseUsage.cacheReadInputTokens,
        }
      : undefined;
    // Build raw response in a format compatible with our existing code
    // Include tool calls if present in the response output
    const toolCalls = response.output
      ?.filter((item: any) => item.type === 'function_call')
      .map((item: any) => ({
        id: item.callId || item.id,
        type: 'function',
        function: {
          name: item.name,
          arguments: typeof item.arguments === 'string'
            ? item.arguments
            : JSON.stringify(item.arguments),
        },
      }));

    const rawResponse = {
      choices: [{
        finishReason: response.status === 'completed' ? 'stop' : response.status,
        delta: {
          toolCalls: toolCalls?.length ? toolCalls : undefined,
        },
      }],
      usage: response.usage,
      // Include full response for debugging
      _openResponsesResponse: response,
    };

    yield {
      content: '',
      done: true,
      usage,
      attachmentResults,
      rawResponse,
      cacheUsage,
      ...(sdkReasoning ? { reasoningContent: sdkReasoning } : {}),
    };
  }

  /**
   * Stream via the OpenAI Chat Completions endpoint using a direct fetch.
   *
   * The OpenRouter SDK's callModel expects Zod schemas for tool inputSchema
   * (Quilltap provides JSON Schema) and the OpenResponses input format
   * doesn't round-trip multimodal image_url parts reliably, so any request
   * with tools or image attachments routes through here instead.
   */
  private async *streamViaChatCompletions(
    params: LLMParams,
    apiKey: string,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
  ): AsyncGenerator<StreamChunk> {
    // Build messages in OpenAI Chat Completions format, formatting image
    // attachments inline as content parts when present.
    const messages = params.messages
      .filter(m => !(m.role === 'tool' && !m.toolCallId))
      .map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool' as const, tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: tc.type, function: tc.function })),
          };
        }
        return {
          role: m.role,
          content: this.buildMessageContent(m) as any,
        };
      });

    // Build request body
    const body: any = {
      model: params.model,
      messages,
      stream: true,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stop: params.stop,
    };

    // Convert tools to OpenAI format and attach if present
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description,
          parameters: tool.function?.parameters || tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    // Add web search if enabled
    if (params.webSearchEnabled) {
      body.tools = body.tools || [];
      body.tools.push({ type: 'web_search_preview' });
    }

    // Handle profile parameters
    const profileParams = params.profileParameters as OpenRouterProfileParams | undefined;
    if (profileParams?.fallbackModels?.length) {
      body.route = 'fallback';
    }

    // Enable reasoning output for models that support it. `exclude: false`
    // tells OpenRouter not to suppress reasoning from the response.
    const reasoningEffort = profileParams?.reasoningEffort;
    if (typeof reasoningEffort === 'string' && reasoningEffort.length > 0) {
      body.reasoning = { effort: reasoningEffort, exclude: false };
    } else {
      body.reasoning = { exclude: false };
    }

    try {
      // Bound how long OpenRouter may take to *start* answering, not how long
      // it takes to finish: the timer is cleared once the response headers land
      // so the SSE body streams unbounded. A signal covering the whole exchange
      // would cut off a long generation mid-answer.
      const controller = new AbortController();
      const firstByteTimer = setTimeout(
        () => controller.abort(),
        resolveRequestTimeoutMs(params)
      );
      let response: Response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
            'X-Title': 'Quilltap',
            'User-Agent': getQuilltapUserAgent(),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(firstByteTimer);
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenRouter API error', {
          context: 'OpenRouterProvider.streamViaChatCompletions',
          status: response.status,
          error: errorText,
        });
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
      let cacheUsage: { cacheReadInputTokens: number; cachedTokens: number } | undefined;
      let toolCalls: any[] = [];
      let fetchReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];

            if (choice?.delta?.content) {
              yield {
                content: choice.delta.content,
                done: false,
              };
            }

            // OpenRouter's reasoning field on the delta (mirrors OpenAI Chat Completions)
            const deltaReasoning = choice?.delta?.reasoning;
            if (deltaReasoning) {
              fetchReasoning += deltaReasoning;
              yield { content: '', done: false, reasoningContent: fetchReasoning };
            }

            // Accumulate tool calls
            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tc.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }

            // Extract usage from final chunk. Exclude cache-read tokens from
            // prompt/total so cached input is not charged against budgets or
            // cost; cacheUsage still reports them for display.
            if (chunk.usage) {
              const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
              cacheUsage = cachedTokens !== undefined && cachedTokens > 0
                ? { cacheReadInputTokens: cachedTokens, cachedTokens }
                : undefined;
              const cacheRead = cachedTokens ?? 0;
              usage = {
                promptTokens: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cacheRead),
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: Math.max(0, (chunk.usage.total_tokens ?? 0) - cacheRead),
              };
            }
          } catch (e) {
            // Skip malformed JSON chunks
          }
        }
      }

      // Build raw response with tool calls
      const rawResponse = {
        choices: [{
          finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          delta: {
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          },
        }],
        usage,
      };

      yield {
        content: '',
        done: true,
        usage,
        attachmentResults,
        rawResponse,
        ...(cacheUsage ? { cacheUsage } : {}),
        ...(fetchReasoning ? { reasoningContent: fetchReasoning } : {}),
      };

    } catch (error) {
      logger.error('Error in streamViaChatCompletions', {
        context: 'OpenRouterProvider.streamViaChatCompletions',
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error(
        'OpenRouter API key validation failed',
        { provider: 'openrouter' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });

      // @openrouter/sdk 0.13 changed models.list() to return a paginated
      // async-iterable; the model array now lives at page.result.data (was
      // response.data in 0.12). Iterate pages so we capture every model.
      const pages = await client.models.list();
      const models: string[] = [];
      for await (const page of pages) {
        for (const m of (page.result?.data ?? []) as Array<{ id: string }>) {
          models.push(m.id);
        }
      }
      return models;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenRouter models',
        { provider: 'openrouter' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

}
