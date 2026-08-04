import type { TimestampConfig } from '@/lib/schemas/types'
import type { OutfitSelection } from '@/components/wardrobe'

export interface SystemPrompt {
  id: string
  name: string
  content?: string
  isDefault: boolean
}

export interface CharacterScenario {
  id: string
  title: string
  content: string
  description?: string
}

/**
 * Project-scoped scenario sourced from the project's `Scenarios/` folder
 * (`/api/v1/projects/[id]/scenarios`). Identified by relativePath rather
 * than UUID, since the file system is the source of truth.
 */
export interface ProjectScenarioOption {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  body: string
}

/**
 * Instance-wide scenario sourced from the "Quilltap General" mount's
 * `Scenarios/` folder (`/api/v1/scenarios`). Same shape as a project
 * scenario, but applies to every non-help chat regardless of project.
 */
export interface GeneralScenarioOption {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  body: string
}

/**
 * Group-scoped scenario sourced from a group's `Scenarios/` folder
 * (`/api/v1/groups/scenarios`). Same shape as project and general
 * scenarios, but applies when specific participant character IDs
 * are selected that belong to a group.
 */
export interface GroupScenarioOption {
  groupId: string
  groupName: string
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  body: string
}

export interface Character {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  defaultConnectionProfileId?: string | null
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  _count?: {
    chats: number
  }
  systemPrompts?: SystemPrompt[]
  scenarios?: CharacterScenario[]
  defaultPartnerId?: string | null
  defaultTimestampConfig?: TimestampConfig | null
  defaultScenarioId?: string | null
  defaultSystemPromptId?: string | null
  defaultImageProfileId?: string | null
  /**
   * When true, a new chat with this character defaults its Starting Outfit to
   * "Let character choose". Absent/false falls back to defaults (or Compose
   * when there is no usable default outfit).
   */
  canChooseOutfit?: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  provider?: string
  modelName?: string
}

export interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

/**
 * A character eligible to be the user's persona in the "Play As" dropdown.
 * Carries the full {@link Character} so a chosen default-user character can be
 * added to `selectedCharacters` in place (flipped to `controlledBy: 'user'`)
 * without a second fetch.
 */
export type UserControlledCharacter = Character

export interface Project {
  id: string
  name: string
  color?: string | null
  defaultAvatarGenerationEnabled?: boolean | null
  defaultImageProfileId?: string | null
  defaultRoleplayTemplateId?: string | null
}

/**
 * A roleplay template offered in the New Chat dialog's template dropdown.
 * Trimmed from the `/api/v1/roleplay-templates` record — the form only needs
 * enough to label an option.
 */
export interface RoleplayTemplateOption {
  id: string
  name: string
  description?: string | null
  isBuiltIn: boolean
}

export interface SelectedCharacter {
  character: Character
  connectionProfileId: string
  selectedSystemPromptId?: string | null
  controlledBy: 'llm' | 'user'
}

/**
 * Autonomous-room creation slice on NewChatFormState. Only consulted when
 * `autonomous.enabled` is true; the rest of the form continues to operate
 * normally otherwise. Numeric fields are kept in human-friendly units
 * (hours, minutes) and converted to milliseconds at submit time.
 */
export interface NewChatAutonomousState {
  enabled: boolean
  scheduleCron: string
  scheduleFreshnessHours: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMinutes: number | null
  budgetEstimatedSpendCapUSD: number | null
  /** Null = inherit user-default visibility from chat_settings. */
  runVisibility: 'owner_only' | 'household' | 'open' | null
  runDestructiveToolsAllowed: boolean
  /**
   * true (default) = the per-run token budget counts only billable cache-miss
   * input + output tokens (prompt-cache hits excluded); false = count every
   * token, including cache reads, the way budgets behaved before cache-read
   * normalization.
   */
  budgetExcludeCacheHits: boolean
}

export interface NewChatFormState {
  imageProfileId: string
  /**
   * Roleplay template for the new chat. Seeded with whatever the chat would
   * have defaulted to (project default > user/global default), and sent
   * verbatim at create time — `null` means "no template".
   */
  roleplayTemplateId: string | null
  /**
   * Set once the user picks a template by hand. Reference data reloads
   * (adding a character, switching projects) re-seed the default only while
   * this is false, so an explicit choice is never quietly overwritten.
   */
  roleplayTemplateTouched: boolean
  scenario: string
  scenarioId: string | null
  /** Relative path of a selected project scenario; mutually exclusive with `scenarioId` and free-text `scenario`. */
  projectScenarioPath: string | null
  /** Relative path of a selected general scenario; mutually exclusive with the other scenario fields. */
  generalScenarioPath: string | null
  /** Relative path of a selected group scenario; mutually exclusive with the other scenario fields. */
  groupScenarioPath: string | null
  /** Group ID of the selected group scenario; paired with `groupScenarioPath`. */
  groupScenarioGroupId: string | null
  timestampConfig: TimestampConfig | null
  avatarGenerationEnabled: boolean
  outfitSelections: OutfitSelection[]
  autonomous: NewChatAutonomousState
}

export const USER_CONTROLLED_PROFILE = '__USER_CONTROLLED__'
export const CUSTOM_SCENARIO_VALUE = '__custom__'
/**
 * Stable token used in the dropdown's `<option value>` to identify a project
 * scenario. Format: `project:<relativePath>`. Character scenarios continue
 * to use their UUID; "Custom" uses CUSTOM_SCENARIO_VALUE.
 */
export const PROJECT_SCENARIO_PREFIX = 'project:'
/**
 * Stable token for general scenarios in the dropdown. Format:
 * `general:<relativePath>`.
 */
export const GENERAL_SCENARIO_PREFIX = 'general:'
/**
 * Stable token for group scenarios in the dropdown. Format:
 * `group:<groupId>:<relativePath>`.
 */
export const GROUP_SCENARIO_PREFIX = 'group:'
