'use client'

/**
 * Character Detail — the body of a single character's page as a props-driven
 * view, so it renders either at `/aurora/[id]/view` (route wrapper supplies a
 * router `onBack` and reads `?action=chat`) or in place inside the Aurora
 * workspace tab (the list view supplies a state `onBack` and an
 * `openChatOnMount` flag), keeping the workspace mounted for keep-alive.
 *
 * @module app/aurora/[id]/view/CharacterDetailView
 */

import { useEffect, useRef, useState } from 'react'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { EntityTabs } from '@/components/tabs'
import { NewChatModal } from '@/components/new-chat'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { WardrobeInstructionsSection } from '@/components/wardrobe/WardrobeInstructionsSection'
import { CanChooseOutfitToggle } from '@/components/wardrobe/CanChooseOutfitToggle'
import { useCharacterView, useCharacterStats } from './hooks'
import {
  CharacterHeader,
  CharacterDetails,
  CharacterGallery,
  SystemPromptsTab,
  TagsTab,
  ProfilesTab,
  ConversationsTab,
  MemoriesTab,
  DescriptionsTab,
  ExternalPromptDialog,
  ExternalPromptResultDialog,
  ArchiveCharacterDialog,
  RehydrateBundleDialog,
} from './components'
import { showSuccessToast } from '@/lib/toast'
import { CHARACTER_TABS } from './constants'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import type { SearchReplaceResult } from '@/components/tools/search-replace/types'
import { CharacterOptimizerModal } from '@/components/characters/optimizer'

export interface CharacterDetailViewProps {
  characterId: string
  onBack: () => void
  /** Open the new-chat modal as soon as the character loads (the `?action=chat`
      entry point). */
  openChatOnMount?: boolean
  /** Sub-tab to select initially (e.g. `conversations`). Used when rendered as a
      workspace tab, where the `?tab=` URL param is unavailable. */
  initialTab?: string
}

