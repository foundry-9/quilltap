'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import { TagEditor } from '@/components/tags/tag-editor'
import { BaseModal } from '@/components/ui/BaseModal'
import { ModelSelector, type ModelInfo } from '../model-selector'
import { getAttachmentSupportDescription, supportsMimeType } from '@/lib/llm/attachment-support'
import { FormActions } from '@/components/ui/FormActions'
import { MODEL_CLASSES, getModelClass } from '@/lib/llm/model-classes'
import type { ApiKey, ProviderConfig, ProfileFormData, ConnectionProfile } from './types'
import { ProviderOptionsPanel } from './ProviderOptionsPanel'
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names'
import { defaultMultiCharacterPrefill } from '@/lib/llm/multi-character-prefill'
import { evaluateThinkingTurn } from '@/lib/llm/thinking-turn'
import { providerAcceptsApiKey } from '@/lib/llm/api-key-support'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: ConnectionProfile | null
  apiKeys: ApiKey[]
  providers: ProviderConfig[]
  /** Normalized names already taken by other profiles (duplicate-name guard). */
  takenNames: Set<string>
  /**
   * Every profile the user owns — the candidate pool for the Fallback
   * dropdown. Optional: a modal rendered without it simply offers no
   * understudies, which is the right answer rather than a crash.
   */
  allProfiles?: ConnectionProfile[]
  form: {
    formData: ProfileFormData
    setField: (name: keyof ProfileFormData, value: any) => void
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
    resetForm: () => void
  }
  operations: {
    saveLoading: boolean
    connectLoading: boolean
    connectError: string | null
    fetchModelsLoading: boolean
    testMessageLoading: boolean
    autoConfigureLoading: boolean
    handleConnect: (callback: (data: any) => void) => Promise<any>
    handleFetchModels: (callback: (data: any) => void) => Promise<any>
    handleTestMessage: (callback: (data: any) => void) => Promise<any>
    handleAutoConfigure: (callback: (data: any) => void) => Promise<any>
    handleSubmit: (editingId: string | null, onSuccess: () => void) => Promise<any>
    getProviderRequirements: (provider: string) => any
  }
}

