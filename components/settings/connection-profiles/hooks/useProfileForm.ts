'use client'

import { useCallback } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { defaultMultiCharacterPrefill } from '@/lib/llm/multi-character-prefill'
import type { ProfileFormData, ConnectionProfile, ProviderConfig } from '../types'
import { initialFormState } from '../types'

/**
 * Hook for managing profile form state and operations
 * Handles form submission, connection testing, model fetching, and testing
 */
export function useProfileForm(providers: ProviderConfig[]) {
  const form = useFormState<ProfileFormData>(initialFormState)

  const saveOp = useAsyncOperation<any>()
  const connectOp = useAsyncOperation<any>()
  const fetchModelsOp = useAsyncOperation<any>()
  const testMessageOp = useAsyncOperation<any>()
  const autoConfigureOp = useAsyncOperation<any>()

  // Get provider config requirements - returns defaults if provider not found
  const getProviderRequirements = useCallback(
    (providerName: string) => {
      const provider = providers.find((p) => p.name === providerName)
      return {
        requiresApiKey: provider?.configRequirements?.requiresApiKey ?? true,
        requiresBaseUrl: provider?.configRequirements?.requiresBaseUrl ?? false,
        supportsWebSearch: provider?.capabilities?.webSearch ?? false,
        supportsToolUse: provider?.capabilities?.toolUse ?? false,
      }
    },
    [providers]
  )

  const resetForm = useCallback(() => {
    form.resetForm()
  }, [form])

  const loadProfileIntoForm = useCallback(
    (profile: ConnectionProfile) => {
      // Build the provider-options `parameters` map for the schema renderer.
      // Strip top-level form-managed keys (temperature/max_tokens/top_p)
      // and translate the legacy OpenRouter nested `providerPreferences`
      // shape into the flat keys the new schema exposes.
      const rawParams: Record<string, unknown> = { ...(profile.parameters ?? {}) }
      const TOP_LEVEL_KEYS = ['temperature', 'max_tokens', 'top_p'] as const
      for (const key of TOP_LEVEL_KEYS) delete rawParams[key]
      const legacyPrefs = rawParams.providerPreferences as
        | { dataCollection?: 'allow' | 'deny'; order?: string[] }
        | undefined
      if (legacyPrefs?.dataCollection === 'deny' && rawParams.enableZDR === undefined) {
        rawParams.enableZDR = true
      }
      delete rawParams.providerPreferences

      form.setFormData({
        name: profile.name,
        transport: (profile as { transport?: 'api' | 'courier' }).transport ?? 'api',
        courierDeltaMode: (profile as { courierDeltaMode?: boolean }).courierDeltaMode ?? true,
        provider: profile.provider,
        apiKeyId: profile.apiKeyId || '',
        baseUrl: profile.baseUrl || '',
        modelName: profile.modelName,
        temperature: profile.parameters?.temperature ?? 1,
        maxTokens: profile.parameters?.max_tokens ?? 1000,
        topP: profile.parameters?.top_p ?? 1,
        isDefault: profile.isDefault,
        isCheap: profile.isCheap ?? false,
        isDangerousCompatible: profile.isDangerousCompatible ?? false,
        allowToolUse: profile.allowToolUse ?? true,
        pseudoToolMode: profile.pseudoToolMode ?? 'auto',
        // Null means the profile predates the field; show the provider default
        // the server would resolve to, so the box reflects actual behaviour.
        multiCharacterPrefill:
          profile.multiCharacterPrefill ?? defaultMultiCharacterPrefill(profile.provider),
        supportsImageUpload: profile.supportsImageUpload ?? false,
        allowWebSearch: profile.allowWebSearch ?? false,
        useNativeWebSearch: profile.useNativeWebSearch ?? false,
        modelClass: profile.modelClass ?? '',
        maxContext: profile.maxContext ? String(profile.maxContext) : '',
        parameters: rawParams,
      })
    },
    [form]
  )

  const buildRequestBody = useCallback(() => {
    // The Courier transport: minimal request body. provider/apiKey/baseUrl
    // are not used by the server in this mode; modelName is free-form
    // informational text the user enters to identify which external LLM they
    // intend to copy the prompt to.
    if (form.formData.transport === 'courier') {
      return {
        name: form.formData.name,
        transport: 'courier',
        courierDeltaMode: form.formData.courierDeltaMode !== false,
        // Free-text label preserved as the provider field for display in
        // lists/badges; the server treats it as informational only.
        provider: form.formData.provider || 'COURIER',
        modelName: form.formData.modelName || 'Manual (clipboard)',
        apiKeyId: null,
        isDefault: form.formData.isDefault,
        isCheap: form.formData.isCheap,
        isDangerousCompatible: false,
        allowToolUse: false,
        // Not a tool flag — the Courier renders the same assembled context for
        // the user to carry by hand, so the turn anchor still applies.
        multiCharacterPrefill: form.formData.multiCharacterPrefill,
        supportsImageUpload: false,
        allowWebSearch: false,
        useNativeWebSearch: false,
        modelClass: null,
        maxContext: null,
        parameters: {},
      }
    }

    // Base parameters carry sampling controls; provider-specific options
    // come from the schema-driven `parameters` form field, which already
    // matches the wire-side key names each plugin reads.
    const parameters: Record<string, any> = {
      temperature: parseFloat(String(form.formData.temperature)),
      max_tokens: parseInt(String(form.formData.maxTokens)),
      top_p: parseFloat(String(form.formData.topP)),
      ...form.formData.parameters,
    }

    const requestBody: any = {
      name: form.formData.name,
      transport: 'api',
      provider: form.formData.provider,
      modelName: form.formData.modelName,
      isDefault: form.formData.isDefault,
      isCheap: form.formData.isCheap,
      isDangerousCompatible: form.formData.isDangerousCompatible,
      allowToolUse: form.formData.allowToolUse,
      pseudoToolMode: form.formData.pseudoToolMode,
      multiCharacterPrefill: form.formData.multiCharacterPrefill,
      supportsImageUpload: form.formData.supportsImageUpload,
      allowWebSearch: form.formData.allowWebSearch,
      useNativeWebSearch: form.formData.useNativeWebSearch,
      modelClass: form.formData.modelClass || null,
      maxContext: form.formData.maxContext ? parseInt(form.formData.maxContext, 10) : null,
      parameters,
    }

    // Always include apiKeyId when editing (to support changes)
    // Only include when truthy for new profiles
    if (form.formData.apiKeyId) {
      requestBody.apiKeyId = form.formData.apiKeyId
    } else {
      requestBody.apiKeyId = null
    }

    // Only include baseUrl if set
    if (form.formData.baseUrl) {
      requestBody.baseUrl = form.formData.baseUrl
    }

    return requestBody
  }, [form.formData])

  const handleConnect = useCallback(
    async (onSuccess?: (data: any) => void) => {
      const result = await connectOp.execute(async () => {
        // Validate required fields
        if (!form.formData.provider) {
          throw new Error('Provider is required')
        }

        const requirements = getProviderRequirements(form.formData.provider)

        if (requirements.requiresBaseUrl && !form.formData.baseUrl) {
          throw new Error('Base URL is required for this provider')
        }

        if (requirements.requiresApiKey && !form.formData.apiKeyId) {
          throw new Error('API Key is required for this provider')
        }

        // Test the connection
        const fetchResult = await fetchJson<any>('/api/v1/connection-profiles?action=test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: form.formData.provider,
            apiKeyId: form.formData.apiKeyId || undefined,
            baseUrl: form.formData.baseUrl || undefined,
          }),
        })

        if (!fetchResult.ok) {
          throw new Error(fetchResult.error || 'Connection test failed')
        }

        return fetchResult.data
      })

      if (result && onSuccess) {
        onSuccess(result)
      }

      return result
    },
    [form.formData, connectOp, getProviderRequirements]
  )

  const handleFetchModels = useCallback(
    async (onSuccess?: (data: any) => void) => {
      const result = await fetchModelsOp.execute(async () => {
        // Validate required fields based on provider
        const requirements = getProviderRequirements(form.formData.provider)
        if (requirements.requiresBaseUrl && !form.formData.baseUrl) {
          throw new Error('Base URL is required for this provider')
        }

        const fetchResult = await fetchJson<any>('/api/v1/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: form.formData.provider,
            apiKeyId: form.formData.apiKeyId || undefined,
            baseUrl: form.formData.baseUrl || undefined,
          }),
        })

        if (!fetchResult.ok) {
          throw new Error(fetchResult.error || 'Failed to fetch models')
        }

        return fetchResult.data
      })

      if (result && onSuccess) {
        onSuccess(result)
      }

      return result
    },
    [form.formData, fetchModelsOp, getProviderRequirements]
  )

  const handleTestMessage = useCallback(
    async (onSuccess?: (data: any) => void) => {
      const result = await testMessageOp.execute(async () => {
        // Validate model name
        if (!form.formData.modelName) {
          throw new Error('Model name is required')
        }

        const fetchResult = await fetchJson<any>('/api/v1/connection-profiles?action=test-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: form.formData.provider,
            apiKeyId: form.formData.apiKeyId || undefined,
            baseUrl: form.formData.baseUrl || undefined,
            modelName: form.formData.modelName,
            parameters: {
              temperature: parseFloat(String(form.formData.temperature)),
              max_tokens: parseInt(String(form.formData.maxTokens)),
              top_p: parseFloat(String(form.formData.topP)),
            },
          }),
        })

        if (!fetchResult.ok) {
          throw new Error(fetchResult.error || 'Test message failed')
        }

        return fetchResult.data
      })

      if (result && onSuccess) {
        onSuccess(result)
      }

      return result
    },
    [form.formData, testMessageOp]
  )

  const handleAutoConfigure = useCallback(
    async (onSuccess?: (data: any) => void) => {
      const result = await autoConfigureOp.execute(async () => {
        // Validate required fields
        if (!form.formData.provider) {
          throw new Error('Provider is required')
        }

        if (!form.formData.modelName) {
          throw new Error('Model name is required')
        }

        const fetchResult = await fetchJson<any>('/api/v1/connection-profiles?action=auto-configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: form.formData.provider,
            modelName: form.formData.modelName,
          }),
        })

        if (!fetchResult.ok) {
          throw new Error(fetchResult.error || 'Auto-configure failed')
        }

        return fetchResult.data
      })

      if (result && onSuccess) {
        onSuccess(result)
      }

      return result
    },
    [form.formData, autoConfigureOp]
  )

  const handleSubmit = useCallback(
    async (editingId: string | null, onSuccess?: () => void) => {
      const result = await saveOp.execute(async () => {
        const method = editingId ? 'PUT' : 'POST'
        const url = editingId ? `/api/v1/connection-profiles/${editingId}` : '/api/v1/connection-profiles'
        const requestBody = buildRequestBody()

        const fetchResult = await fetchJson<any>(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })

        if (!fetchResult.ok) {
          throw new Error(fetchResult.error || 'Failed to save profile')
        }

        return fetchResult.data
      })

      if (result && onSuccess) {
        onSuccess()
      }

      return result
    },
    [saveOp, buildRequestBody]
  )

  return {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    autoConfigureOp,
    getProviderRequirements,
    resetForm,
    loadProfileIntoForm,
    buildRequestBody,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleAutoConfigure,
    handleSubmit,
  }
}
