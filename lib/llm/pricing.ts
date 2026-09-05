/**
 * Model Pricing Data System
 * Sprint 2.1: Real pricing data for cheap LLM selection
 *
 * This module fetches and caches model pricing data from providers
 * to enable cost-aware model selection for background tasks.
 *
 * NOTE: Registered plugins can provide pricing via getModelInfo().
 * The getModelPricingFromRegistry function queries the registry first,
 * falling back to legacy pricing data for unknown providers.
 *
 * @see lib/llm/fallback-data.ts for legacy fallback pricing
 */

import { Provider } from '@/lib/schemas/types'
import { getModelPricing } from '@/lib/plugins/provider-registry'
import {
  LEGACY_FALLBACK_PRICING,
  type LegacyModelPricing,
} from './fallback-data'

/**
 * Pricing information for a model (costs per 1M tokens)
 */
export interface ModelPricing {
  /** Model identifier */
  modelId: string
  /** Provider */
  provider: Provider
  /** Display name */
  name: string
  /** Cost per 1M input/prompt tokens (in USD) */
  promptCostPer1M: number
  /** Cost per 1M output/completion tokens (in USD) */
  completionCostPer1M: number
  /** Context window size */
  contextLength: number | null
  /** Whether this model supports vision/images */
  supportsVision?: boolean
  /** Whether this model supports tool/function calling */
  supportsTools?: boolean
  /** When this pricing data was fetched */
  fetchedAt: string
}

/**
 * Cached pricing data for all providers
 */
export interface PricingCache {
  /** Version for cache invalidation */
  version: number
  /** When the cache was last updated */
  updatedAt: string
  /** Pricing data by provider */
  providers: {
    [key in Provider]?: {
      /** When this provider's data was fetched */
      fetchedAt: string
      /** Models and their pricing */
      models: ModelPricing[]
    }
  }
}

/**
 * Default/fallback pricing data for providers that don't expose pricing via API
 * Re-exported from fallback-data.ts for backward compatibility
 *
 * @deprecated Use getModelPricing() from provider-registry instead
 */
export const FALLBACK_PRICING: Record<Provider, ModelPricing[]> =
  LEGACY_FALLBACK_PRICING as Record<Provider, ModelPricing[]>

/**
 * Calculate the average cost per 1M tokens for a model
 * (simple average of input and output costs)
 */
export function getAverageCostPer1M(pricing: ModelPricing): number {
  return (pricing.promptCostPer1M + pricing.completionCostPer1M) / 2
}

/**
 * Calculate estimated cost for a given number of tokens
 */
export function estimateCost(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number
): number {
  const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPer1M
  const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPer1M
  return promptCost + completionCost
}

/**
 * Sort models by cost (cheapest first)
 */
export function sortByCost(models: ModelPricing[]): ModelPricing[] {
  return [...models].sort((a, b) => {
    const costA = getAverageCostPer1M(a)
    const costB = getAverageCostPer1M(b)
    return costA - costB
  })
}

/**
 * Find the cheapest model for a provider
 */
export function findCheapestModel(
  models: ModelPricing[],
  options?: {
    requireVision?: boolean
    requireTools?: boolean
    minContextLength?: number
  }
): ModelPricing | null {
  let candidates = [...models]

  // Filter by requirements
  if (options?.requireVision) {
    candidates = candidates.filter(m => m.supportsVision)
  }
  if (options?.requireTools) {
    candidates = candidates.filter(m => m.supportsTools)
  }
  if (options?.minContextLength) {
    const minContext = options.minContextLength
    candidates = candidates.filter(
      m => m.contextLength === null || m.contextLength >= minContext
    )
  }

  if (candidates.length === 0) {
    return null
  }

  // Sort by cost and return cheapest
  return sortByCost(candidates)[0]
}

/**
 * Get model pricing from the provider registry
 * First checks plugin's getModelInfo(), then falls back to FALLBACK_PRICING
 *
 * @param provider The provider name
 * @param modelId The model identifier
 * @returns ModelPricing object or null if not found
 */
export function getModelPricingFromRegistry(
  provider: Provider,
  modelId: string
): ModelPricing | null {
  // First try the plugin registry
  const registryPricing = getModelPricing(provider, modelId)
  if (registryPricing) {
    return {
      modelId,
      provider,
      name: modelId, // Plugin doesn't provide display name in pricing
      promptCostPer1M: registryPricing.input,
      completionCostPer1M: registryPricing.output,
      contextLength: null, // Would need to query separately
      fetchedAt: new Date().toISOString(),
    }
  }

  // Fall back to FALLBACK_PRICING
  const providerPricing = FALLBACK_PRICING[provider]
  if (providerPricing) {
    const modelPricing = providerPricing.find(
      (m: ModelPricing) =>
        m.modelId === modelId ||
        m.modelId.includes(modelId) ||
        modelId.includes(m.modelId)
    )
    if (modelPricing) {
      return modelPricing
    }
  }

  return null
}
