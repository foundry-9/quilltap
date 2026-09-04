'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useCreationProgress } from '@/components/providers/creation-progress-provider'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import type {
  Character,
  ConnectionProfile,
  GeneralScenarioOption,
  GroupScenarioOption,
  ImageProfile,
  NewChatFormState,
  Project,
  ProjectScenarioOption,
  RoleplayTemplateOption,
  SelectedCharacter,
  UserControlledCharacter,
} from '../types'
import type { TimestampConfig } from '@/lib/schemas/types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { toScenarioOption, type ScenarioOption } from '@/components/scenario/types'
import { toAutonomousSettingsHint } from '../autonomous-settings-hint'

interface UseNewChatOptions {
  initialCharacterId?: string
  projectId?: string
  /**
   * "Change of venue" continuation mode: when set, handleCreateChat sends
   * `continuationFromChatId` in the POST body so the server replays the
   * source chat's tail into the new one.
   */
  continuationFromChatId?: string
  /**
   * Pre-selected LLM character IDs (continuation mode). Each is loaded from
   * the character roster and seeded as an LLM-controlled SelectedCharacter
   * with its default connection profile and system prompt.
   */
  initialSelectedCharacterIds?: string[]
  /** Pre-selected user-controlled character ID. */
  initialUserCharacterId?: string | null
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  initialTimestampConfig?: TimestampConfig | null
  /**
   * Concierge state to pre-select (continuation mode). A spicy conversation
   * that changes venue stays spicy by default; the user can still override it
   * on the form before creating.
   */
  initialConciergeState?: ConciergeState | null
  /**
   * When true, the form starts in autonomous-room mode: `state.autonomous.enabled`
   * is true at mount, and freshness-window / visibility defaults are seeded
   * from the user's chat_settings.autonomousRoomSettings.
   */
  initialAutonomous?: boolean
}

/**
 * Slim project record used by the in-form project picker. The full `Project`
 * with defaults still loads via `/api/v1/projects/[id]` once a project is
 * selected, since the list endpoint omits the default-* fields.
 */
export interface ProjectListEntry {
  id: string
  name: string
  color?: string | null
}

interface UseNewChatReturn {
  loading: boolean
  creating: boolean
  // Reference data
  characters: Character[]
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  project: Project | null
  /** Project scenarios from `/api/v1/projects/[id]/scenarios`; empty when no project. */
  projectScenarios: ProjectScenarioOption[]
  /** General scenarios from `/api/v1/scenarios`; fetched for every non-help chat. */
  generalScenarios: GeneralScenarioOption[]
  /** Group scenarios from `/api/v1/groups/scenarios?characterIds=...`; fetched when characters are selected. */
  groupScenarios: GroupScenarioOption[]
  /** Every roleplay template available to the user, for the in-form picker. */
  roleplayTemplates: RoleplayTemplateOption[]
  /**
   * The template this chat would use if the picker were left alone: project
   * default > user/global default > null. `state.roleplayTemplateId` is seeded
   * from it; the form uses it only to label that option as the default.
   */
  defaultRoleplayTemplateId: string | null
  /** Every project the user owns, for the in-form picker. */
  availableProjects: ProjectListEntry[]
  /** Currently chosen project ID, or null for "no project (general)". */
  selectedProjectId: string | null
  setSelectedProjectId: (id: string | null) => void
  /**
   * "Show archived" for the scenario picker. Flipping it refetches every
   * scenario tier with `?includeArchived=true` rather than filtering what's
   * already loaded — the server owns the hiding.
   */
  showArchivedScenarios: boolean
  setShowArchivedScenarios: (next: boolean) => void
  // Form state
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  state: NewChatFormState
  setState: React.Dispatch<React.SetStateAction<NewChatFormState>>
  // Actions
  handleCreateChat: () => Promise<{ chatId: string } | null>
}

const INITIAL_STATE: NewChatFormState = {
  imageProfileId: '',
  conciergeState: 'monitored',
  roleplayTemplateId: null,
  roleplayTemplateTouched: false,
  scenario: '',
  scenarioId: null,
  projectScenarioPath: null,
  generalScenarioPath: null,
  groupScenarioPath: null,
  groupScenarioGroupId: null,
  timestampConfig: null,
  avatarGenerationEnabled: false,
  outfitSelections: [],
  autonomous: {
    enabled: false,
    scheduleCron: '',
    scheduleFreshnessHours: null,
    budgetMaxTurns: null,
    budgetMaxTokens: null,
    budgetMaxWallClockMinutes: null,
    budgetEstimatedSpendCapUSD: null,
    runVisibility: null,
    runDestructiveToolsAllowed: false,
    budgetExcludeCacheHits: true,
  },
}

