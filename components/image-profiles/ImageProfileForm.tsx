'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ImageLoraSpec, ImageLoraSupport, ProviderOptionsSchema } from '@quilltap/plugin-types'
import { ImageProfileParameters } from './ImageProfileParameters'
import { LoraListEditor } from './LoraListEditor'
import { ProviderOptionsPanel } from '@/components/settings/connection-profiles/ProviderOptionsPanel'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isDangerousCompatible?: boolean
  apiKey?: ApiKey | null
}

interface ImageProviderInfo {
  value: string
  label: string
  defaultModels: string[]
  apiKeyProvider: string
  legacyNames?: string[]
}

interface ImageProfileFormProps {
  profile?: ImageProfile
  apiKeys: ApiKey[]
  onSuccess?: () => void
  onCancel?: () => void
}

// Fallback providers when API is unavailable
const FALLBACK_PROVIDERS: ImageProviderInfo[] = [
  { value: 'OPENAI', label: 'OpenAI (DALL-E / GPT Image)', defaultModels: ['gpt-image-2', 'gpt-image-1', 'dall-e-3', 'dall-e-2'], apiKeyProvider: 'OPENAI' },
  { value: 'GROK', label: 'Grok (xAI)', defaultModels: ['grok-2-image'], apiKeyProvider: 'GROK' },
  { value: 'GOOGLE', label: 'Google Gemini', defaultModels: ['imagen-4.0-generate-001', 'imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'], apiKeyProvider: 'GOOGLE', legacyNames: ['GOOGLE_IMAGEN'] },
  { value: 'Z_AI', label: 'Z.AI (CogView / GLM-Image)', defaultModels: ['cogview-4-250304', 'glm-image'], apiKeyProvider: 'Z_AI' },
  { value: 'NANOGPT', label: 'NanoGPT (Flux / HiDream / Recraft)', defaultModels: ['hidream', 'flux-2-flash', 'flux-2-dev', 'flux-2-pro', 'recraft-v3', 'gpt-image-1.5'], apiKeyProvider: 'NANOGPT' },
]

// Build a legacy name mapping from provider data
function buildLegacyNameMap(providers: ImageProviderInfo[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const provider of providers) {
    if (provider.legacyNames) {
      for (const legacyName of provider.legacyNames) {
        map[legacyName] = provider.value
      }
    }
  }
  return map
}

// Normalize a provider name using the provider list, converting legacy names to current names
function normalizeProviderName(provider: string, providers: ImageProviderInfo[]): string {
  const legacyMap = buildLegacyNameMap(providers)
  return legacyMap[provider] || provider
}

