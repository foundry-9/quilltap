'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useTagStyles } from '@/components/providers/tag-style-provider'
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles'
import type { TagVisualStyle } from '@/lib/json-store/schemas/types'
import { TagBadge } from '@/components/tags/tag-badge'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'

interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  embeddingProvider: EmbeddingProvider
  embeddingProfileId?: string | null
}

interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  tagStyles: Record<string, TagVisualStyle>
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  createdAt: string
  updatedAt: string
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
}

interface EmbeddingProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

interface TagOption {
  id: string
  name: string
  quickHide?: boolean
}

const AVATAR_MODES: { value: AvatarDisplayMode; label: string; description: string }[] = [
  {
    value: 'ALWAYS',
    label: 'Always Show Avatars',
    description: 'Display avatar for every message (character on left, user on right)',
  },
  {
    value: 'GROUP_ONLY',
    label: 'Group Chats Only',
    description: 'Only show avatars in group chats (will be implemented in the future)',
  },
  {
    value: 'NEVER',
    label: 'Never Show Avatars',
    description: 'Hide avatars in all chats',
  },
]

const AVATAR_STYLES: { value: AvatarDisplayStyle; label: string; description: string; preview: string }[] = [
  {
    value: 'CIRCULAR',
    label: 'Circular',
    description: 'Display avatars as circles',
    preview: '⭕',
  },
  {
    value: 'RECTANGULAR',
    label: 'Rectangular (5:4)',
    description: 'Display avatars as rectangles with 5:4 aspect ratio',
    preview: '▭',
  },
]

