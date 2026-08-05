/**
 * LLM Log Type Definitions
 *
 * Contains schemas for LLM request/response logging used to track
 * all LLM API calls for debugging and monitoring purposes.
 *
 * @module schemas/llm-log.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// LLM LOG TYPE ENUM
// ============================================================================

export const LLMLogTypeEnum = z.enum([
  'CHAT_MESSAGE',
  'TOOL_CONTINUATION',
  'MEMORY_EXTRACTION',
  'TITLE_GENERATION',
  'CONTEXT_COMPRESSION',
  'SUMMARIZATION',
  'IMAGE_PROMPT_CRAFTING',
  'CHARACTER_WIZARD',
  'IMAGE_DESCRIPTION',
  'DANGER_CLASSIFICATION',
  'APPEARANCE_RESOLUTION',
  'AI_IMPORT',
  'SCENE_STATE_TRACKING',
  'CHARACTER_OPTIMIZER',
  'EXTERNAL_PROMPT',
  'AUTO_CONFIGURE',
  'IMAGE_GENERATION',
  'WARDROBE_IMAGE_ANALYSIS',
  'ANSWER_CONFIRMATION',
  'CUSTOM_TOOL_CONSULT',
]);
export type LLMLogType = z.infer<typeof LLMLogTypeEnum>;

// ============================================================================
// LLM LOG MESSAGE SUMMARY
// ============================================================================

export const LLMLogMessageSummarySchema = z.object({
  role: z.string(),
  content: z.string(), // Full message content
  contentPreview: z.string().optional(), // Deprecated: old truncated field, kept for backward compat
  contentLength: z.number(),
  hasAttachments: z.boolean().default(false),
});
export type LLMLogMessageSummary = z.infer<typeof LLMLogMessageSummarySchema>;

// ============================================================================
// LLM LOG REQUEST SUMMARY
// ============================================================================

export const LLMLogRequestSummarySchema = z.object({
  messageCount: z.number(),
  messages: z.array(LLMLogMessageSummarySchema),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  toolCount: z.number().default(0),
  fullMessages: z.any().nullable().optional(), // Deprecated: kept for backward compat with old log entries
});
export type LLMLogRequestSummary = z.infer<typeof LLMLogRequestSummarySchema>;

// ============================================================================
// LLM LOG RESPONSE SUMMARY
// ============================================================================

export const LLMLogResponseSummarySchema = z.object({
  content: z.string(), // Full response content
  contentPreview: z.string().optional(), // Deprecated: old truncated field, kept for backward compat
  contentLength: z.number(),
  fullContent: z.string().nullable().optional(), // Deprecated: kept for backward compat with old log entries
  error: z.string().nullable().optional(),
  // Provider-reported reason for ending generation. Normalized to the raw provider
  // string (e.g. OpenAI/Z.AI `stop`/`length`/`tool_calls`/`content_filter`,
  // Anthropic `end_turn`/`max_tokens`/`tool_use`/`stop_sequence`,
  // Google `STOP`/`MAX_TOKENS`/`SAFETY`, OpenAI Responses `completed`/`incomplete`).
  finishReason: z.string().nullable().optional(),
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  })).optional(), // Native tool calls from the LLM response
});
export type LLMLogResponseSummary = z.infer<typeof LLMLogResponseSummarySchema>;

// ============================================================================
// TOKEN USAGE
// ============================================================================

export const LLMLogTokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});
export type LLMLogTokenUsage = z.infer<typeof LLMLogTokenUsageSchema>;

// ============================================================================
// CACHE USAGE
// ============================================================================

export const LLMLogCacheUsageSchema = z.object({
  cacheCreationInputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
});
export type LLMLogCacheUsage = z.infer<typeof LLMLogCacheUsageSchema>;

// ============================================================================
// REQUEST HASHES
// ============================================================================

// Per-tier prefix hashes (SHA-256 truncated to 16 hex chars) used to verify
// that the cacheable prefix of a request is byte-stable across turns. A drift
// in any tier's hash signals that the cache will miss; observability for
// Phase 1 of the LLM cost-reduction plan.
export const LLMLogRequestHashesSchema = z.object({
  systemBlock1Hash: z.string().optional(),
  systemBlock2Hash: z.string().optional(),
  systemBlock3Hash: z.string().optional(),
  toolsArrayHash: z.string().optional(),
  historyTailHash: z.string().optional(),
});
export type LLMLogRequestHashes = z.infer<typeof LLMLogRequestHashesSchema>;

// ============================================================================
// LLM LOG ENTITY
// ============================================================================

export const LLMLogSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Type of LLM operation
  type: LLMLogTypeEnum,

  // Entity linkage (at least one should be set for non-standalone operations)
  messageId: UUIDSchema.nullable().optional(), // For chat message operations
  chatId: UUIDSchema.nullable().optional(), // For chat-level operations (title, compression)
  characterId: UUIDSchema.nullable().optional(), // For character wizard

  // Autonomous-room run linkage. Set on every LLM call made within the scope
  // of an autonomous-room turn (via the autonomous-run AsyncLocalStorage), so
  // per-run token spend can be summed by run instead of by a fragile
  // timestamp window. Null for all non-autonomous calls.
  autonomousRunId: UUIDSchema.nullable().optional(),

  // Provider info
  provider: z.string(),
  modelName: z.string(),

  // Profile attribution. `provider`/`modelName` above are flattened copies
  // taken from the profile at call time and cannot distinguish two profiles
  // that share the same provider/model pair — these columns can. Nullable:
  // rows written before 4.9 carry NULL and must be attributed by joining on
  // (provider, modelName), which the Almanack labels "approximate".
  connectionProfileId: UUIDSchema.nullable().optional(),
  imageProfileId: UUIDSchema.nullable().optional(),

  // Request summary
  request: LLMLogRequestSummarySchema,

  // Response summary
  response: LLMLogResponseSummarySchema,

  // Token usage
  usage: LLMLogTokenUsageSchema.nullable().optional(),
  cacheUsage: LLMLogCacheUsageSchema.nullable().optional(),

  // Raw provider-shape `usage` sub-object, captured pre-normalization.
  // Lets a SQL query compare provider-reported cached tokens against the
  // normalized `cacheUsage` and catch plugin normalization regressions
  // (the Z.AI pathology from 2026-04: provider reported cache hits but
  // plugin never read `prompt_tokens_details.cached_tokens`).
  // Schema-translator stores `z.record(...)` as a JSON TEXT column.
  rawProviderUsage: z.record(z.string(), z.unknown()).nullable().optional(),

  // Per-tier prefix hashes for cache-stability diagnostics
  requestHashes: LLMLogRequestHashesSchema.nullable().optional(),

  // Timing
  durationMs: z.number().nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type LLMLog = z.infer<typeof LLMLogSchema>;
