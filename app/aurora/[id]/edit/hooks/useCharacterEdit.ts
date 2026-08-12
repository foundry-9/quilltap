'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showAlert } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'
import {
  Character,
  CharacterFormData,
  CharacterEditState,
  CharacterScenario,
} from '../types'

const INITIAL_FORM_DATA: CharacterFormData = {
  name: '',
  aliases: [],
  pronouns: null,
  title: '',
  identity: '',
  description: '',
  manifesto: '',
  personality: '',
  scenarios: [],
  firstMessage: '',
  exampleDialogues: '',
  systemPrompt: '',
  avatarUrl: '',
  defaultConnectionProfileId: '',
  systemTransparency: false,
  coreWhisperEnabled: null,
  canBeCarina: false,
}

/**
 * Hook for managing character edit state and operations
 * Handles fetching, form management, and API interactions
 */
export function useCharacterEdit(id: string) {
  const router = useRouter()
  // Keep-alive-safe returns: inside the workspace, "done editing" closes this
  // edit tab (focus falls back to the adjacent, kept-alive tab the user came
  // from — typically the Aurora grid or the character detail, untouched);
  // outside the workspace it is a normal route push to the character view.
  const navigate = useWorkspaceNavigate()
  const closeSelf = useCloseSelfTab()
  const returnToCharacter = useCallback(() => {
    if (!closeSelf()) {
      router.push(`/aurora/${id}/view`)
    }
  }, [closeSelf, router, id])

  // State management
  const [state, setState] = useState<CharacterEditState>({
    loading: true,
    saving: false,
    error: null,
    showUploadDialog: false,
    showAvatarSelector: false,
    character: null,
    formData: INITIAL_FORM_DATA,
    originalFormData: INITIAL_FORM_DATA,
    avatarRefreshKey: 0,
    externalUpdateCount: 0,
  })

  /**
   * Fetch character data from API
   */
  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${id}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      const char = data.character

      setState((prev) => {
        const hasImageChanged = prev.character?.defaultImageId !== char.defaultImageId
        const initialFormData: CharacterFormData = {
          name: char.name,
          aliases: char.aliases || [],
          pronouns: char.pronouns || null,
          title: char.title || '',
          identity: char.identity || '',
          description: char.description || '',
          manifesto: char.manifesto || '',
          personality: char.personality || '',
          scenarios: char.scenarios || [],
          firstMessage: char.firstMessage || '',
          exampleDialogues: char.exampleDialogues || '',
          systemPrompt: char.systemPrompt || '',
          avatarUrl: char.avatarUrl || '',
          defaultConnectionProfileId: char.defaultConnectionProfileId || '',
          systemTransparency: char.systemTransparency === true,
          coreWhisperEnabled:
            char.coreWhisperEnabled === true || char.coreWhisperEnabled === false
              ? char.coreWhisperEnabled
              : null,
          canBeCarina: char.canBeCarina === true,
        }

        return {
          ...prev,
          character: char,
          avatarRefreshKey: hasImageChanged ? prev.avatarRefreshKey + 1 : prev.avatarRefreshKey,
          formData: initialFormData,
          originalFormData: initialFormData,
          loading: false,
          externalUpdateCount: prev.externalUpdateCount + 1,
        }
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('Failed to fetch character', errorMsg)
      setState((prev) => ({
        ...prev,
        error: errorMsg,
        loading: false,
      }))
    }
  }, [id])

  /**
   * Initial data loading effect
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount + form initialization with loaded data
    fetchCharacter()
  }, [id, fetchCharacter])

  /**
   * Check if form has unsaved changes
   */
  const hasChanges = JSON.stringify(state.formData) !== JSON.stringify(state.originalFormData)

  /**
   * Handle form field changes
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, [e.target.name]: e.target.value },
    }))
  }

  /**
   * Force the markdown editors to remount with the current formData values.
   * Call after any code path that writes fields without going through user
   * input (e.g. the AI wizard apply flow firing synthetic events).
   */
  const bumpExternalUpdateCount = useCallback(() => {
    setState((prev) => ({
      ...prev,
      externalUpdateCount: prev.externalUpdateCount + 1,
    }))
  }, [])

  /**
   * Handle aliases array changes
   */
  const handleAliasesChange = (aliases: string[]) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, aliases },
    }))
  }

  /**
   * Handle pronouns changes
   */
  const handlePronounsChange = (pronouns: { subject: string; object: string; possessive: string } | null) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, pronouns },
    }))
  }

  /**
   * Handle scenarios array changes
   */
  const handleScenariosChange = (scenarios: CharacterScenario[]) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, scenarios },
    }))
  }

  /**
   * Handle systemTransparency toggle. Local state only; persists with the
   * regular form save so the user can change their mind before committing.
   */
  const handleSystemTransparencyChange = (enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, systemTransparency: enabled },
    }))
  }

  /**
   * Handle canBeCarina toggle. Local state only; persists with the regular
   * form save so the user can change their mind before committing.
   */
  const handleCanBeCarinaChange = (enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, canBeCarina: enabled },
    }))
  }

  /**
   * Handle per-character Core whisper override. Tri-state:
   *   null  = inherit from global (default)
   *   true  = always offer the Core packet
   *   false = always skip the Core packet
   */
  const handleCoreWhisperEnabledChange = (value: boolean | null) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, coreWhisperEnabled: value },
    }))
  }

  /**
   * Submit form and save character data
   */
  const handleSubmit = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault()
    setState((prev) => ({ ...prev, saving: true, error: null }))

    try {
      const res = await fetch(`/api/v1/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }

      await fetchCharacter()
      setState((prev) => ({ ...prev, saving: false }))
      showSuccessToast('Character saved successfully!')

      returnToCharacter()
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('Failed to save character', errorMsg)
      setState((prev) => ({
        ...prev,
        saving: false,
        error: errorMsg,
      }))
      showErrorToast(errorMsg)
      return false
    }
  }

  /**
   * Handle cancel/back navigation
   * Navigates to NPCs settings if character is an NPC, otherwise to character view
   */
  const handleCancel = async () => {
    if (hasChanges) {
      const result = await showAlert('You have unsaved changes. What would you like to do?', [
        'Save',
        'Discard',
        'Cancel',
      ])

      if (result === 'Save') {
        // Submit the form
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
        document.querySelector('form')?.dispatchEvent(submitEvent)
        return
      } else if (result === 'Cancel' || result === undefined) {
        return
      }
      // If 'Discard', continue to navigation
    }
    // Navigate to appropriate location based on character type
    if (state.character?.npc) {
      navigate('/settings')
      closeSelf()
    } else {
      returnToCharacter()
    }
  }

  /**
   * Check if character is an NPC
   */
  const isNpc = state.character?.npc ?? false

  /**
   * Set character avatar
   */
  const setCharacterAvatar = async (imageId: string) => {
    try {
      if (!id) {
        throw new Error('Character ID is missing')
      }

      const res = await fetch(`/api/v1/characters/${id}?action=avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      const responseData = await res.json()

      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to set avatar')
      }

      await fetchCharacter()
      setState((prev) => ({ ...prev, showAvatarSelector: false }))
      showSuccessToast('Avatar updated!')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to set avatar'
      console.error('Failed to set avatar', errorMsg)
      showErrorToast(errorMsg)
    }
  }

  /**
   * Get avatar source URL with cache busting
   */
  const getAvatarSrc = (): string | null => {
    let src = null
    if (state.character?.defaultImage) {
      const filepath = state.character.defaultImage.filepath
      src = state.character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    } else {
      src = state.character?.avatarUrl || null
    }
    // Add cache-busting parameter based on defaultImageId to force reload when avatar changes
    if (src && state.character?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${state.character.defaultImageId}`
    }
    return src
  }

  /**
   * Update state for showing/hiding modals
   */
  const toggleUploadDialog = (show: boolean) => {
    setState((prev) => ({ ...prev, showUploadDialog: show }))
  }

  const toggleAvatarSelector = (show: boolean) => {
    setState((prev) => ({ ...prev, showAvatarSelector: show }))
  }

  /**
   * Clear avatar (set to null)
   */
  const clearAvatar = async () => {
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) {
        throw new Error('Failed to clear avatar')
      }

      await fetchCharacter()
      showSuccessToast('Avatar cleared!')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to clear avatar'
      console.error('Failed to clear avatar', errorMsg)
      showErrorToast(errorMsg)
    }
  }

  return {
    // State
    ...state,

    // Computed
    isNpc,

    // Methods
    handleChange,
    handleAliasesChange,
    handlePronounsChange,
    handleScenariosChange,
    handleSystemTransparencyChange,
    handleCanBeCarinaChange,
    handleCoreWhisperEnabledChange,
    handleSubmit,
    handleCancel,
    setCharacterAvatar,
    getAvatarSrc,
    toggleUploadDialog,
    toggleAvatarSelector,
    clearAvatar,
    fetchCharacter,
    bumpExternalUpdateCount,
    hasChanges,
  }
}
