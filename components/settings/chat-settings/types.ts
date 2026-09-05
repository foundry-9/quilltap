/**
 * Chat Settings Types and Interfaces
 * Defines all TypeScript types and interfaces used in the chat settings module
 */

import type { LLMLoggingSettings as LLMLoggingSettingsType, DangerousContentSettings as DangerousContentSettingsType } from '@/lib/schemas/settings.types'

export type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
export type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'
export type TimestampMode = 'NONE' | 'START_ONLY' | 'EVERY_MESSAGE' | 'EVERY_N_MINUTES'
export type TimestampFormat = 'ISO8601' | 'FRIENDLY' | 'DATE_ONLY' | 'TIME_ONLY' | 'CUSTOM'
export type MemoryCascadeAction = 'DELETE_MEMORIES' | 'KEEP_MEMORIES' | 'REGENERATE_MEMORIES' | 'ASK_EVERY_TIME'

/**
 * Token Display Settings
 * Controls visibility of token and cost information in the UI
 */
export interface TokenDisplaySettings {
  showPerMessageTokens: boolean
  showPerMessageCost: boolean
  showChatTotals: boolean
  showSystemEvents: boolean
}

export interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  /**
   * Whether a cheap route with no connection profile behind it may have a
   * stand-in drafted from the user's `isCheap` profiles when it fails. Routes
   * that do have a profile take their chain from that profile instead.
   */
  allowCheapFallback?: boolean
  embeddingProvider: EmbeddingProvider
  /** Optional override for image prompt expansion LLM - when set, uses this instead of global cheap LLM */
  imagePromptProfileId?: string | null
}

export interface TimestampConfig {
  mode: TimestampMode
  format: TimestampFormat
  customFormat?: string | null
  useFictionalTime: boolean
  fictionalBaseTimestamp?: string | null
  fictionalBaseRealTime?: string | null
  autoPrepend: boolean
  timezone?: string | null
  /** Minimum minutes between Host timestamp announcements when mode is EVERY_N_MINUTES (default 15) */
  intervalMinutes: number
}

export interface MemoryCascadePreferences {
  onMessageDelete: MemoryCascadeAction
  onSwipeRegenerate: MemoryCascadeAction
}

/**
 * Story Backgrounds Settings
 * Controls AI-generated background images for chats
 */
export interface StoryBackgroundsSettings {
  enabled: boolean
  defaultImageProfileId?: string | null
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  uncensoredImageDescriptionProfileId?: string | null
  defaultTimestampConfig?: TimestampConfig
  memoryCascadePreferences?: MemoryCascadePreferences
  tokenDisplaySettings?: TokenDisplaySettings
  contextCompressionSettings?: ContextCompressionSettings
  llmLoggingSettings?: LLMLoggingSettings
  /** Auto-detect RNG patterns (dice rolls, coin flips) in user messages and execute them automatically */
  autoDetectRng?: boolean
  /** Whether Pascal's custom pseudo-tools are offered to models and the composer gutter button is shown */
  customTools?: boolean
  /** Whether new chats start in composition mode by default */
  compositionModeDefault?: boolean
  /** Whether browser spellcheck is enabled in the composer and rich-text Document Mode editor */
  composerSpellcheck?: boolean
  /** Whether the `:` emoji typeahead fires in the composer and Document Mode editor (the toolbar picker is not gated by this) */
  composerEmoji?: boolean
  /** Whether the `\` Unicode typeahead fires in the composer and Document Mode editor (the toolbar picker is not gated by this) */
  composerUnicode?: boolean
  /** Master switch for user-defined word-boundary text replacements in the composer and Document Mode editor */
  textReplacementsEnabled?: boolean
  /** Whether the Salon auto-scrolls to the newest message when a response completes (only when already near the bottom) */
  autoScrollOnResponseComplete?: boolean
  /** Agent mode settings for iterative tool use with self-correction */
  agentModeSettings?: AgentModeSettings
  /** Story backgrounds settings for AI-generated chat backgrounds */
  storyBackgroundsSettings?: StoryBackgroundsSettings
  /** Dangerous content handling settings */
  dangerousContentSettings?: DangerousContentSettings
  /** Default IANA timezone for timestamp formatting */
  timezone?: string | null
  /** 4.6 Private Character Rooms — user-level defaults */
  autonomousRoomSettings?: AutonomousRoomSettings
  /** Aurora's Core whisper — global defaults */
  coreWhisper?: CoreWhisperSettings
  /** Thinking / reasoning display — global defaults. DISPLAY ONLY. */
  thinkingDisplay?: ThinkingDisplaySettings
  /** Answer confirmation — global default for the Salon consistency check. */
  answerConfirmationSettings?: AnswerConfirmationSettings
  /** Smart typography — render-time curly quotes plus type-time dashes/ellipsis. */
  smartTypographySettings?: SmartTypographySettings
  createdAt: string
  updatedAt: string
}

