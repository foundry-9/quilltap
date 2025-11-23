'use client'

import { useState, useEffect } from 'react'
import { ImageProfileParameters } from './ImageProfileParameters'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  apiKey?: ApiKey | null
}

interface ImageProfileFormProps {
  profile?: ImageProfile
  apiKeys: ApiKey[]
  onSuccess?: () => void
  onCancel?: () => void
}

const IMAGE_PROVIDERS = [
  { value: 'OPENAI', label: 'OpenAI (DALL-E / GPT Image)' },
  { value: 'GROK', label: 'Grok (xAI)' },
  { value: 'GOOGLE_IMAGEN', label: 'Google Imagen' },
]

const PROVIDER_MODELS: Record<string, string[]> = {
  OPENAI: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
  GROK: ['grok-2-image'],
  GOOGLE_IMAGEN: ['imagen-4.0-generate-001', 'imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'],
}

export function ImageProfileForm({
  profile,
  apiKeys,
  onSuccess,
  onCancel,
}: ImageProfileFormProps) {
  const [formData, setFormData] = useState({
    name: profile?.name || '',
    provider: profile?.provider || 'OPENAI',
    apiKeyId: profile?.apiKeyId || '',
    baseUrl: profile?.baseUrl || '',
    modelName: profile?.modelName || 'dall-e-3',
    parameters: profile?.parameters || {},
    isDefault: profile?.isDefault || false,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isValidatingKey, setIsValidatingKey] = useState(false)
  const [keyValidationStatus, setKeyValidationStatus] = useState<string | null>(null)

  // Fetch available models when provider or API key changes
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setIsFetchingModels(true)
        const url = new URL('/api/image-profiles/models', window.location.origin)
        url.searchParams.set('provider', formData.provider)
        if (formData.apiKeyId) {
          url.searchParams.set('apiKeyId', formData.apiKeyId)
        }

        const res = await fetch(url.toString())
        if (res.ok) {
          const data = await res.json()
          setAvailableModels(data.models)
        } else {
          // Fall back to default models
          setAvailableModels(PROVIDER_MODELS[formData.provider] || [])
        }
      } catch (err) {
        // Fall back to default models on error
        setAvailableModels(PROVIDER_MODELS[formData.provider] || [])
      } finally {
        setIsFetchingModels(false)
      }
    }

    fetchModels()
  }, [formData.provider, formData.apiKeyId])

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
    setFormData(prev => ({
      ...prev,
      provider: newProvider as 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN',
      modelName: PROVIDER_MODELS[newProvider]?.[0] || '',
      parameters: {}, // Reset parameters when switching providers
    }))
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
      const res = await fetch('/api/image-profiles/validate-key', {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const url = profile
        ? `/api/image-profiles/${profile.id}`
        : '/api/image-profiles'

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
    return apiKeys.filter(key => {
      // OPENAI and GROK can use OPENAI/GROK API keys
      if (formData.provider === 'OPENAI' && key.provider === 'OPENAI') return true
      if (formData.provider === 'GROK' && key.provider === 'GROK') return true
      // Google Imagen can use any provider key (generic API keys)
      if (formData.provider === 'GOOGLE_IMAGEN') return true
      return false
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Profile Name */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">
          Profile Name
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., DALL-E 3 HD"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        {validationErrors.name && (
          <p className="text-red-600 text-sm mt-1">{validationErrors.name}</p>
        )}
      </div>

      {/* Provider Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">
          Provider
        </label>
        <select
          value={formData.provider}
          onChange={handleProviderChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          {IMAGE_PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {validationErrors.provider && (
          <p className="text-red-600 text-sm mt-1">{validationErrors.provider}</p>
        )}
      </div>

      {/* API Key Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">
          API Key
        </label>
        <div className="flex gap-2">
          <select
            value={formData.apiKeyId}
            onChange={handleApiKeyChange}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
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
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isValidatingKey ? 'Validating...' : 'Validate'}
          </button>
        </div>
        {validationErrors.apiKeyId && (
          <p className="text-red-600 text-sm mt-1">{validationErrors.apiKeyId}</p>
        )}
        {keyValidationStatus && (
          <p className={`text-sm mt-1 ${keyValidationStatus.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
            {keyValidationStatus}
          </p>
        )}
      </div>

      {/* Model Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">
          Model
        </label>
        <select
          value={formData.modelName}
          onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
          disabled={isFetchingModels}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          {(availableModels.length > 0 ? availableModels : PROVIDER_MODELS[formData.provider] || []).map(
            model => (
              <option key={model} value={model}>
                {model}
              </option>
            )
          )}
        </select>
        {validationErrors.modelName && (
          <p className="text-red-600 text-sm mt-1">{validationErrors.modelName}</p>
        )}
      </div>

      {/* Provider-Specific Parameters */}
      <ImageProfileParameters
        provider={formData.provider}
        parameters={formData.parameters}
        onChange={handleParametersChange}
      />

      {/* Default Profile Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="isDefault"
          checked={formData.isDefault}
          onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
          className="h-4 w-4 text-blue-600 rounded border-gray-300"
        />
        <label htmlFor="isDefault" className="ml-2 text-sm text-gray-700">
          Set as default profile for image generation
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Saving...' : profile ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  )
}
