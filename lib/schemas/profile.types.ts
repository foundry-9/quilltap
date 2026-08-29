/**
 * Profile Type Definitions
 *
 * Contains schemas for API keys, connection profiles, image profiles,
 * and embedding profiles.
 *
 * @module schemas/profile.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
  ProviderEnum,
  ImageProviderEnum,
  EmbeddingProfileProviderEnum,
} from './common.types';

// ============================================================================
// API KEYS
// ============================================================================

export const ApiKeySchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  label: z.string(),
  provider: ProviderEnum,
  key_value: z.string(),
  isActive: z.boolean().default(true),
  lastUsed: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

// ============================================================================
// CONNECTION PROFILES
// ============================================================================

export const ConnectionProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ProviderEnum,
  /**
   * How requests for this profile are delivered.
   * - 'api': the normal plugin-dispatched API path (default for all
   *   pre-existing profiles).
   * - 'courier': the manual / clipboard transport. Quilltap renders the
   *   assembled request as Markdown for the human user to carry by hand to
   *   an external LLM and paste the reply back in. No API key, base URL, or
   *   tools are used; `provider` is informational only ("OpenAI",
   *   "Anthropic in claude.ai", etc.).
   */
  transport: z.enum(['api', 'courier']).default('api'),
  /**
   * The Courier — delta mode. When true (default), after a character's first
   * successful Courier turn in a given chat, subsequent placeholders render
   * only the delta since the last paste. Desktop LLM clients (Claude desktop,
   * ChatGPT web, etc.) hold the prior conversation themselves, so the full
   * system prompt and earlier history needn't be re-established every turn.
   * The Salon bubble still keeps a full-context fallback alongside the delta
   * for when the user has switched clients or cleared their conversation.
   * Ignored when `transport === 'api'`.
   */
  courierDeltaMode: z.boolean().default(true),
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  /** Whether this profile is suitable for use as a "cheap" LLM (low-cost tasks) */
  isCheap: z.boolean().default(false),
  /** Whether the search_web tool is enabled for this profile */
  allowWebSearch: z.boolean().default(false),
  /** Whether to use the provider's native web search integration (if supported) */
  useNativeWebSearch: z.boolean().default(false),
  /** Whether tool use is allowed for this profile (master override — when false, no tools are sent regardless of chat/project settings) */
  allowToolUse: z.boolean().default(true),
  /**
   * How tool calls are framed on the wire when this profile is in play.
   * - 'auto'        — pick automatically based on model capability. Native
   *                   function-calling models use the native protocol; models
   *                   without native support fall back to the simple-json
   *                   `<tool_call>` pseudo-tool format.
   * - 'native'      — force the provider's native function calling.
   * - 'simple-json' — force the `<tool_call>{...}</tool_call>` JSON-in-XML
   *                   pseudo-tool format with stop-sequence enforcement.
   * - 'text-block'  — legacy `[[TOOL ...]]content[[/TOOL]]` pseudo-tool
   *                   format. Kept for compatibility while users migrate.
   */
  pseudoToolMode: z.enum(['auto', 'native', 'simple-json', 'text-block']).default('auto'),
  /**
   * How a multi-character chat anchors a reply to the character whose turn it
   * is.
   *
   * - `true` (default) — append an assistant message containing
   *   `[Character Name]`, so the model structurally continues only that
   *   character's line. The tag is stripped downstream.
   * - `false` — append a prose instruction to the system prompt instead,
   *   leaving the conversation ending on a user message.
   *
   * Turn it off for models that cannot take an assistant prefill (Anthropic
   * 4.6+ rejects the request outright), that lose a capability to it (Ollama's
   * thinking channel is opened by the chat template at the start of the
   * assistant turn, so a prefill suppresses reasoning entirely), or that
   * visibly spend their reply deciding whether `[Name]` was an instruction or
   * a previous speaker's slip. Single-character chats never use either anchor.
   *
   * `null`/absent means "not chosen yet" — rows written before
   * `add-profile-multi-character-prefill-field-v1` and profiles imported from
   * a pre-4.9 bundle. Never read this field directly: resolve it through
   * `profileUsesNamePrefill()` in `lib/llm/multi-character-prefill.ts`, which
   * falls back to the provider default (off for Anthropic, on elsewhere).
   */
  multiCharacterPrefill: z.boolean().nullable().optional(),
  /** Optional model class name for capability tier classification (e.g., 'Compact', 'Standard', 'Extended', 'Deep') */
  modelClass: z.string().nullable().optional(),
  /**
   * The understudy: another connection profile to try when a call through this
   * one fails outright (auth, rate limit, network, missing model, 5xx, empty
   * response, moderation refusal).
   *
   * Chains do NOT recurse — when A falls back to B, B's own
   * `fallbackProfileId` is not followed. That keeps a cycle (A->B, B->A)
   * harmless and caps any call at three attempts. The only config-time rules
   * are "not yourself" and "not a Courier profile" (a Courier transport needs
   * a human to carry the request by hand, which is no kind of failover).
   *
   * Never read this field directly to build a chain: go through
   * `buildFallbackChain()` in `lib/llm/fallback/engine.ts`, which drops a
   * target that has since been deleted or switched to Courier.
   */
  fallbackProfileId: UUIDSchema.nullable().optional(),
  /**
   * Whether, after both this profile and its named understudy have failed,
   * Quilltap may draft ONE more candidate from the rest of the company —
   * a profile of the same or better `modelClass` quality, preferring a
   * different provider than the one that just failed.
   *
   * Off by default: an auto-picked replacement spends money at a provider the
   * user did not choose for this call.
   */
  allowTierFallback: z.boolean().default(false),
  /** Optional override for the context window size in tokens (caps how much input the model accepts) */
  maxContext: z.number().int().positive().nullable().optional(),
  /** Optional override for the maximum output/completion tokens the model can generate */
  maxTokens: z.number().int().positive().nullable().optional(),
  /** Whether this profile is suitable for uncensored/dangerous content (user must explicitly opt in) */
  isDangerousCompatible: z.boolean().default(false),
  /** Whether this profile accepts image attachments (vision input). Set per-profile so users can enable it on OpenRouter/Ollama models that proxy vision-capable LLMs. */
  supportsImageUpload: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),

  /** Custom sort order for display (lower numbers appear first) */
  sortIndex: z.number().default(0),

  // Token usage tracking (persisted, incremented after each message)
  /** Total tokens used through this profile */
  totalTokens: z.number().default(0),
  /** Total prompt/input tokens used through this profile */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used through this profile */
  totalCompletionTokens: z.number().default(0),
  /** Total messages sent through this profile */
  messageCount: z.number().default(0),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;

