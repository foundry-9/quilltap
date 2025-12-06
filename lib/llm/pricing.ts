/**
 * Model Pricing Data System
 * Sprint 2.1: Real pricing data for cheap LLM selection
 *
 * This module fetches and caches model pricing data from providers
 * to enable cost-aware model selection for background tasks.
 */

import { Provider } from '@/lib/schemas/types'

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
 * Prices are per 1M tokens in USD (as of November 2025)
 */
export const FALLBACK_PRICING: Record<Provider, ModelPricing[]> = {
  ANTHROPIC: [
    // Claude 4.5 models
    {
      modelId: 'claude-sonnet-4-5-20250929',
      provider: 'ANTHROPIC',
      name: 'Claude 4.5 Sonnet',
      promptCostPer1M: 3.0,
      completionCostPer1M: 15.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-haiku-4-5-20251001',
      provider: 'ANTHROPIC',
      name: 'Claude 4.5 Haiku',
      promptCostPer1M: 0.80,
      completionCostPer1M: 4.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Claude 4 models
    {
      modelId: 'claude-opus-4-1-20250805',
      provider: 'ANTHROPIC',
      name: 'Claude 4.1 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-sonnet-4-20250514',
      provider: 'ANTHROPIC',
      name: 'Claude 4 Sonnet',
      promptCostPer1M: 3.0,
      completionCostPer1M: 15.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-opus-4-20250514',
      provider: 'ANTHROPIC',
      name: 'Claude 4 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Claude 3 legacy
    {
      modelId: 'claude-3-opus-20240229',
      provider: 'ANTHROPIC',
      name: 'Claude 3 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-3-haiku-20240307',
      provider: 'ANTHROPIC',
      name: 'Claude 3 Haiku',
      promptCostPer1M: 0.25,
      completionCostPer1M: 1.25,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  OPENAI: [
    // GPT-4o models
    {
      modelId: 'gpt-4o',
      provider: 'OPENAI',
      name: 'GPT-4o',
      promptCostPer1M: 2.50,
      completionCostPer1M: 10.0,
      contextLength: 128000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gpt-4o-mini',
      provider: 'OPENAI',
      name: 'GPT-4o Mini',
      promptCostPer1M: 0.15,
      completionCostPer1M: 0.60,
      contextLength: 128000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // o1 reasoning models
    {
      modelId: 'o1',
      provider: 'OPENAI',
      name: 'o1',
      promptCostPer1M: 15.0,
      completionCostPer1M: 60.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: false,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'o1-mini',
      provider: 'OPENAI',
      name: 'o1-mini',
      promptCostPer1M: 3.0,
      completionCostPer1M: 12.0,
      contextLength: 128000,
      supportsVision: false,
      supportsTools: false,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // GPT-3.5 (legacy but cheap)
    {
      modelId: 'gpt-3.5-turbo',
      provider: 'OPENAI',
      name: 'GPT-3.5 Turbo',
      promptCostPer1M: 0.50,
      completionCostPer1M: 1.50,
      contextLength: 16385,
      supportsVision: false,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  GOOGLE: [
    // Gemini 2.0 models
    {
      modelId: 'gemini-2.0-flash',
      provider: 'GOOGLE',
      name: 'Gemini 2.0 Flash',
      promptCostPer1M: 0.075,
      completionCostPer1M: 0.30,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gemini-2.0-pro',
      provider: 'GOOGLE',
      name: 'Gemini 2.0 Pro',
      promptCostPer1M: 1.25,
      completionCostPer1M: 5.0,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Gemini 1.5 models
    {
      modelId: 'gemini-1.5-flash',
      provider: 'GOOGLE',
      name: 'Gemini 1.5 Flash',
      promptCostPer1M: 0.075,
      completionCostPer1M: 0.30,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gemini-1.5-pro',
      provider: 'GOOGLE',
      name: 'Gemini 1.5 Pro',
      promptCostPer1M: 1.25,
      completionCostPer1M: 5.0,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  GROK: [
    {
      modelId: 'grok-2',
      provider: 'GROK',
      name: 'Grok-2',
      promptCostPer1M: 2.0,
      completionCostPer1M: 10.0,
      contextLength: 131072,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'grok-2-mini',
      provider: 'GROK',
      name: 'Grok-2 Mini',
      promptCostPer1M: 0.30,
      completionCostPer1M: 0.50,
      contextLength: 131072,
      supportsVision: false,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  // OpenRouter fetches from API, these are fallbacks
  OPENROUTER: [],

  // Ollama is local/free
  OLLAMA: [],

  // OpenAI Compatible uses same pricing structure as source
  OPENAI_COMPATIBLE: [],

  // Gab AI
  GAB_AI: [
    {
      modelId: 'gab-ai-chat',
      provider: 'GAB_AI',
      name: 'Gab AI Chat',
      promptCostPer1M: 0,
      completionCostPer1M: 0,
      contextLength: 32000,
      supportsVision: false,
      supportsTools: false,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],
}

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
 * Get models cheaper than a threshold
 */
export function getModelsUnderCost(
  models: ModelPricing[],
  maxAverageCostPer1M: number
): ModelPricing[] {
  return models.filter(m => getAverageCostPer1M(m) <= maxAverageCostPer1M)
}

/**
 * Calculate cost tier (1-5) based on actual pricing
 */
export function calculateCostTier(pricing: ModelPricing): number {
  const avgCost = getAverageCostPer1M(pricing)

  // Tier thresholds (per 1M tokens average)
  if (avgCost === 0) return 1 // Free (local/Ollama)
  if (avgCost < 0.5) return 1 // Very cheap (Flash models)
  if (avgCost < 2.0) return 2 // Cheap (Mini models, Haiku)
  if (avgCost < 10.0) return 3 // Mid-tier (Sonnet, GPT-4o)
  if (avgCost < 50.0) return 4 // Expensive (Opus, o1)
  return 5 // Very expensive
}

/**
 * Compare two models and return cost savings percentage
 */
export function calculateSavings(
  expensiveModel: ModelPricing,
  cheaperModel: ModelPricing
): number {
  const expensiveCost = getAverageCostPer1M(expensiveModel)
  const cheaperCost = getAverageCostPer1M(cheaperModel)

  if (expensiveCost === 0) return 0
  return ((expensiveCost - cheaperCost) / expensiveCost) * 100
}
