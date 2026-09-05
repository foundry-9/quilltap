'use client'

import { useState, useCallback } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { fetchJson } from '@/lib/fetch-helpers'
import type { ApiKey, EmbeddingModel, EmbeddingProfile, EmbeddingProvider } from '../types'

/**
 * Provider info returned from the API
 */
export interface EmbeddingProviderInfo {
  name: EmbeddingProvider
  displayName: string
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  description?: string
}

interface UseEmbeddingProfilesResult {
  profiles: EmbeddingProfile[]
  apiKeys: ApiKey[]
  embeddingModels: Record<string, EmbeddingModel[]>
  /** Available embedding providers from the plugin system */
  embeddingProviders: EmbeddingProviderInfo[]
  loading: boolean
  error: string | null
  loadData: () => Promise<void>
  fetchProfiles: () => Promise<void>
  triggerAutoAssociate: () => Promise<void>
}

/**
 * Hook to manage embedding profiles data fetching and state
 */
/**
 * Static provider metadata (used when API doesn't provide full details)
 * This is a fallback - ideally the API would return this information
 */
const PROVIDER_METADATA: Record<string, Omit<EmbeddingProviderInfo, 'name'>> = {
  BUILTIN: {
    displayName: 'Built-in (TF-IDF)',
    requiresApiKey: false,
    requiresBaseUrl: false,
    description: 'Offline embeddings using TF-IDF with BM25 enhancement - no API keys required',
  },
  OPENAI: {
    displayName: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'OpenAI text embeddings (text-embedding-3-small, text-embedding-3-large)',
  },
  OPENROUTER: {
    displayName: 'OpenRouter',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Access multiple embedding models through OpenRouter',
  },
  NANOGPT: {
    displayName: 'NanoGPT',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'OpenAI, BGE, Jina, Qwen, and Gemini embedding models through NanoGPT',
  },
  OLLAMA: {
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    requiresBaseUrl: true,
    description: 'Local embedding models via Ollama',
  },
}

export function useEmbeddingProfiles(): UseEmbeddingProfilesResult {
  const [profiles, setProfiles] = useState<EmbeddingProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<Record<string, EmbeddingModel[]>>({})
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProviderInfo[]>([])

  const {
    loading,
    error,
    execute: executeLoad,
  } = useAsyncOperation<void>()

  const triggerAutoAssociate = useAutoAssociate()

  const loadData = useCallback(async () => {
    await executeLoad(async () => {
      const [profilesRes, keysRes, modelsRes, providersRes] = await Promise.all([
        fetchJson<{ profiles: EmbeddingProfile[]; count: number }>('/api/v1/embedding-profiles'),
        fetchJson<{ apiKeys: ApiKey[]; count: number }>('/api/v1/api-keys'),
        fetchJson<Record<string, EmbeddingModel[]>>('/api/v1/embedding-profiles?action=list-models'),
        fetchJson<{ providers: string[] }>('/api/v1/embedding-profiles?action=list-providers'),
      ])

      if (!profilesRes.ok) {
        throw new Error(profilesRes.error || 'Failed to fetch profiles')
      }
      if (!keysRes.ok) {
        console.error('Failed to fetch API keys', { error: keysRes.error })
      } else if (keysRes.data?.apiKeys) {
        setApiKeys(keysRes.data.apiKeys)
      }
      if (!modelsRes.ok) {
        console.error('Failed to fetch embedding models', { error: modelsRes.error })
      } else if (modelsRes.data) {
        setEmbeddingModels(modelsRes.data)
      }

      // Build providers list from API response or fall back to models keys
      if (providersRes.ok && providersRes.data?.providers) {
        const providers = providersRes.data.providers.map(name => ({
          name: name as EmbeddingProvider,
          ...PROVIDER_METADATA[name] || {
            displayName: name,
            requiresApiKey: true,
            requiresBaseUrl: false,
          },
        }))
        setEmbeddingProviders(providers)
      } else if (modelsRes.data) {
        // Fallback: derive providers from models response
        const providers = Object.keys(modelsRes.data).map(name => ({
          name: name as EmbeddingProvider,
          ...PROVIDER_METADATA[name] || {
            displayName: name,
            requiresApiKey: true,
            requiresBaseUrl: false,
          },
        }))
        setEmbeddingProviders(providers)
      }

      if (profilesRes.data?.profiles) {
        setProfiles(profilesRes.data.profiles)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executeLoad is stable (empty deps in useAsyncOperation)

  const fetchProfiles = useCallback(async () => {
    const result = await fetchJson<{ profiles: EmbeddingProfile[]; count: number }>('/api/v1/embedding-profiles')
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch profiles')
    }
    if (result.data?.profiles) {
      setProfiles(result.data.profiles)
    }
  }, [])

  return {
    profiles,
    apiKeys,
    embeddingModels,
    embeddingProviders,
    loading,
    error,
    loadData,
    fetchProfiles,
    triggerAutoAssociate,
  }
}