export function ImageProfileForm({
  profile,
  apiKeys,
  onSuccess,
  onCancel,
}: ImageProfileFormProps) {
  const [formData, setFormData] = useState({
    name: profile?.name || '',
    // Provider will be normalized after providers are loaded
    provider: profile?.provider || 'OPENAI',
    apiKeyId: profile?.apiKeyId || '',
    baseUrl: profile?.baseUrl || '',
    modelName: profile?.modelName || 'dall-e-3',
    parameters: profile?.parameters || {},
    isDefault: profile?.isDefault || false,
    isDangerousCompatible: profile?.isDangerousCompatible || false,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsSource, setModelsSource] = useState<'provider' | 'builtin' | null>(null)
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null)
  const [isValidatingKey, setIsValidatingKey] = useState(false)
  const [keyValidationStatus, setKeyValidationStatus] = useState<string | null>(null)
  const [imageProviders, setImageProviders] = useState<ImageProviderInfo[]>(FALLBACK_PROVIDERS)
  const [isFetchingProviders, setIsFetchingProviders] = useState(true)
  // Per-model options schema and LoRA support, resolved server-side. The
  // schema is the plugin's answer for *this* model — image gateways route to
  // hundreds of models with different legal sizes — so both refetch whenever
  // the provider or the model changes.
  const [optionsSchema, setOptionsSchema] = useState<ProviderOptionsSchema | null>(null)
  const [loraSupport, setLoraSupport] = useState<ImageLoraSupport | null>(null)
  // Bumped whenever a live model fetch succeeds. A plugin may build its
  // options schema from a catalog it can only load with an API key, so the
  // first schema fetch on a cold cache gets the generic answer; this makes
  // the editor ask again once that catalog exists.
  const [catalogVersion, setCatalogVersion] = useState(0)

  // Fetch available image providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setIsFetchingProviders(true)
        const res = await fetch('/api/v1/image-profiles?action=list-providers')
        if (res.ok) {
          const data = await res.json()
          if (data.providers && data.providers.length > 0) {
            setImageProviders(data.providers)
          }
        }
      } catch (err) {
        // Keep fallback providers on error
        console.error('Failed to fetch image providers:', err)
      } finally {
        setIsFetchingProviders(false)
      }
    }

    fetchProviders()
  }, [])

  // Normalize legacy provider names after providers are loaded
  useEffect(() => {
    if (!isFetchingProviders && formData.provider) {
      const normalizedProvider = normalizeProviderName(formData.provider, imageProviders)
      if (normalizedProvider !== formData.provider) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream imageProviders changes (parent renders unconditionally)
        setFormData(prev => ({ ...prev, provider: normalizedProvider }))
      }
    }
  }, [isFetchingProviders, imageProviders, formData.provider])

  // Query the provider (or its plugin's built-in list) for image models.
  // Shared by the auto-load below and the explicit Fetch Models button.
  const fetchModels = useCallback(async () => {
    try {
      setIsFetchingModels(true)
      setModelsFetchError(null)
      // Normalize provider name for API calls (e.g., GOOGLE_IMAGEN -> GOOGLE)
      const normalizedProvider = normalizeProviderName(formData.provider, imageProviders)
      const url = new URL('/api/v1/image-profiles', window.location.origin)
      url.searchParams.set('action', 'list-models')
      url.searchParams.set('provider', normalizedProvider)
      if (formData.apiKeyId) {
        url.searchParams.set('apiKeyId', formData.apiKeyId)
      }

      const res = await fetch(url.toString())
      if (res.ok) {
        const data = await res.json()
        setAvailableModels(data.models)
        setModelsSource(data.source === 'provider' ? 'provider' : 'builtin')
        setModelsFetchError(data.fetchError || null)
        if (data.source === 'provider') {
          setCatalogVersion(v => v + 1)
        }
      } else {
        // Fall back to default models from provider info
        const providerInfo = imageProviders.find(p => p.value === normalizedProvider || p.value === formData.provider)
        setAvailableModels(providerInfo?.defaultModels || [])
        setModelsSource('builtin')
      }
    } catch (err) {
      // Fall back to default models on error
      const normalizedProvider = normalizeProviderName(formData.provider, imageProviders)
      const providerInfo = imageProviders.find(p => p.value === normalizedProvider || p.value === formData.provider)
      setAvailableModels(providerInfo?.defaultModels || [])
      setModelsSource('builtin')
    } finally {
      setIsFetchingModels(false)
    }
  }, [formData.provider, formData.apiKeyId, imageProviders])

  // Fetch available models when provider or API key changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- model list is server state re-synced whenever provider/key change; the same callback backs the explicit Fetch Models button
    fetchModels()
  }, [fetchModels])

  // Ask the provider's plugin what this model's options look like, and
  // whether it takes LoRA adapters. A provider without the hook answers with
  // a null schema and the legacy hand-written panel below takes over.
  const providerKey = normalizeProviderName(formData.provider, imageProviders)
  const modelKey = formData.modelName
  useEffect(() => {
    let cancelled = false

    const fetchOptionsSchema = async () => {
      try {
        const url = new URL('/api/v1/image-profiles', window.location.origin)
        url.searchParams.set('action', 'options-schema')
        url.searchParams.set('provider', providerKey)
        if (modelKey) {
          url.searchParams.set('model', modelKey)
        }
        const res = await fetch(url.toString())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setOptionsSchema(data.optionsSchema ?? null)
        setLoraSupport(data.loraSupport ?? null)
      } catch {
        if (cancelled) return
        // Fall back to the legacy panel and no LoRA editor rather than
        // leaving a stale schema from the previous provider on screen.
        setOptionsSchema(null)
        setLoraSupport(null)
      }
    }

    // The schema is server state keyed on provider + model; it re-syncs
    // whenever either changes, and again once a live catalog fetch lands.
    fetchOptionsSchema()

    return () => {
      cancelled = true
    }
  }, [providerKey, modelKey, catalogVersion])

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (!formData.name.trim()) {
      errors.name = 'Profile name is required'
    }

    if (!formData.provider) {
      errors.provider = 'Provider is required'
    }

    if (!formData.modelName.trim()) {
      errors.modelName = 'Model name is required'
    }

    if (!formData.apiKeyId) {
      errors.apiKeyId = 'API key is required'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value
    const providerInfo = imageProviders.find(p => p.value === newProvider)
    setFormData(prev => ({
      ...prev,
      provider: newProvider,
      modelName: providerInfo?.defaultModels?.[0] || '',
      apiKeyId: '', // Reset API key when switching providers
      parameters: {}, // Reset parameters when switching providers
    }))
    setKeyValidationStatus(null)
    // The old provider's schema and LoRA cap describe a provider we have just
    // left; clear them rather than render them against the new one until the
    // refetch lands.
    setOptionsSchema(null)
    setLoraSupport(null)
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      apiKeyId: e.target.value,
    }))
    setKeyValidationStatus(null)
  }

  const handleValidateKey = async () => {
    if (!formData.apiKeyId) return

    try {
      setIsValidatingKey(true)
      const res = await fetch('/api/v1/image-profiles?action=validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: formData.provider,
          apiKeyId: formData.apiKeyId,
        }),
      })

      const data = await res.json()
      if (data.valid) {
        setKeyValidationStatus('✓ API key is valid')
      } else {
        setKeyValidationStatus(`✗ ${data.message || 'API key is invalid'}`)
      }
    } catch (err) {
      setKeyValidationStatus('✗ Failed to validate API key')
    } finally {
      setIsValidatingKey(false)
    }
  }

  const handleParametersChange = (params: Record<string, any>) => {
    setFormData(prev => ({
      ...prev,
      parameters: params,
    }))
  }

  const handleSetParameter = (key: string, value: unknown) => {
    setFormData(prev => {
      const next = { ...prev.parameters }
      // An empty box means "unset": storing '' would send a blank string to a
      // provider that reads the key's presence, not its truthiness.
      if (value === undefined || value === '') {
        delete next[key]
      } else {
        next[key] = value
      }
      return { ...prev, parameters: next }
    })
  }

  const currentLoras: ImageLoraSpec[] = Array.isArray(formData.parameters?.loras)
    ? (formData.parameters.loras as ImageLoraSpec[])
    : []

  const handleLorasChange = (loras: ImageLoraSpec[]) => {
    setFormData(prev => {
      const next = { ...prev.parameters }
      if (loras.length === 0) {
        delete next.loras
      } else {
        next.loras = loras
      }
      return { ...prev, parameters: next }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const url = profile
        ? `/api/v1/image-profiles/${profile.id}`
        : '/api/v1/image-profiles'

      const method = profile ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save image profile')
      }

      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const getAvailableApiKeys = () => {
    // Normalize the provider name to handle legacy values like GOOGLE_IMAGEN -> GOOGLE
    const normalizedProvider = normalizeProviderName(formData.provider, imageProviders)
    const providerInfo = imageProviders.find(p => p.value === normalizedProvider || p.value === formData.provider)
    const expectedKeyProvider = providerInfo?.apiKeyProvider || normalizedProvider

    return apiKeys.filter(key => {
      // Match API keys by the provider's expected key provider
      if (key.provider === expectedKeyProvider) return true
      // Also accept keys that match the normalized provider name
      if (key.provider === normalizedProvider) return true
      return false
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {/* Profile Name */}
      <div>
        <label className="qt-label mb-1">
          Profile Name
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., DALL-E 3 HD"
          className="qt-input"
        />
        {validationErrors.name && (
          <p className="qt-text-destructive text-sm mt-1">{validationErrors.name}</p>
        )}
      </div>

      {/* Provider Selection */}
      <div>
        <label className="qt-label mb-1">
          Provider
        </label>
        <select
          value={formData.provider}
          onChange={handleProviderChange}
          className="qt-select"
          disabled={isFetchingProviders}
        >
          {imageProviders.map(p => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {validationErrors.provider && (
          <p className="qt-text-destructive text-sm mt-1">{validationErrors.provider}</p>
        )}
      </div>

      {/* API Key Selection */}
      <div>
        <label className="qt-label mb-1">
          API Key
        </label>
        <div className="flex gap-2">
          <select
            value={formData.apiKeyId}
            onChange={handleApiKeyChange}
            className="flex-1 qt-select"
          >
            <option value="">Select an API key</option>
            {getAvailableApiKeys().map(key => (
              <option key={key.id} value={key.id}>
                {key.label} ({key.provider})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleValidateKey}
            disabled={!formData.apiKeyId || isValidatingKey}
            className="qt-button px-3 py-2 qt-button-primary"
          >
            {isValidatingKey ? 'Validating...' : 'Validate'}
          </button>
        </div>
        {validationErrors.apiKeyId && (
          <p className="qt-text-destructive text-sm mt-1">{validationErrors.apiKeyId}</p>
        )}
        {keyValidationStatus && (
          <p className={`text-sm mt-1 ${keyValidationStatus.startsWith('✓') ? 'qt-text-success' : 'qt-text-destructive'}`}>
            {keyValidationStatus}
          </p>
        )}
      </div>

      {/* Model Selection */}
      <div>
        <label className="qt-label mb-1">
          Model
        </label>
        <div className="flex gap-2">
          <select
            value={formData.modelName}
            onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
            disabled={isFetchingModels}
            className="flex-1 qt-select"
          >
            {(() => {
              const listed = availableModels.length > 0
                ? availableModels
                : (imageProviders.find(p => p.value === formData.provider)?.defaultModels || [])
              // Keep a saved model selectable even when the fetched list omits it
              const options = formData.modelName && !listed.includes(formData.modelName)
                ? [formData.modelName, ...listed]
                : listed
              return options.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            })()}
          </select>
          <button
            type="button"
            onClick={fetchModels}
            disabled={!formData.apiKeyId || isFetchingModels}
            title={formData.apiKeyId ? 'Query the provider for its image models' : 'Select an API key first'}
            className="qt-button px-3 py-2 qt-button-primary"
          >
            {isFetchingModels ? 'Fetching...' : 'Fetch Models'}
          </button>
        </div>
        {!isFetchingModels && modelsSource === 'provider' && (
          <p className="qt-text-success text-sm mt-1">
            ✓ {availableModels.length} image {availableModels.length === 1 ? 'model' : 'models'} fetched from the provider
          </p>
        )}
        {!isFetchingModels && modelsSource === 'builtin' && (
          <p className="qt-text-xs mt-1">
            {modelsFetchError
              ? `Couldn't fetch from the provider (${modelsFetchError}) — showing the plugin's built-in list.`
              : formData.apiKeyId
                ? "Showing the plugin's built-in model list."
                : "Showing the plugin's built-in model list — select an API key and Fetch Models to query the provider."}
          </p>
        )}
        {validationErrors.modelName && (
          <p className="qt-text-destructive text-sm mt-1">{validationErrors.modelName}</p>
        )}
      </div>

      {/* Provider-Specific Parameters.
          A plugin that declares an image options schema gets the shared,
          model-aware renderer — the same one the connection-profile editor
          uses. The hand-written switch below is only for providers whose
          plugins have not adopted the hook yet. */}
      {optionsSchema ? (
        <ProviderOptionsPanel
          schema={optionsSchema}
          parameters={formData.parameters}
          fetchedModels={availableModels}
          modelName={formData.modelName}
          onSetParameter={handleSetParameter}
        />
      ) : (
        <ImageProfileParameters
          provider={formData.provider}
          parameters={formData.parameters}
          onChange={handleParametersChange}
        />
      )}

      {/* LoRA adapters — shown only when this provider/model declares support */}
      <LoraListEditor
        support={loraSupport}
        loras={currentLoras}
        onChange={handleLorasChange}
        hfToken={
          typeof formData.parameters?.hf_api_token === 'string'
            ? formData.parameters.hf_api_token
            : undefined
        }
      />

      {/* Default Profile Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="isDefault"
          checked={formData.isDefault}
          onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
          className="h-4 w-4 rounded"
        />
        <label htmlFor="isDefault" className="ml-2 text-sm text-foreground">
          Set as default profile for image generation
        </label>
      </div>

      {/* Uncensored-Compatible Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="isDangerousCompatible"
          checked={formData.isDangerousCompatible}
          onChange={e => setFormData(prev => ({ ...prev, isDangerousCompatible: e.target.checked }))}
          className="h-4 w-4 rounded"
        />
        <label htmlFor="isDangerousCompatible" className="ml-2 text-sm text-foreground">
          Uncensored-compatible (suitable for dangerous/sensitive content routing)
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="qt-button px-4 py-2 qt-button-secondary"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="qt-button px-4 py-2 qt-button-primary"
        >
          {loading ? 'Saving...' : profile ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  )
}
