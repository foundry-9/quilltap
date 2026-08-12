/**
 * OpenAI Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenAI's Responses API
 * Supports GPT models with multimodal capabilities (text + images)
 * Uses server-side tools for web search (web_search_preview)
 * Supports conversation chaining via previous_response_id for cache optimization
 * Migrated from Chat Completions API to Responses API for better
 * cache utilization, reasoning model support, and future-proofing.
 */

import OpenAI from 'openai';
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage } from './types';
import { buildSdkClientOptions, createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openai');

// OpenAI supports images in vision-capable models
const OPENAI_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Reasoning models don't support temperature, top_p, and other sampling parameters
// See: https://platform.openai.com/docs/guides/reasoning
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];

function isReasoningModel(model: string): boolean {
  const modelLower = model.toLowerCase();
  return REASONING_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix));
}

// Models that support extended (24h) prompt-cache retention. gpt-5.3-chat-latest
// is intentionally NOT in this list — extended retention is unsupported there
// per the OpenAI docs. Adding it would yield a runtime API error.
const EXTENDED_RETENTION_MODEL_PREFIXES = ['gpt-5.1', 'gpt-5.2', 'gpt-5.5'];

function supportsExtendedCacheRetention(model: string): boolean {
  const modelLower = model.toLowerCase();
  return EXTENDED_RETENTION_MODEL_PREFIXES.some(prefix => modelLower.startsWith(prefix));
}

// SDK types for the Responses API
type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;
type ResponsesTool = OpenAI.Responses.Tool;
type ResponsesResponse = OpenAI.Responses.Response;
type ResponsesStreamEvent = OpenAI.Responses.ResponseStreamEvent;

