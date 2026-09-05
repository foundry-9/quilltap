'use client'

/**
 * The scenario dropdown, shared by the New Chat dialog and the Salon sidebar's
 * in-chat picker. Renders the four tiers as optgroups — project, general,
 * group, character — above a standing "Custom…" entry.
 *
 * The component is presentational: it takes already-fetched options and a
 * selection, and reports a new selection. What the surrounding surface does
 * with free text (New Chat layers notes beneath a preset; the sidebar swaps in
 * a textarea only for "Custom…") is the surface's own business.
 *
 * Archived entries only reach this component when the surface asked the server
 * for them; when they do, they're marked "(archived)" and remain selectable —
 * archiving hides an entry from the default view, it does not forbid a human
 * who has deliberately gone looking for it.
 */

import { useMemo } from 'react'
import {
  CUSTOM_SCENARIO_VALUE,
  GENERAL_SCENARIO_PREFIX,
  GROUP_SCENARIO_PREFIX,
  PROJECT_SCENARIO_PREFIX,
  scenarioOptionLabel,
  scenarioSelectionToValue,
  scenarioValueToSelection,
  type CharacterScenario,
  type GeneralScenarioOption,
  type GroupScenarioOption,
  type ProjectScenarioOption,
  type ScenarioSelection,
} from './types'

export interface ScenarioSelectProps {
  id?: string
  selection: ScenarioSelection
  onChange: (selection: ScenarioSelection) => void
  projectScenarios?: ProjectScenarioOption[]
  generalScenarios?: GeneralScenarioOption[]
  groupScenarios?: GroupScenarioOption[]
  /**
   * Character scenarios, offered only when a single LLM character is in play —
   * with two characters present there is no unambiguous "the character".
   */
  characterScenarios?: CharacterScenario[] | null
  /** Marks the character scenario the character itself calls default. */
  characterDefaultScenarioId?: string | null
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** True when at least one tier has something to offer. */
export function hasAnyScenarioOptions(props: {
  projectScenarios?: ProjectScenarioOption[]
  generalScenarios?: GeneralScenarioOption[]
  groupScenarios?: GroupScenarioOption[]
  characterScenarios?: CharacterScenario[] | null
}): boolean {
  return (
    (props.projectScenarios?.length ?? 0) > 0 ||
    (props.generalScenarios?.length ?? 0) > 0 ||
    (props.groupScenarios?.length ?? 0) > 0 ||
    (props.characterScenarios?.length ?? 0) > 0
  )
}

export function ScenarioSelect({
  id,
  selection,
  onChange,
  projectScenarios = [],
  generalScenarios = [],
  groupScenarios = [],
  characterScenarios = null,
  characterDefaultScenarioId = null,
  disabled = false,
  className = 'qt-select mb-2',
  'aria-label': ariaLabel,
}: ScenarioSelectProps) {
  // Group scenarios by groupId for rendering as optgroups
  const groupScenariosByGroup = useMemo(() => {
    const groups = new Map<string, { groupName: string; scenarios: GroupScenarioOption[] }>()
    for (const scenario of groupScenarios) {
      if (!groups.has(scenario.groupId)) {
        groups.set(scenario.groupId, { groupName: scenario.groupName, scenarios: [] })
      }
      groups.get(scenario.groupId)!.scenarios.push(scenario)
    }
    return groups
  }, [groupScenarios])

  return (
    <select
      id={id}
      value={scenarioSelectionToValue(selection)}
      onChange={(e) => onChange(scenarioValueToSelection(e.target.value))}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
      {projectScenarios.length > 0 && (
        <optgroup label="Project Scenarios">
          {projectScenarios.map((s) => (
            <option key={`project:${s.path}`} value={`${PROJECT_SCENARIO_PREFIX}${s.path}`}>
              {scenarioOptionLabel(s, ' (project default)')}
            </option>
          ))}
        </optgroup>
      )}
      {generalScenarios.length > 0 && (
        <optgroup label="General Scenarios">
          {generalScenarios.map((s) => (
            <option key={`general:${s.path}`} value={`${GENERAL_SCENARIO_PREFIX}${s.path}`}>
              {scenarioOptionLabel(s, ' (general default)')}
            </option>
          ))}
        </optgroup>
      )}
      {Array.from(groupScenariosByGroup.entries()).map(([groupId, { groupName, scenarios }]) => (
        <optgroup key={`group:${groupId}`} label={`Group Scenarios: ${groupName}`}>
          {scenarios.map((s) => (
            <option key={`group:${groupId}:${s.path}`} value={`${GROUP_SCENARIO_PREFIX}${groupId}:${s.path}`}>
              {scenarioOptionLabel(s, ' (group default)')}
            </option>
          ))}
        </optgroup>
      ))}
      {characterScenarios && characterScenarios.length > 0 && (
        <optgroup label="Character Scenarios">
          {characterScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {scenarioOptionLabel(
                { name: s.title, isDefault: characterDefaultScenarioId === s.id, archived: s.archived, description: s.description },
                ' (character default)'
              )}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