/**
 * Thinking / reasoning display — global defaults for showing reasoning models'
 * chain-of-thought in the Salon. Per-chat override (`showThinking`, tri-state)
 * lives on the chat row. DISPLAY ONLY.
 */
export interface ThinkingDisplaySettings {
  /** Whether new chats show captured thinking by default. */
  defaultVisible?: boolean
  /** Whether the thinking block starts collapsed when shown. */
  defaultCollapsed?: boolean
}

export const DEFAULT_THINKING_DISPLAY_SETTINGS: ThinkingDisplaySettings = {
  defaultVisible: true,
  defaultCollapsed: true,
}

/**
 * Answer confirmation — global default for the Salon consistency check that
 * vets a character's tool-using reply against what it recalled and looked up.
 * Off by default; a per-project or per-chat override can flip it on.
 */
export interface AnswerConfirmationSettings {
  /** Whether the consistency check runs by default (global). */
  enabled?: boolean
}

export const DEFAULT_ANSWER_CONFIRMATION_SETTINGS: AnswerConfirmationSettings = {
  enabled: false,
}

/**
 * Smart typography — two mechanisms split by confidence.
 *
 * `displayQuotes` curls quotes at *render* time only: the stored message keeps
 * its straight quotes, so the model, the embeddings and every export are
 * unaffected and turning the toggle off restores the old appearance everywhere.
 *
 * `dashes` and `ellipsis` write real characters into the text as it is typed,
 * because a writer typing `--` means a dash. Both are undone by one Backspace.
 */
export interface SmartTypographySettings {
  /** Curl quotes when displaying messages. Stored text is never modified. */
  displayQuotes?: boolean
  /** `--` → en dash and `---` → em dash, as you type. */
  dashes?: boolean
  /** `...` → ellipsis, as you type. */
  ellipsis?: boolean
}

export const DEFAULT_SMART_TYPOGRAPHY_SETTINGS: SmartTypographySettings = {
  displayQuotes: false,
  dashes: true,
  ellipsis: true,
}

/**
 * Aurora's Core whisper — global defaults. Per-chat and per-character overrides
 * live on chat / character rows. Precedence: chat → character → global.
 */
export interface CoreWhisperSettings {
  enabled?: boolean
  interval?: number
  silenceThreshold?: number
  packetTokenBudget?: number
  fireOnContextTransition?: boolean
}

export const DEFAULT_CORE_WHISPER_SETTINGS: CoreWhisperSettings = {
  enabled: true,
  interval: 12,
  silenceThreshold: 3,
  packetTokenBudget: 4096,
  fireOnContextTransition: true,
}

/**
 * 4.6 Private Character Rooms — user-level defaults applied across the
 * householder's autonomous rooms. Per-room overrides live on the chat row.
 */
export interface AutonomousRoomSettings {
  /** Daily cumulative-token cap for all autonomous-room turns (instance-local-midnight rollover). null = no cap. */
  dailyTokenBudget?: number | null
  /** Default catch-up freshness window for scheduled runs (ms). */
  defaultFreshnessWindowMs?: number
  /** Default visibility for new autonomous rooms in the Salon chat list. */
  visibilityDefault?: 'owner_only' | 'household' | 'open'
  /** User-level ceiling for destructive-tool exposure in autonomous rooms. */
  destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
}

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
  isDangerousCompatible?: boolean
  supportsImageUpload?: boolean
  apiKeyId?: string
  apiKey?: ApiKey | null
}

