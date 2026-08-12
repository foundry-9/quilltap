/**
 * Text Provider — Shape 1: Text -> Text
 *
 * Send instructions + data (with optional attachments) to an LLM,
 * receive a text response. This is the fundamental text completion shape,
 * covering both standard and "cheap" model calls.
 *
 * @module @quilltap/plugin-types/providers/text
 */

import type { FileAttachment, TokenUsage, CacheUsage, AttachmentResults, ModelMetadata } from './common';
import type { ToolCall } from '../llm/tools';

/**
 * Message in a conversation
 */
export interface LLMMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Message content */
  content: string;
  /** Optional name for multi-character chats */
  name?: string;
  /** File attachments for this message */
  attachments?: FileAttachment[];
  /** Tool call ID (for tool role messages) */
  toolCallId?: string;
  /** Tool calls made by assistant */
  toolCalls?: ToolCall[];
  /** Cache control for prompt caching (Anthropic, Google) */
  cacheControl?: { type: 'ephemeral' };
  /** Google Gemini thought signature for thinking models */
  thoughtSignature?: string;
  /**
   * Reasoning / chain-of-thought content from thinking-mode providers
   * (e.g. DeepSeek V4 Pro `reasoning_content`). Must be passed back on
   * assistant turns that carry `toolCalls` or DeepSeek's API returns 400.
   * Providers that don't expose a separate reasoning channel ignore this.
   */
  reasoningContent?: string;
}

/**
 * JSON Schema definition for structured outputs
 */
export interface JSONSchemaDefinition {
  /** Name of the schema */
  name: string;
  /** Whether to use strict mode */
  strict?: boolean;
  /** The JSON schema object */
  schema: Record<string, unknown>;
}

/**
 * Response format for structured outputs
 */
export interface ResponseFormat {
  /** Output type */
  type: 'text' | 'json_object' | 'json_schema';
  /** JSON schema definition (when type is 'json_schema') */
  jsonSchema?: JSONSchemaDefinition;
}

/**
 * Parameters for text completion requests
 */
export interface LLMParams {
  /** Array of messages in the conversation */
  messages: LLMMessage[];
  /** Model identifier */
  model: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /**
   * When true, the provider MUST respect the exact maxTokens value without
   * applying model-specific overrides (e.g. reasoning model minimums).
   * Used by background tasks (cheap LLM) that need strict output limits.
   */
  strictMaxTokens?: boolean;
  /** Nucleus sampling parameter */
  topP?: number;
  /** Stop sequences */
  stop?: string | string[];
  /** Tool definitions (provider-specific format) */
  tools?: unknown[];
  /** Tool choice configuration */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Response format for structured outputs */
  responseFormat?: ResponseFormat;
  /** Seed for deterministic generation */
  seed?: number;
  /** User identifier for tracking */
  user?: string;
  /** Enable native web search capability */
  webSearchEnabled?: boolean;
  /** Provider-specific parameters from profile */
  profileParameters?: Record<string, unknown>;
  /** Previous response ID for conversation chaining (OpenAI Responses API) */
  previousResponseId?: string;
  /**
   * Per-character cache identifier. Quilltap builds this from the
   * speaking character's ID so the stable persona block (manifesto /
   * description / personality) becomes the actual cache prefix. Each
   * provider decides how to apply it:
   *  - OpenAI / Grok use it as `prompt_cache_key` (sticky routing hint).
   *  - DeepSeek uses it as `user_id` (KV-cache isolation namespace).
   *  - OpenAI-compatible / Z.AI / OpenRouter forward it as `user`.
   *  - Anthropic ignores it (content-hashed `cache_control` breakpoints).
   *  - Ollama / Curl ignore it.
   * Undefined when no character is active (e.g. user-only chats, titling).
   */
  cacheKey?: string;
  /**
   * Hard wall-clock budget for this one request, in milliseconds.
   *
   * Providers MUST treat this as a ceiling on a single attempt and MUST NOT
   * retry past it — a caller that sets this has already decided what the work
   * is worth waiting for. Omitted means "use the provider's own default",
   * which for SDK-backed providers is typically 10 minutes.
   *
   * Quilltap sets this on background / cheap-LLM work (memory recap, titling,
   * compression, extraction), which is awaited inline on user-visible turns and
   * must degrade rather than stall when a provider accepts a connection and
   * then never answers.
   *
   * Note that for SDK-backed providers this budget covers time-to-response-
   * headers, not time-to-last-token: a streaming request is measured on how
   * long the provider takes to *start* answering, so a long generation is not
   * penalised.
   */
  requestTimeoutMs?: number;
}

/**
 * Response from a text completion
 */
export interface LLMResponse {
  /** Generated content */
  content: string;
  /** Reason generation stopped */
  finishReason: string | null;
  /** Token usage statistics */
  usage: TokenUsage;
  /** Provider-specific raw response */
  raw?: unknown;
  /** Tool calls made by the model */
  toolCalls?: ToolCall[];
  /** Results of attachment processing */
  attachmentResults?: AttachmentResults;
  /** Google Gemini thought signature */
  thoughtSignature?: string;
  /** Reasoning / chain-of-thought content (DeepSeek thinking mode, etc.) */
  reasoningContent?: string;
  /** Cache usage statistics */
  cacheUsage?: CacheUsage;
}

/**
 * Streaming chunk from a text completion
 */
export interface StreamChunk {
  /** Content in this chunk */
  content: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Token usage (typically on final chunk) */
  usage?: TokenUsage;
  /** Tool calls (typically on final chunk) */
  toolCalls?: ToolCall[];
  /** Attachment results (typically on final chunk) */
  attachmentResults?: AttachmentResults;
  /** Raw response for tool call detection */
  rawResponse?: unknown;
  /** Google Gemini thought signature */
  thoughtSignature?: string;
  /** Reasoning / chain-of-thought content, typically on final chunk */
  reasoningContent?: string;
  /** Cache usage statistics (normalized) */
  cacheUsage?: CacheUsage;
  /**
   * Provider-shape `usage` sub-object, captured pre-normalization for
   * cache-instrumentation diagnostics. Each provider's shape differs
   * (OpenAI/Grok/Z.AI: `prompt_tokens_details.cached_tokens`; Anthropic:
   * `cache_read_input_tokens`; Google: `cachedContentTokenCount`).
   * Lets the logger compare provider-reported cache hits against the
   * normalized `cacheUsage` and catch field-mapping regressions.
   */
  rawProviderUsage?: Record<string, unknown> | null;
}

/**
 * Text completion provider interface — Shape 1: Text -> Text
 *
 * Sends instructions and data to an LLM and receives text responses,
 * either as a complete response or as a stream of chunks.
 *
 * This covers both standard and "cheap" model calls — the difference
 * is in model selection and parameters, not the interface shape.
 */
export interface TextProvider {
  /** Whether this provider supports file attachments */
  readonly supportsFileAttachments: boolean;
  /** Supported MIME types for file attachments */
  readonly supportedMimeTypes: string[];
  /** Whether this provider supports web search */
  readonly supportsWebSearch: boolean;

  /**
   * Send a message and get a complete response
   */
  sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>;

  /**
   * Send a message and stream the response
   */
  streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>;

  /**
   * Validate an API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models from the provider
   */
  getAvailableModels(apiKey: string): Promise<string[]>;

  /**
   * Get metadata for a specific model (optional)
   */
  getModelMetadata?(modelId: string): ModelMetadata | undefined;

  /**
   * Get metadata for all models with warnings (optional)
   */
  getModelsWithMetadata?(apiKey: string): Promise<ModelMetadata[]>;
}
