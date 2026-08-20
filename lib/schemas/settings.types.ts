/**
 * Settings Type Definitions
 *
 * Contains schemas for chat settings, cheap LLM configuration,
 * timestamp configuration, and general settings.
 *
 * @module schemas/settings.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  AvatarDisplayModeEnum,
  TagStyleMapSchema,
  ThemePreferenceSchema,
} from './common.types';
import { UserSchema } from './auth.types';

// ============================================================================
// CONTEXT COMPRESSION SETTINGS
// ============================================================================

export const ContextCompressionSettingsSchema = z.object({
  /** Whether context compression is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Number of messages to keep in full context (sliding window size) */
  windowSize: z.number().min(3).max(10).default(5),
  /** Target token count for compressed history (500-1200 tokens) */
  compressionTargetTokens: z.number().min(300).max(2000).default(800),
  /** Target token count for compressed system prompt */
  systemPromptTargetTokens: z.number().min(500).max(3000).default(1500),
  /** How often to re-inject project context into the system prompt (0 = never after initial, matches windowSize by default) */
  projectContextReinjectInterval: z.number().min(0).max(20).default(5),
});

export type ContextCompressionSettings = z.infer<typeof ContextCompressionSettingsSchema>;

// ============================================================================
// CHEAP LLM SETTINGS
// ============================================================================

export const CheapLLMStrategyEnum = z.enum(['USER_DEFINED', 'PROVIDER_CHEAPEST', 'LOCAL_FIRST']);
export type CheapLLMStrategy = z.infer<typeof CheapLLMStrategyEnum>;

export const EmbeddingProviderEnum = z.enum(['SAME_PROVIDER', 'OPENAI', 'LOCAL']);
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderEnum>;

export const CheapLLMSettingsSchema = z.object({
  /** Strategy for selecting the cheap LLM provider */
  strategy: CheapLLMStrategyEnum.default('PROVIDER_CHEAPEST'),
  /** If USER_DEFINED, which connection profile to use */
  userDefinedProfileId: UUIDSchema.nullable().optional(),
  /** Global default cheap LLM profile - always use this if set */
  defaultCheapProfileId: UUIDSchema.nullable().optional(),
  /** Whether to fall back to local models if available */
  fallbackToLocal: z.boolean().default(true),
  /** Provider for generating embeddings */
  embeddingProvider: EmbeddingProviderEnum.default('OPENAI'),
  /** Optional override for image prompt expansion LLM - when set, uses this instead of global cheap LLM */
  imagePromptProfileId: UUIDSchema.nullable().optional(),
});

export type CheapLLMSettings = z.infer<typeof CheapLLMSettingsSchema>;

// ============================================================================
// TIMESTAMP CONFIGURATION
// ============================================================================

export const TimestampModeEnum = z.enum(['NONE', 'START_ONLY', 'EVERY_MESSAGE', 'EVERY_N_MINUTES']);
export type TimestampMode = z.infer<typeof TimestampModeEnum>;

export const TimestampFormatEnum = z.enum(['ISO8601', 'FRIENDLY', 'DATE_ONLY', 'TIME_ONLY', 'CUSTOM']);
export type TimestampFormat = z.infer<typeof TimestampFormatEnum>;

export const TimestampConfigSchema = z.object({
  /** Whether to inject timestamps and how */
  mode: TimestampModeEnum.default('NONE'),
  /** How to format the timestamp */
  format: TimestampFormatEnum.default('FRIENDLY'),
  /** Custom format string (when format is CUSTOM) - uses date-fns format tokens */
  customFormat: z.string().nullable().optional(),
  /** Whether to use fictional/arbitrary timestamp instead of real time */
  useFictionalTime: z.boolean().default(false),
  /** Base fictional timestamp (ISO-8601 format) */
  fictionalBaseTimestamp: z.string().nullable().optional(),
  /** Real timestamp when the fictional base was set (for auto-increment calculation) */
  fictionalBaseRealTime: z.string().nullable().optional(),
  /** Whether to auto-prepend "Current time: [timestamp]" or use {{timestamp}} template variable */
  autoPrepend: z.boolean().default(true),
  /** IANA timezone name override for this chat (e.g., "America/New_York") */
  timezone: z.string().nullable().optional(),
  /** Minimum minutes between Host timestamp announcements when mode is EVERY_N_MINUTES (default 15) */
  intervalMinutes: z.number().int().min(1).default(15),
});

