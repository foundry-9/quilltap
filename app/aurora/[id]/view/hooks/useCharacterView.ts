'use client'

import { useCallback, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  applyTemplateTransform,
  collectTemplateFields,
  countTemplateLiterals,
  countTemplateReplacements,
  replaceTemplateWithName,
  replaceWithTemplate,
} from '@/components/characters/TemplateHighlighter'
import { applyCharacterFieldUpdates } from '@/components/characters/apply-character-field-updates'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'
import type { TimestampConfig } from '@/lib/schemas/types'
import {
  Character,
  Tag,
  ConnectionProfile,
  UserControlledCharacter,
  ImageProfile,
  TemplateCounts,
} from '../types'

interface UseCharacterViewReturn {
  loading: boolean
  error: string | null
  character: Character | null
  tags: Tag[]
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  defaultPartnerId: string
  defaultPartnerName: string | null
  imageProfiles: ImageProfile[]
  defaultImageProfileId: string
  avatarRefreshKey: number
  templateCounts: TemplateCounts
  literalCounts: { charCount: number; userCount: number }
  replacingTemplate: 'char' | 'user' | null
  reversingTemplate: 'char' | 'user' | null
  togglingNpc: boolean
  togglingFavorite: boolean
  togglingControlledBy: boolean
  togglingCarina: boolean
  savingAgentMode: boolean
  savingHelpTools: boolean
  savingCanDressThemselves: boolean
  savingCanCreateOutfits: boolean
  savingCanChooseOutfit: boolean
  savingTimestampConfig: boolean
  savingDefaultScenario: boolean
  savingDefaultSystemPrompt: boolean
  fetchCharacter: () => Promise<void>
  fetchTags: () => Promise<void>
  fetchProfiles: () => Promise<void>
  fetchUserControlledCharacters: () => Promise<void>
  fetchDefaultPartner: () => Promise<void>
  fetchImageProfiles: () => Promise<void>
  setCharacter: (char: Character | null) => void
  setDefaultPartnerId: (id: string) => void
  setAvatarRefreshKey: (key: number) => void
  setImageProfiles: (profiles: ImageProfile[]) => void
  handleTemplateReplace: (type: 'char' | 'user') => Promise<void>
  handleReverseTemplate: (type: 'char' | 'user', chosenName: string) => Promise<void>
  handleSaveConnectionProfile: (profileId: string) => Promise<void>
  handleSaveDefaultPartner: (partnerId: string) => Promise<void>
  handleSaveImageProfile: (profileId: string | null) => Promise<void>
  handleSaveAgentMode: (enabled: boolean | null) => Promise<void>
  handleSaveHelpTools: (enabled: boolean | null) => Promise<void>
  handleSaveCanDressThemselves: (enabled: boolean | null) => Promise<void>
  handleSaveCanCreateOutfits: (enabled: boolean | null) => Promise<void>
  handleSaveCanChooseOutfit: (enabled: boolean) => Promise<void>
  handleSaveTimestampConfig: (config: TimestampConfig | null) => Promise<void>
  handleSaveDefaultScenario: (scenarioId: string | null) => Promise<void>
  handleSaveDefaultSystemPrompt: (promptId: string | null) => Promise<void>
  handleToggleNpc: () => Promise<void>
  handleToggleFavorite: () => Promise<void>
  handleToggleControlledBy: () => Promise<void>
  handleToggleCarina: () => Promise<void>
}

