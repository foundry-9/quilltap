/**
 * Cheap LLM Provider Selection
 * Sprint 2: Memory System - Cheap LLM Support
 *
 * This module provides intelligent selection of cost-effective LLM providers
 * for background tasks like memory extraction, summarization, and chat titling.
 * These tasks don't require the full power of expensive models.
 *
 * Now enhanced with real pricing data from provider APIs (Sprint 2.1).
 *
 * NOTE: Registered plugins provide cheapModels configuration via the provider
 * registry. The legacy fallback constants are imported from fallback-data.ts
 * and used only when no plugin is registered for a provider.
 *
 * @see lib/llm/fallback-data.ts for legacy fallback constants
 */

import { ConnectionProfile, Provider } from '@/lib/schemas/types'
import type { CheapLLMSettings, DangerousContentSettings } from '@/lib/schemas/settings.types'
import { logger } from '@/lib/logger'
import {
  getAverageCostPer1M,
} from './pricing'
import { getCheapModelConfig } from '@/lib/plugins/provider-registry'
import {
  LEGACY_CHEAPEST_MODEL_MAP,
  LEGACY_RECOMMENDED_CHEAP_MODELS,
} from './fallback-data'

/**
 * Strategy for selecting the cheap LLM provider
 */
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'

/**
 * Configuration for cheap LLM provider selection
 */
export interface CheapLLMConfig {
  /** Strategy for selecting the cheap LLM */
  strategy: CheapLLMStrategy
  /** If USER_DEFINED, the connection profile ID to use */
  userDefinedProfileId?: string
  /** Global default cheap profile ID - takes priority over strategy */
  defaultCheapProfileId?: string
  /** Whether to fall back to local models (Ollama) if available */
  fallbackToLocal: boolean
}

/**
 * Result of cheap LLM provider selection
 */
export interface CheapLLMSelection {
  /** The provider to use */
  provider: Provider
  /** The model name to use */
  modelName: string
  /** Base URL if required (e.g., for Ollama) */
  baseUrl?: string
  /** The connection profile ID to use for API key retrieval */
  connectionProfileId?: string
  /** Whether this is a local model (no API costs) */
  isLocal: boolean
  /**
   * The chosen profile's provider parameters (e.g. DeepSeek `thinking` /
   * `reasoning_effort`). Forwarded to the provider so per-model settings like
   * "reasoning off" actually take effect for cheap-LLM tasks. The task pipeline
   * still controls temperature / max-tokens at the top level; providers only
   * apply the allowlisted extras from this object.
   */
  profileParameters?: Record<string, unknown>
}

/**
 * Extract a connection profile's provider parameters (e.g. DeepSeek `thinking`
 * / `reasoning_effort`) as a plain record for forwarding as
 * `LLMParams.profileParameters`. Shared by every path that builds a provider
 * call from a profile — the cheap-LLM selection sites here and the direct
 * utility calls (auto-configure, wizards, optimizer, greeting, …) — so a
 * profile's "reasoning off" setting takes effect uniformly.
 *
 * For Ollama profiles this also injects `num_ctx` from the profile's
 * Max Context. Ollama allocates its own default context window (typically far
 * below the model's capability) unless the request carries `options.num_ctx`,
 * so without this the budgeter sizes prompts against Max Context while the
 * server silently truncates at its default. An explicit `num_ctx` already in
 * the parameters blob wins over the injected value.
 */
export function profileParams(
  profile: Pick<ConnectionProfile, 'provider' | 'parameters'> & { maxContext?: number | null }
): Record<string, unknown> | undefined {
  const params = profile.parameters
  const base = params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined
  if (
    profile.provider === 'OLLAMA' &&
    typeof profile.maxContext === 'number' &&
    profile.maxContext > 0 &&
    base?.num_ctx == null
  ) {
    return { ...(base ?? {}), num_ctx: profile.maxContext }
  }
  return base
}

/** Where a local Ollama server listens when a profile leaves its base URL blank. */
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'

/**
 * Build a {@link CheapLLMSelection} straight from a connection profile,
 * deriving `isLocal` from the provider and forwarding the profile's provider
 * parameters. This is the one place the selection shape is assembled — every
 * selection path (the ladder in {@link getCheapLLMProvider}, the uncensored
 * reroute, and the direct utility calls that pick a profile as-is) goes
 * through here.
 *
 * `localBaseUrlFallback` substitutes the default Ollama address when a local
 * profile has no base URL of its own; non-local profiles always keep their own
 * base URL (or none).
 */