export type TimestampConfig = z.infer<typeof TimestampConfigSchema>;

// ============================================================================
// MEMORY CASCADE PREFERENCES
// ============================================================================

export const MemoryCascadeActionEnum = z.enum([
  'DELETE_MEMORIES',      // Delete associated memories
  'KEEP_MEMORIES',        // Keep memories (orphan them)
  'REGENERATE_MEMORIES',  // Delete old, regenerate new
  'ASK_EVERY_TIME',       // Always show confirmation dialog
]);
export type MemoryCascadeAction = z.infer<typeof MemoryCascadeActionEnum>;

export const MemoryCascadePreferencesSchema = z.object({
  /** What to do when deleting a message with associated memories */
  onMessageDelete: MemoryCascadeActionEnum.default('ASK_EVERY_TIME'),
  /** What to do when generating a new swipe (regenerating response) */
  onSwipeRegenerate: MemoryCascadeActionEnum.default('DELETE_MEMORIES'),
});

export type MemoryCascadePreferences = z.infer<typeof MemoryCascadePreferencesSchema>;

// ============================================================================
// AUTO-HOUSEKEEPING SETTINGS (Commonplace Book)
// ============================================================================

/**
 * Per-character cap override. When a characterId appears in the map, its cap
 * replaces the global `perCharacterCap` for that character only.
 */
export const AutoHousekeepingCapOverrideSchema = z.record(z.string(), z.number().int().positive());
export type AutoHousekeepingCapOverride = z.infer<typeof AutoHousekeepingCapOverrideSchema>;

export const AutoHousekeepingSettingsSchema = z.object({
  /** When true, housekeeping runs automatically (post-write watermark + scheduled sweep). Default off. */
  enabled: z.boolean().default(false),
  /** Global per-character memory cap. Housekeeping engages when count >= 80% of this. */
  perCharacterCap: z.number().int().positive().default(2000),
  /** Per-character cap overrides keyed by characterId. */
  perCharacterCapOverrides: AutoHousekeepingCapOverrideSchema.default({}),
  /** Similarity threshold for the optional merge-similar pass during housekeeping. */
  autoMergeSimilarThreshold: z.number().min(0).max(1).default(0.90),
  /** When true, housekeeping also merges semantically similar memories (on top of retention-policy deletions). */
  mergeSimilar: z.boolean().default(false),
});

export type AutoHousekeepingSettings = z.infer<typeof AutoHousekeepingSettingsSchema>;

// ============================================================================
// MEMORY RECALL SETTINGS (Commonplace Book — recall/read path)
// ============================================================================

/**
 * Recall-time relevance controls for the Commonplace Book. These shape which
 * stored memories surface in a chat by reading the targeting tags the extractor
 * already writes into each memory's `keywords` (see lib/memory/recall-tags.ts).
 *
 * Stored instance-wide in `instance_settings['memoryRecall']` (single-user
 * model — same class as `memoryExtractionLimits`), NOT on the column-per-field
 * `chat_settings` table, so adding it needs no migration. Accessors:
 * `getMemoryRecallSettings` / `setMemoryRecallSettings` in `lib/instance-settings`.
 */
