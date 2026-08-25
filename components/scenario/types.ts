/**
 * Scenario picker — shared option shapes and dropdown tokens.
 *
 * Two surfaces offer the same four tiers of scenario: the New Chat dialog and
 * the in-chat picker in the Salon sidebar. Both render `<ScenarioSelect>`, so
 * the option shapes, the `<option value>` tokens, and the selection type live
 * here rather than in either surface's own module.
 */

/** A scenario stored on the character record itself, addressed by UUID. */
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
 * belong to the group.
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

/**
 * Which tier a picker is currently pointed at. `custom` means no preset —
 * whatever free text the surface collects is the whole scenario.
 */
export type ScenarioSelection =
  | { kind: 'custom' }
  | { kind: 'character'; scenarioId: string }
  | { kind: 'project'; path: string }
  | { kind: 'general'; path: string }
  | { kind: 'group'; groupId: string; path: string }

/** The `<option value>` token for a selection. */
export function scenarioSelectionToValue(selection: ScenarioSelection): string {
  switch (selection.kind) {
    case 'project':
      return `${PROJECT_SCENARIO_PREFIX}${selection.path}`
    case 'general':
      return `${GENERAL_SCENARIO_PREFIX}${selection.path}`
    case 'group':
      return `${GROUP_SCENARIO_PREFIX}${selection.groupId}:${selection.path}`
    case 'character':
      return selection.scenarioId
    case 'custom':
    default:
      return CUSTOM_SCENARIO_VALUE
  }
}

/**
 * Parse a `<option value>` token back into a selection. Anything unrecognised
 * — including the empty string and a malformed group token — reads as custom,
 * which is the one tier that can never be wrong.
 */
export function scenarioValueToSelection(value: string): ScenarioSelection {
  if (!value || value === CUSTOM_SCENARIO_VALUE) return { kind: 'custom' }
  if (value.startsWith(PROJECT_SCENARIO_PREFIX)) {
    return { kind: 'project', path: value.slice(PROJECT_SCENARIO_PREFIX.length) }
  }
  if (value.startsWith(GENERAL_SCENARIO_PREFIX)) {
    return { kind: 'general', path: value.slice(GENERAL_SCENARIO_PREFIX.length) }
  }
  if (value.startsWith(GROUP_SCENARIO_PREFIX)) {
    const rest = value.slice(GROUP_SCENARIO_PREFIX.length)
    const colonIdx = rest.indexOf(':')
    if (colonIdx > -1) {
      return {
        kind: 'group',
        groupId: rest.slice(0, colonIdx),
        path: rest.slice(colonIdx + 1),
      }
    }
    return { kind: 'custom' }
  }
  return { kind: 'character', scenarioId: value }
}

/**
 * The API payload fields a selection maps to. Both `POST /api/v1/chats` and
 * `POST /api/v1/chats/[id]?action=scenario` accept these names, and the server
 * resolves them through the same precedence chain.
 */
export function scenarioSelectionToPayload(selection: ScenarioSelection): {
  scenarioId?: string
  projectScenarioPath?: string
  generalScenarioPath?: string
  groupScenarioPath?: string
  groupScenarioGroupId?: string
} {
  switch (selection.kind) {
    case 'character':
      return { scenarioId: selection.scenarioId }
    case 'project':
      return { projectScenarioPath: selection.path }
    case 'general':
      return { generalScenarioPath: selection.path }
    case 'group':
      return { groupScenarioPath: selection.path, groupScenarioGroupId: selection.groupId }
    case 'custom':
    default:
      return {}
  }
}