export function CharacterDetailView({ characterId: id, onBack, openChatOnMount = false, initialTab }: CharacterDetailViewProps) {
  const { style } = useAvatarDisplay()
  const wardrobeDialog = useWardrobeDialogOptional()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0

  const [showChatDialog, setShowChatDialog] = useState(false)
  const [showSearchReplaceModal, setShowSearchReplaceModal] = useState(false)
  const [showOptimizerModal, setShowOptimizerModal] = useState(false)
  const [showExternalPromptDialog, setShowExternalPromptDialog] = useState(false)
  const [externalPromptResult, setExternalPromptResult] = useState<string | null>(null)
  const [dataRefreshKey, setDataRefreshKey] = useState(0)
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const chatDialogInitializedRef = useRef(false)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)
  const [savingImageProfile, setSavingImageProfile] = useState(false)

  const {
    loading,
    error,
    character,
    profiles,
    userControlledCharacters,
    defaultPartnerId,
    defaultPartnerName,
    defaultImageProfileId,
    avatarRefreshKey,
    templateCounts,
    literalCounts,
    replacingTemplate,
    reversingTemplate,
    fetchCharacter,
    fetchProfiles,
    fetchUserControlledCharacters,
    fetchDefaultPartner,
    fetchImageProfiles,
    setCharacter,
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
    handleArchive,
    handleRehydrate,
    rehydrating,
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
  } = useCharacterView(id)

  const { stats, groups, fetchStats } = useCharacterStats(id)

  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  // Set after a successful rehydrate: the ARCHIVE bundle left on the shelf,
  // whose disposal the user gets to decide (spec §6 step 6).
  const [leftoverBundleFileId, setLeftoverBundleFileId] = useState<string | null>(null)
  const isArchived = Boolean(character?.archivedAt)

  const handleArchiveConfirm = async () => {
    if (await handleArchive()) {
      setShowArchiveDialog(false)
      setDataRefreshKey((prev) => prev + 1) // header stats: memory count just changed
    }
  }

  const handleRehydrateClick = async () => {
    const bundleFileId = await handleRehydrate()
    if (bundleFileId === undefined) return
    setDataRefreshKey((prev) => prev + 1)
    if (bundleFileId) {
      setLeftoverBundleFileId(bundleFileId)
    }
  }

  const characterTagIds = character?.tags || []

  // Initialize data on mount
  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
    fetchUserControlledCharacters()
    fetchDefaultPartner()
    fetchImageProfiles()
  }, [fetchCharacter, fetchProfiles, fetchUserControlledCharacters, fetchDefaultPartner, fetchImageProfiles, id])

  // Refresh the header stats on mount and whenever an action mutates the
  // underlying data (e.g. Search & Replace touching memories/messages).
  useEffect(() => {
    fetchStats()
  }, [fetchStats, dataRefreshKey])

  // Navigating back to the containing workspace tab refreshes the character
  // and everything keyed off dataRefreshKey (stats, memories, photos…).
  // fetchCharacter never flips `loading` after the first load, so the page
  // stays on screen during the refresh.
  useOnTabActivated(() => {
    void fetchCharacter()
    setDataRefreshKey((k) => k + 1)
  })

  // Open the chat modal when arriving via ?action=chat (initialize once)
  useEffect(() => {
    if (openChatOnMount && !chatDialogInitializedRef.current && character) {
      chatDialogInitializedRef.current = true
      setShowChatDialog(true)
      setOpenedFromQuery(true)
    }
  }, [openChatOnMount, character])

  const handleStartChat = () => {
    setOpenedFromQuery(false)
    setShowChatDialog(true)
  }

  const handleConnectionProfileSave = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      await handleSaveConnectionProfile(profileId)
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handlePartnerSave = async (partnerId: string) => {
    setSavingPartner(true)
    try {
      await handleSaveDefaultPartner(partnerId)
    } finally {
      setSavingPartner(false)
    }
  }

  const handleImageProfileSave = async (profileId: string | null) => {
    setSavingImageProfile(true)
    try {
      await handleSaveImageProfile(profileId)
    } finally {
      setSavingImageProfile(false)
    }
  }

  const renderTabContent = (activeTab: string) => {
    switch (activeTab) {
      case 'details':
        return (
          <CharacterDetails
            characterId={id}
            character={character}
            templateCounts={templateCounts}
            literalCounts={literalCounts}
            replacingTemplate={replacingTemplate}
            reversingTemplate={reversingTemplate}
            defaultPartnerName={defaultPartnerName}
            userControlledCharacters={userControlledCharacters}
            onTemplateReplace={handleTemplateReplace}
            onReverseTemplate={handleReverseTemplate}
          />
        )

      case 'system-prompts':
        return (
          <SystemPromptsTab
            characterId={id}
            character={character}
            defaultPartnerName={defaultPartnerName}
          />
        )

      case 'conversations':
        return (
          <ConversationsTab
            characterId={id}
            characterName={character?.name || 'Character'}
            refreshKey={dataRefreshKey}
          />
        )

      case 'memories':
        return <MemoriesTab characterId={id} refreshKey={dataRefreshKey} />

      case 'tags':
        return <TagsTab characterId={id} />

      case 'wardrobe':
        return (
          <div className="space-y-4">
            <p className="qt-text-small qt-text-secondary">
              The wardrobe lives in a global dialog so it travels with you —
              edit, layer, and save outfits from anywhere, including from
              inside a chat.
            </p>
            <CanChooseOutfitToggle
              checked={character?.canChooseOutfit ?? false}
              saving={savingCanChooseOutfit}
              disabled={!character}
              onChange={handleSaveCanChooseOutfit}
            />
            <button
              type="button"
              onClick={() => wardrobeDialog?.open({ characterId: id })}
              disabled={!wardrobeDialog}
              className="qt-button-primary"
            >
              Open wardrobe for {character?.name || 'this character'}
            </button>
            {/* The character's own dressing instructions — the same
                Wardrobe/instructions.md the wardrobe dialog edits. */}
            <WardrobeInstructionsSection container={{ scope: 'character', id }} />
          </div>
        )

      case 'defaults':
        return (
          <ProfilesTab
            characterId={id}
            character={character}
            profiles={profiles}
            userControlledCharacters={userControlledCharacters}
            defaultPartnerId={defaultPartnerId}
            defaultImageProfileId={defaultImageProfileId}
            savingConnectionProfile={savingConnectionProfile}
            savingPartner={savingPartner}
            savingImageProfile={savingImageProfile}
            savingAgentMode={savingAgentMode}
            savingTimestampConfig={savingTimestampConfig}
            savingDefaultScenario={savingDefaultScenario}
            savingDefaultSystemPrompt={savingDefaultSystemPrompt}
            onConnectionProfileChange={handleConnectionProfileSave}
            onPartnerChange={handlePartnerSave}
            onImageProfileChange={handleImageProfileSave}
            onAgentModeChange={handleSaveAgentMode}
            savingHelpTools={savingHelpTools}
            onHelpToolsChange={handleSaveHelpTools}
            savingCanDressThemselves={savingCanDressThemselves}
            onCanDressThemselvesChange={handleSaveCanDressThemselves}
            savingCanCreateOutfits={savingCanCreateOutfits}
            onCanCreateOutfitsChange={handleSaveCanCreateOutfits}
            onTimestampConfigChange={handleSaveTimestampConfig}
            onDefaultScenarioChange={handleSaveDefaultScenario}
            onDefaultSystemPromptChange={handleSaveDefaultSystemPrompt}
          />
        )

      case 'gallery':
        return (
          <CharacterGallery
            characterId={id}
            character={character}
            onAvatarChange={(imageId) => {
              if (character) {
                setCharacter({ ...character, defaultImageId: imageId ?? undefined })
              }
            }}
            onRefresh={fetchCharacter}
          />
        )

      case 'descriptions':
        return <DescriptionsTab characterId={id} />

      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-lg qt-text-destructive">Error: {error}</p>
          <button
            onClick={onBack}
            className="font-medium text-primary hover:text-primary/80"
          >
            ← Back to Characters
          </button>
        </div>
      </div>
    )
  }

  if (quickHideActive && character && shouldHideByIds(characterTagIds)) {
    return (
      <div className="flex min-h-screen items-center justify-center qt-bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return (
    <div className="character-view qt-page-container min-h-screen text-foreground">
      <div>
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to Characters
        </button>

        {isArchived && (
          <div className="mb-6 rounded-2xl border qt-border-default qt-bg-muted/60 p-4 flex items-start gap-3">
            <span className="text-2xl" aria-hidden>🗄️</span>
            <div className="flex-1">
              <p className="qt-text-label text-foreground">
                {character?.name || 'This character'} rests in the archive.
              </p>
              <p className="qt-text-small qt-text-secondary mt-1">
                Their effects — memories, correspondence, photographs, summaries — are
                packed into a sealed bundle on the shelf. What you see below is kept for
                the record and may be read but not altered; rehydrate them to pick up the
                pen again. Old conversations keep their words and their face throughout.
              </p>
            </div>
          </div>
        )}

        <CharacterHeader
          character={character}
          style={style}
          avatarRefreshKey={avatarRefreshKey}
          stats={stats}
          groups={groups}
          onStartChat={handleStartChat}
          onToggleNpc={handleToggleNpc}
          onToggleFavorite={handleToggleFavorite}
          onToggleControlledBy={handleToggleControlledBy}
          onToggleCarina={handleToggleCarina}
          onOptimize={isArchived ? undefined : () => setShowOptimizerModal(true)}
          onSearchReplace={isArchived ? undefined : () => setShowSearchReplaceModal(true)}
          onGenerateExternalPrompt={isArchived ? undefined : () => setShowExternalPromptDialog(true)}
          onArchive={isArchived ? undefined : () => setShowArchiveDialog(true)}
          onRehydrate={isArchived ? handleRehydrateClick : undefined}
          rehydrating={rehydrating}
          togglingNpc={togglingNpc}
          togglingFavorite={togglingFavorite}
          togglingControlledBy={togglingControlledBy}
          togglingCarina={togglingCarina}
        />

        {/* Tabbed Content. For an archived character the content renders inside a
            disabled fieldset: every form control inert, the page still readable.
            The repository write guard is the real lock — this is the courtesy. */}
        <EntityTabs tabs={CHARACTER_TABS} defaultTab={initialTab ?? 'details'}>
          {isArchived
            ? (activeTab: string) => (
                <fieldset disabled className="opacity-90">
                  {renderTabContent(activeTab)}
                </fieldset>
              )
            : renderTabContent}
        </EntityTabs>
      </div>

      {/* Archive Confirmation */}
      {showArchiveDialog && character && (
        <ArchiveCharacterDialog
          characterName={character.name}
          onConfirm={handleArchiveConfirm}
          onCancel={() => setShowArchiveDialog(false)}
        />
      )}

      {/* Post-rehydrate bundle disposal (spec §6 step 6) */}
      {leftoverBundleFileId && character && (
        <RehydrateBundleDialog
          characterName={character.name}
          bundleFileId={leftoverBundleFileId}
          onClose={() => setLeftoverBundleFileId(null)}
          onDeleted={() => showSuccessToast('The bundle is off the shelf.')}
        />
      )}

      {/* Chat Creation Modal */}
      {showChatDialog && character && (
        <NewChatModal
          isOpen={true}
          onClose={() => setShowChatDialog(false)}
          characterId={id}
          characterName={character.name}
          openedFromQuery={openedFromQuery}
        />
      )}

      {/* Character Optimizer Modal */}
      {showOptimizerModal && (
        <CharacterOptimizerModal
          characterId={id}
          characterName={character?.name || 'Character'}
          profiles={profiles}
          defaultConnectionProfileId={character?.defaultConnectionProfileId}
          vaultAvailable={!!character?.characterDocumentMountPointId}
          onClose={() => setShowOptimizerModal(false)}
          onApplied={() => {
            fetchCharacter()
            setShowOptimizerModal(false)
          }}
        />
      )}

      {/* Search & Replace Modal */}
      <SearchReplaceModal
        isOpen={showSearchReplaceModal}
        onClose={() => setShowSearchReplaceModal(false)}
        initialScope={{ type: 'character', characterId: id }}
        characterName={character?.name}
        onComplete={(result: SearchReplaceResult) => {
          // Refresh data if any changes were made
          if (result.messagesUpdated > 0 || result.memoriesUpdated > 0) {
            setDataRefreshKey(prev => prev + 1)
          }
        }}
      />

      {/* External Prompt Generator */}
      {showExternalPromptDialog && (
        <ExternalPromptDialog
          characterId={id}
          characterName={character?.name}
          systemPrompts={character?.systemPrompts}
          scenarios={character?.scenarios}
          onCancel={() => setShowExternalPromptDialog(false)}
          onGenerated={(prompt) => {
            setShowExternalPromptDialog(false)
            setExternalPromptResult(prompt)
          }}
        />
      )}

      {externalPromptResult && (
        <ExternalPromptResultDialog
          characterName={character?.name}
          prompt={externalPromptResult}
          onClose={() => setExternalPromptResult(null)}
        />
      )}
    </div>
  )
}