export const MemoryRecallSettingsSchema = z.object({
  /**
   * What to do with a `scope: narrow` memory whose project differs from the
   * current chat's project (the cross-project-leakage case). `down-weight`
   * (default) applies a strong multiplicative penalty but never fully hides the
   * memory; `exclude` filters it out of recall entirely.
   */
  scopePolicy: z.enum(['down-weight', 'exclude']).default('down-weight'),
  /**
   * When true, recall pulls each top hit's strongly-linked related memories in
   * as extra candidates (one hop, capped) and re-ranks the union — catching the
   * memory relevant by association that didn't clear the embedding threshold
   * directly. Costs one extra batched lookup per turn; off by default.
   */
  expandRelated: z.boolean().default(false),
  /**
   * When true, EVERY turn's consolidated Commonplace Book whisper also carries
   * a freshly-searched "Relevant Past Conversations" list drawn from the
   * responding character's vault `Conversation Summaries/` folder. The search
   * reuses the vector already embedded for that turn's memory search, so it
   * costs no extra embedding call — only the chunk scan and the frontmatter
   * reads.
   *
   * Off by default, in which case the list refreshes on its three original
   * cadences only: the chat-start / character-join recap, each summary fold
   * (the standing `relevant-conversations` whisper), and retrospective turns
   * (the `retrospective-recall` mini-recap).
   *
   * Instance-wide by design — no chat, project, or character override.
   */
  perTurnConversationSummaries: z.boolean().default(false),
});

export type MemoryRecallSettings = z.infer<typeof MemoryRecallSettingsSchema>;

// ============================================================================
// MEMORY EXTRACTION RATE LIMITS (Commonplace Book)
// ============================================================================

/**
 * Graduated importance floor is applied when a character's recent extraction
 * volume approaches or exceeds the configured per-hour cap:
 *   - Below `softStartFraction` of the cap: no filter (all significant candidates pass)
 *   - Between `softStartFraction` and 1.0: only candidates with importance >= `softFloor` pass
 *   - At or above 1.0: extraction is skipped entirely for this exchange
 */
export const MemoryExtractionLimitsSchema = z.object({
  /** When true, the rate limiter is active. Off by default. */
  enabled: z.boolean().default(false),
  /** Maximum memories a single character may accrue per hour before the limiter engages. */
  maxPerHour: z.number().int().positive().default(20),
  /** Fraction of maxPerHour at which the graduated floor begins to apply (0–1). */
  softStartFraction: z.number().min(0).max(1).default(0.7),
  /** Importance floor applied to new candidates while in the graduated band. */
  softFloor: z.number().min(0).max(1).default(0.7),
});

export type MemoryExtractionLimits = z.infer<typeof MemoryExtractionLimitsSchema>;

// ============================================================================
// DATA RETENTION (stale-chat maintenance window)
// ============================================================================

/**
 * How long a chat must sit with no *played* message (participant character or
 * the human user — feature whispers don't count) before the daily maintenance
 * sweep treats it as stale. Governs every stale-gated sweep: generated-image
 * collapse, regenerable-cache collapse, and conversation-chunk cold-tiering.
 *
 * Stored instance-wide in `instance_settings['dataRetention']` (single-user
 * model — same class as `memoryRecall`), NOT on the column-per-field
 * `chat_settings` table, so adding it needs no migration. Accessors:
 * `getDataRetentionSettings` / `setDataRetentionSettings` in
 * `lib/instance-settings`.
 */
export const DataRetentionSettingsSchema = z.object({
  /**
   * A chat is "stale" after this many days with no played message. Governs
   * the maintenance sweep (image collapse + cache collapse + cold-tier).
   */
  staleChatDays: z.number().int().min(1).max(3650).default(30),
});

export type DataRetentionSettings = z.infer<typeof DataRetentionSettingsSchema>;

// ============================================================================
// BRAHMA CONSOLE (agentic tool-use loop budget)
// ============================================================================

/**
 * How many agent turns the Brahma Console (and its one-shot Salon `@Brahma`
 * cousin) may take before it is forced to answer with what it has. Each turn is
 * one round of the tool-use loop — a search, a `run_sql` query, a document read.
 * A generous budget lets the Console chase something deep in the ledgers; the
 * duplicate/stale-query guard still short-circuits a genuinely stuck loop long
 * before this cap, so raising it costs nothing when the model is making real
 * progress.
 *
 * Stored instance-wide in `instance_settings['brahmaConsole']` (single-user
 * model — same class as `dataRetention`), NOT on the column-per-field
 * `chat_settings` table, so adding it needs no migration. Accessors:
 * `getBrahmaConsoleSettings` / `setBrahmaConsoleSettings` in
 * `lib/instance-settings`; resolved for the services by
 * `resolveBrahmaMaxAgentTurns` in
 * `lib/services/brahma-console/turn-budget.ts`.
 */
