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
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
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
 */
export function profileParams(profile: ConnectionProfile): Record<string, unknown> | undefined {
  const params = profile.parameters
  return params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined
}

/**
 * Build a {@link CheapLLMSelection} straight from a connection profile, using
 * the profile's own base URL (no local-fallback substitution) and deriving
 * `isLocal` from the provider. Shared by the selection paths that pick a profile
 * as-is — the global default, the USER_DEFINED profile, and a non-local
 * `isCheap` profile. Ollama-forced and uncensored paths substitute a localhost
 * base URL and are intentionally NOT routed through here.
 */
function selectionFromProfile(profile: ConnectionProfile): CheapLLMSelection {
  return {
    provider: profile.provider,
    modelName: profile.modelName,
    baseUrl: profile.baseUrl || undefined,
    connectionProfileId: profile.id,
    isLocal: profile.provider === 'OLLAMA',
    profileParameters: profileParams(profile),
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
      return {
        provider: 'OLLAMA',
        modelName: localCheapProfile.modelName,
        baseUrl: localCheapProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: localCheapProfile.id,
        isLocal: true,
        profileParameters: profileParams(localCheapProfile),
      }
    }
    // Use the first available cheap profile
    return selectionFromProfile(cheapProfiles[0])
  }

  // Priority 4: Local first (prefer Ollama if available)
  if (config.strategy === 'LOCAL_FIRST' || (config.fallbackToLocal && ollamaAvailable)) {
    // Look for an Ollama profile in available profiles
    const ollamaProfile = availableProfiles.find(p => p.provider === 'OLLAMA')
    if (ollamaProfile) {
      return {
        provider: 'OLLAMA',
        modelName: ollamaProfile.modelName,
        baseUrl: ollamaProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: ollamaProfile.id,
        isLocal: true,
        profileParameters: profileParams(ollamaProfile),
      }
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
    return {
      provider: currentProfile.provider,
      modelName: currentProfile.modelName,
      baseUrl: currentProfile.baseUrl || undefined,
      connectionProfileId: currentProfile.id,
      isLocal: true,
    }
  }

  // Map current provider to its cheapest variant (fallback)
  const cheapModel = getCheapestModel(currentProfile.provider)

  logger.warn('[CheapLLM] Using FALLBACK to cheapest model for current provider', {
    context: 'getCheapLLMProvider',
    provider: currentProfile.provider,
    cheapModel,
    currentProfileModel: currentProfile.modelName,
  })

  return {
    provider: currentProfile.provider,
    modelName: cheapModel,
    baseUrl: currentProfile.baseUrl || undefined,
    connectionProfileId: currentProfile.id,
    isLocal: false,
  }
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
      const isLocal = uncensoredProfile.provider === 'OLLAMA'
      return {
        provider: uncensoredProfile.provider,
        modelName: uncensoredProfile.modelName,
        baseUrl: isLocal ? (uncensoredProfile.baseUrl || 'http://localhost:11434') : (uncensoredProfile.baseUrl || undefined),
        connectionProfileId: uncensoredProfile.id,
        isLocal,
        profileParameters: profileParams(uncensoredProfile),
      }
    }
  }

  // Scan for any isDangerousCompatible profile
  const anyUncensored = availableProfiles.find(p => p.isDangerousCompatible === true)
  if (anyUncensored) {
    const isLocal = anyUncensored.provider === 'OLLAMA'
    return {
      provider: anyUncensored.provider,
      modelName: anyUncensored.modelName,
      baseUrl: isLocal ? (anyUncensored.baseUrl || 'http://localhost:11434') : (anyUncensored.baseUrl || undefined),
      connectionProfileId: anyUncensored.id,
      isLocal,
      profileParameters: profileParams(anyUncensored),
    }
  }

  // Nothing found — fail open with standard selection
  return standardSelection
}

