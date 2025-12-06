/**
 * Model Pricing Fetcher
 * Sprint 2.1: Fetch pricing data from providers on startup
 *
 * This module queries each configured provider for their available models
 * and pricing information, caching the results for cost-aware model selection.
 */

import { OpenRouter } from '@openrouter/sdk'
import { Provider, ConnectionProfile } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'
import {
  ModelPricing,
  PricingCache,
  FALLBACK_PRICING,
  sortByCost,
} from './pricing'

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// In-memory cache
let pricingCache: PricingCache | null = null

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
 */
async function fetchOpenRouterPricing(apiKey: string): Promise<ModelPricing[]> {
  try {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    })

    const response = await client.models.list()
    const models: ModelPricing[] = []

    for (const model of response.data || []) {
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
        contextLength: model.contextLength,
        supportsVision: model.architecture?.modality?.includes('image') || false,
        supportsTools: model.supportedParameters?.some(
          p => p === 'tools' || p === 'tool_choice'
        ) || false,
        fetchedAt: new Date().toISOString(),
      })
    }

    return sortByCost(models)
  } catch (error) {
    logger.error('Failed to fetch OpenRouter pricing', { context: 'fetchOpenRouterPricing' }, error instanceof Error ? error : undefined)
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
  const apiKeyRecord = await repos.connections.findApiKeyById(profile.apiKeyId!)
  if (!apiKeyRecord) return null

  try {
    const apiKey = decryptApiKey(
      apiKeyRecord.ciphertext,
      apiKeyRecord.iv,
      apiKeyRecord.authTag,
      userId
    )
    return { apiKey, baseUrl: profile.baseUrl || undefined }
  } catch {
    return null
  }
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
export async function refreshPricingCache(userId: string): Promise<PricingCache> {
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

/**
 * Get all models across all providers, sorted by cost
 */
export async function getAllModelsSortedByCost(
  userId: string
): Promise<ModelPricing[]> {
  const cache = await getPricingCache(userId)
  const allModels: ModelPricing[] = []

  for (const providerData of Object.values(cache.providers)) {
    if (providerData?.models) {
      allModels.push(...providerData.models)
    }
  }

  return sortByCost(allModels)
}

/**
 * Find the cheapest available model across all providers
 */
export async function findCheapestAvailableModel(
  userId: string,
  options?: {
    requireVision?: boolean
    requireTools?: boolean
    excludeProviders?: Provider[]
  }
): Promise<ModelPricing | null> {
  const cache = await getPricingCache(userId)
  const candidates: ModelPricing[] = []

  for (const [provider, providerData] of Object.entries(cache.providers)) {
    if (options?.excludeProviders?.includes(provider as Provider)) {
      continue
    }

    if (providerData?.models) {
      for (const model of providerData.models) {
        if (options?.requireVision && !model.supportsVision) continue
        if (options?.requireTools && !model.supportsTools) continue
        candidates.push(model)
      }
    }
  }

  if (candidates.length === 0) return null

  return sortByCost(candidates)[0]
}

/**
 * Clear the pricing cache (for testing or manual refresh)
 */
export function clearPricingCache(): void {
  pricingCache = null
}

/**
 * Check if pricing cache exists and is fresh
 */
export function isCacheFresh(): boolean {
  if (!pricingCache) return false
  const cacheAge = Date.now() - new Date(pricingCache.updatedAt).getTime()
  return cacheAge < CACHE_TTL_MS
}