export function ProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  providers,
  takenNames,
  allProfiles = [],
  form,
  operations,
}: ProfileModalProps) {
  // Connection testing states
  const [isConnected, setIsConnected] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  // Fetch models states
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchedModelsWithInfo, setFetchedModelsWithInfo] = useState<ModelInfo[]>([])
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)

  // Test message states
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  // Auto-configure states
  const [autoConfigureMessage, setAutoConfigureMessage] = useState<string | null>(null)

  // Note: No need for state reset effect - modal is keyed by profile.id so it remounts fresh

  // A stored row can carry a base URL its provider does not take — every
  // profile saved before Bug 73 was fixed, and any import. Reading the
  // requirement here rather than the row's truthiness keeps the edit-time
  // model fetch off the wrong endpoint; the next save clears the row. A
  // provider the list does not know about (not loaded, or the fetch failed)
  // keeps its stored URL — absence is not evidence.
  const savedProvider = providers.find((p) => p.name === profile?.provider)
  const savedProviderTakesBaseUrl =
    !savedProvider || (savedProvider.configRequirements?.requiresBaseUrl ?? false)
  // The same reading for the api key (Bug 76): a row written before that fix —
  // or by import — can carry a key its provider does not take, and probing a
  // keyless endpoint with one is how the mismatch stays invisible. The question
  // is whether the provider *takes* a key, not whether it demands one — an
  // OpenAI-Compatible profile aimed at a hosted endpoint holds an optional one
  // (Bug 81).
  const savedProviderTakesApiKey =
    !savedProvider || providerAcceptsApiKey(savedProvider.configRequirements)

  // Auto-fetch models when editing
  useEffect(() => {
    if (isOpen && profile?.id) {
      const fetchModelsForEdit = async () => {
        try {
          const result = await fetchJson<any>('/api/v1/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: profile.provider,
              apiKeyId: (savedProviderTakesApiKey && profile.apiKeyId) || undefined,
              baseUrl: (savedProviderTakesBaseUrl && profile.baseUrl) || undefined,
            }),
          })
          if (result.ok) {
            setFetchedModels(result.data?.models || [])
            setFetchedModelsWithInfo(result.data?.modelsWithInfo || [])
            setModelsMessage(`Found ${result.data?.models?.length || 0} models`)
          }
        } catch {
          // Silently ignore
        }
      }
      fetchModelsForEdit()
    }
  }, [
    isOpen,
    profile?.id,
    profile?.provider,
    profile?.apiKeyId,
    profile?.baseUrl,
    savedProviderTakesBaseUrl,
    savedProviderTakesApiKey,
  ])

  const handleConnectClick = useCallback(async () => {
    const result = await operations.handleConnect((data) => {
      setIsConnected(true)
      setConnectionMessage(data.message || 'Connection successful!')
    })
    if (!result) {
      setIsConnected(false)
      setConnectionMessage(null)
    }
  }, [operations])

  const handleFetchModelsClick = useCallback(async () => {
    const result = await operations.handleFetchModels((data) => {
      setFetchedModels(data.models || [])
      setFetchedModelsWithInfo(data.modelsWithInfo || [])
      setModelsMessage(`Found ${data.models?.length || 0} models`)
    })
    if (!result) {
      setFetchedModels([])
      setModelsMessage(null)
    }
  }, [operations])

  const handleTestMessageClick = useCallback(async () => {
    const result = await operations.handleTestMessage((data) => {
      setTestMessageResult(data.message || 'Test message sent successfully!')
    })
    if (!result) {
      setTestMessageResult(null)
    }
  }, [operations])

  const handleAutoConfigureClick = useCallback(async () => {
    const result = await operations.handleAutoConfigure((data) => {
      form.setField('temperature', data.suggestions.temperature)
      form.setField('maxTokens', data.suggestions.maxTokens)
      form.setField('topP', data.suggestions.topP)
      form.setField('maxContext', String(data.suggestions.maxContext))
      form.setField('modelClass', data.suggestions.modelClass)
      form.setField('isDangerousCompatible', data.suggestions.isDangerousCompatible)
      setAutoConfigureMessage('Configuration applied successfully!')
    })
    if (!result) {
      setAutoConfigureMessage(null)
    }
  }, [operations, form])

  const handleFormSubmit = async () => {
    const result = await operations.handleSubmit(profile?.id || null, () => {
      onSuccess()
      onClose()
    })
    return result
  }

  const handleClose = () => {
    form.resetForm()
    onClose()
  }

  const getModelSuggestions = (provider: string): string[] => {
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
      ANTHROPIC: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805'],
      GOOGLE: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-1.0-pro', 'gemini-pro-vision'],
      GROK: ['grok-beta', 'grok-2', 'grok-vision-beta'],
      OLLAMA: ['llama2', 'neural-chat', 'mistral'],
      OPENROUTER: ['openai/gpt-4', 'anthropic/claude-2', 'meta-llama/llama-2-70b'],
      OPENAI_COMPATIBLE: ['gpt-3.5-turbo'],
    }
    return (models[provider] || ['gpt-3.5-turbo']).sort()
  }

  const getSelectedModelInfo = useCallback(() => {
    if (!form.formData.modelName || fetchedModelsWithInfo.length === 0) return null
    return fetchedModelsWithInfo.find((m) => m.id === form.formData.modelName) || null
  }, [form.formData.modelName, fetchedModelsWithInfo])

  const getMaxTokensLimit = useCallback(() => {
    const modelInfo = getSelectedModelInfo()
    return modelInfo?.maxOutputTokens || 128000
  }, [getSelectedModelInfo])

  const reqs = operations.getProviderRequirements(form.formData.provider)
  const isCourier = form.formData.transport === 'courier'
  // Names must be unique per user (case-insensitive). `takenNames` already
  // excludes the profile being edited, so re-saving an unchanged name is fine.
  const nameTaken =
    form.formData.name.trim().length > 0 &&
    takenNames.has(normalizeProfileName(form.formData.name))
  const isValid = form.formData.name.trim() && form.formData.modelName.trim() && !nameTaken

  // Eligible understudies: anyone but this profile and the Courier profiles.
  // A cycle (A names B, B names A) is deliberately allowed — chains never
  // recurse, so B's own understudy is not followed and the cycle simply stops.
  const fallbackCandidates = allProfiles.filter(
    (p) => p.id !== profile?.id && p.transport !== 'courier'
  )
  const selectedFallbackProfile = form.formData.fallbackProfileId
    ? allProfiles.find((p) => p.id === form.formData.fallbackProfileId) ?? null
    : null
  // A soft warning, never a block: keys can arrive later, and a provider that
  // takes none at all is perfectly ready as it stands.
  const fallbackTargetHasKey = selectedFallbackProfile
    ? !!selectedFallbackProfile.apiKeyId ||
      !providerAcceptsApiKey(
        providers.find((p) => p.name === selectedFallbackProfile.provider)?.configRequirements
      )
    : true

  // Active provider's options schema (if the plugin exposes one)
  const activeProviderConfig = providers.find((p) => p.name === form.formData.provider)
  const optionsSchema = activeProviderConfig?.optionsSchema ?? null

  // Will this profile run a thinking turn? Same evaluator the server runs, fed
  // the plugin's declared rule and the selected model's static facts — which
  // is why the rule is declarative rather than a plugin closure (bug 85). It
  // decides the multi-character prefill default below, and the warning that
  // goes with it.
  const runsThinkingTurn = evaluateThinkingTurn({
    rule: activeProviderConfig?.thinkingTurnRule ?? null,
    parameters: form.formData.parameters,
    model: getSelectedModelInfo(),
  })

  // A stored row that never chose (null — pre-4.9, or an import) shows the
  // provider default until the model list arrives, because the thinking half
  // of the answer needs the model's static facts. Correct it once, so the box
  // matches what the server will actually do and a save cannot freeze the
  // wrong answer into the column (bug 85). Only ever fires for a null row, so
  // it can never overwrite a choice the user made.
  const storedPrefillIsUnset =
    profile?.id !== undefined && (profile.multiCharacterPrefill ?? null) === null
  useEffect(() => {
    if (!storedPrefillIsUnset || fetchedModelsWithInfo.length === 0) return
    form.setField(
      'multiCharacterPrefill',
      defaultMultiCharacterPrefill(form.formData.provider, runsThinkingTurn)
    )
    // Re-running on every keystroke would fight the checkbox; the model list
    // landing is the one event that changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedPrefillIsUnset, fetchedModelsWithInfo, runsThinkingTurn])

  // Directive state: schema fields marked `affects: 'modelInput'` toggle
  // between ModelSelector and free-text entry. The panel writes the
  // parameter through `setParameter` and fires the directive in lockstep,
  // so deriving directly from the parameter map keeps the model input in
  // sync without an extra useState/useEffect.
  const useCustomModelDirective = form.formData.parameters?.useCustomModel === true

  const setParameter = useCallback(
    (key: string, value: unknown) => {
      const next = { ...form.formData.parameters }
      if (value === undefined) {
        delete next[key]
      } else {
        next[key] = value
      }
      form.setField('parameters', next)
    },
    [form]
  )

  // Handle provider change - auto-fill base URL for providers that have defaults
  const handleProviderChange = (newProvider: string) => {
    form.setField('provider', newProvider)

    // Auto-fill base URL for providers with defaults
    const providerConfig = providers.find(p => p.name === newProvider)
    if (providerConfig?.configRequirements?.baseUrlDefault && !form.formData.baseUrl) {
      form.setField('baseUrl', providerConfig.configRequirements.baseUrlDefault)
    }

    // Auto-default allowToolUse and supportsImageUpload based on provider capability
    // (new profiles only — don't clobber saved values on an existing profile).
    //
    // `toolUse` is a SEED, never a clamp: the checkbox below stays editable
    // whatever the capability says. An OpenAI-compatible endpoint declares
    // `false` because an arbitrary endpoint is the conservative case, but a user
    // pointing at llama-server --jinja knows better than we do (Bug 71).
    if (!profile?.id) {
      const supportsToolUse = providerConfig?.capabilities?.toolUse ?? false
      form.setField('allowToolUse', supportsToolUse)
      // Only the providers that take a base URL may be judged by one — on the
      // rest the field is hidden and its value belongs to a provider the user
      // has moved off (Bug 73).
      const takesBaseUrl = providerConfig?.configRequirements?.requiresBaseUrl ?? false
      form.setField(
        'supportsImageUpload',
        supportsMimeType(
          newProvider as any,
          'image/jpeg',
          (takesBaseUrl && form.formData.baseUrl) || undefined
        )
      )
      // No model is chosen yet at this point, so only the provider rule can
      // speak; `handleModelChange` re-seeds once the model is known and its
      // thinking habit can be read.
      form.setField('multiCharacterPrefill', defaultMultiCharacterPrefill(newProvider))
    }
  }

  // Handle model change - auto-fill name if empty (new profile only)
  const handleModelChange = (modelName: string) => {
    form.setField('modelName', modelName)

    // Re-seed the multi-character turn anchor now the model is known: a model
    // that reasons unasked (deepseek-v4-flash) breaks on a `[Name]` prefill,
    // and the user never opted into thinking so nothing else would warn them
    // (bug 85). A seed, never a clamp — the box below stays editable.
    if (!profile?.id) {
      const modelInfo = fetchedModelsWithInfo.find((m) => m.id === modelName) || null
      form.setField(
        'multiCharacterPrefill',
        defaultMultiCharacterPrefill(
          form.formData.provider,
          evaluateThinkingTurn({
            rule: activeProviderConfig?.thinkingTurnRule ?? null,
            parameters: form.formData.parameters,
            model: modelInfo,
          })
        )
      )
    }

    // Auto-fill name with PROVIDER/MODEL if name is empty and this is a new
    // profile. A second profile on the same provider+model is exactly the
    // case where the obvious name collides, so suffix it until it's unique.
    if (!profile?.id && !form.formData.name.trim() && modelName.trim()) {
      const suggested = makeUniqueProfileName(`${form.formData.provider}/${modelName}`, takenNames)
      form.setField('name', suggested)
    }
  }

  const footer = (
    <FormActions
      onCancel={handleClose}
      onSubmit={handleFormSubmit}
      submitLabel={operations.saveLoading ? 'Saving...' : profile?.id ? 'Update Profile' : 'Create Profile'}
      isLoading={operations.saveLoading}
      isDisabled={!isValid}
    />
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={profile?.id ? 'Edit Connection Profile' : 'Create Connection Profile'}
      maxWidth="3xl"
      footer={footer}
    >
      <div className="space-y-4">
            {/* Transport selector */}
            <div>
              <label htmlFor="transport" className="block qt-text-label mb-2">
                Transport *
              </label>
              <select
                id="transport"
                name="transport"
                value={form.formData.transport}
                onChange={(e) => form.setField('transport', e.target.value as 'api' | 'courier')}
                className="qt-select"
              >
                <option value="api">API (provider-backed)</option>
                <option value="courier">The Courier (manual / clipboard)</option>
              </select>
              <p className="qt-text-xs mt-1">
                {isCourier
                  ? 'Manual / clipboard mode. Quilltap will render each LLM call as Markdown for you to carry by hand to an external LLM. No API key, no tools — just copy out and paste back.'
                  : 'Standard provider-backed mode. Quilltap calls the LLM directly using the API key and base URL you configure below.'}
              </p>
            </div>

            {/* Name and Provider Row */}
            <div className={isCourier ? '' : 'grid grid-cols-2 gap-4'}>
              <div>
                <label htmlFor="name" className="block qt-text-label mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={form.formData.name}
                  onChange={(e) => form.setField('name', e.target.value)}
                  placeholder={isCourier ? 'e.g., Claude desktop courier' : 'e.g., My GPT-4 Profile'}
                  className="qt-input"
                  autoFocus
                />
                {nameTaken && (
                  <p className="qt-text-destructive qt-text-xs mt-1">
                    Another connection profile already bears this name. Names must be unique.
                  </p>
                )}
              </div>

              {!isCourier && (
                <div>
                  <label htmlFor="provider" className="block qt-text-label mb-2">
                    Provider *
                  </label>
                  <select
                    id="provider"
                    name="provider"
                    value={form.formData.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="qt-select"
                  >
                    {providers.length > 0 ? (
                      providers
                        .filter((p) => p.capabilities?.chat)
                        .map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.displayName}
                          </option>
                        ))
                    ) : (
                      <>
                        <option value="OPENAI">OpenAI</option>
                        <option value="ANTHROPIC">Anthropic</option>
                        <option value="GOOGLE">Google</option>
                        <option value="GROK">Grok</option>
                        <option value="OLLAMA">Ollama</option>
                        <option value="OPENROUTER">OpenRouter</option>
                        <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
                      </>
                    )}
                  </select>
                  <p className="qt-text-xs mt-1">
                    Non-image attachments: {getAttachmentSupportDescription(form.formData.provider as any, (reqs.requiresBaseUrl && form.formData.baseUrl) || undefined)}
                  </p>
                </div>
              )}
            </div>

            {isCourier && (
              <>
                <div>
                  <label htmlFor="courierModelNameModal" className="block qt-text-label mb-2">
                    Which LLM will you carry to? (informational)
                  </label>
                  <input
                    type="text"
                    id="courierModelNameModal"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={(e) => form.setField('modelName', e.target.value)}
                    placeholder="e.g., Claude Opus 4.7, ChatGPT o3, Local Llama via LM Studio"
                    className="qt-input"
                  />
                  <p className="qt-text-xs mt-1">
                    Free text — appears on the placeholder bubble so you remember which LLM to paste into. Quilltap does not validate or call it.
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="courierIsDefaultModal"
                      checked={form.formData.isDefault}
                      onChange={(e) => form.setField('isDefault', e.target.checked)}
                      className="qt-checkbox"
                    />
                    <label htmlFor="courierIsDefaultModal" className="text-sm">
                      Set as default profile
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="courierIsCheapModal"
                      checked={form.formData.isCheap}
                      onChange={(e) => form.setField('isCheap', e.target.checked)}
                      className="qt-checkbox"
                    />
                    <label htmlFor="courierIsCheapModal" className="text-sm">
                      Mark as cheap LLM (memory extraction, danger classification, etc.)
                    </label>
                  </div>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="courierDeltaModeModal"
                      checked={form.formData.courierDeltaMode}
                      onChange={(e) => form.setField('courierDeltaMode', e.target.checked)}
                      className="qt-checkbox mt-0.5"
                    />
                    <label htmlFor="courierDeltaModeModal" className="text-sm">
                      <span className="block">Delta mode after first turn</span>
                      <span className="qt-text-xs">After the character&apos;s first paste-back in a chat, render only what&apos;s new since the last reply — the desktop LLM remembers the rest. The bubble still keeps a full-context fallback you can swap to if your destination LLM has lost the conversation.</span>
                    </label>
                  </div>
                </div>

                <div className="qt-text-xs">
                  The Courier does not expose tools, web search, or image uploads. Memories, character manifestos, scene state, and wardrobe context are all still bundled into the prompt as normal — the external LLM just doesn&apos;t have any way to call back into Quilltap.
                </div>

                {profile?.id && (
                  <div className="pt-4">
                    <TagEditor entityType="profile" entityId={profile.id} />
                  </div>
                )}
              </>
            )}

            {/* API Key and Base URL Fields — API transport only */}
            {!isCourier && (() => {
              // Shown when the provider *takes* a key; starred only when it
              // demands one. OpenAI-Compatible is the provider where those
              // differ — a hosted endpoint needs a bearer token, a local
              // llama.cpp has nowhere to put one — so its field is offered and
              // optional rather than absent (Bug 81).
              const showApiKey = reqs.acceptsApiKey
              const showBaseUrl = reqs.requiresBaseUrl
              const showBoth = showApiKey && showBaseUrl

              return (
                <div className={showBoth ? 'grid grid-cols-2 gap-4' : ''}>
                  {showApiKey && (
                    <div>
                      <label htmlFor="apiKeyId" className="block qt-text-label mb-2">
                        {reqs.requiresApiKey ? 'API Key *' : 'API Key'}
                      </label>
                      <select
                        id="apiKeyId"
                        name="apiKeyId"
                        value={form.formData.apiKeyId}
                        onChange={(e) => form.setField('apiKeyId', e.target.value)}
                        className="qt-select"
                      >
                        <option value="">
                          {reqs.requiresApiKey ? 'Select an API Key' : 'None — the endpoint needs no key'}
                        </option>
                        {(apiKeys || [])
                          .filter((key) => key.provider === form.formData.provider)
                          .map((key) => (
                            <option key={key.id} value={key.id}>
                              {key.label}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {showBaseUrl && (
                    <div>
                      <label htmlFor="baseUrl" className="block qt-text-label mb-2">
                        Base URL *
                      </label>
                      <input
                        type="url"
                        id="baseUrl"
                        name="baseUrl"
                        value={form.formData.baseUrl}
                        onChange={(e) => form.setField('baseUrl', e.target.value)}
                        placeholder="http://localhost:11434"
                        className="qt-input"
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Connection Testing Section — API transport only */}
            {!isCourier && (
            <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
              <h4 className="font-medium text-sm mb-3">Connection Testing</h4>

              <div className="flex flex-wrap gap-3 mb-3">
                <button
                  type="button"
                  onClick={handleConnectClick}
                  disabled={operations.connectLoading}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.connectLoading ? 'Connecting...' : 'Connect'}
                </button>

                <button
                  type="button"
                  onClick={handleFetchModelsClick}
                  disabled={(() => {
                    if (operations.fetchModelsLoading) return true
                    if (reqs.requiresBaseUrl && !form.formData.baseUrl) return true
                    if (reqs.requiresApiKey && !isConnected) return true
                    return false
                  })()}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.fetchModelsLoading ? 'Fetching...' : 'Fetch Models'}
                </button>

                <button
                  type="button"
                  onClick={handleTestMessageClick}
                  disabled={!isConnected || operations.testMessageLoading || !form.formData.modelName}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.testMessageLoading ? 'Testing...' : 'Test Message'}
                </button>

                <button
                  type="button"
                  onClick={handleAutoConfigureClick}
                  disabled={!form.formData.modelName || operations.autoConfigureLoading}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.autoConfigureLoading ? 'Auto-Configuring...' : 'Auto-Configure'}
                </button>
              </div>

              {/* Status messages */}
              {connectionMessage && (
                <div className="text-sm qt-alert-success">
                  ✓ {connectionMessage}
                </div>
              )}

              {operations.connectError && (
                <div className="text-sm qt-alert-destructive">
                  ✗ {operations.connectError}
                </div>
              )}

              {modelsMessage && (
                <div className="text-sm qt-alert-info">
                  ✓ {modelsMessage}
                </div>
              )}

              {testMessageResult && (
                <div className="text-sm qt-alert-info">
                  ✓ {testMessageResult}
                </div>
              )}

              {autoConfigureMessage && (
                <div className="text-sm qt-alert-success">
                  {autoConfigureMessage}
                </div>
              )}

              <p className="qt-text-xs mt-2">
                1. Click Connect to test the connection • 2. Fetch Models • 3. Test Message to verify
              </p>
            </div>
            )}

            {/* Model Selection — API transport only */}
            {!isCourier && (
            <div>
              <label htmlFor="modelName" className="block qt-text-label mb-2">
                Model *
              </label>
              {useCustomModelDirective ? (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="e.g., openai/gpt-4-turbo"
                    list="modelSuggestions"
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {fetchedModels.length > 0
                      ? fetchedModels.map((model) => <option key={model} value={model} />)
                      : getModelSuggestions(form.formData.provider).map((model) => (
                          <option key={model} value={model} />
                        ))}
                  </datalist>
                </>
              ) : fetchedModels.length > 0 ? (
                <ModelSelector
                  models={fetchedModels}
                  modelsWithInfo={fetchedModelsWithInfo}
                  value={form.formData.modelName}
                  onChange={handleModelChange}
                  placeholder="Select or search a model"
                  required
                  showFetchedCount
                />
              ) : (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="e.g., gpt-4"
                    list="modelSuggestions"
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {getModelSuggestions(form.formData.provider).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              )}
            </div>
            )}

            {/* Model Parameters — API transport only */}
            {!isCourier && (
            <div className="border-t qt-border-default pt-4">
              <h4 className="font-medium text-sm mb-3">Model Parameters (Optional)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="temperature" className="block qt-text-label mb-2">
                    Temperature ({form.formData.temperature})
                  </label>
                  <input
                    type="range"
                    id="temperature"
                    min="0"
                    max="2"
                    step="0.1"
                    value={form.formData.temperature}
                    onChange={(e) => form.setField('temperature', parseFloat(e.target.value))}
                    className="qt-range w-full"
                  />
                  <p className="qt-text-xs mt-1">0 = deterministic, 2 = creative</p>
                </div>

                <div>
                  <label htmlFor="maxTokens" className="block qt-text-label mb-2">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    id="maxTokens"
                    value={form.formData.maxTokens}
                    onChange={(e) => form.setField('maxTokens', parseInt(e.target.value))}
                    min="1"
                    max={getMaxTokensLimit()}
                    className="qt-input"
                  />
                  <p className="qt-text-xs mt-1">
                    {getSelectedModelInfo()?.maxOutputTokens
                      ? `Reported model limit: ${getSelectedModelInfo()?.maxOutputTokens?.toLocaleString()}`
                      : 'Max output tokens'}
                  </p>
                </div>

                <div>
                  <label htmlFor="topP" className="block qt-text-label mb-2">
                    Top P ({form.formData.topP})
                  </label>
                  <input
                    type="range"
                    id="topP"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.formData.topP}
                    onChange={(e) => form.setField('topP', parseFloat(e.target.value))}
                    className="qt-range w-full"
                  />
                  <p className="qt-text-xs mt-1">Nucleus sampling (0-1)</p>
                </div>
              </div>
            </div>
            )}

            {/* Checkboxes — API transport only (Courier has its own minimal pair above) */}
            {!isCourier && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={form.formData.isDefault}
                  onChange={(e) => form.setField('isDefault', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="isDefault" className="text-sm">
                  Set as default profile
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isCheap"
                  checked={form.formData.isCheap}
                  onChange={(e) => form.setField('isCheap', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="isCheap" className="text-sm">
                  Mark as cheap LLM (for cost-effective tasks)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDangerousCompatible"
                  checked={form.formData.isDangerousCompatible}
                  onChange={(e) => form.setField('isDangerousCompatible', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="isDangerousCompatible" className="text-sm">
                  Uncensored-compatible (suitable for dangerous/sensitive content routing)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowToolUse"
                  checked={form.formData.allowToolUse}
                  onChange={(e) => form.setField('allowToolUse', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="allowToolUse" className="text-sm">
                  Allow tool use (overrides chat and project tool settings when disabled)
                </label>
              </div>
              {!reqs.supportsToolUse && (
                <p className="qt-text-xs ml-6">
                  This provider does not advertise tool support, so new profiles start with it off.
                  If your endpoint does speak native function calling — llama-server with
                  <code> --jinja</code>, vLLM, LM Studio — you may turn it on regardless.
                </p>
              )}
              {form.formData.allowToolUse && (
                <div className="flex flex-col gap-1 ml-6">
                  <label htmlFor="pseudoToolMode" className="text-sm">
                    Tool format
                  </label>
                  <select
                    id="pseudoToolMode"
                    value={form.formData.pseudoToolMode}
                    onChange={(e) =>
                      form.setField(
                        'pseudoToolMode',
                        e.target.value as 'auto' | 'native' | 'simple-json' | 'text-block',
                      )
                    }
                    className="qt-select w-full max-w-md"
                    title="How tool calls are framed on the wire. Auto picks the right format for the model; simple-json is the new pseudo-tool surface for models without native function calling; text-block is the legacy format kept for compatibility."
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="native">Native function calling</option>
                    <option value="simple-json">Simple JSON (&lt;tool_call&gt;…)</option>
                    <option value="text-block">Text-block ([[TOOL ...]]) — legacy</option>
                  </select>
                  <p className="qt-text-xs mt-1">
                    Auto: native for capable models, otherwise simple JSON. Override only if your model needs a particular dialect.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="multiCharacterPrefill"
                    checked={form.formData.multiCharacterPrefill}
                    onChange={(e) => form.setField('multiCharacterPrefill', e.target.checked)}
                    className="qt-checkbox"
                  />
                  <label htmlFor="multiCharacterPrefill" className="text-sm">
                    Announce the speaker in multi-character scenes ([Name] prefill)
                  </label>
                </div>
                <p className="qt-text-xs ml-6">
                  Ticked, a multi-character turn is handed to the model already opened with{' '}
                  <code>[Name]</code>, so it can only continue that character&apos;s line. Unticked, the
                  same instruction is given in prose and the model is left to begin the turn itself.
                  Untick it for models that refuse an opened turn outright, for local thinking models
                  whose reasoning never appears (an opened turn closes that door), and for any model
                  that spends its reply wondering whether the name was addressed to it.
                </p>
                {form.formData.multiCharacterPrefill &&
                  !defaultMultiCharacterPrefill(form.formData.provider) && (
                    <p className="qt-text-xs qt-text-warning ml-6">
                      Anthropic&apos;s recent models reject a request handed over mid-turn and will
                      return an error on every multi-character reply. Leave this unticked unless you
                      know your model tolerates it.
                    </p>
                  )}
                {form.formData.multiCharacterPrefill &&
                  defaultMultiCharacterPrefill(form.formData.provider) &&
                  runsThinkingTurn && (
                    <p className="qt-text-xs qt-text-warning ml-6">
                      This model reasons before it answers, and a turn handed over already opened
                      sits badly with that: some providers refuse the request outright, others
                      quietly swallow the reasoning altogether. A model that deliberates over whose
                      turn it is rarely needs the name put in its mouth — leave this unticked unless
                      you have watched yours cope.
                    </p>
                  )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="supportsImageUpload"
                  checked={form.formData.supportsImageUpload}
                  onChange={(e) => form.setField('supportsImageUpload', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="supportsImageUpload" className="text-sm">
                  Supports image attachments (vision input)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowWebSearch"
                  checked={form.formData.allowWebSearch}
                  onChange={(e) => form.setField('allowWebSearch', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="allowWebSearch" className="text-sm">
                  Allow web search tool
                </label>
              </div>
              {reqs.supportsWebSearch && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useNativeWebSearch"
                    checked={form.formData.useNativeWebSearch}
                    onChange={(e) => form.setField('useNativeWebSearch', e.target.checked)}
                    className="qt-checkbox"
                  />
                  <label htmlFor="useNativeWebSearch" className="text-sm">
                    Use provider native web search
                  </label>
                </div>
              )}
            </div>
            )}

            {/* Model Class and Max Context — API transport only */}
            {!isCourier && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="modelClass" className="block qt-text-label mb-2">
                  Model Class
                </label>
                <select
                  id="modelClass"
                  name="modelClass"
                  value={form.formData.modelClass}
                  onChange={(e) => form.setField('modelClass', e.target.value)}
                  className="qt-select"
                >
                  <option value="">(None)</option>
                  {MODEL_CLASSES.map((mc) => (
                    <option key={mc.name} value={mc.name}>
                      {mc.name} (Tier {mc.tier})
                    </option>
                  ))}
                </select>
                {form.formData.modelClass && (() => {
                  const mc = getModelClass(form.formData.modelClass)
                  if (!mc) return null
                  return (
                    <p className="qt-text-xs mt-1">
                      Context: {mc.maxContext.toLocaleString()} | Output: {mc.maxOutput.toLocaleString()} | Quality: {mc.quality} | Tags: {mc.tags.join(', ')}
                    </p>
                  )
                })()}
              </div>
              <div>
                <label htmlFor="maxContext" className="block qt-text-label mb-2">
                  Max Context (tokens)
                </label>
                <input
                  type="number"
                  id="maxContext"
                  name="maxContext"
                  value={form.formData.maxContext}
                  onChange={(e) => form.setField('maxContext', e.target.value)}
                  placeholder="e.g., 128000"
                  min="1"
                  className="qt-input"
                />
                <p className="qt-text-xs mt-1">
                  Override context window size. Leave blank to use provider default.
                </p>
              </div>
            </div>
            )}

            {/* Fallback — the understudies. API transport only: a Courier
                request is carried by hand, so nothing about it can stand in
                automatically. Sits next to Model Class because the tier
                toggle below is only as good as that field. */}
            {!isCourier && (
            <div className="qt-card p-4 space-y-3">
              <div>
                <h4 className="qt-text-label">Fallback</h4>
                <p className="qt-text-xs mt-1">
                  Should this connection be indisposed — a refused key, a rate limit, a
                  provider gone dark — the show need not come down. Name an understudy and
                  the call is passed along without a word to anyone.
                </p>
              </div>

              <div>
                <label htmlFor="fallbackProfileId" className="block qt-text-label mb-2">
                  Understudy
                </label>
                <select
                  id="fallbackProfileId"
                  name="fallbackProfileId"
                  value={form.formData.fallbackProfileId}
                  onChange={(e) => form.setField('fallbackProfileId', e.target.value)}
                  className="qt-select"
                >
                  <option value="">(None — the call simply fails)</option>
                  {fallbackCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.provider} {p.modelName}
                    </option>
                  ))}
                </select>
                {selectedFallbackProfile && !fallbackTargetHasKey && (
                  <p className="qt-text-xs qt-text-warning mt-1">
                    {selectedFallbackProfile.name} has no API key attached yet. The
                    understudy will be skipped until one arrives.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowTierFallback"
                  name="allowTierFallback"
                  checked={form.formData.allowTierFallback}
                  onChange={(e) => form.setField('allowTierFallback', e.target.checked)}
                  className="qt-checkbox"
                />
                <label htmlFor="allowTierFallback" className="text-sm">
                  Draft a stand-in from the company when both named players are indisposed
                </label>
              </div>
              <p className="qt-text-xs">
                One further attempt, and one only: a connection of the same standing or
                better, preferring a different provider than the one that just failed.
                {!form.formData.modelClass && (
                  <>
                    {' '}
                    Set a Model Class above and the choice will be a great deal better
                    informed — without one, only your other unclassified connections are
                    eligible.
                  </>
                )}
              </p>
            </div>
            )}

            {/* Provider-specific options — schema-driven, supplied by the active plugin */}
            {!isCourier && optionsSchema && (
              <ProviderOptionsPanel
                schema={optionsSchema}
                parameters={form.formData.parameters}
                fetchedModels={fetchedModels}
                modelName={form.formData.modelName}
                onSetParameter={setParameter}
              />
            )}

            {/* Tag Editor (only show when editing) — API path. Courier path renders its own above. */}
            {!isCourier && profile?.id && (
              <div className="pt-4">
                <TagEditor entityType="profile" entityId={profile.id} />
              </div>
            )}
      </div>
    </BaseModal>
  )
}

export default ProfileModal
