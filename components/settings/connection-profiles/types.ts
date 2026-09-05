/**
 * Type definitions for connection profiles
 */

import type { ProviderOptionsSchema, ThinkingTurnRule } from '@quilltap/plugin-types'

export type { ProviderOptionsSchema, ThinkingTurnRule }

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface Tag {
  id: string
  name: string
  createdAt?: string
}

/**
 * A tag as the connection-profiles **collection** endpoint sends it:
 * `enrichWithTags`'s `{ tagId, tag }` envelope, not a flat `Tag`.
 *
 * Declared rather than assumed because this field was typed `Tag[]` while the
 * wire carried envelopes, and `fetchJson<any>` meant nothing checked — so
 * `ProfileCard` read `tag.name` off the envelope and rendered every tag as an
 * empty pill (Bug 74, third layer). The item route's `?action=get-tags` answers
 * flat `Tag`s; these two shapes are not interchangeable.
 */
export interface EnrichedTag {
  tagId: string
  tag: Tag
}

export interface ProviderConfig {
  name: string
  displayName: string
  configRequirements: {
    requiresApiKey: boolean
    /**
     * Whether a key *may* be attached, as against `requiresApiKey`'s "must it
     * be?". Absent means the same answer as `requiresApiKey`; read it through
     * `providerAcceptsApiKey` rather than by hand (Bug 81).
     */
    acceptsApiKey?: boolean
    requiresBaseUrl: boolean
    baseUrlLabel?: string
    baseUrlDefault?: string
  }
  capabilities: {
    chat: boolean
    imageGeneration: boolean
    embeddings: boolean
    webSearch: boolean
    toolUse?: boolean
  }
  /**
   * Provider-specific connection-profile options schema emitted by the
   * plugin's `getProviderOptionsSchema()` hook. `null` (or missing) means
   * the plugin declares no extra fields and the host should render no
   * provider-options panel.
   */
  optionsSchema?: ProviderOptionsSchema | null
  /**
   * The provider plugin's `thinkingTurnRule`: which `parameters` key switches
   * reasoning on or off, and which values mean which. Feeds
   * `evaluateThinkingTurn` so the editor can seed the multi-character prefill
   * box the way the server would (bug 85). Null when the plugin declares none.
   */
  thinkingTurnRule?: ThinkingTurnRule | null
}

export interface ConnectionProfile {
  id: string
  name: string
  /** Transport — 'api' (default) or 'courier' for manual / clipboard. */
  transport?: 'api' | 'courier'
  /** The Courier — delta-mode flag (default true). */
  courierDeltaMode?: boolean
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isCheap?: boolean
  isDangerousCompatible?: boolean
  allowWebSearch?: boolean
  useNativeWebSearch?: boolean
  allowToolUse?: boolean
  /** Tool-call framing: native, simple-json, text-block, or auto. */
  pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block'
  /**
   * Multi-character turn anchor: true prefills an assistant `[Name]` message,
   * false appends a prose instruction instead. Null/absent means never chosen
   * — resolve through `defaultMultiCharacterPrefill(provider)`.
   */
  multiCharacterPrefill?: boolean | null
  supportsImageUpload?: boolean
  modelClass?: string | null
  /** The understudy: another profile to try when this one's provider fails. */
  fallbackProfileId?: string | null
  /** Whether a same-or-better-tier stand-in may be drafted automatically. */
  allowTierFallback?: boolean
  maxContext?: number | null
  sortIndex?: number
  apiKey?: ApiKey | null
  tags?: EnrichedTag[]
  messageCount?: number
  totalTokens?: number
  totalPromptTokens?: number
  totalCompletionTokens?: number
}

export interface ProfileFormData {
  name: string
  /**
   * Transport. 'api' = standard plugin-dispatched API call. 'courier' = manual
   * clipboard transport: the assembled request is rendered as Markdown for the
   * user to carry by hand to an external LLM and paste back. When 'courier',
   * provider/apiKeyId/baseUrl are ignored, all tool/web-search flags are
   * forced off server-side, and `modelName` is free-form informational text.
   */
  transport: 'api' | 'courier'
  /**
   * The Courier — delta mode. When true (default), after a character's first
   * successful Courier turn in a chat, subsequent placeholders render only
   * the delta since the last paste instead of the full context. The Salon
   * bubble keeps a full-context fallback alongside the delta. Ignored when
   * `transport === 'api'`.
   */
  courierDeltaMode: boolean
  provider: string
  apiKeyId: string
  baseUrl: string
  modelName: string
  temperature: number
  maxTokens: number
  topP: number
  isDefault: boolean
  isCheap: boolean
  isDangerousCompatible: boolean
  allowToolUse: boolean
  pseudoToolMode: 'auto' | 'native' | 'simple-json' | 'text-block'
  /**
   * Multi-character turn anchor. True sends the assistant `[Name]` prefill;
   * false anchors the turn with a prose instruction in the system prompt
   * instead. Seeded from the provider default when a profile has never
   * recorded a choice.
   */
  multiCharacterPrefill: boolean
  supportsImageUpload: boolean
  allowWebSearch: boolean
  useNativeWebSearch: boolean
  modelClass: string
  /**
   * The understudy: the id of another profile to try when a call through this
   * one fails outright. Empty string means none named.
   */
  fallbackProfileId: string
  /**
   * Whether, once this profile and its understudy have both failed, Quilltap
   * may draft one further stand-in of the same or better model class.
   */
  allowTierFallback: boolean
  maxContext: string
  /**
   * Provider-specific options written by the schema-driven options panel.
   * Keys come from the active provider plugin's `getProviderOptionsSchema()`
   * and flow straight into the saved profile's `parameters` JSON blob.
   */
  parameters: Record<string, unknown>
}

export const initialFormState: ProfileFormData = {
  name: '',
  transport: 'api',
  courierDeltaMode: true,
  provider: 'OPENAI',
  apiKeyId: '',
  baseUrl: '',
  modelName: 'gpt-3.5-turbo',
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  isDefault: false,
  isCheap: false,
  isDangerousCompatible: false,
  allowToolUse: true,
  pseudoToolMode: 'auto',
  multiCharacterPrefill: true,
  supportsImageUpload: false,
  allowWebSearch: false,
  useNativeWebSearch: false,
  modelClass: '',
  fallbackProfileId: '',
  allowTierFallback: false,
  maxContext: '',
  parameters: {},
}