export const ConnectionProfilesFileSchema = z.object({
  version: z.number().default(1),
  apiKeys: z.array(ApiKeySchema).default([]),
  llmProfiles: z.array(ConnectionProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfilesFile = z.infer<typeof ConnectionProfilesFileSchema>;

// ============================================================================
// IMAGE PROFILES
// ============================================================================

export const ImageProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ImageProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  /** Whether this profile is suitable for uncensored/dangerous image content (user must explicitly opt in) */
  isDangerousCompatible: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfile = z.infer<typeof ImageProfileSchema>;

export const ImageProfilesFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(ImageProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfilesFile = z.infer<typeof ImageProfilesFileSchema>;

// ============================================================================
// EMBEDDING PROFILES
// ============================================================================

export const EmbeddingProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: EmbeddingProfileProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  /** Embedding dimension size requested from the provider (provider-specific) */
  dimensions: z.number().nullable().optional(),
  /**
   * If set, the raw vector returned by the provider is sliced to this length
   * before normalization. Intended for Matryoshka-trained models (e.g. Qwen3-
   * Embedding) whose first N components are themselves a valid embedding at
   * dimension N. When null, the vector is stored at whatever length the
   * provider returned.
   */
  truncateToDimensions: z.number().int().positive().nullable().optional(),
  /**
   * When true (default), every embedding is L2-normalised before storage so
   * cosine similarity reduces to a dot product. False is reserved for niche
   * cases where downstream code wants raw magnitudes.
   */
  normalizeL2: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type EmbeddingProfile = z.infer<typeof EmbeddingProfileSchema>;

export const EmbeddingProfilesFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(EmbeddingProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type EmbeddingProfilesFile = z.infer<typeof EmbeddingProfilesFileSchema>;
