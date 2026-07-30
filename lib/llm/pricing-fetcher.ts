/**
 * Model Pricing Fetcher
 * Sprint 2.1: Fetch pricing data from providers on startup
 *
 * This module queries each configured provider for their available models
 * and pricing information, caching the results for cost-aware model selection.
 */

import { Provider, ConnectionProfile } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'

import { logger } from '@/lib/logger'
import {
  ModelPricing,
  PricingCache,
  FALLBACK_PRICING,
  sortByCost,
} from './pricing'

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Fail-fast timeout for the public pricing fetch. Cost estimation sits on the
// critical path of message finalization, so we can't afford to wait on Node's
// default socket behavior when openrouter.ai is slow or unreachable.
const OPENROUTER_FETCH_TIMEOUT_MS = 3000

// Negative-cache TTL: skip retries for 5 minutes after a failure so repeated
// cost estimates don't each pay the timeout when openrouter.ai is down.
const OPENROUTER_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000

// In-memory cache
let pricingCache: PricingCache | null = null

// OpenRouter public pricing cache (no auth required)
let openRouterPublicCache: {
  models: ModelPricing[]
  fetchedAt: number
} | null = null

// Timestamp of the last failed public-pricing fetch (for negative caching)
let openRouterPublicFetchFailureAt: number | null = null

/**
 * Mapping from Quilltap provider names to OpenRouter provider slugs
 * Used to look up pricing for non-OpenRouter providers via OpenRouter's public API
 */
const PROVIDER_TO_OPENROUTER_SLUG: Partial<Record<Provider, string>> = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  GROK: 'x-ai',
  // OPENROUTER: not needed - already uses OpenRouter format
  // OLLAMA: not applicable - local/free
  // OPENAI_COMPATIBLE: not applicable - unknown provider
}

/**
 * Fetch pricing from OpenRouter's public API (no authentication required)
 * This provides pricing data for models from all major providers
 */
