'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import {
  ChatSettings,
  ConnectionProfile,
  EmbeddingProfile,
  ImageProfile,
  AvatarDisplayMode,
  AvatarDisplayStyle,
  CheapLLMSettings,
  MemoryCascadePreferences,
  TokenDisplaySettings,
  ContextCompressionSettings,
  LLMLoggingSettings,
  StoryBackgroundsSettings,
  DEFAULT_MEMORY_CASCADE_PREFERENCES,
  DEFAULT_TOKEN_DISPLAY_SETTINGS,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  DEFAULT_LLM_LOGGING_SETTINGS,
  DEFAULT_AUTO_DETECT_RNG,
  AgentModeSettings,
  DEFAULT_AGENT_MODE_SETTINGS,
  DEFAULT_STORY_BACKGROUNDS_SETTINGS,
  DangerousContentSettings,
  DEFAULT_DANGEROUS_CONTENT_SETTINGS,
  AutonomousRoomSettings,
  ThinkingDisplaySettings,
  DEFAULT_THINKING_DISPLAY_SETTINGS,
  AnswerConfirmationSettings,
  DEFAULT_ANSWER_CONFIRMATION_SETTINGS,
  SmartTypographySettings,
  DEFAULT_SMART_TYPOGRAPHY_SETTINGS,
} from '../types'

interface UseChatSettingsReturn {
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleUncensoredImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleMemoryCascadeUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
  handleTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
  handleContextCompressionUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
  handleLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
  handleAutoDetectRngChange: (value: boolean) => Promise<void>
  handleCustomToolsChange: (value: boolean) => Promise<void>
  handleCompositionModeDefaultChange: (value: boolean) => Promise<void>
  handleComposerSpellcheckChange: (value: boolean) => Promise<void>
  handleComposerEmojiChange: (value: boolean) => Promise<void>
  handleComposerUnicodeChange: (value: boolean) => Promise<void>
  handleAutoScrollOnResponseCompleteChange: (value: boolean) => Promise<void>
  handleTextReplacementsEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeDefaultEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeMaxTurnsChange: (value: number) => Promise<void>
  handleStoryBackgroundsEnabledChange: (value: boolean) => Promise<void>
  handleStoryBackgroundsProfileChange: (profileId: string | null) => Promise<void>
  handleDangerousContentUpdate: (updates: Partial<DangerousContentSettings>) => Promise<void>
  handleTimezoneChange: (timezone: string | null) => Promise<void>
  handleAutonomousRoomSettingsUpdate: (updates: Partial<AutonomousRoomSettings>) => Promise<void>
  handleThinkingDisplayUpdate: (updates: Partial<ThinkingDisplaySettings>) => Promise<void>
  handleAnswerConfirmationUpdate: (updates: Partial<AnswerConfirmationSettings>) => Promise<void>
  handleSmartTypographyUpdate: (updates: Partial<SmartTypographySettings>) => Promise<void>
}