export interface EmbeddingProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  apiKeyId?: string
  apiKey?: ApiKey | null
}

export interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isDangerousCompatible?: boolean
  apiKeyId?: string
  apiKey?: ApiKey | null
}

/**
 * Avatar Display Mode Options
 * Defines the available avatar display modes with labels and descriptions
 */
export const AVATAR_MODES = [
  {
    value: 'ALWAYS' as const,
    label: 'Always Show Avatars',
    description: 'Display avatar for every message (character on left, user on right)',
  },
  {
    value: 'GROUP_ONLY' as const,
    label: 'Group Chats Only',
    description: 'Only show avatars in group chats (will be implemented in the future)',
  },
  {
    value: 'NEVER' as const,
    label: 'Never Show Avatars',
    description: 'Hide avatars in all chats',
  },
] as const

/**
 * Avatar Display Style Options
 * Defines the available avatar display styles with labels, descriptions, and visual previews
 */
export const AVATAR_STYLES = [
  {
    value: 'CIRCULAR' as const,
    label: 'Circular',
    description: 'Display avatars as circles',
    preview: '⭕',
  },
  {
    value: 'RECTANGULAR' as const,
    label: 'Rectangular (5:4)',
    description: 'Display avatars as rectangles with 5:4 aspect ratio',
    preview: '▭',
  },
] as const

/**
 * Timestamp Injection Mode Options
 * Defines when timestamps should be injected into system prompts
 */
export const TIMESTAMP_MODES = [
  {
    value: 'NONE' as const,
    label: 'Disabled',
    description: 'No timestamp injection',
  },
  {
    value: 'START_ONLY' as const,
    label: 'Conversation Start',
    description: 'Include timestamp only in the initial system prompt',
  },
  {
    value: 'EVERY_MESSAGE' as const,
    label: 'Every Message',
    description: 'Update timestamp with each message sent',
  },
  {
    value: 'EVERY_N_MINUTES' as const,
    label: 'Every X Minutes',
    description: 'Have the Host announce the time only when at least this many minutes have passed since the last announcement',
  },
] as const

/**
 * Timestamp Format Options
 * Defines how timestamps should be formatted
 */
export const TIMESTAMP_FORMATS = [
  {
    value: 'FRIENDLY' as const,
    label: 'Friendly',
    description: 'Human-readable format (e.g., "March 15, 2024 at 2:30 PM")',
    example: 'March 15, 2024 at 2:30 PM',
  },
  {
    value: 'ISO8601' as const,
    label: 'ISO 8601',
    description: 'Standard machine-readable format',
    example: '2024-03-15T14:30:00Z',
  },
  {
    value: 'DATE_ONLY' as const,
    label: 'Date Only',
    description: 'Just the date, no time',
    example: 'March 15, 2024',
  },
  {
    value: 'TIME_ONLY' as const,
    label: 'Time Only',
    description: 'Just the time, no date',
    example: '2:30 PM',
  },
  {
    value: 'CUSTOM' as const,
    label: 'Custom',
    description: 'Use a custom format string (date-fns tokens)',
    example: '',
  },
] as const

/**
 * Default timestamp configuration. Defined with the timestamp helpers that
 * consume it and re-exported here so the settings form keeps its usual import.
 */
export { DEFAULT_TIMESTAMP_CONFIG } from '@/lib/chat/timestamp-utils'

/**
 * Memory Cascade Action Options
 * Defines what to do with memories when messages are deleted or regenerated
 */
export const MEMORY_CASCADE_ACTIONS = [
  {
    value: 'ASK_EVERY_TIME' as const,
    label: 'Ask every time',
    description: 'Show a confirmation dialog to choose what to do',
  },
  {
    value: 'DELETE_MEMORIES' as const,
    label: 'Always delete memories',
    description: 'Automatically delete associated memories',
  },
  {
    value: 'KEEP_MEMORIES' as const,
    label: 'Always keep memories',
    description: 'Keep memories (they will become orphaned)',
  },
  {
    value: 'REGENERATE_MEMORIES' as const,
    label: 'Delete and regenerate',
    description: 'Delete old memories and extract new ones from context',
  },
] as const

