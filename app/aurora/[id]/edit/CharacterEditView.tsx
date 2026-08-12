'use client'

import { useEffect, useState } from 'react'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { EntityTabs, Tab } from '@/components/tabs'
import { Icon } from '@/components/ui/icon'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'
import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'
import { AIWizardModal, type GeneratedCharacterData, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import LLMLogsSection from '@/components/characters/LLMLogsSection'
import { DescriptionsTab } from '../view/components/DescriptionsTab'
import { useCharacterEdit } from './hooks'
import { CharacterBasicInfo } from './components'
import { AestheticEditorField } from '@/components/settings/AestheticEditorField'
import type { CharacterScenario } from './types'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { buildWizardCurrentData, getGeneratedCharacterTextEntries } from '../../shared/wizard-text-fields'

/**
 * Tab configuration for character edit page
 */
const EDIT_CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: <Icon name="user" className="w-4 h-4" />,
  },
  {
    id: 'system-prompts',
    label: 'System Prompts',
    icon: <Icon name="code" className="w-4 h-4" />,
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    icon: <Icon name="wardrobe" className="w-4 h-4" />,
  },
  {
    id: 'descriptions',
    label: 'Appearance',
    icon: <Icon name="file" className="w-4 h-4" />,
  },
  {
    id: 'rename',
    label: 'Rename/Replace',
    icon: <Icon name="pencil" className="w-4 h-4" />,
  },
]

/**
 * Main character edit view component
 * Orchestrates the editing of character information across multiple tabs
 */