export const BrahmaConsoleSettingsSchema = z.object({
  /**
   * Maximum tool-use turns per query before the Console is made to give its
   * final answer. Independent of the duplicate/stale-query guard, which still
   * stops a loop that repeats itself regardless of this number.
   */
  maxAgentTurns: z.number().int().min(5).max(200).default(50),
});

export type BrahmaConsoleSettings = z.infer<typeof BrahmaConsoleSettingsSchema>;

// ============================================================================
// TABOO (instance-wide forbidden phrases)
// ============================================================================

/**
 * Phrases no character may utter — the stock LLM-isms of the day ("that's not
 * nothing", "weight-bearing"). One list per instance, rendered as a universal,
 * character-independent section of the system prompt on every conversational
 * character response.
 *
 * Stored instance-wide in `instance_settings['taboo']` (single-user model —
 * same class as `dataRetention`), NOT on the column-per-field `chat_settings`
 * table, so adding it needs no migration. Accessors: `getTabooSettings` /
 * `setTabooSettings` in `lib/instance-settings`; the setter normalizes
 * (trim, drop empties, case-insensitive dedupe) while preserving user order.
 * Rendered by `renderTabooSection` in
 * `lib/chat/context/system-prompt-builder.ts`.
 */
export const TabooSettingsSchema = z.object({
  /**
   * The forbidden phrases, in the order the user arranged them. Order is
   * user-controlled on purpose: it is part of the cacheable prompt prefix, so
   * it only shifts when the user edits the list.
   */
  phrases: z
    .array(z.string().trim().min(1).max(200))
    .max(500)
    .default([]),
});

export type TabooSettings = z.infer<typeof TabooSettingsSchema>;

// ============================================================================
// AUTONOMOUS ROOM SETTINGS (4.6 Private Character Rooms)
// ============================================================================

export const AutonomousRoomVisibilityDefaultEnum = z.enum(['owner_only', 'household', 'open']);
export type AutonomousRoomVisibilityDefault = z.infer<typeof AutonomousRoomVisibilityDefaultEnum>;

export const AutonomousRoomDestructiveToolPolicyEnum = z.enum(['always_refuse', 'opt_in_per_room']);
export type AutonomousRoomDestructiveToolPolicy = z.infer<typeof AutonomousRoomDestructiveToolPolicyEnum>;

/**
 * User-level defaults that govern every autonomous room owned by the user.
 *  - dailyTokenBudget: daily cap on cumulative tokens spent by autonomous-room
 *    turns for this user, evaluated at instance-local midnight. Defaults to null
 *    (no daily cap until the user sets one). Cache-read (prompt-cache hit) tokens
 *    are excluded by the provider plugins, so cached input does not count toward
 *    this cap.
 *  - defaultFreshnessWindowMs: per-room override falls back to this. 12h default.
 *  - visibilityDefault: applied at room creation; per-room override on chats.runVisibility.
 *  - destructiveToolPolicy: 'always_refuse' is a ceiling — overrides any permissive
 *    per-room runDestructiveToolsAllowed flag. 'opt_in_per_room' honors the per-room flag.
 */
export const AutonomousRoomSettingsSchema = z.object({
  dailyTokenBudget: z.number().int().positive().nullable().default(null),
  defaultFreshnessWindowMs: z.number().int().positive().default(12 * 60 * 60 * 1000),
  visibilityDefault: AutonomousRoomVisibilityDefaultEnum.default('owner_only'),
  destructiveToolPolicy: AutonomousRoomDestructiveToolPolicyEnum.default('opt_in_per_room'),
});

export type AutonomousRoomSettings = z.infer<typeof AutonomousRoomSettingsSchema>;

// ============================================================================
// TOKEN DISPLAY SETTINGS
// ============================================================================