export default function ChatSettingsTab() {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagOptions, setTagOptions] = useState<TagOption[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [quickHideSavingId, setQuickHideSavingId] = useState<string | null>(null)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [embeddingProfiles, setEmbeddingProfiles] = useState<EmbeddingProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const { updateStyles: syncTagStyleContext } = useTagStyles()
  const { refresh: refreshQuickHideTags } = useQuickHide()
  const tagFetchIdRef = useRef(0)

  const tagStyles = useMemo(() => settings?.tagStyles ?? {}, [settings?.tagStyles])

  const applyLocalTagStyles = useCallback((nextStyles: Record<string, TagVisualStyle>) => {
    setSettings((prev) => (prev ? { ...prev, tagStyles: nextStyles } : prev))
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setSettings(data)
      syncTagStyleContext(data.tagStyles ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [syncTagStyleContext])

  const fetchTags = useCallback(async () => {
    const requestId = ++tagFetchIdRef.current
    try {
      const res = await fetch('/api/tags', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error('Failed to load tags')
      }
      const data = await res.json()
      if (tagFetchIdRef.current === requestId) {
        setTagOptions((data.tags || []).map((tag: any) => ({
          id: tag.id,
          name: tag.name,
          quickHide: Boolean(tag.quickHide),
        })))
      }
    } catch (err) {
      clientLogger.error('Error loading tags', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchConnectionProfiles = useCallback(async () => {
    try {
      setLoadingProfiles(true)
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setConnectionProfiles(data)
    } catch (err) {
      clientLogger.error('Error loading connection profiles', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  const fetchEmbeddingProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/embedding-profiles')
      if (!res.ok) throw new Error('Failed to fetch embedding profiles')
      const data = await res.json()
      setEmbeddingProfiles(data)
    } catch (err) {
      clientLogger.error('Error loading embedding profiles', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchTags()
    fetchConnectionProfiles()
    fetchEmbeddingProfiles()
  }, [fetchSettings, fetchTags, fetchConnectionProfiles, fetchEmbeddingProfiles])

  const handleAvatarModeChange = async (mode: AvatarDisplayMode) => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayMode: mode }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update chat settings')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      syncTagStyleContext(updatedSettings.tagStyles ?? {})
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarStyleChange = async (style: AvatarDisplayStyle) => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayStyle: style }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update chat settings')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      syncTagStyleContext(updatedSettings.tagStyles ?? {})
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const persistTagStyles = useCallback(async (nextStyles: Record<string, TagVisualStyle>) => {
    if (!settings) return

    try {
      setTagSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagStyles: nextStyles }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update tag styles')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      syncTagStyleContext(updatedSettings.tagStyles ?? {})
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setTagSaving(false)
    }
  }, [settings, syncTagStyleContext])

  const handleTagStyleFieldChange = useCallback((tagId: string, updates: Partial<TagVisualStyle>) => {
    if (!settings) return

    const merged = mergeWithDefaultTagStyle(tagStyles[tagId])
    const nextStyles = {
      ...tagStyles,
      [tagId]: {
        ...merged,
        ...updates,
      },
    }

    applyLocalTagStyles(nextStyles)
    persistTagStyles(nextStyles)
  }, [applyLocalTagStyles, persistTagStyles, settings, tagStyles])

  const handleRemoveTagStyle = useCallback((tagId: string) => {
    if (!settings || !tagStyles[tagId]) return
    const { [tagId]: _removed, ...rest } = tagStyles
    applyLocalTagStyles(rest)
    persistTagStyles(rest)
  }, [applyLocalTagStyles, persistTagStyles, settings, tagStyles])

  const handleCheapLLMUpdate = async (updates: Partial<CheapLLMSettings>) => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cheapLLMSettings: { ...settings.cheapLLMSettings, ...updates } }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update cheap LLM settings')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      syncTagStyleContext(updatedSettings.tagStyles ?? {})
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleAddTagStyle = useCallback(() => {
    if (!selectedTagId || !settings) return
    const nextStyles = {
      ...tagStyles,
      [selectedTagId]: { ...DEFAULT_TAG_STYLE },
    }
    applyLocalTagStyles(nextStyles)
    persistTagStyles(nextStyles)
    setSelectedTagId('')
  }, [applyLocalTagStyles, persistTagStyles, selectedTagId, settings, tagStyles])

  const handleQuickHideToggle = useCallback(
    async (tagId: string, nextValue: boolean) => {
      setQuickHideSavingId(tagId)
      setError(null)
      try {
        const res = await fetch(`/api/tags/${tagId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quickHide: nextValue }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update quick-hide')
        }

        const { tag } = await res.json()
        setTagOptions(prev =>
          prev.map(option =>
            option.id === tagId ? { ...option, quickHide: tag.quickHide } : option
          )
        )
        await refreshQuickHideTags()
        await fetchTags()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update quick-hide')
      } finally {
        setQuickHideSavingId(current => (current === tagId ? null : current))
      }
    },
    [fetchTags, refreshQuickHideTags]
  )

  const tagLabelLookup = useMemo(() => {
    const entries = new Map<string, string>()
    for (const tag of tagOptions) {
      entries.set(tag.id, tag.name)
    }
    return entries
  }, [tagOptions])

  const tagMetadataLookup = useMemo(() => {
    const entries = new Map<string, TagOption>()
    for (const tag of tagOptions) {
      entries.set(tag.id, tag)
    }
    return entries
  }, [tagOptions])

  const availableForStyling = useMemo(
    () => tagOptions.filter((tag) => !tagStyles[tag.id]),
    [tagOptions, tagStyles]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-600 dark:text-gray-400">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-red-600 dark:text-red-400 py-8">
        Failed to load chat settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4 text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4 text-green-800 dark:text-green-200">
          Settings saved successfully
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Message Avatar Display</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Control how avatars are displayed in chat messages
        </p>

        <div className="space-y-3">
          {AVATAR_MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex items-start gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayMode"
                value={mode.value}
                checked={settings.avatarDisplayMode === mode.value}
                onChange={() => handleAvatarModeChange(mode.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{mode.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {mode.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">Avatar Display Style</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Choose how avatars are shaped and displayed throughout the application
        </p>

        <div className="space-y-3">
          {AVATAR_STYLES.map((style) => (
            <label
              key={style.value}
              className="flex items-start gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayStyle"
                value={style.value}
                checked={settings.avatarDisplayStyle === style.value}
                onChange={() => handleAvatarStyleChange(style.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{style.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {style.description}
                </div>
              </div>
              <div className="text-3xl">{style.preview}</div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">Cheap LLM Settings</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Configure which LLM to use for background tasks like memory extraction and summarization
        </p>

        <div className="space-y-4">
          {/* Strategy Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Strategy
            </label>
            <div className="space-y-2">
              {[
                { value: 'USER_DEFINED' as CheapLLMStrategy, label: 'User Defined', description: 'Use the profile you select below' },
                { value: 'PROVIDER_CHEAPEST' as CheapLLMStrategy, label: 'Provider Cheapest', description: 'Automatically use the cheapest model from current provider' },
                { value: 'LOCAL_FIRST' as CheapLLMStrategy, label: 'Local First', description: 'Prefer local/Ollama models if available' },
              ].map((strategy) => (
                <label
                  key={strategy.value}
                  className="flex items-start gap-3 p-3 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="cheapLLMStrategy"
                    value={strategy.value}
                    checked={settings?.cheapLLMSettings.strategy === strategy.value}
                    onChange={() => handleCheapLLMUpdate({ strategy: strategy.value })}
                    disabled={saving}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{strategy.label}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {strategy.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* User Defined Profile Selection */}
          {settings?.cheapLLMSettings.strategy === 'USER_DEFINED' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Cheap LLM Profile
              </label>
              <select
                value={settings?.cheapLLMSettings.userDefinedProfileId || ''}
                onChange={(e) => handleCheapLLMUpdate({ userDefinedProfileId: e.target.value || null })}
                disabled={saving || loadingProfiles}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a profile...</option>
                {connectionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName})
                  </option>
                ))}
              </select>
              {connectionProfiles.length === 0 && !loadingProfiles && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  No connection profiles found. Create one in the Connection Profiles tab first.
                </p>
              )}
            </div>
          )}

          {/* Default Cheap Profile (Global Override) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Global Default Cheap LLM (Optional Override)
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              If set, this profile will always be used regardless of strategy
            </p>
            <select
              value={settings?.cheapLLMSettings.defaultCheapProfileId || ''}
              onChange={(e) => handleCheapLLMUpdate({ defaultCheapProfileId: e.target.value || null })}
              disabled={saving || loadingProfiles}
              className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Not set</option>
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName})
                </option>
              ))}
            </select>
          </div>

          {/* Fallback to Local */}
          <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={settings?.cheapLLMSettings.fallbackToLocal ?? true}
              onChange={(e) => handleCheapLLMUpdate({ fallbackToLocal: e.target.checked })}
              disabled={saving}
              className="rounded"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">Fallback to Local</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Use local Ollama models as fallback if configured strategy is unavailable
              </div>
            </div>
          </label>

          {/* Embedding Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Embedding Provider
            </label>
            <div className="space-y-2">
              {[
                { value: 'SAME_PROVIDER' as EmbeddingProvider, label: 'Same Provider', description: 'Use embeddings from the same provider as the cheap LLM' },
                { value: 'OPENAI' as EmbeddingProvider, label: 'OpenAI', description: 'Use OpenAI for embeddings' },
                { value: 'LOCAL' as EmbeddingProvider, label: 'Local', description: 'Use local Ollama embeddings' },
              ].map((provider) => (
                <label
                  key={provider.value}
                  className="flex items-start gap-3 p-3 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="embeddingProvider"
                    value={provider.value}
                    checked={settings?.cheapLLMSettings.embeddingProvider === provider.value}
                    onChange={() => handleCheapLLMUpdate({ embeddingProvider: provider.value })}
                    disabled={saving}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{provider.label}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {provider.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Embedding Profile Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Embedding Profile (Optional)
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Specific embedding profile to use. Leave blank to use the default for the selected embedding provider.
            </p>
            <select
              value={settings?.cheapLLMSettings.embeddingProfileId || ''}
              onChange={(e) => handleCheapLLMUpdate({ embeddingProfileId: e.target.value || null })}
              disabled={saving}
              className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Use default for provider</option>
              {embeddingProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName})
                </option>
              ))}
            </select>
            {embeddingProfiles.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No embedding profiles found. Create one in the Embedding Profiles tab.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Image Description Profile */}
      <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">Image Description Profile</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          When you attach an image to a chat with a provider that doesn&apos;t support images (like Ollama, OpenRouter, etc.),
          this profile will be used to generate a text description of the image.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Image Description Profile
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Select a vision-capable profile (like gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash) to describe images.
              If not set, the system will automatically use any available vision-capable profile.
            </p>
            <select
              value={settings?.imageDescriptionProfileId || ''}
              onChange={async (e) => {
                const newValue = e.target.value || null
                try {
                  setSaving(true)
                  const res = await fetch('/api/chat-settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageDescriptionProfileId: newValue }),
                  })
                  if (!res.ok) throw new Error('Failed to update settings')
                  await fetchSettings()
                  setSuccess(true)
                  setTimeout(() => setSuccess(false), 3000)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to save')
                } finally {
                  setSaving(false)
                }
              }}
              disabled={saving || loadingProfiles}
              className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Auto-select vision-capable profile</option>
              {connectionProfiles
                .filter(profile => {
                  // Only show vision-capable providers
                  const visionProviders = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK']
                  return visionProviders.includes(profile.provider)
                })
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName})
                  </option>
                ))}
            </select>
            {connectionProfiles.filter(p => ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK'].includes(p.provider)).length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No vision-capable profiles found. Create an OpenAI, Anthropic, Google, or Grok profile in the Connection Profiles tab.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">Tag Appearance</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Map tags to custom emojis and colors. Tags without a custom style use the default gray border/background and show only the tag name.
        </p>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tag
              </label>
              <select
                value={selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                disabled={tagSaving || availableForStyling.length === 0}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a tag</option>
                {availableForStyling.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleAddTagStyle}
              disabled={!selectedTagId || tagSaving}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-800 disabled:opacity-50"
            >
              Add Style
            </button>
          </div>

          {Object.keys(tagStyles).length > 0 ? (
            <div className="grid gap-4 grid-cols-1 landscape:grid-cols-3 lg:grid-cols-4">
              {Object.entries(tagStyles).map(([tagId, style]) => {
                const label = tagLabelLookup.get(tagId) || 'Unknown tag'
                const mergedStyle = mergeWithDefaultTagStyle(style)
                const tagMeta = tagMetadataLookup.get(tagId)
                const quickHideEnabled = Boolean(tagMeta?.quickHide)

                return (
                  <div key={tagId} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800 shadow-sm flex flex-col">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white text-sm">{label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Preview:</div>
                      <div className="mt-2 mb-4">
                        <TagBadge tag={{ id: tagId, name: label }} styleOverride={mergedStyle} />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-sm text-gray-700 dark:text-gray-300">
                        Emoji
                        <input
                          type="text"
                          maxLength={8}
                          value={mergedStyle.emoji ?? ''}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { emoji: e.target.value.trim() || null })}
                          disabled={tagSaving}
                          placeholder="😀"
                          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                        />
                      </label>

                      <div className="space-y-2 pt-1">
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={mergedStyle.emojiOnly ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { emojiOnly: e.target.checked })}
                            disabled={tagSaving || !mergedStyle.emoji}
                            className="rounded"
                          />
                          <span>Show emoji only</span>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={mergedStyle.bold ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { bold: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="font-bold">Bold</span>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={mergedStyle.italic ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { italic: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="italic">Italic</span>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={mergedStyle.strikethrough ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { strikethrough: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="line-through">Strikethrough</span>
                        </label>

                        <div className="pt-2 mt-2 border-t border-dashed border-gray-200 dark:border-slate-700">
                          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={quickHideEnabled}
                              onChange={(e) => handleQuickHideToggle(tagId, e.target.checked)}
                              disabled={quickHideSavingId === tagId}
                              className="rounded"
                            />
                            <span>Enable quick-hide button</span>
                          </label>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Adds this tag to the navbar quick-hide controls.
                          </p>
                        </div>
                      </div>

                      <label className="block text-sm text-gray-700 dark:text-gray-300">
                        Border + Font Color
                        <input
                          type="color"
                          value={mergedStyle.foregroundColor}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { foregroundColor: e.target.value })}
                          disabled={tagSaving}
                          className="mt-1 block h-10 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                        />
                      </label>

                      <label className="block text-sm text-gray-700 dark:text-gray-300">
                        Background Color
                        <input
                          type="color"
                          value={mergedStyle.backgroundColor}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { backgroundColor: e.target.value })}
                          disabled={tagSaving}
                          className="mt-1 block h-10 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleRemoveTagStyle(tagId)}
                        disabled={tagSaving}
                        className="w-full px-3 py-1.5 text-sm rounded-md text-red-600 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                      >
                        Remove Style
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-400 border border-dashed border-gray-300 dark:border-slate-700 rounded-lg p-4">
              No custom tag styles yet. Select a tag above to add an emoji and colors.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
