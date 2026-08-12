/**
 * Grok Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Grok's Responses API
 * via the OpenAI SDK pointed at https://api.x.ai/v1
 * Supports Grok models with multimodal capabilities (text + images)
 * Uses server-side tools for web search (web_search, x_search)
 */

import OpenAI from 'openai';
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { buildSdkClientOptions, createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-grok');

// Grok supports images (text/PDF handled via fallback system)
const GROK_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

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
  const normalize = (s: string): string => s.replace(/\s+/g, '').replace(/=+$/, '');
  const decoded = Buffer.from(data, 'base64');
  if (normalize(decoded.toString('base64')) === normalize(data)) {
    return decoded.toString('utf-8');
  }
  return data;
}

// SDK types for the Responses API
type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;
type ResponsesTool = OpenAI.Responses.Tool;
type ResponsesResponse = OpenAI.Responses.Response;
type ResponsesStreamEvent = OpenAI.Responses.ResponseStreamEvent;

/**
 * xAI's Responses endpoint accepts `stop` sequences; OpenAI's Responses API
 * does not model them, so the SDK types omit the field. Quilltap sends them
 * deliberately — this records the divergence in one place instead of casting at
 * each assignment. (The other two xAI extensions, the `x_search` tool and the
 * `citations` include value, are value-level and cast at their use sites.)
 */
type WithGrokStop<T> = T & { stop?: string[] };

export class GrokProvider implements TextProvider {
  private readonly baseUrl = 'https://api.x.ai/v1';
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * Whether an attachment MIME type has a handler behind the gate. Images send
   * inline; `text/*` embeds inline; PDF reaches the honest "requires Grok Files
   * API" arm. Anything else falls to the generic "unsupported" rejection. The
   * previous gate was images-only, which made the text and PDF arms dead code.
   */
  private isHandledMimeType(mimeType: string): boolean {
    return (
      this.supportedMimeTypes.includes(mimeType) ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/pdf'
    );
  }