export function selectionFromProfile(
  profile: ConnectionProfile,
  options: { localBaseUrlFallback?: boolean } = {},
): CheapLLMSelection {
  const isLocal = profile.provider === 'OLLAMA'
  const baseUrl = profile.baseUrl
    || (isLocal && options.localBaseUrlFallback ? OLLAMA_DEFAULT_BASE_URL : undefined)
  return {
    provider: profile.provider,
    modelName: profile.modelName,
    baseUrl,
    connectionProfileId: profile.id,
    isLocal,
    profileParameters: profileParams(profile),
  }
}

/**
 * Build a {@link CheapLLMConfig} from a chatSettings row (or fall back to the
 * defaults when the row or its `cheapLLMSettings` is absent). Shared so callers
 * don't repeat the same merge.
 */
export function buildCheapLLMConfig(
  chatSettings: { cheapLLMSettings?: CheapLLMSettings | null } | null | undefined,
): CheapLLMConfig {
  const settings = chatSettings?.cheapLLMSettings
  if (!settings) return DEFAULT_CHEAP_LLM_CONFIG
  return {
    ...DEFAULT_CHEAP_LLM_CONFIG,
    strategy: settings.strategy,
    fallbackToLocal: settings.fallbackToLocal,
    userDefinedProfileId: settings.userDefinedProfileId ?? undefined,
    defaultCheapProfileId: settings.defaultCheapProfileId ?? undefined,
  }
}

/**
 * Mapping of providers to their cheapest models (legacy fallback)
 * @see getCheapModelConfig() from provider-registry for plugin-based resolution
 */

/**
 * Models that are known to work well for cheap LLM tasks
 * Re-exported from fallback-data.ts for backward compatibility
 *
 * @deprecated Use getCheapModelConfig() from provider-registry instead
 */
export const RECOMMENDED_CHEAP_MODELS = LEGACY_RECOMMENDED_CHEAP_MODELS

/**
 * Default cheap LLM configuration
 */
export const DEFAULT_CHEAP_LLM_CONFIG: CheapLLMConfig = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
}

/**
 * Gets the cheapest model for a given provider
 * First checks the plugin registry, falls back to hardcoded map.
 */
export function getCheapestModel(provider: Provider): string {
  // First try the plugin registry
  const registryConfig = getCheapModelConfig(provider)
  if (registryConfig?.defaultModel) {
    return registryConfig.defaultModel
  }

  // Fall back to hardcoded map
  return LEGACY_CHEAPEST_MODEL_MAP[provider]
}

/**
 * Selects the appropriate cheap LLM provider based on configuration
 *
 * Selection priority (per CHEAP-LLM.md spec):
 * 1. Global defaultCheapProfileId if set
 * 2. USER_DEFINED strategy with userDefinedProfileId
 * 3. Any profile with isCheap flag set to true
 * 4. LOCAL_FIRST or fallbackToLocal using Ollama
 * 5. Fall back to current profile's cheapest model variant
 *
 * @param currentProfile - The current connection profile being used for chat
 * @param config - Cheap LLM configuration
 * @param availableProfiles - All available connection profiles (for USER_DEFINED strategy)
 * @param ollamaAvailable - Whether Ollama is available locally
 * @param onNoCheapLLM - Callback when no cheap LLM is available (for toast notification)
 * @returns The selected cheap LLM configuration
 */
