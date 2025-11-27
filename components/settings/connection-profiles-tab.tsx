'use client'

import { useState, useEffect } from 'react'
import { TagEditor } from '@/components/tags/tag-editor'
import { TagBadge } from '@/components/tags/tag-badge'
import { ModelSelector } from './model-selector'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface Tag {
  id: string
  name: string
  createdAt?: string
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  apiKey?: ApiKey | null
  tags?: Tag[]
}

export default function ConnectionProfilesTab() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    provider: 'OPENAI',
    apiKeyId: '',
    baseUrl: '',
    modelName: 'gpt-3.5-turbo',
    temperature: 1,
    maxTokens: 1000,
    topP: 1,
    isDefault: false,
  })

  // Connection testing states
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  // Fetch models states
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)

  // Test message states
  const [isTestingMessage, setIsTestingMessage] = useState(false)
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
  }, [])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()

      // Fetch tags for each profile
      const profilesWithTags = await Promise.all(
        data.map(async (profile: ConnectionProfile) => {
          try {
            const tagsRes = await fetch(`/api/profiles/${profile.id}/tags`)
            if (tagsRes.ok) {
              const tagsData = await tagsRes.json()
              return { ...profile, tags: tagsData.tags || [] }
            }
          } catch (err) {
            console.error(`Error fetching tags for profile ${profile.id}:`, err)
          }
          return profile
        })
      )

      setProfiles(profilesWithTags)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/keys')
      if (!res.ok) throw new Error('Failed to fetch API keys')
      const data = await res.json()
      setApiKeys(data)
    } catch (err) {
      console.error('Failed to fetch API keys:', err)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      provider: 'OPENAI',
      apiKeyId: '',
      baseUrl: '',
      modelName: 'gpt-3.5-turbo',
      temperature: 1,
      maxTokens: 1000,
      topP: 1,
      isDefault: false,
    })
    setEditingId(null)
    // Reset connection states
    setIsConnected(false)
    setConnectionMessage(null)
    setFetchedModels([])
    setModelsMessage(null)
    setTestMessageResult(null)
  }

  const handleEdit = (profile: ConnectionProfile) => {
    setFormData({
      name: profile.name,
      provider: profile.provider,
      apiKeyId: profile.apiKeyId || '',
      baseUrl: profile.baseUrl || '',
      modelName: profile.modelName,
      temperature: profile.parameters?.temperature ?? 1,
      maxTokens: profile.parameters?.max_tokens ?? 1000,
      topP: profile.parameters?.top_p ?? 1,
      isDefault: profile.isDefault,
    })
    setEditingId(profile.id)
    setShowForm(true)
    // Scroll to form after state update
    setTimeout(() => {
      const formElement = document.getElementById('profile-form')
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setError(null)

    try {
      const method = editingId ? 'PUT' : 'POST'
      const url = editingId ? `/api/profiles/${editingId}` : '/api/profiles'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          parameters: {
            temperature: parseFloat(String(formData.temperature)),
            max_tokens: parseInt(String(formData.maxTokens)),
            top_p: parseFloat(String(formData.topP)),
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save profile')
      }

      resetForm()
      setShowForm(false)
      await fetchProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this profile?')) return

    try {
      const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete profile')
      await fetchProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target
    setFormData({
      ...formData,
      [name]:
        type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    })

    // Reset connection state if provider or credentials change
    if (name === 'provider' || name === 'apiKeyId' || name === 'baseUrl') {
      setIsConnected(false)
      setConnectionMessage(null)
      setFetchedModels([])
      setModelsMessage(null)
      setTestMessageResult(null)
    }
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    setConnectionMessage(null)
    setError(null)

    try {
      // Validate required fields
      if (!formData.provider) {
        throw new Error('Provider is required')
      }

      if (formData.provider === 'OLLAMA' || formData.provider === 'OPENAI_COMPATIBLE') {
        if (!formData.baseUrl) {
          throw new Error('Base URL is required for this provider')
        }
      } else if (!formData.apiKeyId) {
        throw new Error('API Key is required for this provider')
      }

      // Test the connection
      const res = await fetch('/api/profiles/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: formData.provider,
          apiKeyId: formData.apiKeyId || undefined,
          baseUrl: formData.baseUrl || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Connection test failed')
      }

      setIsConnected(true)
      setConnectionMessage(data.message || 'Connection successful!')
    } catch (err) {
      setIsConnected(false)
      setConnectionMessage(null)
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setModelsMessage(null)
    setError(null)

    try {
      // Validate required fields based on provider
      if ((formData.provider === 'OLLAMA' || formData.provider === 'OPENAI_COMPATIBLE') && !formData.baseUrl) {
        throw new Error('Base URL is required for this provider')
      }

      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: formData.provider,
          apiKeyId: formData.apiKeyId || undefined,
          baseUrl: formData.baseUrl || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch models')
      }

      setFetchedModels(data.models || [])
      setModelsMessage(`Found ${data.models?.length || 0} models`)
    } catch (err) {
      setModelsMessage(null)
      setError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const handleTestMessage = async () => {
    setIsTestingMessage(true)
    setTestMessageResult(null)
    setError(null)

    try {
      // Validate model name
      if (!formData.modelName) {
        throw new Error('Model name is required')
      }

      const res = await fetch('/api/profiles/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: formData.provider,
          apiKeyId: formData.apiKeyId || undefined,
          baseUrl: formData.baseUrl || undefined,
          modelName: formData.modelName,
          parameters: {
            temperature: parseFloat(String(formData.temperature)),
            max_tokens: parseInt(String(formData.maxTokens)),
            top_p: parseFloat(String(formData.topP)),
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Test message failed')
      }

      setTestMessageResult(data.message || 'Test message sent successfully!')
    } catch (err) {
      setTestMessageResult(null)
      setError(err instanceof Error ? err.message : 'Test message failed')
    } finally {
      setIsTestingMessage(false)
    }
  }

  const getModelSuggestions = (provider: string): string[] => {
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
      ANTHROPIC: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251015', 'claude-opus-4-1-20250805'],
      GOOGLE: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-1.0-pro', 'gemini-pro-vision'],
      GROK: ['grok-beta', 'grok-2', 'grok-vision-beta'],
      GAB_AI: ['arya', 'gpt-4o'],
      OLLAMA: ['llama2', 'neural-chat', 'mistral'],
      OPENROUTER: ['openai/gpt-4', 'anthropic/claude-2', 'meta-llama/llama-2-70b'],
      OPENAI_COMPATIBLE: ['gpt-3.5-turbo'],
    }
    const modelList = models[provider] || ['gpt-3.5-turbo']
    return modelList.sort()
  }

  if (loading) {
    return <div className="text-center py-8">Loading connection profiles...</div>
  }

  return (
    <div>
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {apiKeys.length === 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 text-yellow-700 dark:text-yellow-200 px-4 py-3 rounded mb-6">
          <p className="font-medium">No API keys found</p>
          <p className="text-sm">Add an API key in the &quot;API Keys&quot; tab before creating a connection profile.</p>
        </div>
      )}

      {/* Profiles List */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Connection Profiles</h2>
          {!showForm && (
            <button
              onClick={() => {
                resetForm()
                setShowForm(true)
                // Scroll to form after state update
                setTimeout(() => {
                  const formElement = document.getElementById('profile-form')
                  if (formElement) {
                    formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }, 0)
              }}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800"
            >
              + Add Profile
            </button>
          )}
        </div>

        {profiles.length === 0 ? (
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6 text-center text-gray-600 dark:text-gray-400">
            <p>No connection profiles yet. Create one to start chatting.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map(profile => (
              <div
                key={profile.id}
                className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium dark:text-white">{profile.name}</p>
                      {profile.isDefault && (
                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 text-xs rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {profile.provider} • {profile.modelName}
                    </p>
                    {profile.apiKey && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        API Key: {profile.apiKey.label}
                      </p>
                    )}
                    {profile.baseUrl && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Base URL: {profile.baseUrl}
                      </p>
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                      Temperature: {profile.parameters?.temperature ?? 0.7} •
                      Max Tokens: {profile.parameters?.max_tokens ?? 1000} •
                      Top P: {profile.parameters?.top_p ?? 1}
                    </div>
                    {profile.tags && profile.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {profile.tags.map(tag => (
                          <TagBadge key={tag.id} tag={tag} size="sm" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(profile)}
                      className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(profile.id)}
                      className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Profile Form */}
      {showForm && (
        <div id="profile-form" className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingId ? 'Edit Connection Profile' : 'Add New Connection Profile'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g., My GPT-4 Profile"
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
              </div>

              <div>
                <label htmlFor="provider" className="block text-sm font-medium mb-2">
                  Provider *
                </label>
                <select
                  id="provider"
                  name="provider"
                  value={formData.provider}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                >
                  <option value="OPENAI">OpenAI</option>
                  <option value="ANTHROPIC">Anthropic</option>
                  <option value="GOOGLE">Google</option>
                  <option value="GROK">Grok</option>
                  <option value="GAB_AI">Gab AI</option>
                  <option value="OLLAMA">Ollama</option>
                  <option value="OPENROUTER">OpenRouter</option>
                  <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="apiKeyId" className="block text-sm font-medium mb-2">
                  API Key
                </label>
                <select
                  id="apiKeyId"
                  name="apiKeyId"
                  value={formData.apiKeyId}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                >
                  <option value="">Select an API Key</option>
                  {apiKeys
                    .filter(key => key.provider === formData.provider)
                    .map(key => (
                      <option key={key.id} value={key.id}>
                        {key.label}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Optional if using Ollama or already authenticated</p>
              </div>

              {(formData.provider === 'OLLAMA' || formData.provider === 'OPENAI_COMPATIBLE') && (
                <div>
                  <label htmlFor="baseUrl" className="block text-sm font-medium mb-2">
                    Base URL
                  </label>
                  <input
                    type="url"
                    id="baseUrl"
                    name="baseUrl"
                    value={formData.baseUrl}
                    onChange={handleChange}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Required for Ollama and compatible services</p>
                </div>
              )}
            </div>

            {/* Connection Testing Section */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-800">
              <h4 className="font-medium text-sm mb-3">Connection Testing</h4>

              <div className="flex flex-wrap gap-3 mb-3">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>

                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={
                    isFetchingModels ||
                    // For providers that need baseUrl, require it
                    ((formData.provider === 'OLLAMA' || formData.provider === 'OPENAI_COMPATIBLE') && !formData.baseUrl) ||
                    // For other providers (except ANTHROPIC which doesn't need connection), require connection
                    (formData.provider !== 'ANTHROPIC' && formData.provider !== 'OLLAMA' && formData.provider !== 'OPENAI_COMPATIBLE' && !isConnected)
                  }
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {isFetchingModels ? 'Fetching...' : 'Fetch Models'}
                </button>

                <button
                  type="button"
                  onClick={handleTestMessage}
                  disabled={!isConnected || isTestingMessage || !formData.modelName}
                  className="px-4 py-2 bg-purple-600 dark:bg-purple-700 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {isTestingMessage ? 'Testing...' : 'Test Message'}
                </button>
              </div>

              {/* Status messages */}
              {connectionMessage && (
                <div className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 mb-2">
                  ✓ {connectionMessage}
                </div>
              )}

              {modelsMessage && (
                <div className="text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded px-3 py-2 mb-2">
                  ✓ {modelsMessage}
                </div>
              )}

              {testMessageResult && (
                <div className="text-sm text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900 border border-purple-200 dark:border-purple-700 rounded px-3 py-2 mb-2">
                  ✓ {testMessageResult}
                </div>
              )}

              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                1. Click Connect to test the connection • 2. Fetch Models (enabled after connection) • 3. Test Message to verify API functionality
              </p>
            </div>

            <div>
              <label htmlFor="modelName" className="block text-sm font-medium mb-2">
                Model *
              </label>
              {fetchedModels.length > 0 ? (
                <ModelSelector
                  models={fetchedModels}
                  value={formData.modelName}
                  onChange={(value) => setFormData({ ...formData, modelName: value })}
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
                    value={formData.modelName}
                    onChange={handleChange}
                    placeholder="e.g., gpt-4"
                    list="modelSuggestions"
                    required
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                  <datalist id="modelSuggestions">
                    {getModelSuggestions(formData.provider).map(model => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              )}
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
              <h4 className="font-medium text-sm mb-3">Model Parameters (Optional)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="temperature" className="block text-sm font-medium mb-2">
                    Temperature ({formData.temperature})
                  </label>
                  <input
                    type="range"
                    id="temperature"
                    name="temperature"
                    min="0"
                    max="2"
                    step="0.1"
                    value={formData.temperature}
                    onChange={handleChange}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">0 = deterministic, 2 = creative</p>
                </div>

                <div>
                  <label htmlFor="maxTokens" className="block text-sm font-medium mb-2">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    id="maxTokens"
                    name="maxTokens"
                    value={formData.maxTokens}
                    onChange={handleChange}
                    min="1"
                    max="4000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label htmlFor="topP" className="block text-sm font-medium mb-2">
                    Top P ({formData.topP})
                  </label>
                  <input
                    type="range"
                    id="topP"
                    name="topP"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formData.topP}
                    onChange={handleChange}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Nucleus sampling (0-1)</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isDefault"
                name="isDefault"
                checked={formData.isDefault}
                onChange={handleChange}
                className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
              />
              <label htmlFor="isDefault" className="text-sm">
                Set as default profile
              </label>
            </div>

            {/* Tag Editor (only show when editing existing profile) */}
            {editingId && (
              <div className="pt-4">
                <TagEditor entityType="profile" entityId={editingId} />
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
              <button
                type="submit"
                disabled={formLoading}
                className="px-6 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
              >
                {formLoading
                  ? 'Saving...'
                  : editingId
                    ? 'Update Profile'
                    : 'Create Profile'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  resetForm()
                }}
                className="px-6 py-2 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
