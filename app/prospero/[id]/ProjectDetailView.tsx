'use client'

/**
 * Project Detail — the body of a single project's page as a props-driven view,
 * so it renders either at `/prospero/[id]` (route wrapper supplies a router
 * `onBack`) or in place inside the Prospero workspace tab (the list view
 * supplies a state `onBack`), keeping the workspace mounted for keep-alive.
 *
 * @module app/prospero/[id]/ProjectDetailView
 */

import { useEffect, useState } from 'react'
import { useProjectDetail, useProjectChats, useProjectFiles, useProjectCardState, useProjectDocumentStores } from './hooks'
import { useStoryBackground } from '@/hooks/useStoryBackground'
import {
  ProjectDetailHeader,
  FilesCard,
  CharactersCard,
  SettingsCard,
  ModelBehaviorCard,
  ImageGenerationCard,
  ChatsSection,
  DocumentStoresCard,
  ScenariosCard,
  WardrobeCard,
} from './components'

export interface ProjectDetailViewProps {
  projectId: string
  onBack: () => void
}

export function ProjectDetailView({ projectId, onBack }: ProjectDetailViewProps) {
  const {
    project,
    loading,
    error,
    editForm,
    setEditForm,
    isEditing,
    setIsEditing,
    fetchProject,
    handleSave,
    handleToggleAllowAnyCharacter,
    handleSaveAgentMode,
    handleSaveAnswerConfirmationOverride,
    handleSaveAvatarGeneration,
    handleSaveDefaultImageProfile,
    handleSaveDefaultRoleplayTemplate,
    handleSaveBackgroundDisplayMode,
    handleSaveAlertCharactersOfLanternImages,
    handleRemoveCharacter,
  } = useProjectDetail(projectId)

  // Image profiles for the default image profile selector
  const [imageProfiles, setImageProfiles] = useState<Array<{ id: string; name: string; provider: string; modelName: string }>>([])

  const {
    chats,
    loading: chatsLoading,
    loadingMore,
    pagination,
    fetchChats,
    loadMoreChats,
    handleRemoveChat,
  } = useProjectChats(projectId)

  const { files, fetchFiles } = useProjectFiles(projectId)

  const {
    linkedStores,
    allStores,
    fetchLinkedStores,
    fetchAllStores,
    linkStore,
    unlinkStore,
  } = useProjectDocumentStores(projectId)

  // Card expansion state - all open on first visit, all closed on subsequent visits
  const { cardState, toggleCard } = useProjectCardState(projectId)

  // Story background - fetch background image for project based on display mode
  // Pass null for chatId since we're on the project page, not a specific chat
  const { backgroundUrl: storyBackgroundUrl } = useStoryBackground(
    null,
    projectId,
    project?.backgroundDisplayMode !== 'theme' // Enable passive polling when backgrounds are enabled
  )

  useEffect(() => {
    fetchProject()
    fetchChats()
    fetchFiles()
    fetchLinkedStores()
    fetchAllStores()
    // Fetch image profiles for the default image profile selector
    fetch('/api/v1/image-profiles')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load image profiles')))
      .then(data => setImageProfiles(data?.profiles || []))
      .catch(() => {/* non-critical, selector will just be empty */})
  }, [projectId, fetchProject, fetchChats, fetchFiles, fetchLinkedStores, fetchAllStores])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading project...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">{error || 'Project not found'}</p>
          <button onClick={onBack} className="qt-text-primary hover:underline">
            Back to Projects
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="qt-page-container text-foreground"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <ProjectDetailHeader
        project={project}
        isEditing={isEditing}
        editForm={editForm}
        onEditFormChange={setEditForm}
        onEditClick={() => setIsEditing(true)}
        onCancelEdit={() => setIsEditing(false)}
        onSave={handleSave}
        onBack={onBack}
      />

      {/* Cards grid - 3 columns on wide desktop, 2 on medium, 1 on mobile.
           Compact cards flow through the columns; the two cards that host a
           Lexical editor (Project Settings, Image Generation) span the full
           width at the bottom so the editors aren't squeezed into a column. */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 grid-flow-row-dense">
        <FilesCard
          files={files}
          expanded={cardState.files}
          onToggle={() => toggleCard('files')}
          projectId={projectId}
          onFilesChange={fetchFiles}
        />
        <DocumentStoresCard
          linkedStores={linkedStores}
          allStores={allStores}
          expanded={cardState.documentStores}
          onToggle={() => toggleCard('documentStores')}
          onLink={linkStore}
          onUnlink={unlinkStore}
        />
        <ScenariosCard
          projectId={projectId}
          expanded={cardState.scenarios}
          onToggle={() => toggleCard('scenarios')}
        />
        <WardrobeCard
          projectId={projectId}
          expanded={cardState.wardrobe}
          onToggle={() => toggleCard('wardrobe')}
        />
        <CharactersCard
          project={project}
          onRemoveCharacter={handleRemoveCharacter}
          onToggleAllowAnyCharacter={handleToggleAllowAnyCharacter}
          expanded={cardState.characters}
          onToggle={() => toggleCard('characters')}
        />
        <ModelBehaviorCard
          project={project}
          onAgentModeChange={handleSaveAgentMode}
          onAnswerConfirmationOverrideChange={handleSaveAnswerConfirmationOverride}
          onDefaultRoleplayTemplateChange={handleSaveDefaultRoleplayTemplate}
          expanded={cardState.modelBehavior}
          onToggle={() => toggleCard('modelBehavior')}
        />
        {/* Full-width cards (host Lexical editors) — kept last so they stack
            across the whole grid instead of flexing beside a compact card. */}
        <SettingsCard
          project={project}
          editForm={editForm}
          onEditFormChange={setEditForm}
          onSave={handleSave}
          expanded={cardState.settings}
          onToggle={() => toggleCard('settings')}
        />
        <ImageGenerationCard
          project={project}
          imageProfiles={imageProfiles}
          onAvatarGenerationChange={handleSaveAvatarGeneration}
          onDefaultImageProfileChange={handleSaveDefaultImageProfile}
          onBackgroundDisplayModeChange={handleSaveBackgroundDisplayMode}
          onAlertCharactersOfLanternImagesChange={handleSaveAlertCharactersOfLanternImages}
          expanded={cardState.imageGeneration}
          onToggle={() => toggleCard('imageGeneration')}
        />
      </div>

      {/* Infinite scrolling chats section */}
      <ChatsSection
        projectId={projectId}
        chats={chats}
        loading={chatsLoading}
        loadingMore={loadingMore}
        hasMore={pagination.hasMore}
        total={pagination.total}
        onLoadMore={loadMoreChats}
        onRemoveChat={handleRemoveChat}
      />
    </div>
  )
}
