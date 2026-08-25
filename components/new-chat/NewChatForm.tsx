'use client'

import { useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import type { OutfitSelection, PreviousOutfitSummary } from '@/components/wardrobe'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'
import { AutonomousRoomCard } from './AutonomousRoomCard'
import type {
  ConnectionProfile,
  GeneralScenarioOption,
  GroupScenarioOption,
  ImageProfile,
  NewChatAutonomousState,
  NewChatFormState,
  Project,
  ProjectScenarioOption,
  RoleplayTemplateOption,
  SelectedCharacter,
  UserControlledCharacter,
} from './types'
import type { ProjectListEntry } from './hooks/useNewChat'
import { ScenarioSelect, hasAnyScenarioOptions } from '@/components/scenario/ScenarioSelect'
import type { ScenarioSelection } from '@/components/scenario/types'

interface NewChatFormProps {
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  state: NewChatFormState
  setState: React.Dispatch<React.SetStateAction<NewChatFormState>>
  project: Project | null
  /** Project scenarios from `/api/v1/projects/[id]/scenarios`; empty when no project. */
  projectScenarios?: ProjectScenarioOption[]
  /** General scenarios from `/api/v1/scenarios`; fetched for every non-help chat. */
  generalScenarios?: GeneralScenarioOption[]
  /** Group scenarios from `/api/v1/groups/scenarios?characterIds=...`; fetched when characters are selected. */
  groupScenarios?: GroupScenarioOption[]
  /**
   * Roleplay templates from `/api/v1/roleplay-templates`. When non-empty the
   * form renders a template dropdown, pre-set to whatever the chat would have
   * defaulted to (`state.roleplayTemplateId`, seeded by useNewChat).
   */
  roleplayTemplates?: RoleplayTemplateOption[]
  /**
   * The template the chat would use if the dropdown were left alone (project
   * default > user/global default > none). Used only to mark that option as
   * the default in the list.
   */
  defaultRoleplayTemplateId?: string | null
  /**
   * In-form project picker plumbing. When `availableProjects` is non-empty and
   * `onSelectedProjectIdChange` is supplied, the form renders a dropdown so the
   * user can file the chat under any of their projects (or none) at submit
   * time. Callers that render their own picker (NewChatModal's continuation
   * mode) can omit these.
   */
  availableProjects?: ProjectListEntry[]
  selectedProjectId?: string | null
  onSelectedProjectIdChange?: (id: string | null) => void
  creating: boolean
  /**
   * When true, renders connection-profile and system-prompt selects inline for a
   * single LLM-controlled character (used by the modal when the picker is collapsed).
   * When false, the caller is expected to render those controls in a picker panel.
   */
  showSingleCharacterControls?: boolean
  /**
   * Continuation mode: source chat ID forwarded to OutfitSelector so it can
   * render the "Same as last conversation" option and default to it.
   */
  continuationFromChatId?: string | null
  /**
   * Continuation mode: per-character per-slot preview of what each
   * character was wearing at the end of the source chat.
   */
  previousOutfitSummary?: PreviousOutfitSummary | null
  /**
   * Optional hints from the user's chat_settings.autonomousRoomSettings.
   * Used to label "Inherit" radio with the current default, and to disable
   * the destructive-tools checkbox when the user-level policy is the
   * always-refuse ceiling.
   */
  autonomousSettingsHint?: {
    visibilityDefault?: 'owner_only' | 'household' | 'open'
    destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
    defaultFreshnessHours?: number
  }
}

export function NewChatForm({
  profiles,
  imageProfiles,
  // Retained as a prop for caller compatibility, but the "Play As" dropdown now
  // draws only from the selected cast, so it is no longer read here.
  selectedCharacters,
  setSelectedCharacters,
  state,
  setState,
  project,
  projectScenarios = [],
  generalScenarios = [],
  groupScenarios = [],
  roleplayTemplates = [],
  defaultRoleplayTemplateId = null,
  availableProjects,
  selectedProjectId,
  onSelectedProjectIdChange,
  creating,
  showSingleCharacterControls = false,
  continuationFromChatId,
  previousOutfitSummary,
  autonomousSettingsHint,
}: NewChatFormProps) {
  const { formatCharacterName } = useUserCharacterDisplayName()

  const llmSelected = useMemo(
    () => selectedCharacters.filter((sc) => sc.controlledBy === 'llm'),
    [selectedCharacters]
  )
  const singleLlm = llmSelected.length === 1 ? llmSelected[0] : null

  // The single source of truth for "who the user plays as": the cast member
  // whose `controlledBy` is 'user'. Both the "Play As" dropdown and the picker
  // panel's per-character select read and mutate this same slot.
  const userEntry = useMemo(
    () => selectedCharacters.find((sc) => sc.controlledBy === 'user'),
    [selectedCharacters]
  )
  const hasUserControlled = Boolean(userEntry)

  const singleCharacterScenarios = useMemo(() => {
    if (!singleLlm) return null
    const s = singleLlm.character.scenarios
    return s && s.length > 0 ? s : null
  }, [singleLlm])

  const showScenarioDropdown = hasAnyScenarioOptions({
    projectScenarios,
    generalScenarios,
    groupScenarios,
    characterScenarios: singleCharacterScenarios,
  })

  const selectedProjectScenario = state.projectScenarioPath
    ? projectScenarios.find((s) => s.path === state.projectScenarioPath)
    : undefined
  const selectedGeneralScenario = state.generalScenarioPath
    ? generalScenarios.find((s) => s.path === state.generalScenarioPath)
    : undefined
  const selectedGroupScenario = state.groupScenarioPath
    ? groupScenarios.find(
        (s) =>
          s.path === state.groupScenarioPath &&
          s.groupId === state.groupScenarioGroupId
      )
    : undefined
  const selectedCharacterScenario = state.scenarioId
    ? singleCharacterScenarios?.find((s) => s.id === state.scenarioId)
    : undefined
  const selectedPreset = selectedProjectScenario
    ? { kind: 'project' as const, content: selectedProjectScenario.body }
    : selectedGeneralScenario
      ? { kind: 'general' as const, content: selectedGeneralScenario.body }
      : selectedGroupScenario
        ? { kind: 'group' as const, content: selectedGroupScenario.body }
        : selectedCharacterScenario
          ? { kind: 'character' as const, content: selectedCharacterScenario.content }
          : null

  // The character's own default — used to render the override-visibility note
  // when the form is currently using the project default but the character
  // also has one.
  const characterDefaultScenario = useMemo(() => {
    if (!singleLlm) return undefined
    const id = singleLlm.character.defaultScenarioId
    if (!id) return undefined
    return singleCharacterScenarios?.find((s) => s.id === id)
  }, [singleLlm, singleCharacterScenarios])
  const showOverrideNote =
    Boolean(selectedProjectScenario) &&
    Boolean(characterDefaultScenario)

  const scenarioSelection: ScenarioSelection = selectedProjectScenario
    ? { kind: 'project', path: selectedProjectScenario.path }
    : selectedGeneralScenario
      ? { kind: 'general', path: selectedGeneralScenario.path }
      : selectedGroupScenario
        ? { kind: 'group', groupId: selectedGroupScenario.groupId, path: selectedGroupScenario.path }
        : selectedCharacterScenario
          ? { kind: 'character', scenarioId: selectedCharacterScenario.id }
          : { kind: 'custom' }

  const handleScenarioSelectionChange = (selection: ScenarioSelection) => {
    setState((prev) => ({
      ...prev,
      scenarioId: selection.kind === 'character' ? selection.scenarioId : null,
      projectScenarioPath: selection.kind === 'project' ? selection.path : null,
      generalScenarioPath: selection.kind === 'general' ? selection.path : null,
      groupScenarioPath: selection.kind === 'group' ? selection.path : null,
      groupScenarioGroupId: selection.kind === 'group' ? selection.groupId : null,
    }))
  }

  const switchToCharacterDefault = () => {
    if (!characterDefaultScenario) return
    setState((prev) => ({
      ...prev,
      scenarioId: characterDefaultScenario.id,
      projectScenarioPath: null,
      generalScenarioPath: null,
      groupScenarioPath: null,
      groupScenarioGroupId: null,
      scenario: '',
    }))
  }

  const handleSingleProfileChange = (profileId: string) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, connectionProfileId: profileId } : sc
      )
    )
  }

  const handleSingleSystemPromptChange = (promptId: string | null) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  const singleCharacterId = singleLlm?.character.id
  const characterIdForImage = singleCharacterId || selectedCharacters[0]?.character.id || undefined

  const outfitCharacters = useMemo(() => {
    const list = llmSelected.map((sc) => ({
      id: sc.character.id,
      name: sc.character.name,
      isUserControlled: false,
      canChooseOutfit: sc.character.canChooseOutfit ?? false,
    }))
    if (userEntry) {
      list.push({
        id: userEntry.character.id,
        name: userEntry.character.name,
        isUserControlled: true,
        canChooseOutfit: userEntry.character.canChooseOutfit ?? false,
      })
    }
    return list
  }, [llmSelected, userEntry])

  // "Play As" options: only characters already in the cast. Any added character
  // can take the user's chair, and default-user personas now appear in the
  // picker on the left, so they enter the cast the same way as everyone else
  // rather than being pulled in from a separate roster here.
  const playAsOptions = useMemo(
    () =>
      selectedCharacters.map((sc) => ({
        id: sc.character.id,
        label: formatCharacterName(sc.character),
      })),
    [selectedCharacters, formatCharacterName]
  )

  // Mark one cast member as the user's persona, in place. Any prior user entry
  // is handed back to the LLM with its profile cleared (matching
  // CharacterPickerPanel.handleProfileChange, so the submit guard will ask for a
  // profile again). Every option comes from the cast, so there is nothing to
  // pull in or remove.
  const handlePlayAsChange = useCallback(
    (nextId: string) => {
      setSelectedCharacters((prev) => {
        const reverted = prev.map((sc) =>
          sc.controlledBy === 'user'
            ? { ...sc, controlledBy: 'llm' as const, connectionProfileId: '' }
            : sc
        )
        if (nextId === '') return reverted // "Chat as yourself"
        return reverted.map((sc) =>
          sc.character.id === nextId
            ? { ...sc, controlledBy: 'user' as const, connectionProfileId: '' }
            : sc
        )
      })
    },
    [setSelectedCharacters]
  )

  const handleOutfitSelectionsChange = useCallback(
    (selections: OutfitSelection[]) => {
      setState((prev) => ({ ...prev, outfitSelections: selections }))
    },
    [setState]
  )

  const handleRoleplayTemplateChange = useCallback(
    (value: string) => {
      setState((prev) => ({
        ...prev,
        roleplayTemplateId: value || null,
        roleplayTemplateTouched: true,
      }))
    },
    [setState]
  )

  const handleImageProfileChange = useCallback(
    (id: string | null) => {
      setState((prev) => ({ ...prev, imageProfileId: id || '' }))
    },
    [setState]
  )

  const isAutonomous = state.autonomous.enabled
  const updateAutonomous = useCallback(
    (patch: Partial<NewChatAutonomousState>) => {
      setState((prev) => ({
        ...prev,
        autonomous: { ...prev.autonomous, ...patch },
      }))
    },
    [setState]
  )

  const handleAutonomousToggle = useCallback(
    (next: boolean) => {
      setState((prev) => ({
        ...prev,
        autonomous: { ...prev.autonomous, enabled: next },
      }))
    },
    [setState]
  )

  const handleTimestampConfigChange = useCallback(
    (config: TimestampConfig) => {
      setState((prev) => ({ ...prev, timestampConfig: config }))
    },
    [setState]
  )

  const showSystemPromptDropdown =
    showSingleCharacterControls &&
    singleLlm &&
    singleLlm.character.systemPrompts &&
    singleLlm.character.systemPrompts.length > 1

  return (
    <div className="new-chat-form grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
      {/* Autonomous toggle (spans both columns) */}
      <div className="md:col-span-2 rounded-xl border qt-border-default qt-bg-card/60 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isAutonomous}
            onChange={(e) => handleAutonomousToggle(e.target.checked)}
            className="qt-checkbox mt-1"
            disabled={creating || hasUserControlled}
          />
          <span>
            <span className="font-medium text-foreground">Make this an autonomous room</span>
            <span className="block qt-text-xs qt-text-muted mt-1">
              Autonomous rooms run when scheduled or started manually. They have no human user, no
              composer, and pause for nobody.{' '}
              <Link href="/help/autonomous-rooms" className="underline hover:no-underline qt-text-primary">
                Learn more
              </Link>
              .
            </span>
          </span>
        </label>
        {hasUserControlled && !isAutonomous && (
          <p className="mt-2 qt-text-xs qt-text-warning">
            A character is set to Play As (user). Autonomous rooms have no user —
            revert it to &ldquo;Chat as yourself&rdquo; to enable.
          </p>
        )}
      </div>

      {/* Left card: Character Customization */}
      <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
        <h3 className="qt-section-title">Character Customization</h3>

        {profiles.length === 0 && (
          <div className="rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-3 qt-text-warning">
            <p className="qt-label">No connection profiles available</p>
            <p className="mt-1 qt-body-sm">
              <Link href="/settings?tab=providers" className="underline hover:no-underline">
                Add an AI provider
              </Link>{' '}
              to start a chat.
            </p>
          </div>
        )}

        {showSingleCharacterControls && singleLlm && (
          <div>
            <label htmlFor="new-chat-profile" className="mb-2 block text-sm qt-text-primary">
              Connection Profile *
            </label>
            <select
              id="new-chat-profile"
              value={singleLlm.connectionProfileId}
              onChange={(e) => handleSingleProfileChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Select a profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.modelName ? ` (${profile.modelName})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {showSystemPromptDropdown && singleLlm && (
          <div>
            <label htmlFor="new-chat-system-prompt" className="mb-2 block text-sm qt-text-primary">
              System Prompt
            </label>
            <select
              id="new-chat-system-prompt"
              value={singleLlm.selectedSystemPromptId || ''}
              onChange={(e) => handleSingleSystemPromptChange(e.target.value || null)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Use Default</option>
              {singleLlm.character.systemPrompts!.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                  {prompt.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isAutonomous && playAsOptions.length > 0 && (
          <div>
            <label htmlFor="new-chat-partner" className="mb-2 block text-sm qt-text-primary">
              Play As (Optional)
            </label>
            <select
              id="new-chat-partner"
              value={userEntry?.character.id ?? ''}
              onChange={(e) => handlePlayAsChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Chat as yourself</option>
              {playAsOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {roleplayTemplates.length > 0 && (
          <div>
            <label htmlFor="new-chat-roleplay-template" className="mb-2 block text-sm qt-text-primary">
              Roleplay Template
            </label>
            <select
              id="new-chat-roleplay-template"
              value={state.roleplayTemplateId ?? ''}
              onChange={(e) => handleRoleplayTemplateChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">
                No Template{defaultRoleplayTemplateId === null ? ' (default)' : ''}
              </option>
              {roleplayTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isBuiltIn ? ' (Built-in)' : ''}
                  {template.id === defaultRoleplayTemplateId ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <p className="qt-text-xs qt-text-muted mt-1">
              Sets how prose, dialogue, and asides are dressed for this conversation. You may
              change your mind later from the chat&rsquo;s own sidebar.
            </p>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm qt-text-primary">
            Image Generation Profile (Optional)
          </label>
          {imageProfiles.length > 0 ? (
            <ImageProfilePicker
              value={state.imageProfileId || null}
              onChange={handleImageProfileChange}
              characterId={characterIdForImage}
              userCharacterId={userEntry?.character.id}
            />
          ) : (
            <p className="qt-text-xs qt-text-muted">
              No image profiles configured.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-chat-scenario" className="mb-2 block text-sm qt-text-primary">
            Starting Scenario (Optional)
          </label>
          {showScenarioDropdown && (
            <ScenarioSelect
              id="new-chat-scenario-select"
              selection={scenarioSelection}
              onChange={handleScenarioSelectionChange}
              projectScenarios={projectScenarios}
              generalScenarios={generalScenarios}
              groupScenarios={groupScenarios}
              characterScenarios={singleCharacterScenarios}
              characterDefaultScenarioId={singleLlm?.character.defaultScenarioId ?? null}
              disabled={creating}
            />
          )}
          {showOverrideNote && characterDefaultScenario && (
            <p className="mb-2 text-xs qt-text-muted">
              Using the project default. Character default:{' '}
              <button
                type="button"
                onClick={switchToCharacterDefault}
                className="underline hover:no-underline qt-text-primary"
                disabled={creating}
              >
                {characterDefaultScenario.title}
              </button>{' '}
              — click to switch.
            </p>
          )}
          {selectedPreset && (
            <div className="rounded-lg border qt-border-default qt-bg-muted/40 px-3 py-2 text-sm qt-text-secondary whitespace-pre-wrap">
              {selectedPreset.content}
            </div>
          )}
          {selectedPreset && (
            <p className="mb-1 mt-2 text-xs qt-text-muted">
              Your notes here are added beneath the scenario above.
            </p>
          )}
          <MarkdownLexicalEditor
            value={state.scenario}
            onChange={(value) => setState((prev) => ({ ...prev, scenario: value }))}
            disabled={creating}
            namespace="NewChatForm.scenario"
            ariaLabel={selectedPreset ? 'Additional scenario notes' : 'Starting scenario'}
            minHeight="6rem"
          />
        </div>

        {outfitCharacters.length > 0 && (
          <OutfitSelector
            characters={outfitCharacters}
            onSelectionsChange={handleOutfitSelectionsChange}
            disabled={creating}
            sourceChatId={continuationFromChatId ?? null}
            previousOutfitSummary={previousOutfitSummary ?? null}
            projectId={selectedProjectId ?? null}
          />
        )}

        {!isAutonomous && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.avatarGenerationEnabled}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, avatarGenerationEnabled: e.target.checked }))
                }
                className="qt-checkbox"
                disabled={creating}
              />
              <span className="qt-text-small">Auto-generate character avatars</span>
            </label>
            <p className="qt-text-xs qt-text-muted mt-1">
              Generate new portraits when outfits change (uses image API)
            </p>
          </div>
        )}
      </div>

      {/* Right card: Reality Injection Mode (chat) or Autonomous Room (autonomous) */}
      {isAutonomous ? (
        <AutonomousRoomCard
          value={state.autonomous}
          onChange={updateAutonomous}
          settingsHint={autonomousSettingsHint}
          disabled={creating}
        />
      ) : (
        <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
          <h3 className="qt-section-title">Reality Injection Mode</h3>
          <TimestampConfigCard
            value={state.timestampConfig}
            onChange={handleTimestampConfigChange}
            compact
            disabled={creating}
          />
        </div>
      )}

      {onSelectedProjectIdChange && availableProjects && availableProjects.length > 0 ? (
        <div className="md:col-span-2 rounded-lg border qt-border-default qt-bg-card/50 p-3 space-y-2">
          <label htmlFor="new-chat-project-select" className="qt-text-xs qt-text-muted">
            File this chat under a project
          </label>
          <div className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor:
                  availableProjects.find((p) => p.id === selectedProjectId)?.color || 'var(--muted)',
              }}
            >
              <Icon name="folder" className="w-3 h-3 qt-text-secondary" />
            </div>
            <select
              id="new-chat-project-select"
              value={selectedProjectId ?? ''}
              onChange={(e) => onSelectedProjectIdChange(e.target.value || null)}
              disabled={creating}
              className="qt-select flex-1 min-w-0"
            >
              <option value="">— None (General) —</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : project ? (
        <div className="md:col-span-2 rounded-lg border qt-border-default qt-bg-card/50 p-3">
          <div className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: project.color || 'var(--muted)' }}
            >
              <Icon name="folder" className="w-3 h-3 qt-text-secondary" />
            </div>
            <div className="min-w-0">
              <p className="qt-text-xs qt-text-muted">In project</p>
              <p className="qt-body truncate">{project.name}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