export class OpenAIProvider implements TextProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = OPENAI_SUPPORTED_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * Format messages from LLMMessage format to Responses API input format.
   * The first system message is extracted as top-level instructions.
   * Additional system messages become 'developer' role messages.
   */
  private formatMessagesForResponsesAPI(
    messages: LLMMessage[]
  ): { input: ResponsesInputItem[]; instructions: string | undefined; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Extract the first system message as top-level instructions
    let instructions: string | undefined;
    const inputMessages: LLMMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system' && instructions === undefined) {
        instructions = msg.content;
      } else {
        inputMessages.push(msg);
      }
    }

    const input: ResponsesInputItem[] = [];

    for (const msg of inputMessages) {
      // Additional system messages become 'developer' role in Responses API
      if (msg.role === 'system') {
        input.push({
          type: 'message' as const,
          role: 'developer' as const,
          content: msg.content,
        });
        continue;
      }

      // Tool result messages become function_call_output items
      if (msg.role === 'tool') {
        if (msg.toolCallId) {
          input.push({
            type: 'function_call_output' as const,
            call_id: msg.toolCallId,
            output: msg.content,
          });
        } else {
          logger.debug('Skipping tool message without toolCallId', {
            context: 'OpenAIProvider.formatMessagesForResponsesAPI',
          });
        }
        continue;
      }

      // Assistant messages: emit text content + any tool calls as separate items
      if (msg.role === 'assistant') {
        input.push({
          type: 'message' as const,
          role: 'assistant' as const,
          content: msg.content,
        });

        // Emit function_call items for each tool call
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            input.push({
              type: 'function_call' as const,
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            } as ResponsesInputItem);
          }
        }
        continue;
      }

      // User messages need content array format for image support
      const content: Array<OpenAI.Responses.ResponseInputText | OpenAI.Responses.ResponseInputImage> = [];

      if (msg.content) {
        content.push({ type: 'input_text', text: msg.content });
      }

      // Add file attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. OpenAI supports: ${this.supportedMimeTypes.join(', ')}`,
            });
            continue;
          }

          if (!attachment.data) {
            failed.push({
              id: attachment.id,
              error: 'File data not loaded',
            });
            continue;
          }

          content.push({
            type: 'input_image',
            image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: 'auto',
          });
          sent.push(attachment.id);
        }
      }

      // If no content was added, add empty text to avoid empty content array
      if (content.length === 0) {
        content.push({ type: 'input_text', text: '' });
      }

      input.push({
        type: 'message' as const,
        role: 'user' as const,
        content,
      });
    }

    return { input, instructions, attachmentResults: { sent, failed } };
  }

  /**
   * Extract only the last user message from the input for use with previous_response_id.
   * When chaining, OpenAI reconstructs the conversation from the previous response,
   * so we only need to send the new user message.
   */
  private extractLastUserMessage(input: ResponsesInputItem[]): ResponsesInputItem[] {
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i];
      if ('role' in item && item.role === 'user') {
        return [item];
      }
    }
    // Fallback: return the last item regardless of type
    return input.length > 0 ? [input[input.length - 1]] : [];
  }

  /**
   * Convert Chat Completions-format tools to Responses API function tools
   */
  private formatToolsForResponsesAPI(
    tools: LLMParams['tools']
  ): OpenAI.Responses.FunctionTool[] {
    if (!tools || tools.length === 0) return [];

    return tools.map((tool) => {
      const chatTool = tool as { type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } };
      const fn = chatTool.function;
      return {
        type: 'function' as const,
        name: fn.name,
        description: fn.description ?? undefined,
        parameters: fn.parameters,
        strict: false,
      };
    });
  }

  /**
   * Build raw response object compatible with Chat Completions format.
   * This ensures the streaming service, tool call parser, Inspector,
   * and chat log storage all continue to work without changes.
   */
  private buildRawResponse(response: ResponsesResponse): Record<string, unknown> {
    const toolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = [];

    for (const item of response.output) {
      if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id,
          type: 'function',
          function: {
            name: item.name,
            arguments: item.arguments,
          },
        });
      }
    }

    return {
      id: response.id,
      object: 'chat.completion',
      created: response.created_at,
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.output_text,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: response.usage?.input_tokens ?? 0,
        completion_tokens: response.usage?.output_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  /**
   * Determine finish reason from response
   */
  private getFinishReason(response: ResponsesResponse): string {
    for (const item of response.output) {
      if (item.type === 'function_call') {
        return 'tool_calls';
      }
    }

    if (response.status === 'completed') return 'stop';
    if (response.status === 'incomplete') return response.incomplete_details?.reason || 'length';
    if (response.status === 'failed') return 'error';

    return 'stop';
  }

  /**
   * Build the text format configuration for structured output
   */
  private buildTextConfig(responseFormat?: LLMParams['responseFormat']): OpenAI.Responses.ResponseTextConfig | undefined {
    if (!responseFormat) return undefined;

    if (responseFormat.type === 'json_object') {
      return { format: { type: 'json_object' } };
    }

    if (responseFormat.type === 'json_schema' && responseFormat.jsonSchema) {
      return {
        format: {
          type: 'json_schema',
          name: responseFormat.jsonSchema.name || 'response',
          schema: responseFormat.jsonSchema.schema as Record<string, unknown>,
          strict: responseFormat.jsonSchema.strict ?? true,
        },
      };
    }

    return undefined;
  }

  /**
   * Build the common request parameters shared between sendMessage and streamMessage
   */
  private buildBaseRequestParams(
    params: LLMParams,
    input: ResponsesInputItem[],
    instructions: string | undefined,
  ): Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, 'stream'> {
    const isReasoning = isReasoningModel(params.model);

    const requestParams: Record<string, unknown> = {
      model: params.model,
      input,
      store: false,
      max_output_tokens: params.maxTokens ?? 4096,
    };

    if (instructions) {
      requestParams.instructions = instructions;
    }

    if (!isReasoning) {
      requestParams.top_p = params.topP ?? 1;
      if (params.temperature !== undefined) {
        requestParams.temperature = params.temperature;
      }
    } else {
      if (!params.strictMaxTokens) {
        // Full reasoning model minimum for chat messages
        const minTokensForReasoning = 4096;
        if ((params.maxTokens ?? 0) < minTokensForReasoning) {
          requestParams.max_output_tokens = minTokensForReasoning;
        }
        // Per-profile reasoning effort applies in the normal (non-strict) path.
        // Strict mode is reserved for background tasks and forces 'low' below.
        const reasoningEffort = params.profileParameters?.reasoningEffort;
        // When reasoningSummary is enabled, request the summary surface so we can
        // capture chain-of-thought (raw o-series reasoning is encrypted).
        const includeSummary = params.profileParameters?.reasoningSummary === true;
        if (
          typeof reasoningEffort === 'string' &&
          ['minimal', 'low', 'medium', 'high'].includes(reasoningEffort)
        ) {
          requestParams.reasoning = includeSummary
            ? { effort: reasoningEffort, summary: 'auto' }
            : { effort: reasoningEffort };
        } else if (includeSummary) {
          requestParams.reasoning = { summary: 'auto' };
        }
      } else {
        // Strict mode: use low reasoning effort so the model doesn't burn
        // the entire output budget on thinking. This is for background tasks
        // (summarization, keyword extraction) that don't need deep reasoning.
        requestParams.reasoning = { effort: 'low' };
      }
    }

    const tools: ResponsesTool[] = [];
    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search_preview' });
      requestParams.include = ['web_search_call.action.sources'];
    }
    if (params.tools && params.tools.length > 0) {
      tools.push(...this.formatToolsForResponsesAPI(params.tools));
    }
    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    const textConfig: OpenAI.Responses.ResponseTextConfig =
      this.buildTextConfig(params.responseFormat) ?? {};
    const verbosity = params.profileParameters?.verbosity;
    if (typeof verbosity === 'string' && ['low', 'medium', 'high'].includes(verbosity)) {
      textConfig.verbosity = verbosity as 'low' | 'medium' | 'high';
    }
    if (Object.keys(textConfig).length > 0) {
      requestParams.text = textConfig;
    }

    // Pin sticky cache routing. Without prompt_cache_key, requests above
    // ~15 RPM/key shard across machines and degrade hit rate. Quilltap
    // builds a per-character key in lib/llm/cache-key.ts.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.prompt_cache_key = params.cacheKey;
      if (supportsExtendedCacheRetention(params.model)) {
        requestParams.prompt_cache_retention = '24h';
      }
    }

    if (params.stop) {
      const stopArr = Array.isArray(params.stop) ? params.stop : [params.stop];
      if (stopArr.length > 0) {
        requestParams.stop = stopArr;
      }
    }

    return requestParams as Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, 'stream'>;
  }

  /**
   * Build LLMResponse from a Responses API response
   */
  private buildLLMResponse(
    response: ResponsesResponse,
    attachmentResults: { sent: string[]; failed: { id: string; error: string }[] },
  ): LLMResponse {
    const cachedTokens = response.usage?.input_tokens_details?.cached_tokens
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined

    // Extract reasoning summary from the response output (reasoning items with summary text).
    // Raw o-series reasoning is encrypted; the summary is the only capturable surface.
    let reasoningContent = '';
    for (const item of response.output) {
      if ((item as any).type === 'reasoning') {
        const summaryArr = (item as any).summary;
        if (Array.isArray(summaryArr)) {
          for (const part of summaryArr) {
            if (part.type === 'summary_text' && part.text) {
              reasoningContent += part.text;
            }
          }
        }
      }
    }

    return {
      content: response.output_text,
      finishReason: this.getFinishReason(response),
      usage: {
        // Exclude cache-read tokens from prompt/total so cached input is not
        // charged against budgets or cost; cacheUsage still reports them for
        // display. (OpenAI folds cached_tokens into input_tokens.)
        promptTokens: Math.max(0, (response.usage?.input_tokens ?? 0) - (cachedTokens ?? 0)),
        completionTokens: response.usage?.output_tokens ?? 0,
        totalTokens: Math.max(0, (response.usage?.total_tokens ?? 0) - (cachedTokens ?? 0)),
      },
      raw: this.buildRawResponse(response),
      attachmentResults,
      ...(cacheUsage ? { cacheUsage } : {}),
      ...(reasoningContent ? { reasoningContent } : {}),
    };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    });
    const { input, instructions, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    const baseParams = this.buildBaseRequestParams(params, input, instructions);

    // Try with conversation chaining if we have a previous response ID
    if (params.previousResponseId) {
      try {
        const chainedInput = this.extractLastUserMessage(input);
        const chainedParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
          ...baseParams,
          input: chainedInput,
          previous_response_id: params.previousResponseId,
          stream: false,
        };

        const response = await client.responses.create(chainedParams);

        if (response.error) {
          throw new Error(`OpenAI API error: ${response.error.message}`);
        }

        return this.buildLLMResponse(response, attachmentResults);
      } catch (error) {
        logger.warn('Conversation chaining failed, falling back to full input', {
          context: 'OpenAIProvider.sendMessage',
          previousResponseId: params.previousResponseId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to full input request below
      }
    }

    // Standard request with full input (no chaining or chaining fallback)
    const requestParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      ...baseParams,
      stream: false,
    };

    const response = await client.responses.create(requestParams);

    if (response.error) {
      logger.error('Responses API returned error', {
        context: 'OpenAIProvider.sendMessage',
        code: response.error.code,
        message: response.error.message,
      });
      throw new Error(`OpenAI API error: ${response.error.message}`);
    }

    return this.buildLLMResponse(response, attachmentResults);
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    });
    const { input, instructions, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);
    const baseParams = this.buildBaseRequestParams(params, input, instructions);

    // Determine whether to use conversation chaining
    let useChaining = !!params.previousResponseId;
    let stream: AsyncIterable<ResponsesStreamEvent> | null = null;

    if (useChaining) {
      try {
        const chainedInput = this.extractLastUserMessage(input);
        const chainedParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
          ...baseParams,
          input: chainedInput,
          previous_response_id: params.previousResponseId,
          stream: true,
        };

        stream = await client.responses.create(chainedParams) as AsyncIterable<ResponsesStreamEvent>;
      } catch (error) {
        logger.warn('Streaming conversation chaining failed, falling back to full input', {
          context: 'OpenAIProvider.streamMessage',
          previousResponseId: params.previousResponseId,
          error: error instanceof Error ? error.message : String(error),
        });
        useChaining = false;
      }
    }

    // Fall back to standard request if chaining wasn't used or failed
    if (!stream) {
      const requestParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
        ...baseParams,
        stream: true,
      };

      stream = await client.responses.create(requestParams) as AsyncIterable<ResponsesStreamEvent>;
    }

    let finalResponse: ResponsesResponse | null = null;
    let streamReasoning = '';

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield {
          content: event.delta,
          done: false,
        };
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        // Cumulative: append delta to accumulator and emit the full string
        streamReasoning += (event as any).delta;
        yield { content: '', done: false, reasoningContent: streamReasoning };
      } else if (event.type === 'response.completed') {
        finalResponse = event.response;
      }
    }

    // Build final response
    if (finalResponse) {
      const raw = this.buildRawResponse(finalResponse);
      const cachedTokens = finalResponse.usage?.input_tokens_details?.cached_tokens
      const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
        ? { cacheReadInputTokens: cachedTokens, cachedTokens }
        : undefined

      yield {
        content: '',
        done: true,
        usage: {
          // Cache-read tokens excluded from prompt/total (see buildLLMResponse).
          promptTokens: Math.max(0, (finalResponse.usage?.input_tokens ?? 0) - (cachedTokens ?? 0)),
          completionTokens: finalResponse.usage?.output_tokens ?? 0,
          totalTokens: Math.max(0, (finalResponse.usage?.total_tokens ?? 0) - (cachedTokens ?? 0)),
        },
        attachmentResults,
        rawResponse: raw,
        rawProviderUsage: (finalResponse.usage ?? null) as Record<string, unknown> | null,
        ...(cacheUsage ? { cacheUsage } : {}),
        ...(streamReasoning ? { reasoningContent: streamReasoning } : {}),
      };
    } else {
      logger.warn('Stream ended without response.completed event', {
        context: 'OpenAIProvider.streamMessage',
      });
      yield {
        content: '',
        done: true,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        attachmentResults,
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('OpenAI API key validation failed', { context: 'OpenAIProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({
        apiKey,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      });
      const models = await client.models.list();
      // Filter for Responses API-compatible chat models
      const chatModelPrefixes = ['gpt-4', 'gpt-5', 'o1', 'o3', 'o4'];
      const chatModels = models.data
        .filter((m) => chatModelPrefixes.some(prefix => m.id.startsWith(prefix)))
        .map((m) => m.id)
        .sort();
      return chatModels;
    } catch (error) {
      logger.error('Failed to fetch OpenAI models', { context: 'OpenAIProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

}