async function fetchOpenRouterPublicPricing(): Promise<ModelPricing[]> {
  try {

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`)
    }

    const data = await response.json()
    const models: ModelPricing[] = []

    for (const model of data.data || []) {
      // Parse pricing (OpenRouter returns costs per token as strings)
      const promptCost = parseFloat(String(model.pricing?.prompt || '0'))
      const completionCost = parseFloat(String(model.pricing?.completion || '0'))

      // Convert from per-token to per-1M tokens
      const promptCostPer1M = promptCost * 1_000_000
      const completionCostPer1M = completionCost * 1_000_000

      models.push({
        modelId: model.id,
        provider: 'OPENROUTER', // All models stored as OPENROUTER provider
        name: model.name || model.id,
        promptCostPer1M,
        completionCostPer1M,
        contextLength: model.context_length ?? null,
        supportsVision: model.architecture?.modality?.includes('image') || false,
        supportsTools: Array.isArray(model.supported_parameters) &&
          model.supported_parameters.some((p: string) => p === 'tools' || p === 'tool_choice'),
        fetchedAt: new Date().toISOString(),
      })
    }

    openRouterPublicFetchFailureAt = null
    return models
  } catch (error) {
    openRouterPublicFetchFailureAt = Date.now()
    logger.error('Failed to fetch OpenRouter public pricing',
      { context: 'fetchOpenRouterPublicPricing' },
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Get cached OpenRouter public pricing, refreshing if stale
 */
async function getOpenRouterPublicPricing(): Promise<ModelPricing[]> {
  // Check if cache is fresh
  if (openRouterPublicCache) {
    const cacheAge = Date.now() - openRouterPublicCache.fetchedAt
    if (cacheAge < CACHE_TTL_MS) {
      return openRouterPublicCache.models
    }
  }

  // Negative cache: after a recent failure, skip the fetch entirely so we
  // don't pay the timeout again on every cost estimate while openrouter.ai
  // is down.
  if (openRouterPublicFetchFailureAt !== null) {
    const failureAge = Date.now() - openRouterPublicFetchFailureAt
    if (failureAge < OPENROUTER_NEGATIVE_CACHE_TTL_MS) {
      return []
    }
  }

  // Fetch and cache
  const models = await fetchOpenRouterPublicPricing()
  if (models.length > 0) {
    openRouterPublicCache = {
      models,
      fetchedAt: Date.now(),
    }
  }

  return models
}

/**
 * Look up pricing for a model from any provider using OpenRouter's public data
 *
 * @param provider The Quilltap provider (OPENAI, ANTHROPIC, etc.)
 * @param modelId The model ID as used by the provider (e.g., 'gpt-5-nano')
 * @returns ModelPricing if found, null otherwise
 */
export async function getOpenRouterPricingForModel(
  provider: Provider,
  modelId: string
): Promise<ModelPricing | null> {
  // Get the OpenRouter slug for this provider
  const openRouterSlug = PROVIDER_TO_OPENROUTER_SLUG[provider]
  if (!openRouterSlug) {

    return null
  }

  // Get cached OpenRouter pricing
  const models = await getOpenRouterPublicPricing()
  if (models.length === 0) {
    return null
  }

  // Build the expected OpenRouter model ID
  const openRouterModelId = `${openRouterSlug}/${modelId}`

  // Try exact match first
  let match = models.find(m => m.modelId === openRouterModelId)
  if (match) {

    return match
  }

  // Try fuzzy matching - model might have version suffix or prefix differences
  // e.g., 'gpt-4o-2024-11-20' should match 'openai/gpt-4o'
  match = models.find(m => {
    if (!m.modelId.startsWith(`${openRouterSlug}/`)) return false
    const openRouterModelName = m.modelId.slice(openRouterSlug.length + 1)
    return modelId.includes(openRouterModelName) || openRouterModelName.includes(modelId)
  })

  if (match) {

    return match
  }

  return null
}

/**
 * Get unique providers from connection profiles
 */
function getUniqueProviders(profiles: ConnectionProfile[]): Provider[] {
  const providers = new Set<Provider>()
  for (const profile of profiles) {
    providers.add(profile.provider)
  }
  return Array.from(providers)
}

/**
 * Fetch pricing from OpenRouter API
 * OpenRouter is the only provider that exposes pricing via API
 * Uses dynamic import to avoid requiring @openrouter/sdk at the top level
 */
async function fetchOpenRouterPricing(apiKey: string): Promise<ModelPricing[]> {
  try {
    // Dynamic import to make @openrouter/sdk optional
    const { OpenRouter } = await import('@openrouter/sdk')

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: 'Quilltap',
    })

    // @openrouter/sdk 0.13 changed models.list() to return a paginated
    // async-iterable; the model array now lives at page.result.data (was
    // response.data in 0.12). Iterate pages so we capture every model.
    const pages = await client.models.list()
    const models: ModelPricing[] = []

    for await (const page of pages) {
      for (const model of page.result?.data || []) {
        // Parse pricing (OpenRouter returns costs per token as strings)
        const promptCost = parseFloat(String(model.pricing?.prompt || '0'))
        const completionCost = parseFloat(String(model.pricing?.completion || '0'))

        // Convert from per-token to per-1M tokens
        const promptCostPer1M = promptCost * 1_000_000
        const completionCostPer1M = completionCost * 1_000_000

        models.push({
          modelId: model.id,
          provider: 'OPENROUTER',
          name: model.name,
          promptCostPer1M,
          completionCostPer1M,
          contextLength: model.contextLength ?? null,
          supportsVision: model.architecture?.modality?.includes('image') || false,
          supportsTools: model.supportedParameters?.some(
            (p: string) => p === 'tools' || p === 'tool_choice'
          ) || false,
          fetchedAt: new Date().toISOString(),
        })
      }
    }

    return sortByCost(models)
  } catch (error) {
    // Log appropriately - SDK might not be installed
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      logger.warn('OpenRouter SDK not installed, skipping pricing fetch', { context: 'fetchOpenRouterPricing' })
    } else {
      logger.error('Failed to fetch OpenRouter pricing', { context: 'fetchOpenRouterPricing' }, error instanceof Error ? error : undefined)
    }
    return []
  }
}

/**
 * Fetch available models from Ollama (free, so no pricing)
 */
async function fetchOllamaModels(baseUrl: string): Promise<ModelPricing[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const data = await response.json()
    const models: ModelPricing[] = []

    for (const model of data.models || []) {
      models.push({
        modelId: model.name,
        provider: 'OLLAMA',
        name: model.name,
        promptCostPer1M: 0, // Free
        completionCostPer1M: 0, // Free
        contextLength: null, // Varies by model
        supportsVision: model.name.includes('llava') || model.name.includes('vision'),
        supportsTools: false, // Most Ollama models don't support function calling
        fetchedAt: new Date().toISOString(),
      })
    }

    return models
  } catch (error) {
    logger.error('Failed to fetch Ollama models', { context: 'fetchOllamaModels' }, error instanceof Error ? error : undefined)
    return []
  }
}

/**
 * Get an API key for a provider from available profiles
 */
async function getApiKeyForProvider(
  provider: Provider,
  profiles: ConnectionProfile[],
  userId: string
): Promise<{ apiKey: string; baseUrl?: string } | null> {
  const profile = profiles.find(p => p.provider === provider && p.apiKeyId)
  if (!profile) return null

  const repos = getRepositories()
  const apiKeyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId!, userId)
  if (!apiKeyRecord) return null

  return { apiKey: apiKeyRecord.key_value, baseUrl: profile.baseUrl || undefined }
}

/**
 * Fetch pricing data for a specific provider
 */
async function fetchProviderPricing(
  provider: Provider,
  profiles: ConnectionProfile[],
  userId: string
): Promise<ModelPricing[]> {
  // Ollama is special - uses baseUrl, no API key
  if (provider === 'OLLAMA') {
    const ollamaProfile = profiles.find(p => p.provider === 'OLLAMA')
    if (ollamaProfile?.baseUrl) {
      return fetchOllamaModels(ollamaProfile.baseUrl)
    }
    return []
  }

  // OpenRouter has API pricing
  if (provider === 'OPENROUTER') {
    const creds = await getApiKeyForProvider(provider, profiles, userId)
    if (creds?.apiKey) {
      return fetchOpenRouterPricing(creds.apiKey)
    }
    return []
  }

  // Other providers use fallback pricing data
  // We could potentially call their models endpoints to verify availability,
  // but pricing is not exposed via API
  return FALLBACK_PRICING[provider] || []
}

/**
 * Refresh pricing cache for all configured providers
 */
async function refreshPricingCache(userId: string): Promise<PricingCache> {
  const repos = getRepositories()
  const profiles = await repos.connections.findAll()

  // Get unique providers from profiles
  const providers = getUniqueProviders(profiles)

  const cache: PricingCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {},
  }

  // Fetch pricing for each provider in parallel
  const fetchPromises = providers.map(async provider => {
    const models = await fetchProviderPricing(provider, profiles, userId)
    return { provider, models }
  })

  const results = await Promise.all(fetchPromises)

  for (const { provider, models } of results) {
    if (models.length > 0) {
      cache.providers[provider] = {
        fetchedAt: new Date().toISOString(),
        models,
      }
    } else if (FALLBACK_PRICING[provider]?.length > 0) {
      // Use fallback if fetch failed
      cache.providers[provider] = {
        fetchedAt: new Date().toISOString(),
        models: FALLBACK_PRICING[provider],
      }
    }
  }

  // Update in-memory cache
  pricingCache = cache

  logger.info(
    'Refreshed pricing cache',
    { context: 'refreshPricingCache', providersCount: Object.keys(cache.providers).length }
  )

  return cache
}

/**
 * Get cached pricing data, refreshing if stale
 */
export async function getPricingCache(userId: string): Promise<PricingCache> {
  // Check if cache is fresh
  if (pricingCache) {
    const cacheAge = Date.now() - new Date(pricingCache.updatedAt).getTime()
    if (cacheAge < CACHE_TTL_MS) {
      return pricingCache
    }
  }

  // Refresh cache
  return refreshPricingCache(userId)
}

/**
 * Get pricing for a specific provider
 */
export async function getProviderPricing(
  provider: Provider,
  userId: string
): Promise<ModelPricing[]> {
  const cache = await getPricingCache(userId)
  return cache.providers[provider]?.models || FALLBACK_PRICING[provider] || []
}

/**
 * Get pricing for a specific model
 */
export async function getModelPricing(
  provider: Provider,
  modelId: string,
  userId: string
): Promise<ModelPricing | null> {
  const models = await getProviderPricing(provider, userId)
  return models.find(m => m.modelId === modelId) || null
}

