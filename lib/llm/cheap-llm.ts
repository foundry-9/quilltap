/**
 * Cheap LLM Provider Selection
 * Sprint 2: Memory System - Cheap LLM Support
 *
 * This module provides intelligent selection of cost-effective LLM providers
 * for background tasks like memory extraction, summarization, and chat titling.
 * These tasks don't require the full power of expensive models.
 */

import { ConnectionProfile, Provider } from '@/lib/json-store/schemas/types'

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
}

/**
 * Mapping of providers to their cheapest models
 * Updated for November 2025 model lineup
 */
const CHEAPEST_MODEL_MAP: Record<Provider, string> = {
  ANTHROPIC: 'claude-haiku-4-5-20251015',
  OPENAI: 'gpt-4o-mini',
  GOOGLE: 'gemini-2.0-flash',
  GROK: 'grok-2-mini', // Grok's cheaper offering
  OPENROUTER: 'openai/gpt-4o-mini', // OpenRouter format
  OLLAMA: 'llama3.2:3b', // Fast, small local model
  OPENAI_COMPATIBLE: 'gpt-4o-mini', // Default to OpenAI mini format
  GAB_AI: 'gab-ai-chat', // Gab AI's default model
}

/**
 * Models that are known to work well for cheap LLM tasks
 * (memory extraction, summarization, titling)
 */
export const RECOMMENDED_CHEAP_MODELS: Record<Provider, string[]> = {
  ANTHROPIC: ['claude-haiku-4-5-20251015', 'claude-3-haiku-20240307'],
  OPENAI: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  GOOGLE: ['gemini-2.0-flash', 'gemini-1.5-flash'],
  GROK: ['grok-2-mini'],
  OPENROUTER: [
    'openai/gpt-4o-mini',
    'anthropic/claude-3-haiku',
    'google/gemini-2.0-flash',
    'mistralai/mistral-7b-instruct',
  ],
  OLLAMA: [
    'llama3.2:3b',
    'llama3.2:1b',
    'phi3:mini',
    'mistral:7b',
    'gemma2:2b',
  ],
  OPENAI_COMPATIBLE: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  GAB_AI: ['gab-ai-chat'],
}

/**
 * Default cheap LLM configuration
 */
export const DEFAULT_CHEAP_LLM_CONFIG: CheapLLMConfig = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
}

/**
 * Gets the cheapest model for a given provider
 */
export function getCheapestModel(provider: Provider): string {
  return CHEAPEST_MODEL_MAP[provider]
}

/**
 * Selects the appropriate cheap LLM provider based on configuration
 *
 * @param currentProfile - The current connection profile being used for chat
 * @param config - Cheap LLM configuration
 * @param availableProfiles - All available connection profiles (for USER_DEFINED strategy)
 * @param ollamaAvailable - Whether Ollama is available locally
 * @returns The selected cheap LLM configuration
 */
export function getCheapLLMProvider(
  currentProfile: ConnectionProfile,
  config: CheapLLMConfig = DEFAULT_CHEAP_LLM_CONFIG,
  availableProfiles: ConnectionProfile[] = [],
  ollamaAvailable: boolean = false
): CheapLLMSelection {
  // Strategy 1: User-defined connection profile
  if (config.strategy === 'USER_DEFINED' && config.userDefinedProfileId) {
    const userProfile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (userProfile) {
      return {
        provider: userProfile.provider,
        modelName: userProfile.modelName,
        baseUrl: userProfile.baseUrl || undefined,
        connectionProfileId: userProfile.id,
        isLocal: userProfile.provider === 'OLLAMA',
      }
    }
    // Fall through to next strategy if profile not found
  }

  // Strategy 2: Local first (prefer Ollama if available)
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
      }
    }

    // If LOCAL_FIRST was explicitly requested but no Ollama profile exists,
    // we should still fall through to the cheapest provider
  }

  // Strategy 3: Map current provider to its cheapest variant (default)
  const cheapModel = getCheapestModel(currentProfile.provider)

  return {
    provider: currentProfile.provider,
    modelName: cheapModel,
    baseUrl: currentProfile.baseUrl || undefined,
    connectionProfileId: currentProfile.id,
    isLocal: currentProfile.provider === 'OLLAMA',
  }
}

/**
 * Checks if a model is considered a "cheap" model
 * Used to validate user-defined cheap LLM profiles
 */
export function isCheapModel(provider: Provider, modelName: string): boolean {
  const recommendedModels = RECOMMENDED_CHEAP_MODELS[provider] || []

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
      return {
        valid: true, // Still valid, just a warning
        error: `Warning: ${profile.modelName} is not a recommended cheap model. ` +
          `Consider using one of: ${RECOMMENDED_CHEAP_MODELS[profile.provider]?.join(', ')}`,
      }
    }
  }

  return { valid: true }
}