/**
 * Default memory cascade preferences
 */
export const DEFAULT_MEMORY_CASCADE_PREFERENCES: MemoryCascadePreferences = {
  onMessageDelete: 'ASK_EVERY_TIME',
  onSwipeRegenerate: 'DELETE_MEMORIES',
}

/**
 * Default token display settings
 */
export const DEFAULT_TOKEN_DISPLAY_SETTINGS: TokenDisplaySettings = {
  showPerMessageTokens: false,
  showPerMessageCost: false,
  showChatTotals: false,
  showSystemEvents: false,
}

/**
 * Context Compression Settings
 * Controls how older messages are compressed to reduce token costs
 */
export interface ContextCompressionSettings {
  enabled: boolean
  windowSize: number
  compressionTargetTokens: number
  systemPromptTargetTokens: number
  /** How often to re-inject project context (0 = never after initial, must be >= windowSize) */
  projectContextReinjectInterval: number
}

/**
 * Default context compression settings
 */
export const DEFAULT_CONTEXT_COMPRESSION_SETTINGS: ContextCompressionSettings = {
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 800,
  systemPromptTargetTokens: 1500,
  projectContextReinjectInterval: 5,
}

/**
 * Token Display Options
 * Defines the available token display toggles
 */
export const TOKEN_DISPLAY_OPTIONS = [
  {
    key: 'showPerMessageTokens' as const,
    label: 'Show Token Count on Messages',
    description: 'Display the number of prompt and completion tokens for each message',
  },
  {
    key: 'showPerMessageCost' as const,
    label: 'Show Cost Estimate on Messages',
    description: 'Display estimated cost for each message (requires pricing data)',
  },
  {
    key: 'showChatTotals' as const,
    label: 'Show Chat Token Totals',
    description: 'Display aggregate token counts and cost at the top of the chat',
  },
  {
    key: 'showSystemEvents' as const,
    label: 'Show System Events in Chat',
    description: 'Display background LLM operations (memory extraction, summarization, etc.) in the chat timeline',
  },
] as const

/**
 * LLM Logging Settings
 * Re-exported from schema types for use in chat settings components
 */
export type LLMLoggingSettings = LLMLoggingSettingsType

/**
 * Default LLM logging settings
 */
export const DEFAULT_LLM_LOGGING_SETTINGS: LLMLoggingSettings = {
  enabled: true,
  verboseMode: false,
  retentionDays: 30,
}

/**
 * Automation Settings Options
 * Defines the available automation toggles
 */
export const AUTOMATION_OPTIONS = [
  {
    key: 'autoDetectRng' as const,
    label: 'Auto-Detect RNG Calls',
    description: 'Automatically detect dice rolls (e.g., 2d6), coin flips, and "spin the bottle" in your messages and execute them',
  },
] as const

/**
 * Default automation settings
 */
export const DEFAULT_AUTO_DETECT_RNG = true

/**
 * Default custom-tools setting
 */
export const DEFAULT_CUSTOM_TOOLS = true

/**
 * Agent Mode Settings
 * Controls iterative tool use with self-correction
 */
export interface AgentModeSettings {
  /** Maximum number of agent turns (1-25) */
  maxTurns: number
  /** Whether agent mode is enabled by default for new chats */
  defaultEnabled: boolean
}

/**
 * Default agent mode settings
 */
export const DEFAULT_AGENT_MODE_SETTINGS: AgentModeSettings = {
  maxTurns: 10,
  defaultEnabled: false,
}

/**
 * Default story backgrounds settings
 */
export const DEFAULT_STORY_BACKGROUNDS_SETTINGS: StoryBackgroundsSettings = {
  enabled: false,
  defaultImageProfileId: null,
}

/**
 * Dangerous Content Settings
 * Re-exported from schema types for use in chat settings components
 */
export type DangerousContentSettings = DangerousContentSettingsType

/**
 * Default dangerous content settings
 */
export const DEFAULT_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}