export function useCharacterView(characterId: string): UseCharacterViewReturn {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<UserControlledCharacter[]>([])
  const [defaultPartnerId, setDefaultPartnerId] = useState<string>('')
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [defaultImageProfileId, setDefaultImageProfileId] = useState<string>('')
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [replacingTemplate, setReplacingTemplate] = useState<'char' | 'user' | null>(null)
  const [reversingTemplate, setReversingTemplate] = useState<'char' | 'user' | null>(null)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)
  const [savingImageProfile, setSavingImageProfile] = useState(false)
  const [togglingNpc, setTogglingNpc] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState(false)
  const [togglingControlledBy, setTogglingControlledBy] = useState(false)
  const [togglingCarina, setTogglingCarina] = useState(false)
  const [savingAgentMode, setSavingAgentMode] = useState(false)
  const [savingHelpTools, setSavingHelpTools] = useState(false)
  const [savingCanDressThemselves, setSavingCanDressThemselves] = useState(false)
  const [savingCanCreateOutfits, setSavingCanCreateOutfits] = useState(false)
  const [savingCanChooseOutfit, setSavingCanChooseOutfit] = useState(false)
  const [savingTimestampConfig, setSavingTimestampConfig] = useState(false)
  const [savingDefaultScenario, setSavingDefaultScenario] = useState(false)
  const [savingDefaultSystemPrompt, setSavingDefaultSystemPrompt] = useState(false)

  // Get the default partner for template highlighting ({{user}} replacement)
  // This uses the new default conversation partner system instead of old personas
  const defaultPartner = userControlledCharacters.find(c => c.id === defaultPartnerId)
  const defaultPartnerName = defaultPartner?.name || null

  // `collectTemplateFields` is the single source of truth for which character
  // fields participate in templating (prose scalars incl. identity/manifesto,
  // every scenario + system prompt, the physicalDescription prose/prompt
  // fields). Both the forward count and the reverse-literal count walk it, and
  // so does the transform engine, so they can never drift. `properties.json`
  // metadata (pronouns, aliases, title, talkativeness) is intentionally excluded.
  const templateDescriptors = character ? collectTemplateFields(character) : []
  const templateFields: Record<string, string | null | undefined> = Object.fromEntries(
    templateDescriptors.map((d) => [d.key, d.value])
  )

  const templateCounts = character
    ? countTemplateReplacements(templateFields, character.name, defaultPartnerName)
    : { charCount: 0, userCount: 0, fieldCounts: {} }

  // Count `{{char}}`/`{{user}}` literals already present — drives the reverse
  // ("restore name") buttons.
  const literalCounts = countTemplateLiterals(templateDescriptors.map((d) => d.value))

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      setCharacter((prev) => {
        if (prev?.defaultImageId !== data.character.defaultImageId) {
          setAvatarRefreshKey(k => k + 1)
        }
        return data.character
      })
      // Set the default image profile ID from the character data
      if (data.character.defaultImageProfileId) {
        setDefaultImageProfileId(data.character.defaultImageProfileId)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMsg)
      console.error('Failed to fetch character', { error: errorMsg, characterId })
    } finally {
      setLoading(false)
    }
  }, [characterId])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=get-tags`)
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      setTags(data.tags || [])
    } catch (err) {
      console.error('Failed to fetch tags:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/connection-profiles')
      if (res.ok) {
        const data = await res.json()
        const profiles = data.profiles || []
        setProfiles(profiles.map((p: any) => ({ id: p.id, name: p.name })))
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchImageProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/image-profiles')
      if (res.ok) {
        const data = await res.json()
        setImageProfiles(data)
      }
    } catch (err) {
      console.error('Failed to fetch image profiles:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchUserControlledCharacters = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/characters?controlledBy=user')
      if (res.ok) {
        const data = await res.json()
        const characters = data.characters || []
        setUserControlledCharacters(characters.map((c: any) => ({
          id: c.id,
          name: c.name,
          title: c.title || null,
        })))
      }
    } catch (err) {
      console.error('Failed to fetch user-controlled characters:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const fetchDefaultPartner = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=default-partner`)
      if (res.ok) {
        const data = await res.json()
        if (data.partnerId) {
          setDefaultPartnerId(data.partnerId)
        }
      }
    } catch (err) {
      console.error('Failed to fetch default partner:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [characterId])

  // Shared save routine for both template directions. The transform turns each
  // templatable field's text from one form to the other; applyTemplateTransform
  // routes the results to the main PUT and the dedicated system-prompt endpoint
  // (system prompts are stripped by the character PUT schema). A full refetch
  // resyncs counts/badges/buttons; on partial failure we still refetch so the UI
  // never shows stale optimistic state.
  const runTemplateSave = async (
    transform: (text: string) => string,
    successMsg: string
  ): Promise<void> => {
    if (!character) return

    const { mainUpdates, changedSystemPrompts } = applyTemplateTransform(character, transform)

    if (Object.keys(mainUpdates).length === 0 && changedSystemPrompts.length === 0) {
      showSuccessToast('No replacements needed')
      return
    }

    const { errors } = await applyCharacterFieldUpdates(characterId, {
      mainUpdates,
      promptUpdates: changedSystemPrompts,
    })

    await fetchCharacter()

    if (errors.length > 0) {
      showErrorToast(errors.join(' '))
    } else {
      showSuccessToast(successMsg)
    }
  }

  // Forward: replace hard-coded names with {{char}} / {{user}} template tokens.
  const handleTemplateReplace = async (type: 'char' | 'user') => {
    if (!character) return

    const nameToReplace = type === 'char' ? character.name : defaultPartnerName
    const template = type === 'char' ? '{{char}}' : '{{user}}'

    if (!nameToReplace) return

    setReplacingTemplate(type)
    try {
      await runTemplateSave(
        (text) => replaceWithTemplate(text, nameToReplace, template),
        `Replaced ${type === 'char' ? 'character name' : 'user character name'} with ${template}`
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to replace template')
      console.error('Template replacement failed', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setReplacingTemplate(null)
    }
  }

  // Reverse: replace {{char}} / {{user}} tokens with a concrete name. For 'char'
  // the name is this character's own; for 'user' the caller supplies the chosen
  // user-controlled character's name (from the picker dialog).
  const handleReverseTemplate = async (type: 'char' | 'user', chosenName: string) => {
    if (!character) return

    const name = type === 'char' ? character.name : chosenName
    if (!name) return

    setReversingTemplate(type)
    try {
      await runTemplateSave(
        (text) => replaceTemplateWithName(text, type, name),
        type === 'char' ? `Restored {{char}} to ${name}` : `Restored {{user}} to ${name}`
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to restore template')
      console.error('Template restore failed', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setReversingTemplate(null)
    }
  }

  const handleSaveConnectionProfile = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      // Handle the special "User Acts As Character" virtual profile
      const isUserControlled = profileId === USER_CONTROLLED_PROFILE_ID
      const updatePayload = isUserControlled
        ? {
            controlledBy: 'user' as const,
            defaultConnectionProfileId: undefined,
          }
        : {
            controlledBy: 'llm' as const,
            defaultConnectionProfileId: profileId || undefined,
          }

      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      })
      if (!res.ok) throw new Error('Failed to update connection profile')
      await fetchCharacter()
      showSuccessToast(isUserControlled ? 'Character set to user-controlled' : 'Connection profile updated')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update connection profile')
      console.error('Failed to save connection profile', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handleSaveDefaultPartner = async (partnerId: string) => {
    setSavingPartner(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=set-default-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: partnerId || null }),
      })
      if (!res.ok) throw new Error('Failed to update default partner')

      setDefaultPartnerId(partnerId)
      showSuccessToast(partnerId ? 'Default partner updated' : 'Default partner removed')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update partner')
      console.error('Failed to save default partner', { error: err instanceof Error ? err.message : String(err) })
      await fetchDefaultPartner() // Revert to server state
    } finally {
      setSavingPartner(false)
    }
  }

  const handleSaveImageProfile = async (profileId: string | null) => {
    setSavingImageProfile(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultImageProfileId: profileId }),
      })
      if (!res.ok) throw new Error('Failed to update image profile')

      setDefaultImageProfileId(profileId || '')
      showSuccessToast(profileId ? 'Image profile updated' : 'Image profile removed')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update image profile')
      console.error('Failed to save image profile', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingImageProfile(false)
    }
  }

  const handleSaveAgentMode = async (enabled: boolean | null) => {
    setSavingAgentMode(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAgentModeEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update agent mode setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultAgentModeEnabled: enabled })
      }
      const message = enabled === null
        ? 'Agent mode set to inherit from global'
        : enabled
          ? 'Agent mode enabled by default'
          : 'Agent mode disabled by default'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update agent mode')
      console.error('Failed to save agent mode', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingAgentMode(false)
    }
  }

  const handleSaveHelpTools = async (enabled: boolean | null) => {
    setSavingHelpTools(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultHelpToolsEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update help tools setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultHelpToolsEnabled: enabled })
      }
      const message = enabled === null
        ? 'Help tools set to inherit from global (disabled)'
        : enabled
          ? 'Help tools enabled'
          : 'Help tools disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update help tools')
      console.error('Failed to save help tools', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingHelpTools(false)
    }
  }

  const handleSaveCanDressThemselves = async (enabled: boolean | null) => {
    setSavingCanDressThemselves(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canDressThemselves: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update self-dressing setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, canDressThemselves: enabled })
      }
      const message = enabled === null
        ? 'Wardrobe self-dressing set to inherit from global (enabled)'
        : enabled
          ? 'Wardrobe self-dressing enabled'
          : 'Wardrobe self-dressing disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update self-dressing setting')
      console.error('Failed to save self-dressing setting', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingCanDressThemselves(false)
    }
  }

  const handleSaveCanCreateOutfits = async (enabled: boolean | null) => {
    setSavingCanCreateOutfits(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canCreateOutfits: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update outfit creation setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, canCreateOutfits: enabled })
      }
      const message = enabled === null
        ? 'Outfit creation set to inherit from global (enabled)'
        : enabled
          ? 'Outfit creation enabled'
          : 'Outfit creation disabled'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update outfit creation setting')
      console.error('Failed to save outfit creation setting', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingCanCreateOutfits(false)
    }
  }

  const handleSaveCanChooseOutfit = async (enabled: boolean) => {
    setSavingCanChooseOutfit(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canChooseOutfit: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update outfit-choice setting')

      // Update local state
      if (character) {
        setCharacter({ ...character, canChooseOutfit: enabled })
      }
      showSuccessToast(
        enabled
          ? 'New chats will let this character choose their own opening outfit'
          : 'New chats will use this character’s default opening outfit',
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update outfit-choice setting')
      console.error('Failed to save outfit-choice setting', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingCanChooseOutfit(false)
    }
  }

  const handleSaveTimestampConfig = async (config: TimestampConfig | null) => {
    setSavingTimestampConfig(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTimestampConfig: config }),
      })
      if (!res.ok) throw new Error('Failed to update timestamp config')

      // Update local state
      if (character) {
        setCharacter({ ...character, defaultTimestampConfig: config })
      }
      const message = config && config.mode !== 'NONE'
        ? 'Default timestamp settings updated'
        : 'Default timestamp settings cleared'
      showSuccessToast(message)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update timestamp config')
      console.error('Failed to save timestamp config', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter() // Revert to server state
    } finally {
      setSavingTimestampConfig(false)
    }
  }

  const handleSaveDefaultScenario = async (scenarioId: string | null) => {
    setSavingDefaultScenario(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultScenarioId: scenarioId }),
      })
      if (!res.ok) throw new Error('Failed to update default scenario')

      if (character) {
        setCharacter({ ...character, defaultScenarioId: scenarioId })
      }
      showSuccessToast(scenarioId ? 'Default scenario updated' : 'Default scenario cleared')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update default scenario')
      console.error('Failed to save default scenario', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter()
    } finally {
      setSavingDefaultScenario(false)
    }
  }

  const handleSaveDefaultSystemPrompt = async (promptId: string | null) => {
    setSavingDefaultSystemPrompt(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSystemPromptId: promptId }),
      })
      if (!res.ok) throw new Error('Failed to update default system prompt')

      if (character) {
        // Also update the isDefault flags on the prompts array to stay in sync
        const updatedPrompts = character.systemPrompts?.map(p => ({
          ...p,
          isDefault: promptId ? p.id === promptId : p.isDefault,
        })) || []
        setCharacter({ ...character, defaultSystemPromptId: promptId, systemPrompts: updatedPrompts })
      }
      showSuccessToast(promptId ? 'Default system prompt updated' : 'Default system prompt cleared')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update default system prompt')
      console.error('Failed to save default system prompt', { error: err instanceof Error ? err.message : String(err) })
      await fetchCharacter()
    } finally {
      setSavingDefaultSystemPrompt(false)
    }
  }

  const handleToggleNpc = async () => {
    if (!character) return
    setTogglingNpc(true)
    try {
      const newNpcValue = !character.npc
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc: newNpcValue }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }
      // Update local state
      setCharacter({ ...character, npc: newNpcValue })
      showSuccessToast(newNpcValue ? 'Converted to NPC' : 'Converted to Character')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle NPC status')
      console.error('Failed to toggle NPC status', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingNpc(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (!character) return
    setTogglingFavorite(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=favorite`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to toggle favorite')
      }
      const data = await res.json()
      setCharacter({ ...character, isFavorite: data.character.isFavorite })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle favorite')
      console.error('Failed to toggle favorite', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingFavorite(false)
    }
  }

  const handleToggleControlledBy = async () => {
    if (!character) return
    setTogglingControlledBy(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=toggle-controlled-by`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to toggle controlled-by')
      }
      const data = await res.json()
      setCharacter({ ...character, controlledBy: data.character.controlledBy })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle controlled-by')
      console.error('Failed to toggle controlled-by', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingControlledBy(false)
    }
  }

  const handleToggleCarina = async () => {
    if (!character) return
    setTogglingCarina(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=toggle-carina`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to toggle Carina eligibility')
      }
      const data = await res.json()
      setCharacter({ ...character, canBeCarina: data.character.canBeCarina })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle Carina eligibility')
      console.error('Failed to toggle Carina eligibility', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTogglingCarina(false)
    }
  }

  return {
    loading,
    error,
    character,
    tags,
    profiles,
    userControlledCharacters,
    defaultPartnerId,
    defaultPartnerName,
    imageProfiles,
    defaultImageProfileId,
    avatarRefreshKey,
    templateCounts,
    literalCounts,
    replacingTemplate,
    reversingTemplate,
    togglingNpc,
    togglingFavorite,
    togglingControlledBy,
    togglingCarina,
    savingAgentMode,
    savingHelpTools,
    savingCanDressThemselves,
    savingCanCreateOutfits,
    savingCanChooseOutfit,
    savingTimestampConfig,
    savingDefaultScenario,
    savingDefaultSystemPrompt,
    fetchCharacter,
    fetchTags,
    fetchProfiles,
    fetchUserControlledCharacters,
    fetchDefaultPartner,
    fetchImageProfiles,
    setCharacter,
    setDefaultPartnerId,
    setAvatarRefreshKey,
    setImageProfiles,
    handleTemplateReplace,
    handleReverseTemplate,
    handleSaveConnectionProfile,
    handleSaveDefaultPartner,
    handleSaveImageProfile,
    handleSaveAgentMode,
    handleSaveHelpTools,
    handleSaveCanDressThemselves,
    handleSaveCanCreateOutfits,
    handleSaveCanChooseOutfit,
    handleSaveTimestampConfig,
    handleSaveDefaultScenario,
    handleSaveDefaultSystemPrompt,
    handleToggleNpc,
    handleToggleFavorite,
    handleToggleControlledBy,
    handleToggleCarina,
  }
}
