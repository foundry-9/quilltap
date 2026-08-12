/**
 * OpenAI-Compatible Provider Base Class
 *
 * A reusable base class for building LLM providers that use OpenAI-compatible APIs.
 * This includes services like:
 * - Local LLM servers (LM Studio, vLLM, Text Generation Web UI, Ollama with OpenAI compat)
 * - Cloud services with OpenAI-compatible APIs (Gab AI, Together AI, Fireworks, etc.)
 *
 * External plugins can extend this class to create custom providers with minimal code:
 *
 * @example
 * ```typescript
 * import { OpenAICompatibleProvider } from '@quilltap/plugin-utils';
 *
 * export class MyCustomProvider extends OpenAICompatibleProvider {
 *   constructor() {
 *     super({
 *       baseUrl: 'https://api.my-service.com/v1',
 *       providerName: 'MyService',
 *       requireApiKey: true,
 *       attachmentErrorMessage: 'MyService does not support file attachments',
 *     });
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';
import type {
  TextProvider,
  LLMParams,
  LLMResponse,
  StreamChunk,
  PluginLogger,
} from '@quilltap/plugin-types';
import { createPluginLogger } from '../logging';
import { getQuilltapUserAgent } from '../version';
import { DEFAULT_REQUEST_TIMEOUT_MS, buildSdkRequestOptions } from './request-budget';

/** Matches the OpenAI SDK default; retries never apply to a caller-supplied budget. */
const DEFAULT_MAX_RETRIES = 2;

/**
 * Configuration options for OpenAI-compatible providers.
 *
 * Use this interface when extending OpenAICompatibleProvider to customize
 * the provider's behavior for your specific service.
 */
export interface OpenAICompatibleProviderConfig {
  /**
   * Base URL for the API endpoint.
   * Should include the version path (e.g., 'https://api.example.com/v1')
   */
  baseUrl: string;

  /**
   * Provider name used for logging context.
   * This appears in log messages to identify which provider generated them.
   * @default 'OpenAICompatible'
   */
  providerName?: string;

  /**
   * Whether an API key is required for this provider.
   * If true, requests will fail with an error when no API key is provided.
   * If false, requests will use 'not-needed' as the API key (for local servers).
   * @default false
   */
  requireApiKey?: boolean;

  /**
   * Custom error message shown when file attachments are attempted.
   * @default 'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)'
   */
  attachmentErrorMessage?: string;

  /**
   * Default wall-clock budget per request, in milliseconds.
   *
   * The OpenAI SDK's own default is 600 000 ms, which means a service that
   * accepts a connection and then goes quiet holds the caller for ten minutes
   * before the first retry. That is far longer than any Quilltap caller wants
   * to wait, so the base class lowers it.
   *
   * Individual requests can tighten this further via `LLMParams.requestTimeoutMs`.
   *
   * @default 300000 (5 minutes)
   */
  requestTimeoutMs?: number;

  /**
   * How many times the SDK may retry a failed or timed-out request.
   *
   * Applies only to requests that did *not* specify their own
   * `LLMParams.requestTimeoutMs` — a caller-supplied budget is a hard ceiling
   * and never retries.
   *
   * @default 2 (the OpenAI SDK default)
   */
  maxRetries?: number;
}

/**
 * Base provider class for OpenAI-compatible APIs.
 *
 * This class implements the full LLMProvider interface using the OpenAI SDK,
 * allowing subclasses to create custom providers with just configuration.
 *
 * Features:
 * - Streaming and non-streaming chat completions
 * - API key validation
 * - Model listing
 * - Configurable API key requirements
 * - Dynamic logging with provider name context
 *
 * @remarks
 * File attachments and image generation are not supported by default,
 * as support varies across OpenAI-compatible implementations.
 */
export class OpenAICompatibleProvider implements TextProvider {
  /** File attachments are not supported by default */
  readonly supportsFileAttachments = false;
  /** No MIME types are supported for attachments */
  readonly supportedMimeTypes: string[] = [];
  /** Web search is not supported */
  readonly supportsWebSearch = false;