  /**
   * Format messages from LLMMessage format to Responses API format.
   * Grok uses 'system' role directly in the input array — the `instructions`
   * parameter is NOT supported by xAI and will cause an error.
   */
  private formatMessagesForResponsesAPI(
    messages: LLMMessage[]
  ): { input: ResponsesInputItem[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const input: ResponsesInputItem[] = [];

    for (const msg of messages) {
      // Tool result messages → function_call_output items
      if (msg.role === 'tool') {
        if (!msg.toolCallId) {
          logger.debug('Skipping tool message without toolCallId', {
            context: 'GrokProvider.formatMessagesForResponsesAPI',
          });
          continue;
        }
        input.push({
          type: 'function_call_output',
          call_id: msg.toolCallId,
          output: msg.content,
        } as ResponsesInputItem);
        continue;
      }

      // System messages stay as 'system' role (xAI doesn't support 'developer' or 'instructions')
      if (msg.role === 'system') {
        input.push({
          type: 'message' as const,
          role: 'system' as const,
          content: msg.content,
        });
        continue;
      }

      // Assistant messages — may include tool calls
      if (msg.role === 'assistant') {
        // Always emit the text content as a message
        input.push({
          type: 'message' as const,
          role: 'assistant' as const,
          content: msg.content,
        });
        // If the assistant invoked tools, emit function_call items
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            input.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            } as ResponsesInputItem);
          }
        }
        continue;
      }

      // User messages need content array format
      const content: Array<OpenAI.Responses.ResponseInputText | OpenAI.Responses.ResponseInputImage> = [];

      if (msg.content) {
        content.push({ type: 'input_text', text: msg.content });
      }

      // Add file attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.isHandledMimeType(attachment.mimeType)) {
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Grok supports: ${this.supportedMimeTypes.join(', ')}, text/*`,
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

          // For images, use input_image format
          if (attachment.mimeType.startsWith('image/')) {
            content.push({
              type: 'input_image',
              image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
              detail: 'auto',
            });
            sent.push(attachment.id);
          } else if (attachment.mimeType.startsWith('text/')) {
            // For text files, embed as text content. `data` may be raw text or
            // base64; decodeBase64Text round-trips to tell which (a bare decode
            // would mangle already-plain text — see the helper).
            const textContent = decodeBase64Text(attachment.data);
            content.push({
              type: 'input_text',
              text: `[File: ${attachment.filename}]\n${textContent}`,
            });
            sent.push(attachment.id);
          } else {
            failed.push({
              id: attachment.id,
              error: 'PDF and binary document support requires Grok Files API (not yet implemented)',
            });
          }
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

    return { input, attachmentResults: { sent, failed } };
  }

  /**
   * Convert OpenAI-format tools to Responses API function tools
   */
  private formatToolsForResponsesAPI(
    tools: LLMParams['tools']
  ): OpenAI.Responses.FunctionTool[] {
    if (!tools || tools.length === 0) return [];

    return tools.map((tool) => {
      const openAITool = tool as { type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } };
      const fn = openAITool.function;
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
   * Extract text content from Responses API response.
   * Used as fallback when output_text may not be populated by xAI.
   */
  private extractTextFromResponse(response: ResponsesResponse): string {
    // Prefer the SDK's convenience field if available
    if (response.output_text) {
      return response.output_text;
    }
    // Fallback: manually extract from output items
    let text = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            text += content.text;
          }
        }
      }
    }
    return text;
  }

  /**
   * Extract a reasoning summary from the response output. Reasoning items carry
   * a `summary` array of `summary_text` parts when a summary was requested and
   * the model produced one. DISPLAY ONLY — never re-fed to the model.
   */
  private extractReasoningFromResponse(response: ResponsesResponse): string {
    let reasoning = '';
    for (const item of response.output) {
      if ((item as { type?: string }).type === 'reasoning') {
        const summaryArr = (item as { summary?: unknown }).summary;
        if (Array.isArray(summaryArr)) {
          for (const part of summaryArr) {
            if (part?.type === 'summary_text' && typeof part.text === 'string') {
              reasoning += part.text;
            }
          }
        }
      }
    }
    return reasoning;
  }

  /**
   * Build raw response object compatible with Chat Completions format.
   * This ensures the tool call parser, Inspector, and chat log storage
   * all continue to work without changes.
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
          content: this.extractTextFromResponse(response),
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

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    });
    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    const requestParams: WithGrokStop<OpenAI.Responses.ResponseCreateParamsNonStreaming> = {
      model: params.model,
      input,
      store: false, // Stateless operation - Quilltap manages history locally
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: false,
    };

    if (params.stop) {
      requestParams.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Pin sticky cache routing. Grok caches per-server, so requests without
    // a stable key round-robin across machines and effectively never hit cache.
    // Quilltap builds a per-character key in lib/llm/cache-key.ts.
    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.prompt_cache_key = params.cacheKey;
    }

    // Opt-in reasoning summary. Only the reasoning Grok models return one, and
    // only when the summary surface is requested. Captured for DISPLAY ONLY —
    // never re-fed to the model. xAI may still return nothing.
    if (params.profileParameters?.reasoningSummary === true) {
      requestParams.reasoning = { summary: 'auto' };
    }

    // Build tools - server-side (web search) + client-side (function calling)
    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      // Grok uses web_search and x_search (not web_search_preview)
      tools.push({ type: 'web_search' } as ResponsesTool);
      // x_search is an xAI-only tool, absent from OpenAI's Tool union.
      tools.push({ type: 'x_search' } as unknown as ResponsesTool);
      // 'citations' is an xAI-only include value, absent from OpenAI's union.
      requestParams.include = ['citations'] as unknown as OpenAI.Responses.ResponseIncludable[];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    const response = await client.responses.create(requestParams);

    if (response.error) {
      logger.error('Responses API returned error', {
        context: 'GrokProvider.sendMessage',
        code: response.error.code,
        message: response.error.message,
      });
      throw new Error(`Grok API error: ${response.error.message}`);
    }

    const text = this.extractTextFromResponse(response);
    const finishReason = this.getFinishReason(response);
    const raw = this.buildRawResponse(response);
    const reasoningContent = this.extractReasoningFromResponse(response);
    const cachedTokens = response.usage?.input_tokens_details?.cached_tokens
    const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
      ? { cacheReadInputTokens: cachedTokens, cachedTokens }
      : undefined

    return {
      content: text,
      finishReason,
      usage: {
        // Exclude cache-read tokens from prompt/total so cached input is not
        // charged against budgets or cost; cacheUsage still reports them for
        // display. (Grok folds cached_tokens into input_tokens.)
        promptTokens: Math.max(0, (response.usage?.input_tokens ?? 0) - (cachedTokens ?? 0)),
        completionTokens: response.usage?.output_tokens ?? 0,
        totalTokens: Math.max(0, (response.usage?.total_tokens ?? 0) - (cachedTokens ?? 0)),
      },
      raw,
      attachmentResults,
      ...(cacheUsage ? { cacheUsage } : {}),
      ...(reasoningContent ? { reasoningContent } : {}),
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      // A caller-supplied budget is a ceiling; without one the SDK's 10-minute
      // default would let a silent endpoint hold a turn open indefinitely.
      ...buildSdkClientOptions(params),
    });
    const { input, attachmentResults } = this.formatMessagesForResponsesAPI(params.messages);

    const requestParams: WithGrokStop<OpenAI.Responses.ResponseCreateParamsStreaming> = {
      model: params.model,
      input,
      store: false,
      temperature: params.temperature ?? 0.7,
      max_output_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream: true,
    };

    if (params.stop) {
      requestParams.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      requestParams.prompt_cache_key = params.cacheKey;
    }

    // Opt-in reasoning summary (display only; never re-fed to the model).
    if (params.profileParameters?.reasoningSummary === true) {
      requestParams.reasoning = { summary: 'auto' };
    }

    const tools: ResponsesTool[] = [];

    if (params.webSearchEnabled) {
      tools.push({ type: 'web_search' } as ResponsesTool);
      // x_search is an xAI-only tool, absent from OpenAI's Tool union.
      tools.push({ type: 'x_search' } as unknown as ResponsesTool);
      // 'citations' is an xAI-only include value, absent from OpenAI's union.
      requestParams.include = ['citations'] as unknown as OpenAI.Responses.ResponseIncludable[];
    }

    if (params.tools && params.tools.length > 0) {
      const functionTools = this.formatToolsForResponsesAPI(params.tools);
      tools.push(...functionTools);
    }

    if (tools.length > 0) {
      requestParams.tools = tools;
    }

    const stream = await client.responses.create(requestParams);

    let finalResponse: ResponsesResponse | null = null;
    let streamReasoning = '';

    for await (const event of stream as AsyncIterable<ResponsesStreamEvent>) {
      if (event.type === 'response.output_text.delta') {
        yield {
          content: event.delta,
          done: false,
        };
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        // Cumulative: append the delta and emit the full accumulated string.
        // DISPLAY ONLY — never re-fed to the model.
        streamReasoning += (event as { delta?: string }).delta ?? '';
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
          // Cache-read tokens excluded from prompt/total (see sendMessage).
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
        context: 'GrokProvider.streamMessage',
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
        baseURL: this.baseUrl,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('Grok API key validation failed', { context: 'GrokProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
        defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      });
      const models = await client.models.list();
      const grokModels = models.data
        .map((m) => m.id)
        .sort();
      return grokModels;
    } catch (error) {
      logger.error('Failed to fetch Grok models', { context: 'GrokProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

}