function generateTitle(selected: SelectedCharacter[]): string {
  const llm = selected.filter((sc) => sc.controlledBy === 'llm')
  if (llm.length === 0) return 'New Chat'
  if (llm.length === 1) return `Chat with ${llm[0].character.name}`
  if (llm.length === 2) return `Chat with ${llm[0].character.name} and ${llm[1].character.name}`
  if (llm.length === 3) {
    return `Chat with ${llm[0].character.name}, ${llm[1].character.name}, and ${llm[2].character.name}`
  }
  return `Group Chat (${llm.length} characters)`
}

export function useNewChat({
  initialCharacterId,
  projectId,
  continuationFromChatId,
  initialSelectedCharacterIds,
  initialUserCharacterId,
  initialImageProfileId,
  initialAvatarGenerationEnabled,
  initialTimestampConfig,
  initialConciergeState,
  initialAutonomous = false,
}: UseNewChatOptions = {}): UseNewChatReturn {
  const navigate = useWorkspaceNavigate()
  const creationProgress = useCreationProgress()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [characters, setCharacters] = useState<Character[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<UserControlledCharacter[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [projectScenarios, setProjectScenarios] = useState<ProjectScenarioOption[]>([])
  const [generalScenarios, setGeneralScenarios] = useState<GeneralScenarioOption[]>([])
  const [groupScenarios, setGroupScenarios] = useState<GroupScenarioOption[]>([])
  const [roleplayTemplates, setRoleplayTemplates] = useState<RoleplayTemplateOption[]>([])
  const [defaultRoleplayTemplateId, setDefaultRoleplayTemplateId] = useState<string | null>(null)
  const [templateDefaultsLoaded, setTemplateDefaultsLoaded] = useState(false)
  const [availableProjects, setAvailableProjects] = useState<ProjectListEntry[]>([])

  // selectedProjectId is the live picker value. It seeds from the `projectId`
  // prop (set by the URL on /salon/new or by the parent on the modal) and
  // re-syncs whenever the prop changes — the same props-as-state pattern
  // NewChatModal previously implemented locally for continuation mode.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null)
  const [showArchivedScenarios, setShowArchivedScenarios] = useState(false)
  const [lastSeenProjectIdProp, setLastSeenProjectIdProp] = useState<string | undefined>(projectId)
  if (projectId !== lastSeenProjectIdProp) {
    setLastSeenProjectIdProp(projectId)
    setSelectedProjectId(projectId ?? null)
  }

  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [state, setState] = useState<NewChatFormState>(() => ({
    ...INITIAL_STATE,
    autonomous: { ...INITIAL_STATE.autonomous, enabled: initialAutonomous },
  }))

  const seededRef = useRef(false)
  const prevLlmIdsRef = useRef<string>('')

  // Memoise the joined character-ID list so the fetchData useEffect doesn't
  // churn when the parent passes a fresh array reference each render.
  const initialSelectedKey = (initialSelectedCharacterIds || []).join(',')

  // Memoise selected LLM character IDs to determine when to refetch group scenarios
  const selectedLlmCharacterIds = useMemo(() => {
    return selectedCharacters
      .filter((sc) => sc.controlledBy === 'llm')
      .map((sc) => sc.character.id)
  }, [selectedCharacters])
  const selectedLlmCharacterIdsKey = selectedLlmCharacterIds.join(',')

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        const requests: Array<Promise<Response>> = [
          fetch('/api/v1/characters'),
          fetch('/api/v1/connection-profiles'),
          fetch('/api/v1/image-profiles'),
          fetch(withArchivedParam('/api/v1/scenarios', showArchivedScenarios)),
          fetch('/api/v1/settings/chat'),
          fetch('/api/v1/projects'),
          fetch('/api/v1/roleplay-templates'),
        ]
        if (selectedProjectId) {
          requests.push(fetch(`/api/v1/projects/${selectedProjectId}`))
          requests.push(fetch(withArchivedParam(
            `/api/v1/projects/${selectedProjectId}/scenarios`,
            showArchivedScenarios,
          )))
        }
        if (initialCharacterId) {
          requests.push(fetch(`/api/v1/characters/${initialCharacterId}`))
          requests.push(fetch(`/api/v1/characters/${initialCharacterId}?action=default-partner`))
        }
        // Fetch group scenarios when LLM characters are selected
        if (selectedLlmCharacterIds.length > 0) {
          requests.push(
            fetch(withArchivedParam(
              `/api/v1/groups/scenarios?characterIds=${selectedLlmCharacterIds.join(',')}`,
              showArchivedScenarios,
            ))
          )
        }

        const responses = await Promise.all(requests)
        if (cancelled) return

        let idx = 0
        const charsRes = responses[idx++]
        const profilesRes = responses[idx++]
        const imageProfilesRes = responses[idx++]
        const generalScenariosRes = responses[idx++]
        const chatSettingsRes = responses[idx++]
        const projectListRes = responses[idx++]
        const roleplayTemplatesRes = responses[idx++]
        const projectRes = selectedProjectId ? responses[idx++] : null
        const projectScenariosRes = selectedProjectId ? responses[idx++] : null
        const seedCharacterRes = initialCharacterId ? responses[idx++] : null
        const seedPartnerRes = initialCharacterId ? responses[idx++] : null
        const groupScenariosRes = selectedLlmCharacterIds.length > 0 ? responses[idx++] : null

        let loadedCharacters: Character[] = []
        let loadedUserChars: UserControlledCharacter[] = []
        // Full unfiltered roster, retained so the seeding paths below can resolve
        // a user/partner character whose default may be either 'llm' (flipped to
        // user in a source chat) or 'user' — neither sub-list alone is enough.
        let allCharacters: Character[] = []
        if (charsRes.ok) {
          const data = await charsRes.json()
          const all: Character[] = data.characters || []
          allCharacters = all
          // The picker on the left lists every character — including
          // default-user personas — so they enter the cast the same way as
          // anyone else and can then be chosen in the "Play As" dropdown.
          loadedCharacters = all
          // Still tracked separately for partner/persona seeding paths below.
          loadedUserChars = all.filter((c) => c.controlledBy === 'user')
        }
        let loadedProfiles: ConnectionProfile[] = []
        if (profilesRes.ok) {
          const data = await profilesRes.json()
          loadedProfiles = data.profiles || []
        }
        let loadedImageProfiles: ImageProfile[] = []
        if (imageProfilesRes.ok) {
          const data = await imageProfilesRes.json()
          loadedImageProfiles = Array.isArray(data) ? data : data.profiles || []
        }
        let loadedGeneralScenarios: GeneralScenarioOption[] = []
        if (generalScenariosRes.ok) {
          const data = await generalScenariosRes.json()
          loadedGeneralScenarios = (data.scenarios || []).map((s: ScenarioOption) => toScenarioOption(s))
        } else {
          console.warn('[useNewChat] Failed to load general scenarios', {
            status: generalScenariosRes.status,
          })
        }
        let loadedRoleplayTemplates: RoleplayTemplateOption[] = []
        if (roleplayTemplatesRes && roleplayTemplatesRes.ok) {
          const data = await roleplayTemplatesRes.json()
          const list: Array<{ id: string; name: string; description?: string | null; isBuiltIn?: boolean }> =
            Array.isArray(data) ? data : data.templates || []
          loadedRoleplayTemplates = list.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description ?? null,
            isBuiltIn: Boolean(t.isBuiltIn),
          }))
        } else if (roleplayTemplatesRes && !roleplayTemplatesRes.ok) {
          console.warn('[useNewChat] Failed to load roleplay templates', {
            status: roleplayTemplatesRes.status,
          })
        }

        let loadedAvailableProjects: ProjectListEntry[] = []
        if (projectListRes && projectListRes.ok) {
          const data = await projectListRes.json()
          loadedAvailableProjects = Array.isArray(data?.projects)
            ? data.projects.map((p: { id: string; name: string; color?: string | null }) => ({
                id: p.id,
                name: p.name,
                color: p.color ?? null,
              }))
            : []
        } else if (projectListRes && !projectListRes.ok) {
          console.warn('[useNewChat] Failed to load project list', { status: projectListRes.status })
        }

        let loadedProject: Project | null = null
        if (projectRes && projectRes.ok) {
          const data = await projectRes.json()
          loadedProject = data.project || data
        } else if (projectRes && !projectRes.ok) {
          console.warn('[useNewChat] Failed to load project', { projectId: selectedProjectId, status: projectRes.status })
        }

        let loadedProjectScenarios: ProjectScenarioOption[] = []
        if (projectScenariosRes && projectScenariosRes.ok) {
          const data = await projectScenariosRes.json()
          // Server returns full ParsedProjectScenario[]; pick the fields the UI needs.
          loadedProjectScenarios = (data.scenarios || []).map((s: ScenarioOption) => toScenarioOption(s))
        } else if (projectScenariosRes && !projectScenariosRes.ok) {
          console.warn('[useNewChat] Failed to load project scenarios', {
            projectId: selectedProjectId,
            status: projectScenariosRes.status,
          })
        }

        let loadedGroupScenarios: GroupScenarioOption[] = []
        if (groupScenariosRes && groupScenariosRes.ok) {
          const data = await groupScenariosRes.json()
          const groupScenariosByGroup = data.groupScenarios || []
          // Flatten the grouped scenarios into a single array with groupId/groupName metadata
          for (const group of groupScenariosByGroup) {
            const scenarios = group.scenarios || []
            for (const s of scenarios) {
              loadedGroupScenarios.push({
                ...toScenarioOption(s),
                groupId: group.groupId,
                groupName: group.groupName,
              })
            }
          }
        } else if (groupScenariosRes && !groupScenariosRes.ok) {
          console.warn('[useNewChat] Failed to load group scenarios', {
            status: groupScenariosRes.status,
          })
        }

        let seededChar: Character | null = null
        if (seedCharacterRes && seedCharacterRes.ok) {
          const { character } = await seedCharacterRes.json()
          seededChar = character
        }
        let seededPartnerId: string | null = null
        if (seedPartnerRes && seedPartnerRes.ok) {
          const data = await seedPartnerRes.json()
          seededPartnerId = data.partnerId || null
        }

        // Autonomous-room defaults from chat_settings.autonomousRoomSettings.
        // Only seeded when starting in autonomous mode — non-autonomous chats
        // don't need them. Stored unconditionally on state.autonomous so the
        // toggle can flip without re-fetching.
        let autonomousSeedFreshnessHours: number | null = null
        let autonomousSeedDestructivePolicyAlwaysRefuse = false
        // The user's global roleplay-template default; the project default (read
        // below) outranks it, mirroring the server's resolution at create time.
        let userDefaultRoleplayTemplateId: string | null = null
        if (chatSettingsRes && chatSettingsRes.ok) {
          try {
            const settings = await chatSettingsRes.json()
            userDefaultRoleplayTemplateId = settings?.defaultRoleplayTemplateId ?? null
            const hint = toAutonomousSettingsHint(settings)
            autonomousSeedFreshnessHours = hint?.defaultFreshnessHours ?? null
            autonomousSeedDestructivePolicyAlwaysRefuse = hint?.destructiveToolPolicy === 'always_refuse'
          } catch (err) {
            console.warn('[useNewChat] Failed to parse chat-settings response', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        setCharacters(loadedCharacters)
        setUserControlledCharacters(loadedUserChars)
        setProfiles(loadedProfiles)
        setImageProfiles(loadedImageProfiles)
        setProject(loadedProject)
        setProjectScenarios(loadedProjectScenarios)
        setGeneralScenarios(loadedGeneralScenarios)
        setGroupScenarios(loadedGroupScenarios)
        setRoleplayTemplates(loadedRoleplayTemplates)
        setAvailableProjects(loadedAvailableProjects)

        // What the chat's template would be if the user never touched the
        // dropdown: project default > user/global default > none. Same chain the
        // create route walks, so the pre-selection tells the truth.
        const resolvedDefaultTemplateId =
          loadedProject?.defaultRoleplayTemplateId || userDefaultRoleplayTemplateId || null
        const defaultTemplateStillExists =
          !resolvedDefaultTemplateId ||
          loadedRoleplayTemplates.some((t) => t.id === resolvedDefaultTemplateId)
        setDefaultRoleplayTemplateId(defaultTemplateStillExists ? resolvedDefaultTemplateId : null)
        // Only trust the pre-selection — and send it at create time — when every
        // source of the default answered. A failed settings/templates/project
        // fetch would otherwise turn "couldn't read your default" into an
        // explicit "no template", overriding a default the server knows about.
        setTemplateDefaultsLoaded(
          Boolean(roleplayTemplatesRes?.ok) &&
            Boolean(chatSettingsRes?.ok) &&
            (!selectedProjectId || Boolean(projectRes?.ok))
        )

        // Project default wins over general default for pre-selection. When a
        // project default exists, seed `projectScenarioPath`; otherwise fall
        // back to the general default.
        // `!s.archived` is belt-and-braces: the server already refuses to let
        // an archived file win default resolution, but with "Show archived"
        // ticked an archived row carrying a stale `isDefault: true` would
        // otherwise be a candidate for auto-selection here.
        const projectDefaultScenarioPath =
          loadedProjectScenarios.find((s) => s.isDefault && !s.archived)?.path ?? null
        const generalDefaultScenarioPath =
          loadedGeneralScenarios.find((s) => s.isDefault && !s.archived)?.path ?? null
        const seededGeneralScenarioPath = projectDefaultScenarioPath
          ? null
          : generalDefaultScenarioPath

        // Continuation mode: seed multi-character + form state from the
        // source chat's roster, bypassing the single-character seed branch.
        if (
          initialSelectedCharacterIds &&
          initialSelectedCharacterIds.length > 0 &&
          !seededRef.current
        ) {
          seededRef.current = true
          const seededSelected: SelectedCharacter[] = []
          for (const cid of initialSelectedCharacterIds) {
            const char = loadedCharacters.find((c) => c.id === cid)
            if (!char) continue
            const connectionProfileId =
              char.defaultConnectionProfileId || loadedProfiles[0]?.id || ''
            const defaultPromptId = char.defaultSystemPromptId
              ? char.systemPrompts?.find((p) => p.id === char.defaultSystemPromptId)?.id
              : char.systemPrompts?.find((p) => p.isDefault)?.id ?? char.systemPrompts?.[0]?.id
            seededSelected.push({
              character: char,
              connectionProfileId,
              selectedSystemPromptId: defaultPromptId ?? null,
              controlledBy: 'llm',
            })
          }
          // Seed the source chat's user-controlled participant as an in-place
          // user entry — the single source of truth for "who I play as". Skip in
          // autonomous mode (no user) and when already present. The character may
          // be a default-LLM one flipped to user in the source chat, so resolve
          // it from the full roster rather than either filtered sub-list.
          if (initialUserCharacterId && !initialAutonomous) {
            const userChar = allCharacters.find((c) => c.id === initialUserCharacterId)
            if (userChar && !seededSelected.some((sc) => sc.character.id === userChar.id)) {
              seededSelected.push({
                character: userChar,
                connectionProfileId: '',
                selectedSystemPromptId: null,
                controlledBy: 'user',
              })
            }
          }
          if (seededSelected.length > 0) {
            setSelectedCharacters(seededSelected)
          }
          setState((prev) => ({
            ...prev,
            timestampConfig: initialTimestampConfig ?? prev.timestampConfig,
            // Continuation mode intentionally does NOT pre-fill scenario:
            // the whole point is to pick a new one.
            scenarioId: null,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId:
              initialImageProfileId ||
              loadedProject?.defaultImageProfileId ||
              prev.imageProfileId,
            avatarGenerationEnabled:
              initialAvatarGenerationEnabled ??
              loadedProject?.defaultAvatarGenerationEnabled ??
              prev.avatarGenerationEnabled,
            conciergeState: initialConciergeState ?? prev.conciergeState,
          }))
        }
        // Seed selected character + defaults when initialCharacterId is provided
        else if (initialCharacterId && seededChar && !seededRef.current) {
          seededRef.current = true
          const char = seededChar
          const connectionProfileId =
            char.defaultConnectionProfileId || loadedProfiles[0]?.id || ''
          const defaultPromptId = char.defaultSystemPromptId
            ? char.systemPrompts?.find((p) => p.id === char.defaultSystemPromptId)?.id
            : char.systemPrompts?.find((p) => p.isDefault)?.id ?? char.systemPrompts?.[0]?.id
          const seededSelected: SelectedCharacter[] = [
            {
              character: char,
              connectionProfileId,
              selectedSystemPromptId: defaultPromptId ?? null,
              controlledBy: 'llm',
            },
          ]
          // Seed the character's default partner as an in-place user persona.
          // Skip in autonomous mode (no user). The partner is a default-user
          // character, absent from `loadedCharacters` — resolve it from the full
          // roster.
          const partnerId = seededPartnerId || char.defaultPartnerId || ''
          if (partnerId && !initialAutonomous) {
            const partner = allCharacters.find((c) => c.id === partnerId)
            if (partner && partner.id !== char.id) {
              seededSelected.push({
                character: partner,
                connectionProfileId: '',
                selectedSystemPromptId: null,
                controlledBy: 'user',
              })
            }
          }
          setSelectedCharacters(seededSelected)

          // Scenario default: project default wins over character default.
          // The character default still rides on `state.scenarioId` so the form
          // can render the override-visibility note offering a one-click switch.
          // General default fills in only when no project default exists.
          setState((prev) => ({
            ...prev,
            timestampConfig: char.defaultTimestampConfig ?? null,
            scenarioId: char.defaultScenarioId ?? null,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId:
              loadedProject?.defaultImageProfileId ||
              char.defaultImageProfileId ||
              '',
            avatarGenerationEnabled: loadedProject?.defaultAvatarGenerationEnabled ?? false,
          }))
        } else if (loadedProject) {
          // Project-only seeding (page mode)
          setState((prev) => ({
            ...prev,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId: loadedProject.defaultImageProfileId || prev.imageProfileId,
            avatarGenerationEnabled:
              loadedProject.defaultAvatarGenerationEnabled ?? prev.avatarGenerationEnabled,
          }))
        } else if (generalDefaultScenarioPath) {
          // No project, no initial character — still pre-select the general
          // default so the dropdown lands on something meaningful.
          setState((prev) => ({
            ...prev,
            generalScenarioPath: generalDefaultScenarioPath,
          }))
        }

        // Always merge autonomous-room defaults from user settings so the
        // freshness-window placeholder and the "always refuse" ceiling are
        // available even before the user flips the toggle on. The roleplay
        // template rides along: re-seeded on every reference-data load (a new
        // project, a changed cast) until the user picks one by hand.
        setState((prev) => ({
          ...prev,
          roleplayTemplateId: prev.roleplayTemplateTouched
            ? prev.roleplayTemplateId
            : defaultTemplateStillExists
              ? resolvedDefaultTemplateId
              : null,
          autonomous: {
            ...prev.autonomous,
            scheduleFreshnessHours:
              prev.autonomous.scheduleFreshnessHours ?? autonomousSeedFreshnessHours,
            // If the user's chat-settings ceiling is "always refuse", force the
            // per-room checkbox off and disabled in the form. The form reads
            // back the same chat-settings response from SWR to disable the input.
            runDestructiveToolsAllowed: autonomousSeedDestructivePolicyAlwaysRefuse
              ? false
              : prev.autonomous.runDestructiveToolsAllowed,
          },
        }))
      } catch (err) {
        if (cancelled) return
        console.error('[useNewChat] Failed to fetch data', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to load chat creation data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
    // The continuation seed depends on the joined character-ID list (serialised
    // as initialSelectedKey above) so a fresh array reference from the parent
    // doesn't churn the fetch. Other initial-* options are scalars. The group
    // scenarios fetch depends on selectedLlmCharacterIdsKey so it refetches when
    // the selected LLM character roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialCharacterId,
    selectedProjectId,
    continuationFromChatId,
    initialSelectedKey,
    initialUserCharacterId,
    initialImageProfileId,
    initialAvatarGenerationEnabled,
    initialConciergeState,
    selectedLlmCharacterIdsKey,
    showArchivedScenarios,
  ])

  // When exactly one LLM character is selected (and it wasn't seeded), propagate their defaults.
  // Matches behavior of the former /salon/new page for multi-char mode.
  useEffect(() => {
    const llmCharacters = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
    const currentIds = llmCharacters
      .map((sc) => sc.character.id)
      .sort()
      .join(',')
    if (currentIds === prevLlmIdsRef.current) return
    prevLlmIdsRef.current = currentIds

    if (llmCharacters.length === 1 && !seededRef.current) {
      const char = llmCharacters[0].character
      setState((prev) => ({
        ...prev,
        timestampConfig: char.defaultTimestampConfig ?? prev.timestampConfig,
        scenarioId: char.defaultScenarioId ?? prev.scenarioId,
        imageProfileId:
          project?.defaultImageProfileId ||
          char.defaultImageProfileId ||
          prev.imageProfileId,
      }))

      // Seed the character's default partner as an in-place user persona, the
      // way the Play-As dropdown would. Skip in autonomous mode, when a user
      // entry already exists, or when the partner is already in the cast. The
      // partner is a default-user character — resolve it from the user roster.
      // Loop-safe: adding a non-LLM entry leaves the LLM-id key unchanged, so
      // this effect early-returns on the re-run.
      const partnerId = char.defaultPartnerId
      if (partnerId && !state.autonomous.enabled) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loop-safe: the partner is a non-LLM entry, so the LLM-id key above is unchanged on the re-run and this effect early-returns; the inner updater is additionally idempotent (no-ops once a user entry exists)
        setSelectedCharacters((prev) => {
          if (prev.some((sc) => sc.controlledBy === 'user')) return prev
          if (prev.some((sc) => sc.character.id === partnerId)) return prev
          const partner = userControlledCharacters.find((c) => c.id === partnerId)
          if (!partner) return prev
          return [
            ...prev,
            {
              character: partner,
              connectionProfileId: '',
              selectedSystemPromptId: null,
              controlledBy: 'user',
            },
          ]
        })
      }
    }
  }, [
    selectedCharacters,
    project?.defaultImageProfileId,
    state.autonomous.enabled,
    userControlledCharacters,
  ])

  const handleCreateChat = async (): Promise<{ chatId: string } | null> => {
    if (selectedCharacters.length === 0) {
      showErrorToast('Please select at least one character')
      return null
    }

    const isAutonomous = state.autonomous.enabled

    if (isAutonomous) {
      const llmSelected = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
      if (llmSelected.length < 2) {
        showErrorToast('Autonomous rooms need at least two LLM-controlled characters')
        return null
      }
      if (selectedCharacters.some((sc) => sc.controlledBy === 'user')) {
        showErrorToast('Autonomous rooms have no user — remove user-controlled characters')
        return null
      }
    }

    const llmMissingProfile = selectedCharacters.filter(
      (sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId
    )
    if (llmMissingProfile.length > 0) {
      showErrorToast(
        `Please select a connection profile for: ${llmMissingProfile.map((sc) => sc.character.name).join(', ')}`
      )
      return null
    }

    const hasLlm = selectedCharacters.some((sc) => sc.controlledBy === 'llm')
    if (!hasLlm) {
      showErrorToast('At least one character must be LLM-controlled')
      return null
    }

    setCreating(true)

    // Correlation id for the "Green Room" status dialog. Only fresh/continued
    // conversations get the dialog — autonomous rooms navigate to settings.
    let progressId: string | undefined
    if (!isAutonomous && creationProgress) {
      progressId =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined
    }

    try {
      const participants: Array<{
        type: 'CHARACTER'
        characterId: string
        connectionProfileId?: string
        selectedSystemPromptId?: string
        controlledBy?: 'llm' | 'user'
      }> = selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.controlledBy === 'llm' ? sc.connectionProfileId : undefined,
        selectedSystemPromptId: sc.selectedSystemPromptId || undefined,
        controlledBy: sc.controlledBy,
      }))

      const requestBody: Record<string, unknown> = {
        title: generateTitle(selectedCharacters),
        participants,
      }

      if (state.imageProfileId) {
        requestBody.imageProfileId = state.imageProfileId
      }

      // Omitted when Monitored so a plain create stays byte-identical to what it
      // has always been; the server treats absence and 'monitored' the same way
      // (no write, no Concierge bubble).
      if (state.conciergeState !== 'monitored') {
        requestBody.conciergeState = state.conciergeState
      }

      // Sent — including `null` for "No Template" — so the value the user saw in
      // the dropdown is the value the chat is created with. Omitted entirely when
      // the defaults never loaded and the user didn't choose, leaving the server
      // to walk its own project > user default chain.
      if (state.roleplayTemplateTouched || templateDefaultsLoaded) {
        requestBody.roleplayTemplateId = state.roleplayTemplateId
      }

      // Free-text scenario notes — sent independently of any preset. The server
      // appends them beneath the chosen preset body, or treats them as the whole
      // scenario when no preset is selected.
      if (state.scenario) {
        requestBody.scenario = state.scenario
      }

      // Preset selection (mutually exclusive among the four sources):
      // character scenarioId > projectScenarioPath > groupScenarioPath > generalScenarioPath.
      if (state.scenarioId) {
        requestBody.scenarioId = state.scenarioId
      } else if (state.projectScenarioPath) {
        requestBody.projectScenarioPath = state.projectScenarioPath
      } else if (state.groupScenarioPath) {
        requestBody.groupScenarioPath = state.groupScenarioPath
        requestBody.groupScenarioGroupId = state.groupScenarioGroupId
      } else if (state.generalScenarioPath) {
        requestBody.generalScenarioPath = state.generalScenarioPath
      }

      if (state.timestampConfig && state.timestampConfig.mode !== 'NONE') {
        requestBody.timestampConfig = state.timestampConfig
      }

      if (selectedProjectId) {
        requestBody.projectId = selectedProjectId
      }

      if (!isAutonomous && state.avatarGenerationEnabled) {
        requestBody.avatarGenerationEnabled = true
      }

      if (state.outfitSelections.length > 0) {
        requestBody.outfitSelections = state.outfitSelections
      }

      if (continuationFromChatId) {
        requestBody.continuationFromChatId = continuationFromChatId
      }

      if (isAutonomous) {
        requestBody.chatType = 'autonomous'
        const auto = state.autonomous
        const cron = auto.scheduleCron.trim()
        if (cron.length > 0) requestBody.scheduleCron = cron
        if (auto.scheduleFreshnessHours != null && auto.scheduleFreshnessHours > 0) {
          requestBody.scheduleFreshnessWindowMs = auto.scheduleFreshnessHours * 60 * 60 * 1000
        }
        if (auto.budgetMaxTurns != null && auto.budgetMaxTurns > 0) {
          requestBody.budgetMaxTurns = auto.budgetMaxTurns
        }
        if (auto.budgetMaxTokens != null && auto.budgetMaxTokens > 0) {
          requestBody.budgetMaxTokens = auto.budgetMaxTokens
        }
        if (auto.budgetMaxWallClockMinutes != null && auto.budgetMaxWallClockMinutes > 0) {
          requestBody.budgetMaxWallClockMs = auto.budgetMaxWallClockMinutes * 60 * 1000
        }
        if (auto.budgetEstimatedSpendCapUSD != null && auto.budgetEstimatedSpendCapUSD > 0) {
          requestBody.budgetEstimatedSpendCapUSD = auto.budgetEstimatedSpendCapUSD
        }
        if (auto.runVisibility) {
          requestBody.runVisibility = auto.runVisibility
        }
        if (auto.runDestructiveToolsAllowed) {
          requestBody.runDestructiveToolsAllowed = true
        }
        // Always send the budget counting mode; the API treats an omitted value
        // as "exclude cache hits", and only an explicit `false` opts into
        // counting every token.
        requestBody.budgetExcludeCacheHits = auto.budgetExcludeCacheHits
      }

      if (progressId) {
        requestBody.progressId = progressId
        // Open the blocking status dialog and start streaming progress just as
        // the create request goes out.
        creationProgress?.begin(progressId)
      }

      const res = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      if (isAutonomous) {
        showSuccessToast('Autonomous room created!')
        navigate('/settings?tab=chat&section=autonomous-rooms')
      } else {
        showSuccessToast(continuationFromChatId ? 'Conversation continued in a new chat!' : 'Chat created!')
        // In the workspace this opens (or focuses) the new chat as a tab in place
        // — no route navigation, so a chat streaming in the other pane survives.
        navigate(`/salon/${data.chat.id}`)
      }
      // Creation succeeded and we've navigated — the conversation is ready, so
      // dismiss the status dialog.
      creationProgress?.complete()
      return { chatId: data.chat.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create chat'
      showErrorToast(msg)
      console.error('[useNewChat] Failed to create chat', { error: msg })
      // Surface the failure in the status dialog (if it was opened) so it stops
      // spinning and offers a Close button.
      if (progressId) creationProgress?.fail(msg)
      return null
    } finally {
      setCreating(false)
    }
  }

  return {
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
    roleplayTemplates,
    defaultRoleplayTemplateId,
    availableProjects,
    selectedProjectId,
    setSelectedProjectId,
    showArchivedScenarios,
    setShowArchivedScenarios,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  }
}