export function useChatSettings(): UseChatSettingsReturn {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  // Ref to track the latest settings for use in concurrent updates
  // This prevents race conditions when multiple updates happen quickly
  const settingsRef = useRef<ChatSettings | null>(null)

  // Get the avatar display context updater to sync style changes globally
  const { syncAvatarDisplayStyle } = useAvatarDisplay()

  // Fetch all data via TanStack Query
  const queryClient = useQueryClient()
  const { data: settingsData, isLoading, error: loadError } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettings>('/api/v1/settings/chat', { signal }),
  })
  const { data: connProfileData } = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ConnectionProfile[] }>('/api/v1/connection-profiles', { signal }),
  })
  const { data: embeddingProfileData } = useQuery({
    queryKey: queryKeys.embeddingProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: EmbeddingProfile[] }>('/api/v1/embedding-profiles', { signal }),
  })
  const { data: imageProfileData } = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ImageProfile[] }>('/api/v1/image-profiles', { signal }),
  })

  // Shim preserving SWR's `mutate` signature for the handlers below. With a
  // payload it writes optimistically without revalidating (the old
  // `mutate(updated, false)`); with no args it revalidates (the old
  // `mutate()`).
  const mutateSettings = useCallback(
    async (updated?: ChatSettings, _revalidate?: boolean): Promise<void> => {
      if (updated !== undefined) {
        queryClient.setQueryData(queryKeys.settings.chat, updated)
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.settings.chat })
      }
    },
    [queryClient]
  )

  const settings = settingsData ?? null
  const connectionProfiles = connProfileData?.profiles ?? []
  const embeddingProfiles = embeddingProfileData?.profiles ?? []
  const imageProfiles = imageProfileData?.profiles ?? []
  const loadingProfiles = !connProfileData || !embeddingProfileData || !imageProfileData
  const loading = isLoading
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'An error occurred') : null

  // Keep the ref in sync with state
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  /**
   * Fetch helper (kept for backward compatibility with return interface)
   */
  const fetchSettings = useCallback(async () => {
    await mutateSettings()
  }, [mutateSettings])

  /**
   * Helper function to show success message
   */
  const showSuccess = useCallback(async () => {
    setSuccess(true)
    const timer = setTimeout(() => setSuccess(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  /**
   * Shared core of the mutation handlers below: PUT a partial body, write the
   * server's response into the cache without revalidating, flash the success
   * indicator. `failureMessage` is the throw's fallback when the server sends
   * no `error`; `logLabel` prefixes the `console.error` — several handlers
   * differ between the two, so both are explicit. `afterSave` runs between the
   * cache write and the success flash, for handlers with extra follow-up.
   */
  const patchChatSettings = useCallback(
    async (
      body: Record<string, unknown>,
      failureMessage: string,
      logLabel: string,
      afterSave?: () => void | Promise<void>
    ) => {
      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || failureMessage)
        }

        const updatedSettings = await res.json()
        await mutateSettings(updatedSettings, false)
        await afterSave?.()
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error(logLabel, { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update avatar display mode
   */
  const handleAvatarModeChange = useCallback(
    async (mode: AvatarDisplayMode) => {
      if (!settings) return

      await patchChatSettings(
        { avatarDisplayMode: mode },
        'Failed to update chat settings',
        'Failed to update avatar display mode'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update avatar display style
   */
  const handleAvatarStyleChange = useCallback(
    async (style: AvatarDisplayStyle) => {
      if (!settings) return

      await patchChatSettings(
        { avatarDisplayStyle: style },
        'Failed to update chat settings',
        'Failed to update avatar display style',
        // Sync the style to the global AvatarDisplayProvider context
        // This ensures all Avatar components re-render with the new style
        () => syncAvatarDisplayStyle(style)
      )
    },
    [settings, patchChatSettings, syncAvatarDisplayStyle]
  )

  /**
   * Update cheap LLM settings
   */
  const handleCheapLLMUpdate = useCallback(
    async (updates: Partial<CheapLLMSettings>) => {
      if (!settings) return

      await patchChatSettings(
        { cheapLLMSettings: { ...settings.cheapLLMSettings, ...updates } },
        'Failed to update cheap LLM settings',
        'Failed to update cheap LLM settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update image description profile
   */
  const handleImageDescriptionProfileChange = useCallback(
    async (profileId: string | null) => {
      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        await mutateSettings()
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        console.error('Failed to update image description profile', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update uncensored image description fallback profile
   */
  const handleUncensoredImageDescriptionProfileChange = useCallback(
    async (profileId: string | null) => {
      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uncensoredImageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        await mutateSettings()
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        console.error('Failed to update uncensored image description profile', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update memory cascade preferences
   */
  const handleMemoryCascadeUpdate = useCallback(
    async (updates: Partial<MemoryCascadePreferences>) => {
      if (!settings) return

      const currentPrefs = settings.memoryCascadePreferences || DEFAULT_MEMORY_CASCADE_PREFERENCES
      await patchChatSettings(
        { memoryCascadePreferences: { ...currentPrefs, ...updates } },
        'Failed to update memory cascade preferences',
        'Failed to update memory cascade preferences'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update token display settings
   */
  const handleTokenDisplayChange = useCallback(
    async (key: keyof TokenDisplaySettings, value: boolean) => {
      if (!settings) return

      const currentSettings = settings.tokenDisplaySettings || DEFAULT_TOKEN_DISPLAY_SETTINGS
      await patchChatSettings(
        { tokenDisplaySettings: { ...currentSettings, [key]: value } },
        'Failed to update token display settings',
        'Failed to update token display settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update context compression settings
   */
  const handleContextCompressionUpdate = useCallback(
    async (updates: Partial<ContextCompressionSettings>) => {
      if (!settings) return

      const currentSettings = settings.contextCompressionSettings || DEFAULT_CONTEXT_COMPRESSION_SETTINGS
      await patchChatSettings(
        { contextCompressionSettings: { ...currentSettings, ...updates } },
        'Failed to update context compression settings',
        'Failed to update context compression settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update LLM logging settings
   */
  const handleLLMLoggingChange = useCallback(
    async (key: keyof LLMLoggingSettings, value: boolean | number) => {
      if (!settings) return

      const currentSettings = settings.llmLoggingSettings || DEFAULT_LLM_LOGGING_SETTINGS
      await patchChatSettings(
        { llmLoggingSettings: { ...currentSettings, [key]: value } },
        'Failed to update LLM logging settings',
        'Failed to update LLM logging settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update auto-detect RNG setting
   */
  const handleAutoDetectRngChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { autoDetectRng: value },
        'Failed to update auto-detect RNG setting',
        'Failed to update auto-detect RNG setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update custom-tools setting
   */
  const handleCustomToolsChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { customTools: value },
        'Failed to update custom tools setting',
        'Failed to update custom tools setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update default-composition-mode setting
   */
  const handleCompositionModeDefaultChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { compositionModeDefault: value },
        'Failed to update composition mode default',
        'Failed to update composition mode default'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update composer-spellcheck setting
   */
  const handleComposerSpellcheckChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { composerSpellcheck: value },
        'Failed to update composer spellcheck setting',
        'Failed to update composer spellcheck setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update composer-emoji setting (the `:` typeahead only — the toolbar's
   * emoji picker is deliberately not gated by this flag)
   */
  const handleComposerEmojiChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { composerEmoji: value },
        'Failed to update composer emoji setting',
        'Failed to update composer emoji setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update composer-unicode setting (the `\` typeahead only — the toolbar's
   * symbol picker is deliberately not gated by this flag)
   */
  const handleComposerUnicodeChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { composerUnicode: value },
        'Failed to update composer unicode setting',
        'Failed to update composer unicode setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update Salon auto-scroll-on-response-complete setting
   */
  const handleAutoScrollOnResponseCompleteChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { autoScrollOnResponseComplete: value },
        'Failed to update auto-scroll setting',
        'Failed to update auto-scroll setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update text-replacements master toggle
   */
  const handleTextReplacementsEnabledChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      await patchChatSettings(
        { textReplacementsEnabled: value },
        'Failed to update text-replacements setting',
        'Failed to update text-replacements setting'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * 4.6 Private Character Rooms — update user-level autonomous-room defaults.
   * Merges the partial onto the current value so the form can fire one field
   * at a time without clobbering siblings.
   */
  const handleAutonomousRoomSettingsUpdate = useCallback(
    async (updates: Partial<AutonomousRoomSettings>) => {
      if (!settings) return

      const merged: AutonomousRoomSettings = {
        ...(settings.autonomousRoomSettings ?? {}),
        ...updates,
      }

      await patchChatSettings(
        { autonomousRoomSettings: merged },
        'Failed to update autonomous-room settings',
        'Failed to update autonomous-room settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update thinking / reasoning display global defaults. DISPLAY ONLY — never
   * affects whether reasoning is captured or stored, only whether it is shown.
   */
  const handleThinkingDisplayUpdate = useCallback(
    async (updates: Partial<ThinkingDisplaySettings>) => {
      if (!settings) return

      const merged: ThinkingDisplaySettings = {
        ...DEFAULT_THINKING_DISPLAY_SETTINGS,
        ...(settings.thinkingDisplay ?? {}),
        ...updates,
      }

      await patchChatSettings(
        { thinkingDisplay: merged },
        'Failed to update thinking-display settings',
        'Failed to update thinking-display settings'
      )
    },
    [settings, patchChatSettings]
  )

  const handleAnswerConfirmationUpdate = useCallback(
    async (updates: Partial<AnswerConfirmationSettings>) => {
      if (!settings) return

      const merged: AnswerConfirmationSettings = {
        ...DEFAULT_ANSWER_CONFIRMATION_SETTINGS,
        ...(settings.answerConfirmationSettings ?? {}),
        ...updates,
      }

      await patchChatSettings(
        { answerConfirmationSettings: merged },
        'Failed to update answer-confirmation settings',
        'Failed to update answer-confirmation settings'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update smart typography settings (merge-then-PUT, like the sibling bags).
   */
  const handleSmartTypographyUpdate = useCallback(
    async (updates: Partial<SmartTypographySettings>) => {
      if (!settings) return

      const merged: SmartTypographySettings = {
        ...DEFAULT_SMART_TYPOGRAPHY_SETTINGS,
        ...(settings.smartTypographySettings ?? {}),
        ...updates,
      }

      await patchChatSettings(
        { smartTypographySettings: merged },
        'Failed to update smart typography settings',
        'Failed to update smart typography settings',
        // Persisted messages arrive with server-PRE-RENDERED HTML baked into the
        // chat payload (see app/api/v1/chats/[id]/handlers/get.ts), so a cached
        // conversation would keep its old quotes until something else happened
        // to refetch it. Toggling `displayQuotes` must be visible at once, which
        // means dropping those cached renders. Messages the client renders
        // itself pick the change up through the settings query directly.
        () => queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      )
    },
    [settings, patchChatSettings, queryClient]
  )

  /**
   * Update agent mode default enabled setting
   */
  const handleAgentModeDefaultEnabledChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      const currentSettings = settings.agentModeSettings || DEFAULT_AGENT_MODE_SETTINGS
      await patchChatSettings(
        { agentModeSettings: { ...currentSettings, defaultEnabled: value } },
        'Failed to update agent mode settings',
        'Failed to update agent mode default enabled'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update agent mode max turns setting
   */
  const handleAgentModeMaxTurnsChange = useCallback(
    async (value: number) => {
      if (!settings) return

      const currentSettings = settings.agentModeSettings || DEFAULT_AGENT_MODE_SETTINGS
      await patchChatSettings(
        { agentModeSettings: { ...currentSettings, maxTurns: value } },
        'Failed to update agent mode settings',
        'Failed to update agent mode max turns'
      )
    },
    [settings, patchChatSettings]
  )

  /**
   * Update story backgrounds enabled setting
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleStoryBackgroundsEnabledChange = useCallback(
    async (value: boolean) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      const currentSettings = latestSettings.storyBackgroundsSettings || DEFAULT_STORY_BACKGROUNDS_SETTINGS
      await patchChatSettings(
        { storyBackgroundsSettings: { ...currentSettings, enabled: value } },
        'Failed to update story backgrounds settings',
        'Failed to update story backgrounds enabled'
      )
    },
    [patchChatSettings]
  )

  /**
   * Update story backgrounds image profile
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleStoryBackgroundsProfileChange = useCallback(
    async (profileId: string | null) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      const currentSettings = latestSettings.storyBackgroundsSettings || DEFAULT_STORY_BACKGROUNDS_SETTINGS
      await patchChatSettings(
        { storyBackgroundsSettings: { ...currentSettings, defaultImageProfileId: profileId } },
        'Failed to update story backgrounds settings',
        'Failed to update story backgrounds profile'
      )
    },
    [patchChatSettings]
  )

  /**
   * Update dangerous content settings
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleDangerousContentUpdate = useCallback(
    async (updates: Partial<DangerousContentSettings>) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      const currentSettings = latestSettings.dangerousContentSettings || DEFAULT_DANGEROUS_CONTENT_SETTINGS
      await patchChatSettings(
        { dangerousContentSettings: { ...currentSettings, ...updates } },
        'Failed to update dangerous content settings',
        'Failed to update dangerous content settings'
      )
    },
    [patchChatSettings]
  )

  /**
   * Update default timezone setting
   */
  const handleTimezoneChange = useCallback(
    async (timezone: string | null) => {
      if (!settings) return

      await patchChatSettings(
        { timezone },
        'Failed to update timezone',
        'Failed to update timezone'
      )
    },
    [settings, patchChatSettings]
  )

  return {
    settings,
    loading,
    error,
    saving,
    success,
    connectionProfiles,
    embeddingProfiles,
    imageProfiles,
    loadingProfiles,
    fetchSettings,
    handleAvatarModeChange,
    handleAvatarStyleChange,
    handleCheapLLMUpdate,
    handleImageDescriptionProfileChange,
    handleUncensoredImageDescriptionProfileChange,
    handleMemoryCascadeUpdate,
    handleTokenDisplayChange,
    handleContextCompressionUpdate,
    handleLLMLoggingChange,
    handleAutoDetectRngChange,
    handleCustomToolsChange,
    handleCompositionModeDefaultChange,
    handleComposerSpellcheckChange,
    handleComposerEmojiChange,
    handleComposerUnicodeChange,
    handleAutoScrollOnResponseCompleteChange,
    handleTextReplacementsEnabledChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
    handleStoryBackgroundsEnabledChange,
    handleStoryBackgroundsProfileChange,
    handleDangerousContentUpdate,
    handleTimezoneChange,
    handleAutonomousRoomSettingsUpdate,
    handleThinkingDisplayUpdate,
    handleAnswerConfirmationUpdate,
    handleSmartTypographyUpdate,
  }
}