export const TokenDisplaySettingsSchema = z.object({
  /** Show per-message token counts in chat */
  showPerMessageTokens: z.boolean().default(false),
  /** Show estimated cost per message */
  showPerMessageCost: z.boolean().default(false),
  /** Show chat-level token aggregation and cost */
  showChatTotals: z.boolean().default(false),
  /** Show system events (cheap LLM operations) in chat */
  showSystemEvents: z.boolean().default(false),
});

export type TokenDisplaySettings = z.infer<typeof TokenDisplaySettingsSchema>;

// ============================================================================
// LLM LOGGING SETTINGS
// ============================================================================

export const LLMLoggingSettingsSchema = z.object({
  /** Whether LLM request/response logging is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Whether to store full messages in logs (default: false for storage efficiency) */
  verboseMode: z.boolean().default(false),
  /** Number of days to retain logs, 0 = forever (default: 30) */
  retentionDays: z.number().min(0).max(365).default(30),
});

export type LLMLoggingSettings = z.infer<typeof LLMLoggingSettingsSchema>;

// ============================================================================
// DANGEROUS CONTENT SETTINGS
// ============================================================================

export const DangerousContentModeEnum = z.enum(['OFF', 'DETECT_ONLY', 'AUTO_ROUTE']);
export type DangerousContentMode = z.infer<typeof DangerousContentModeEnum>;

export const DangerousContentDisplayModeEnum = z.enum(['SHOW', 'BLUR', 'COLLAPSE']);
export type DangerousContentDisplayMode = z.infer<typeof DangerousContentDisplayModeEnum>;

export const DangerousContentSettingsSchema = z.object({
  /** Operating mode: OFF disables all scanning, DETECT_ONLY flags but doesn't reroute, AUTO_ROUTE flags and reroutes to uncensored provider */
  mode: DangerousContentModeEnum.default('OFF'),
  /** Classification threshold (0-1): content scoring above this is flagged as dangerous */
  threshold: z.number().min(0).max(1).default(0.7),
  /** Whether to scan user text messages for dangerous content */
  scanTextChat: z.boolean().default(true),
  /** Whether to scan user image prompts for dangerous content */
  scanImagePrompts: z.boolean().default(true),
  /** Whether to scan expanded prompts before image generation */
  scanImageGeneration: z.boolean().default(false),
  /** Connection profile ID for uncensored text LLM (must have isDangerousCompatible=true) */
  uncensoredTextProfileId: UUIDSchema.nullable().optional(),
  /** Image profile ID for uncensored image generation (must have isDangerousCompatible=true) */
  uncensoredImageProfileId: UUIDSchema.nullable().optional(),
  /** How flagged messages are displayed in the UI */
  displayMode: DangerousContentDisplayModeEnum.default('SHOW'),
  /** Whether to show warning badges on flagged messages */
  showWarningBadges: z.boolean().default(true),
  /** Custom classification prompt to append to the default classification system prompt */
  customClassificationPrompt: z.string().nullable().optional(),
});

export type DangerousContentSettings = z.infer<typeof DangerousContentSettingsSchema>;

// ============================================================================
// AUTO-LOCK SETTINGS
// ============================================================================

export const AutoLockSettingsSchema = z.object({
  /** Whether auto-lock is enabled (default: false) */
  enabled: z.boolean().default(false),
  /** Number of minutes of inactivity before auto-locking (default: 15, min: 1) */
  idleMinutes: z.number().int().min(1).default(15),
});

export type AutoLockSettings = z.infer<typeof AutoLockSettingsSchema>;

// ============================================================================
// AGENT MODE SETTINGS
// ============================================================================

export const AgentModeSettingsSchema = z.object({
  /** Maximum number of agent turns (iterations) before forcing final response (1-25, default: 10) */
  maxTurns: z.number().min(1).max(25).default(10),
  /** Whether agent mode is enabled by default for new chats (default: false) */
  defaultEnabled: z.boolean().default(false),
});

export type AgentModeSettings = z.infer<typeof AgentModeSettingsSchema>;

