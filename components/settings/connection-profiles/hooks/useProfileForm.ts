'use client'

import { useCallback } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { defaultMultiCharacterPrefill } from '@/lib/llm/multi-character-prefill'
import type { ApiKey, ProfileFormData, ConnectionProfile, ProviderConfig } from '../types'
import { initialFormState } from '../types'

/**
 * Hook for managing profile form state and operations
 * Handles form submission, connection testing, model fetching, and testing
 *
 * `apiKeys` is the same list the modal's API Key select renders from; the form
 * needs it to tell a key it could currently *show* from one it merely still
 * holds (Bug 76). An empty list means "not loaded", never "no keys exist".
 */
export function useProfileForm(providers: ProviderConfig[], apiKeys: ApiKey[] = []) {
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

  /**
   * The base URL as it is allowed to leave the form.
   *
   * A provider that does not require one hides the field (`ProfileModal`'s
   * `showBaseUrl` gate), so whatever is still sitting in form state belongs to
   * a provider the user has since moved off — most often the `localhost:11434`
   * that selecting Ollama auto-filled. Sending it points every probe, and the
   * saved row, at the wrong endpoint with nothing on screen to explain it, and
   * no gesture that clears it (Bug 73). The value stays in form state so
   * switching back restores it; it simply never reaches the wire.
   *
   * A provider missing from `providers` is not evidence of anything —
   * the list has not loaded, or its fetch failed — so the stored value is left
   * alone there rather than clearing a working profile on a failed fetch.
   */
  const outboundBaseUrl = useCallback((): string => {
    const known = providers.find((p) => p.name === form.formData.provider)
    if (known && !known.configRequirements?.requiresBaseUrl) return ''
    return form.formData.baseUrl || ''
  }, [providers, form.formData.provider, form.formData.baseUrl])

  /**
   * The api key as it is allowed to leave the form. The exact twin of
   * `outboundBaseUrl`, one field over (Bug 76).
   *
   * `handleProviderChange` deliberately never clears `apiKeyId` — the value
   * stays in form state so switching back restores it — but the select cannot
   * express what is stored once the provider moves. On a keyless provider it is
   * not rendered at all; on a different hosted provider its options are
   * filtered to that provider, so the stored id matches nothing and the control
   * reads blank. Sending it anyway had the dialog saying no key was selected
   * while the wire carried one, and the save refused with
   * `API key provider does not match profile provider` — naming a field the
   * dialog does not show, with no gesture on a keyless provider that clears it.
   *
   * So: send only what the select could currently display. Absence is not
   * evidence in either list — a provider list that has not loaded is no reason
   * to judge the provider keyless, and an api-key list that has not loaded is
   * no reason to call a stored id undisplayable.
   */
  const outboundApiKeyId = useCallback((): string => {
    const stored = form.formData.apiKeyId || ''
    if (!stored) return ''

    const known = providers.find((p) => p.name === form.formData.provider)
    if (known && !known.configRequirements?.requiresApiKey) return ''

    // The select's own option filter, asked as a question.
    if (apiKeys.length > 0) {
      const displayable = apiKeys.some(
        (key) => key.id === stored && key.provider === form.formData.provider
      )
      if (!displayable) return ''
    }

    return stored
  }, [providers, apiKeys, form.formData.provider, form.formData.apiKeyId])

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

    // Always sent, never conditionally: `null` is how the row is *cleared* of a
    // key the current provider cannot use, so a profile that carried one across
    // a provider change — or arrived that way by import — heals on its next
    // save rather than being refused forever (Bug 76). Both handlers map a
    // null/absent value to a cleared column.
    requestBody.apiKeyId = outboundApiKeyId() || null

    // Always sent, never conditionally: an empty string is how the row is
    // *cleared* of a base URL the current provider does not take, so a profile
    // that picked one up from an earlier provider heals on its next save
    // rather than staying broken and invisible (Bug 73). Both the create and
    // the update handler map a falsy value to NULL.
    requestBody.baseUrl = outboundBaseUrl()

    return requestBody
  }, [form.formData, outboundBaseUrl, outboundApiKeyId])

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

        // Judged on what may leave, not on what is held: a key the select
        // cannot show is not a key the user chose for this provider, and
        // "API Key is required" is the honest thing to say about a blank
        // control (Bug 76).
        if (requirements.requiresApiKey && !outboundApiKeyId()) {
          throw new Error('API Key is required for this provider')
        }

        // Test the connection
        const fetchResult = await fetchJson<any>('/api/v1/connection-profiles?action=test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: form.formData.provider,
            apiKeyId: outboundApiKeyId() || undefined,
            baseUrl: outboundBaseUrl() || undefined,
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
    [form.formData, connectOp, getProviderRequirements, outboundBaseUrl, outboundApiKeyId]
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
            apiKeyId: outboundApiKeyId() || undefined,
            baseUrl: outboundBaseUrl() || undefined,
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
    [form.formData, fetchModelsOp, getProviderRequirements, outboundBaseUrl, outboundApiKeyId]
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
            apiKeyId: outboundApiKeyId() || undefined,
            baseUrl: outboundBaseUrl() || undefined,
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
    [form.formData, testMessageOp, outboundBaseUrl, outboundApiKeyId]
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
