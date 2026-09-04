'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { CharacterPickerPanel, NewChatForm, useNewChat } from '@/components/new-chat'
import { toAutonomousSettingsHint } from '@/components/new-chat/autonomous-settings-hint'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'

export function NewChatPageClient() {
  const searchParams = useSearchParams()
  const projectIdParam = searchParams.get('projectId') || undefined
  const characterIdParam = searchParams.get('characterId') || undefined
  const autonomousParam = searchParams.get('autonomous') === '1'

  const { data: autonomousHint } = useChatSettingsQuery(toAutonomousSettingsHint)

  const {
    loading,
    creating,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    generalScenarios,
    groupScenarios,
    showArchivedScenarios,
    setShowArchivedScenarios,
    roleplayTemplates,
    defaultRoleplayTemplateId,
    availableProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  } = useNewChat({
    initialCharacterId: characterIdParam,
    projectId: projectIdParam,
    initialAutonomous: autonomousParam,
  })

  const isAutonomous = state.autonomous.enabled

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading...</p>
      </div>
    )
  }

  const llmCount = selectedCharacters.filter((sc) => sc.controlledBy === 'llm').length
  const hasUserCharacter = selectedCharacters.some((sc) => sc.controlledBy === 'user')
  const canSubmit =
    !creating &&
    selectedCharacters.length > 0 &&
    llmCount > 0 &&
    !selectedCharacters.some((sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId) &&
    profiles.length > 0 &&
    (!isAutonomous || (llmCount >= 2 && !hasUserCharacter))

  return (
    <div className="qt-page-container min-h-screen text-foreground">
      <div>
        <Link
          href={project ? `/prospero/${project.id}` : '/salon'}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to {project ? project.name : 'Chats'}
        </Link>

        <h1 className="mb-6 qt-heading-1">{isAutonomous ? 'New Autonomous Room' : 'New Chat'}</h1>

        {project && (
          <div className="mb-6 rounded-lg border qt-border-default qt-bg-card/50 p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: project.color || 'var(--muted)' }}
              >
                <Icon name="folder" className="w-4 h-4 qt-text-secondary" />
              </div>
              <div>
                <p className="text-sm qt-text-primary">Creating chat in project</p>
                <p className="font-medium text-foreground">{project.name}</p>
              </div>
            </div>
          </div>
        )}

        {profiles.length === 0 && (
          <div className="mb-6 rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-4 qt-text-warning">
            <p className="font-medium">No connection profiles available</p>
            <p className="mt-1 text-sm">
              You need to create a connection profile before starting a chat.{' '}
              <Link href="/settings?tab=providers" className="underline hover:no-underline">
                Go to AI Providers
              </Link>
            </p>
          </div>
        )}

        <CharacterPickerPanel
          characters={characters}
          profiles={profiles}
          selectedCharacters={selectedCharacters}
          onSelectedCharactersChange={setSelectedCharacters}
          onCharactersChanged={() => setState((prev) => ({ ...prev, scenarioId: null }))}
          disabled={creating}
          autoFocusSearch
        />

        <div className="mt-6">
          <NewChatForm
            profiles={profiles}
            imageProfiles={imageProfiles}
            userControlledCharacters={userControlledCharacters}
            selectedCharacters={selectedCharacters}
            setSelectedCharacters={setSelectedCharacters}
            state={state}
            setState={setState}
            project={project}
            projectScenarios={projectScenarios}
            generalScenarios={generalScenarios}
            groupScenarios={groupScenarios}
            showArchivedScenarios={showArchivedScenarios}
            onShowArchivedScenariosChange={setShowArchivedScenarios}
            roleplayTemplates={roleplayTemplates}
            defaultRoleplayTemplateId={defaultRoleplayTemplateId}
            availableProjects={availableProjects}
            selectedProjectId={selectedProjectId}
            onSelectedProjectIdChange={setSelectedProjectId}
            creating={creating}
            showSingleCharacterControls={false}
            autonomousSettingsHint={autonomousHint}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Link
            href={project ? `/prospero/${project.id}` : '/salon'}
            className="qt-button qt-button-secondary"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void handleCreateChat()}
            disabled={!canSubmit}
            className="qt-button-success"
          >
            {creating
              ? 'Creating...'
              : isAutonomous
                ? 'Create Autonomous Room'
                : 'Create Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