// ============================================================================
// CORE WHISPER SETTINGS (Aurora)
// ============================================================================

/**
 * Aurora's Core whisper — global defaults for the periodic re-offering of each
 * character's own `Core/` vault folder. Per-chat and per-character overrides
 * live on the `chats` and `characters` tables respectively; resolution
 * precedence is chat → character → global.
 */
export const CoreWhisperSettingsSchema = z.object({
  /** Master switch. When false, no Core whispers fire anywhere. Default: true. */
  enabled: z.boolean().default(true),
  /** Assistant turns between periodic whispers for the same character. Default: 12. */
  interval: z.number().int().min(3).max(50).default(12),
  /** Whisper fires when this many consecutive visible turns by others precede the character's next turn. Default: 3. */
  silenceThreshold: z.number().int().min(1).max(20).default(3),
  /** Soft warning threshold (token estimate) on assembled Core packets. No truncation; an oversized packet logs a refactoring hint. Default: 4096. */
  packetTokenBudget: z.number().int().positive().default(4096),
  /** Fire the whisper after major context transitions (rolling-summary fold, transparency-affecting setting change). Default: true. */
  fireOnContextTransition: z.boolean().default(true),
});

export type CoreWhisperSettings = z.infer<typeof CoreWhisperSettingsSchema>;

// ============================================================================
// THINKING / REASONING DISPLAY SETTINGS
// ============================================================================

/**
 * Global defaults for displaying reasoning models' chain-of-thought ("thinking")
 * in the Salon. Per-chat overrides live on the `chats` table as the tri-state
 * `showThinking` (NULL = inherit `defaultVisible`). DISPLAY ONLY — these settings
 * never affect whether reasoning is captured or stored, only whether it is shown.
 */
export const ThinkingDisplaySettingsSchema = z.object({
  /** Whether new chats show captured thinking by default. Default: true. */
  defaultVisible: z.boolean().default(true),
  /** Whether the thinking block starts collapsed when shown. Default: true. */
  defaultCollapsed: z.boolean().default(true),
});

export type ThinkingDisplaySettings = z.infer<typeof ThinkingDisplaySettingsSchema>;

/**
 * Answer confirmation — global defaults for the Salon consistency check that
 * vets a character's tool-using reply against what it was told (Commonplace
 * Book whisper) and looked up (read tools) this turn. Off by default; a
 * per-project or per-chat override can flip it on. See
 * `isAnswerConfirmationActive`.
 */
export const AnswerConfirmationSettingsSchema = z.object({
  /** Whether the consistency check runs by default (global). Default: false. */
  enabled: z.boolean().default(false),
});

export type AnswerConfirmationSettings = z.infer<typeof AnswerConfirmationSettingsSchema>;

/**
 * Smart typography — two mechanisms, deliberately split by confidence.
 *
 * `displayQuotes` is a *rendering* opinion: the message renderer curls quotes on
 * the way to the screen and the stored bytes are never touched, so the model,
 * the embeddings and every export still see exactly what the writer typed, and
 * flipping the toggle off puts all of history back.
 *
 * `dashes` and `ellipsis` are *content*: a writer typing `--` means a dash, so
 * the real character is written into the text at the keystroke, one Backspace
 * (or one Cmd/Ctrl+Z) away from being undone.
 *
 * Dashes are deliberately absent from the render-time half and always will be —
 * `run it with --verbose` must survive being written in prose.
 */
export const SmartTypographySettingsSchema = z.object({
  /** Part A — curl quotes when rendering messages. Stored text is never modified. Default: false. */
  displayQuotes: z.boolean().default(false),
  /** Part B — `--` and `---` become real dashes as you type. Default: true. */
  dashes: z.boolean().default(true),
  /** Part B — `...` becomes an ellipsis as you type. Default: true. */
  ellipsis: z.boolean().default(true),
});

export type SmartTypographySettings = z.infer<typeof SmartTypographySettingsSchema>;

// ============================================================================
// STORY BACKGROUNDS SETTINGS
// ============================================================================