  /** Base URL for the API endpoint */
  protected readonly baseUrl: string;
  /** Provider name for logging */
  protected readonly providerName: string;
  /** Whether API key is required */
  protected readonly requireApiKey: boolean;
  /** Error message for attachment failures */
  protected readonly attachmentErrorMessage: string;
  /** Default per-request wall-clock budget in milliseconds */
  protected readonly requestTimeoutMs: number;
  /** Retry count for requests that carry no caller-supplied budget */
  protected readonly maxRetries: number;
  /** Logger instance */
  protected readonly logger: PluginLogger;

  /**
   * Creates a new OpenAI-compatible provider instance.
   *
   * @param config - Configuration object or base URL string (for backward compatibility)
   */
  constructor(config: string | OpenAICompatibleProviderConfig) {
    // Support both legacy string baseUrl and new config object
    if (typeof config === 'string') {
      this.baseUrl = config;
      this.providerName = 'OpenAICompatible';
      this.requireApiKey = false;
      this.attachmentErrorMessage =
        'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)';
      this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
      this.maxRetries = DEFAULT_MAX_RETRIES;
    } else {
      this.baseUrl = config.baseUrl;
      this.providerName = config.providerName ?? 'OpenAICompatible';
      this.requireApiKey = config.requireApiKey ?? false;
      this.attachmentErrorMessage =
        config.attachmentErrorMessage ??
        'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)';
      this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    }

    this.logger = createPluginLogger(`${this.providerName}Provider`);
  }