/**
 * Checks if a model is considered a "cheap" model
 * Used to validate user-defined cheap LLM profiles
 * First checks the plugin registry, falls back to hardcoded list.
 */
export function isCheapModel(provider: Provider, modelName: string): boolean {
  // First try the plugin registry
  const registryConfig = getCheapModelConfig(provider)
  const registryModels = registryConfig?.recommendedModels || []

  // Fall back to hardcoded list
  const recommendedModels = registryModels.length > 0
    ? registryModels
    : (RECOMMENDED_CHEAP_MODELS[provider] || [])

  // Check exact match first
  if (recommendedModels.includes(modelName)) {
    return true
  }

  const lowerModelName = modelName.toLowerCase()

  // Exclude known expensive models first
  const expensiveIndicators = ['opus', 'o1', 'o3', 'ultra', 'pro']
  if (expensiveIndicators.some(indicator => lowerModelName.includes(indicator))) {
    return false
  }

  // Check for mid-tier models that shouldn't be considered cheap
  // Note: "4o" alone (without "mini") is mid-tier, not cheap
  if (lowerModelName.includes('4o') && !lowerModelName.includes('mini')) {
    return false
  }
  if (lowerModelName.includes('sonnet')) {
    return false
  }

  // Check if model name contains common cheap model indicators
  const cheapIndicators = [
    'mini',
    'flash',
    'haiku',
    'turbo',
    '3.5',
    ':1b',
    ':2b',
    ':3b',
    ':7b',
    'small',
    'tiny',
    'instant',
  ]

  return cheapIndicators.some(indicator => lowerModelName.includes(indicator))
}

/**
 * Estimates the relative cost of a model (for UI display)
 * Returns a value from 1 (cheapest) to 5 (most expensive)
 */
export function estimateModelCost(provider: Provider, modelName: string): number {
  const lowerModelName = modelName.toLowerCase()

  // Local models are free
  if (provider === 'OLLAMA') {
    return 1
  }

  // High-tier models (check first as they take priority)
  const highTierIndicators = ['opus', 'o1-', 'o3-', 'ultra']
  if (highTierIndicators.some(i => lowerModelName.includes(i))) {
    return 5
  }

  // Check for cheap model indicators
  if (isCheapModel(provider, modelName)) {
    return 2
  }

  // Mid-tier models (everything else including pro, sonnet, 4o)
  const midTierIndicators = ['sonnet', '4o', 'pro', 'gemini-1.5', 'gemini-2.0-pro']
  if (midTierIndicators.some(i => lowerModelName.includes(i))) {
    return 3
  }

  // Default to mid-tier
  return 3
}

/**
 * Validates that a cheap LLM configuration is usable
 */
export function validateCheapLLMConfig(
  config: CheapLLMConfig,
  availableProfiles: ConnectionProfile[]
): { valid: boolean; error?: string } {
  if (config.strategy === 'USER_DEFINED') {
    if (!config.userDefinedProfileId) {
      return {
        valid: false,
        error: 'USER_DEFINED strategy requires userDefinedProfileId',
      }
    }

    const profile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (!profile) {
      return {
        valid: false,
        error: `Connection profile ${config.userDefinedProfileId} not found`,
      }
    }

    // Warn if the selected model is not a cheap model
    if (!isCheapModel(profile.provider, profile.modelName)) {
      // Get recommended models from registry or fallback
      const registryConfig = getCheapModelConfig(profile.provider)
      const recommendedModels = registryConfig?.recommendedModels?.length
        ? registryConfig.recommendedModels
        : RECOMMENDED_CHEAP_MODELS[profile.provider]

      return {
        valid: true, // Still valid, just a warning
        error: `Warning: ${profile.modelName} is not a recommended cheap model. ` +
          `Consider using one of: ${recommendedModels?.join(', ')}`,
      }
    }
  }

  return { valid: true }
}

// ============================================================================
// PRICING-AWARE SELECTION (Sprint 2.1)
// ============================================================================