export const StoryBackgroundsSettingsSchema = z.object({
  /** Whether story background generation is enabled (default: false) */
  enabled: z.boolean().default(false),
  /** Default image profile ID to use for background generation */
  defaultImageProfileId: UUIDSchema.nullable().optional(),
});

export type StoryBackgroundsSettings = z.infer<typeof StoryBackgroundsSettingsSchema>;

// ============================================================================
// CHAT SETTINGS
// ============================================================================

export const ChatSettingsSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  avatarDisplayMode: AvatarDisplayModeEnum.default('ALWAYS'),
  avatarDisplayStyle: z.string().default('CIRCULAR'),
  tagStyles: TagStyleMapSchema,
  /** Cheap LLM settings for memory extraction and summarization */
  cheapLLMSettings: CheapLLMSettingsSchema.default({
    strategy: 'PROVIDER_CHEAPEST',
    fallbackToLocal: true,
    embeddingProvider: 'OPENAI',
  }),
  /** Profile ID to use for image description fallback (when provider doesn't support images) */
  imageDescriptionProfileId: UUIDSchema.nullable().optional(),
  /**
   * Profile ID to use as a candid fallback when `imageDescriptionProfileId`
   * refuses or returns an unusable response. Typically an uncensored
   * vision-capable model that can describe images the primary refuses to.
   */
  uncensoredImageDescriptionProfileId: UUIDSchema.nullable().optional(),
  /** Default roleplay template ID for all new chats */
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),
  /** Theme preference settings */
  themePreference: ThemePreferenceSchema.default({
    activeThemeId: null,
    colorMode: 'system',
    showNavThemeSelector: false,
  }),
  /** Sidebar width in pixels (256-512, default: 256) */
  sidebarWidth: z.number().min(256).max(512).default(256).optional(),
  /** Default timestamp configuration for new chats */
  defaultTimestampConfig: TimestampConfigSchema.default({
    mode: 'NONE',
    format: 'FRIENDLY',
    useFictionalTime: false,
    autoPrepend: true,
    intervalMinutes: 15,
  }),
  /** Memory cascade preferences for message deletion/regeneration */
  memoryCascadePreferences: MemoryCascadePreferencesSchema.default({
    onMessageDelete: 'ASK_EVERY_TIME',
    onSwipeRegenerate: 'DELETE_MEMORIES',
  }),
  /** Commonplace Book auto-housekeeping settings (off by default; user opts in from the Commonplace Book tab) */
  autoHousekeepingSettings: AutoHousekeepingSettingsSchema.default({
    enabled: false,
    perCharacterCap: 2000,
    perCharacterCapOverrides: {},
    autoMergeSimilarThreshold: 0.90,
    mergeSimilar: false,
  }),
  /** Per-hour extraction rate limit for the Commonplace Book (off by default) */
  memoryExtractionLimits: MemoryExtractionLimitsSchema.default({
    enabled: false,
    maxPerHour: 20,
    softStartFraction: 0.7,
    softFloor: 0.7,
  }),
  /** 4.6 Private Character Rooms — user-level defaults for autonomous rooms */
  autonomousRoomSettings: AutonomousRoomSettingsSchema.default({
    dailyTokenBudget: null,
    defaultFreshnessWindowMs: 12 * 60 * 60 * 1000,
    visibilityDefault: 'owner_only',
    destructiveToolPolicy: 'opt_in_per_room',
  }),
  /** Token display settings for showing usage and costs */
  tokenDisplaySettings: TokenDisplaySettingsSchema.default({
    showPerMessageTokens: false,
    showPerMessageCost: false,
    showChatTotals: false,
    showSystemEvents: false,
  }),
  /** Context compression settings for long conversations */
  contextCompressionSettings: ContextCompressionSettingsSchema.default({
    enabled: true,
    windowSize: 5,
    compressionTargetTokens: 800,
    systemPromptTargetTokens: 1500,
    projectContextReinjectInterval: 5,
  }),
  /** LLM logging settings for tracking API calls */
  llmLoggingSettings: LLMLoggingSettingsSchema.default({
    enabled: true,
    verboseMode: false,
    retentionDays: 30,
  }),
  /** Auto-detect RNG patterns (dice rolls, coin flips) in user messages and execute them automatically (default: true) */
  autoDetectRng: z.boolean().default(true),
  /** Offer Pascal's custom pseudo-tools (`run_custom`) to models and show the composer gutter button (default: true) */
  customTools: z.boolean().default(true),
  /** Whether new chats start in composition mode (Enter = newline, Ctrl/Cmd+Enter = submit) by default */
  compositionModeDefault: z.boolean().default(false),
  /** Whether browser spellcheck is enabled in the Salon composer and Document Mode rich editor (default: true) */
  composerSpellcheck: z.boolean().default(true),
  /** Whether the `:` emoji typeahead fires in the Salon composer and Document Mode editor (default: true). The formatting toolbar's emoji picker is NOT gated by this — an explicit button press is never a surprise. */
  composerEmoji: z.boolean().default(true),
  /** Whether the `\` Unicode typeahead fires in the Salon composer and Document Mode editor (default: true). The formatting toolbar's symbol picker is NOT gated by this — an explicit button press is never a surprise. */
  composerUnicode: z.boolean().default(true),
  /** Master switch for user-defined word-boundary text replacements in the Salon composer and Document Mode rich editor (default: true). Rule list lives in the text_replacement_rules table. */
  textReplacementsEnabled: z.boolean().default(true),
  /** Whether the Salon scrolls to the newest message when an assistant reply finishes streaming or a new message arrives. Only scrolls when the reader is already near the bottom. Default off so long replies don't yank the reader away from where they're reading. */
  autoScrollOnResponseComplete: z.boolean().default(false),
  /** Agent mode settings for iterative tool use with self-correction */
  agentModeSettings: AgentModeSettingsSchema.default({
    maxTurns: 10,
    defaultEnabled: false,
  }),
  /** Aurora's Core whisper — global defaults for re-offering each character's own `Core/` vault folder before their next turn. */
  coreWhisper: CoreWhisperSettingsSchema.default({
    enabled: true,
    interval: 12,
    silenceThreshold: 3,
    packetTokenBudget: 4096,
    fireOnContextTransition: true,
  }),
  /** Thinking / reasoning display — global defaults for showing thinking models' chain-of-thought in the Salon. */
  thinkingDisplay: ThinkingDisplaySettingsSchema.default({
    defaultVisible: true,
    defaultCollapsed: true,
  }),
  /** Answer confirmation — global default for the Salon consistency check (off by default) */
  answerConfirmationSettings: AnswerConfirmationSettingsSchema.default({
    enabled: false,
  }),
  /** Smart typography — render-time curly quotes, plus type-time dashes and ellipsis. */
  smartTypographySettings: SmartTypographySettingsSchema.default({
    displayQuotes: false,
    dashes: true,
    ellipsis: true,
  }),
  /** Story backgrounds settings for AI-generated chat backgrounds */
  storyBackgroundsSettings: StoryBackgroundsSettingsSchema.default({
    enabled: false,
    defaultImageProfileId: null,
  }),
  /** Dangerous content detection and routing settings */
  dangerousContentSettings: DangerousContentSettingsSchema.default({
    mode: 'OFF',
    threshold: 0.7,
    scanTextChat: true,
    scanImagePrompts: true,
    scanImageGeneration: false,
    displayMode: 'SHOW',
    showWarningBadges: true,
  }),
  /** Auto-lock settings for automatic idle timeout locking */
  autoLockSettings: AutoLockSettingsSchema.default({
    enabled: false,
    idleMinutes: 15,
  }),
  /** Default IANA timezone for timestamp formatting (e.g., "America/New_York"). Falls back to QUILLTAP_TIMEZONE env var or system default. */
  timezone: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

// ============================================================================
// GENERAL SETTINGS (COMPOUND)
// ============================================================================

export const GeneralSettingsSchema = z.object({
  version: z.number().default(1),
  user: UserSchema,
  chatSettings: ChatSettingsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