  /**
   * Collects attachment failures for messages with attachments.
   * Since attachments are not supported, all attachments are marked as failed.
   *
   * @param params - LLM parameters containing messages
   * @returns Object with empty sent array and failed attachments
   */
  protected collectAttachmentFailures(
    params: LLMParams
  ): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: this.attachmentErrorMessage,
          });
        }
      }
    }
    return { sent: [], failed };
  }

  /**
   * Validates that an API key is provided when required.
   * @throws Error if API key is required but not provided
   */
  protected validateApiKeyRequirement(apiKey: string): void {
    if (this.requireApiKey && !apiKey) {
      throw new Error(`${this.providerName} provider requires an API key`);
    }
  }

  /**
   * Gets the effective API key to use for requests.
   * Returns 'not-needed' for providers that don't require keys.
   */
  protected getEffectiveApiKey(apiKey: string): string {
    return this.requireApiKey ? apiKey : apiKey || 'not-needed';
  }

  /**
   * Creates an OpenAI client configured with the provider's base URL,
   * API key, and Quilltap User-Agent header.
   *
   * @param apiKey - API key for authentication
   * @returns Configured OpenAI client instance
   */
  protected createClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey: this.getEffectiveApiKey(apiKey),
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
      timeout: this.requestTimeoutMs,
      maxRetries: this.maxRetries,
    });
  }

  /**
   * Builds the per-request options for a single call.
   *
   * When the caller supplied `params.requestTimeoutMs` it is a hard ceiling:
   * the request uses that budget and does not retry, so the total time spent is
   * what the caller asked for rather than a multiple of it. Otherwise the
   * client-level defaults apply.
   *
   * Subclasses that build their own request bodies should pass the result as
   * the second argument to `client.chat.completions.create(...)`.
   *
   * @param params - LLM parameters for the request
   * @returns Request options for the OpenAI SDK, or undefined to use defaults
   */
  protected buildRequestOptions(
    params: LLMParams
  ): { timeout: number; maxRetries: number } | undefined {
    return buildSdkRequestOptions(params);
  }

  /**
   * Sends a message and returns the complete response.
   *
   * @param params - LLM parameters including messages, model, and settings
   * @param apiKey - API key for authentication
   * @returns Complete LLM response with content and usage statistics
   */
  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);

    // Map messages to OpenAI Chat Completions format, including tool messages
    const messages = params.messages
      .filter((m) => {
        // Skip tool messages without toolCallId (backward compat)
        if (m.role === 'tool' && !m.toolCallId) return false;
        return true;
      })
      .map((m) => {
        // Tool result messages
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId as string,
            content: m.content,
          };
        }
        // Assistant messages with tool calls
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc: any) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          };
        }
        // Standard messages (strip attachments)
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        };
      });

    try {
      const response = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
        ...(params.cacheKey ? { user: params.cacheKey } : {}),
      }, this.buildRequestOptions(params));

      const choice = response.choices[0];
      return {
        content: choice.message.content ?? '',
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        raw: response,
        attachmentResults,
      };
    } catch (error) {
      this.logger.error(
        `${this.providerName} API error in sendMessage`,
        { context: `${this.providerName}Provider.sendMessage`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Sends a message and streams the response.
   *
   * @param params - LLM parameters including messages, model, and settings
   * @param apiKey - API key for authentication
   * @yields Stream chunks with content and final usage statistics
   */
  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);

    // Map messages to OpenAI Chat Completions format, including tool messages
    const messages = params.messages
      .filter((m) => {
        // Skip tool messages without toolCallId (backward compat)
        if (m.role === 'tool' && !m.toolCallId) return false;
        return true;
      })
      .map((m) => {
        // Tool result messages
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId as string,
            content: m.content,
          };
        }
        // Assistant messages with tool calls
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc: any) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          };
        }
        // Standard messages (strip attachments)
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        };
      });

    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
        stream: true,
        stream_options: { include_usage: true },
        ...(params.cacheKey ? { user: params.cacheKey } : {}),
      }, this.buildRequestOptions(params));

      let chunkCount = 0;

      // Track usage - it may come in a separate final chunk
      let accumulatedUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

      for await (const chunk of stream) {
        chunkCount++;
        const content = chunk.choices[0]?.delta?.content;
        const hasUsage = chunk.usage;

        // Track usage when we get it (may come in a separate final chunk)
        if (hasUsage) {
          accumulatedUsage = {
            prompt_tokens: chunk.usage?.prompt_tokens,
            completion_tokens: chunk.usage?.completion_tokens,
            total_tokens: chunk.usage?.total_tokens,
          };
        }

        // Yield content chunks
        if (content) {
          yield {
            content,
            done: false,
          };
        }
      }

      // After stream ends, yield final chunk with accumulated usage
      yield {
        content: '',
        done: true,
        usage: accumulatedUsage ? {
          promptTokens: accumulatedUsage.prompt_tokens ?? 0,
          completionTokens: accumulatedUsage.completion_tokens ?? 0,
          totalTokens: accumulatedUsage.total_tokens ?? 0,
        } : undefined,
        attachmentResults,
      };
    } catch (error) {
      this.logger.error(
        `${this.providerName} API error in streamMessage`,
        { context: `${this.providerName}Provider.streamMessage`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  /**
   * Validates an API key by attempting to list models.
   *
   * @param apiKey - API key to validate
   * @returns true if the API key is valid, false otherwise
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    // For providers that require API key, return false if not provided
    if (this.requireApiKey && !apiKey) {
      return false;
    }

    try {
      const client = this.createClient(apiKey);
      await client.models.list();
      return true;
    } catch (error) {
      this.logger.error(
        `${this.providerName} API validation failed`,
        { context: `${this.providerName}Provider.validateApiKey`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * Fetches available models from the API.
   *
   * @param apiKey - API key for authentication
   * @returns Sorted array of model IDs, or empty array on failure
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    // For providers that require API key, return empty if not provided
    if (this.requireApiKey && !apiKey) {
      this.logger.error(`${this.providerName} provider requires an API key to fetch models`, {
        context: `${this.providerName}Provider.getAvailableModels`,
      });
      return [];
    }

    try {
      const client = this.createClient(apiKey);
      const models = await client.models.list();
      const modelList = models.data.map((m) => m.id).sort();
      return modelList;
    } catch (error) {
      this.logger.error(
        `Failed to fetch ${this.providerName} models`,
        { context: `${this.providerName}Provider.getAvailableModels`, baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

}