export function getCheapLLMProvider(
  currentProfile: ConnectionProfile,
  config: CheapLLMConfig = DEFAULT_CHEAP_LLM_CONFIG,
  availableProfiles: ConnectionProfile[] = [],
  ollamaAvailable: boolean = false,
  onNoCheapLLM?: () => void
): CheapLLMSelection {

  // Priority 1: Global default cheap profile (always takes precedence if set)
  if (config.defaultCheapProfileId) {
    const defaultCheapProfile = availableProfiles.find(p => p.id === config.defaultCheapProfileId)
    if (defaultCheapProfile) {
      return selectionFromProfile(defaultCheapProfile)
    }
    // Global default not found, fall through to other strategies
  }

  // Priority 2: User-defined connection profile (USER_DEFINED strategy)
  if (config.strategy === 'USER_DEFINED' && config.userDefinedProfileId) {
    const userProfile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (userProfile) {
      return selectionFromProfile(userProfile)
    }
    // Fall through to next strategy if profile not found
    logger.warn('[CheapLLM] USER_DEFINED profile not found, falling through', {
      context: 'getCheapLLMProvider',
      userDefinedProfileId: config.userDefinedProfileId,
    })
  }

  // Priority 3: Use any profile marked as "cheap" (isCheap flag)
  const cheapProfiles = availableProfiles.filter(p => p.isCheap === true)
  if (cheapProfiles.length > 0) {
    // Prefer local (Ollama) cheap profiles for zero cost
    const localCheapProfile = cheapProfiles.find(p => p.provider === 'OLLAMA')
    if (localCheapProfile) {
      return selectionFromProfile(localCheapProfile, { localBaseUrlFallback: true })
    }
    // Use the first available cheap profile
    return selectionFromProfile(cheapProfiles[0])
  }

  // Priority 4: Local first (prefer Ollama if available)
  if (config.strategy === 'LOCAL_FIRST' || (config.fallbackToLocal && ollamaAvailable)) {
    // Look for an Ollama profile in available profiles
    const ollamaProfile = availableProfiles.find(p => p.provider === 'OLLAMA')
    if (ollamaProfile) {
      return selectionFromProfile(ollamaProfile, { localBaseUrlFallback: true })
    }

    // If LOCAL_FIRST was explicitly requested but no Ollama profile exists,
    // we should still fall through to the cheapest provider
  }

  // Priority 5: No dedicated cheap LLM available - warn and use current profile
  // Toast warning that no cheap LLM is configured
  if (onNoCheapLLM) {
    onNoCheapLLM()
  }

  // For Ollama, always use the current profile's model - all local models are "free"
  // and we can't assume what models the user has installed
  if (currentProfile.provider === 'OLLAMA') {
    return selectionFromProfile(currentProfile)
  }

  // Map current provider to its cheapest variant (fallback)
  const cheapModel = getCheapestModel(currentProfile.provider)

  logger.warn('[CheapLLM] Using FALLBACK to cheapest model for current provider', {
    context: 'getCheapLLMProvider',
    provider: currentProfile.provider,
    cheapModel,
    currentProfileModel: currentProfile.modelName,
  })

  // The current profile, but on its provider's cheapest model.
  return { ...selectionFromProfile(currentProfile), modelName: cheapModel }
}

/**
 * Resolves an uncensored-compatible cheap LLM selection for dangerous chats.
 * When a chat is flagged as dangerous, background tasks (memory extraction,
 * title generation, context summaries, etc.) should use an uncensored provider
 * to avoid content refusals.
 *
 * @param standardSelection - The standard cheap LLM selection
 * @param isDangerousChat - Whether the chat is flagged as dangerous
 * @param dangerSettings - The resolved dangerous content settings
 * @param availableProfiles - All available connection profiles for the user
 * @returns An uncensored CheapLLMSelection if applicable, otherwise the standard selection
 */
export function resolveUncensoredCheapLLMSelection(
  standardSelection: CheapLLMSelection,
  isDangerousChat: boolean,
  dangerSettings: DangerousContentSettings | undefined,
  availableProfiles: ConnectionProfile[]
): CheapLLMSelection {
  // Not a dangerous chat or no danger settings — use standard selection
  if (!isDangerousChat || !dangerSettings || dangerSettings.mode === 'OFF') {
    return standardSelection
  }

  // Try the configured uncensored text profile first
  if (dangerSettings.uncensoredTextProfileId) {
    const uncensoredProfile = availableProfiles.find(p => p.id === dangerSettings.uncensoredTextProfileId)
    if (uncensoredProfile) {
      return selectionFromProfile(uncensoredProfile, { localBaseUrlFallback: true })
    }
  }

  // Scan for any isDangerousCompatible profile
  const anyUncensored = availableProfiles.find(p => p.isDangerousCompatible === true)
  if (anyUncensored) {
    return selectionFromProfile(anyUncensored, { localBaseUrlFallback: true })
  }

  // Nothing found — fail open with standard selection
  return standardSelection
}

// ============================================================================
// PRICING-AWARE SELECTION (Sprint 2.1)
// ============================================================================