export function CharacterEditView({ characterId, initialTab }: { characterId: string; initialTab?: string }) {
  const id = characterId

  const {
    loading,
    saving,
    error,
    character,
    formData,
    showAvatarSelector,
    showUploadDialog,
    avatarRefreshKey,
    externalUpdateCount,
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
    toggleAvatarSelector,
    toggleUploadDialog,
    fetchCharacter,
    bumpExternalUpdateCount,
    isNpc,
  } = useCharacterEdit(id)

  const [showWizard, setShowWizard] = useState(false)
  const [savingCanChooseOutfit, setSavingCanChooseOutfit] = useState(false)
  const wardrobeDialog = useWardrobeDialogOptional()

  // Persist the "let this character choose their opening outfit" flag (vault
  // properties.json). Immediate save, mirroring the other per-character wardrobe
  // toggles; on failure we re-fetch to snap the checkbox back to server truth.
  const handleSaveCanChooseOutfit = async (enabled: boolean) => {
    setSavingCanChooseOutfit(true)
    try {
      const res = await fetch(`/api/v1/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canChooseOutfit: enabled }),
      })
      if (!res.ok) throw new Error('Failed to update outfit-choice setting')
    } catch (err) {
      console.error('Failed to save outfit-choice setting', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      await fetchCharacter()
      setSavingCanChooseOutfit(false)
    }
  }

  // Handle applying wizard-generated data
  const handleWizardApply = async (data: GeneratedCharacterData) => {
    // Apply text fields by creating synthetic events
    const textEntries = getGeneratedCharacterTextEntries(data)
    for (const field of textEntries) {
      const syntheticEvent = {
        target: { name: field.field, value: field.value },
      } as React.ChangeEvent<HTMLInputElement>
      handleChange(syntheticEvent)
    }
    // Remount markdown editors so they pick up the wizard-written values
    // instead of staying on whatever was on screen before.
    if (textEntries.length > 0) {
      bumpExternalUpdateCount()
    }

    // Handle physical description if generated. The cutover collapsed the
    // multi-record array to a single record; PATCH the character row directly
    // and the repository's write overlay routes it into the vault.
    if (data.physicalDescription) {
      try {
        const response = await fetch(`/api/v1/characters/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            physicalDescription: {
              name: data.physicalDescription.name,
              headAndShouldersPrompt: data.physicalDescription.headAndShouldersPrompt,
              shortPrompt: data.physicalDescription.shortPrompt,
              mediumPrompt: data.physicalDescription.mediumPrompt,
              longPrompt: data.physicalDescription.longPrompt,
              completePrompt: data.physicalDescription.completePrompt,
              fullDescription: data.physicalDescription.fullDescription,
            },
          }),
        })

        if (response.ok) {
          showSuccessToast('Physical description saved')
        } else {
          const errorData = await response.json().catch(() => ({}))
          showErrorToast(errorData.error || 'Failed to save physical description')
        }
      } catch (err) {
        console.error('Failed to save physical description', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to save physical description')
      }
    }

    // Handle wizard-generated wardrobe items
    if (data.wardrobeItems && data.wardrobeItems.length > 0) {
      let wardrobeItemsSaved = 0
      for (const item of data.wardrobeItems) {
        try {
          const res = await fetch(`/api/v1/characters/${id}/wardrobe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: item.title,
              description: item.description || null,
              types: item.types,
              appropriateness: item.appropriateness || null,
            }),
          })
          if (res.ok) {
            wardrobeItemsSaved++
          }
        } catch (err) {
          console.error('Failed to create wardrobe item', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (wardrobeItemsSaved > 0) {
        showSuccessToast(`${wardrobeItemsSaved} wardrobe item${wardrobeItemsSaved > 1 ? 's' : ''} created`)
      }
    }

    // Handle wizard-generated scenarios
    const normalizedScenarios = normalizeGeneratedScenarios(data.scenarios)
    if (normalizedScenarios.length > 0) {
      let scenariosSaved = 0
      const savedScenarios: CharacterScenario[] = []
      for (const scenario of normalizedScenarios) {
        try {
          const res = await fetch(`/api/v1/characters/${id}/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: scenario.title, content: scenario.content }),
          })
          if (res.ok) {
            const resData = await res.json()
            scenariosSaved++
            // Collect saved scenario with its server-assigned ID
            if (resData.scenario) {
              savedScenarios.push({
                id: resData.scenario.id,
                title: resData.scenario.title,
                content: resData.scenario.content,
                createdAt: resData.scenario.createdAt,
                updatedAt: resData.scenario.updatedAt,
              })
            }
          }
        } catch (err) {
          console.error('Failed to create scenario', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (scenariosSaved > 0) {
        showSuccessToast(`${scenariosSaved} scenario${scenariosSaved > 1 ? 's' : ''} created`)
        // Update scenarios in form state directly instead of re-fetching
        // (fetchCharacter would overwrite wizard-applied text fields that haven't been saved yet)
        handleScenariosChange([...(formData.scenarios || []), ...savedScenarios])
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  const avatarSrc = getAvatarSrc()

  return (
    <div className="character-edit qt-page-container text-foreground">
      {/* Header Section */}
      <div className="mb-8">
        <button
          onClick={handleCancel}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          {isNpc ? '← Back to NPCs' : '← Back'}
        </button>
        <div className="flex items-center gap-4">
          {/* Avatar Display */}
          <div className="relative">
            {avatarSrc ? (

              <img
                key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                src={avatarSrc}
                alt={character?.name || ''}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full qt-bg-muted">
                <span className="qt-heading-1 qt-text-secondary">
                  {character?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <button
              onClick={() => toggleAvatarSelector(true)}
              className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground qt-shadow-lg transition hover:qt-bg-primary/90"
              title="Change avatar"
            >
              <Icon name="pencil" className="w-3 h-3" />
            </button>
          </div>

          {/* Title and AI Wizard Button */}
          <div className="flex-1 flex items-center justify-between">
            <h1 className="qt-heading-1">
              Edit: {character?.name || 'Loading...'}
            </h1>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="qt-button-secondary flex items-center gap-2"
              title="Use AI to generate character details"
            >
              <Icon name="wand" className="w-4 h-4" />
              AI Wizard
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 rounded border qt-border-destructive/40 qt-bg-destructive/10 px-4 py-3 qt-text-destructive">
          {error}
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit}>
        <EntityTabs tabs={EDIT_CHARACTER_TABS} defaultTab={initialTab ?? 'details'}>
          {(activeTab: string) => {
            switch (activeTab) {
              case 'details':
                return (
                  <CharacterBasicInfo
                    characterId={id}
                    formData={formData}
                    externalUpdateCount={externalUpdateCount}
                    onChange={handleChange}
                    onAliasesChange={handleAliasesChange}
                    onPronounsChange={handlePronounsChange}
                    onScenariosChange={handleScenariosChange}
                    onSystemTransparencyChange={handleSystemTransparencyChange}
                    onCanBeCarinaChange={handleCanBeCarinaChange}
                    onCoreWhisperEnabledChange={handleCoreWhisperEnabledChange}
                  />
                )

              case 'system-prompts':
                return (
                  <SystemPromptsEditor
                    characterId={id}
                    characterName={character?.name || 'Character'}
                    onUpdate={fetchCharacter}
                  />
                )

              case 'wardrobe':
                return (
                  <div className="space-y-4">
                    <p className="qt-text-small qt-text-secondary">
                      The wardrobe is managed in the global Wardrobe dialog so
                      you can drop in from anywhere — including from inside a
                      chat — and edit, layer, or save outfits without leaving
                      the page you&apos;re on.
                    </p>
                    <div className="rounded-lg border qt-border-default qt-bg-card p-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={character?.canChooseOutfit ?? false}
                          onChange={(e) => handleSaveCanChooseOutfit(e.target.checked)}
                          disabled={savingCanChooseOutfit || !character}
                          className="mt-1 accent-[var(--primary)]"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="qt-text-label block">Let this character choose their opening outfit</span>
                          <span className="qt-text-small qt-text-secondary block mt-0.5">
                            When enabled, a new chat with this character defaults
                            its Starting Outfit to “Let character choose” instead
                            of their default wardrobe. You can still overrule it
                            per chat.
                          </span>
                        </span>
                        {savingCanChooseOutfit && (
                          <span className="h-4 w-4 mt-1 animate-spin rounded-full qt-spinner shrink-0" />
                        )}
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => wardrobeDialog?.open({ characterId: id })}
                      disabled={!wardrobeDialog}
                      className="qt-button-primary"
                    >
                      Open wardrobe for {character?.name || 'this character'}
                    </button>
                  </div>
                )

              case 'descriptions':
                return (
                  <div className="space-y-6">
                    <DescriptionsTab characterId={id} />
                    <div className="qt-card qt-bg-card qt-border rounded-lg p-4">
                      <AestheticEditorField
                        label="Depiction Guidelines (the Ariel Clause)"
                        description="This character's own rules about how they may or may not be depicted in story backgrounds and ad-hoc images. These are mandatory constraints, passed to the image-prompt generator whenever this character appears — they are never applied to plain avatars."
                        loadUrl={`/api/v1/characters/${id}?action=depiction-guidelines`}
                        namespace={`DepictionGuidelines-${id}`}
                        disabledHint={
                          character?.characterDocumentMountPointId
                            ? undefined
                            : 'This character has no document vault yet, so depiction guidelines cannot be stored. Save the character once to provision its vault, then return here.'
                        }
                      />
                    </div>
                  </div>
                )

              case 'rename':
                return (
                  <RenameReplaceTab
                    characterId={id}
                    characterName={character?.name || ''}
                    onRenameComplete={() => {
                      fetchCharacter()
                    }}
                  />
                )

              default:
                return null
            }
          }}
        </EntityTabs>

        {/* Form Action Buttons */}
        <div className="flex gap-4 mt-8">
          <button
            type="submit"
            disabled={saving}
            className="qt-button qt-button-primary qt-button-lg flex-1"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="qt-button qt-button-secondary qt-button-lg"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* LLM Logs Section */}
      <LLMLogsSection characterId={id} />

      {/* Avatar Selector Modal */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => toggleAvatarSelector(false)}
        onSelect={setCharacterAvatar}
        currentImageId={character?.defaultImageId}
        contextType="CHARACTER"
        contextId={id}
      />

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => toggleUploadDialog(false)}
        contextType="CHARACTER"
        contextId={id}
        onSuccess={() => {
          toggleUploadDialog(false)
          fetchCharacter()
        }}
      />

      {/* AI Wizard Modal */}
      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterId={id}
        characterName={character?.name || ''}
        currentData={{
          ...buildWizardCurrentData(formData),
          scenarios: formData.scenarios,
        }}
        onApply={handleWizardApply}
      />
    </div>
  )
}
