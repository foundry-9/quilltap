'use client'

/**
 * The in-chat scenario picker, living in the Salon sidebar's Chat section.
 *
 * Offers the same four tiers the New Chat dialog does — project, general,
 * group, character — through the shared `<ScenarioSelect>`, plus a free-text
 * box that appears only for "Custom…". Saving posts to
 * `?action=scenario`, which rewrites `chat.scenarioText`, recompiles every
 * participant's identity stack, and has the Host announce the revision.
 *
 * The current scene seeds the control: when its text matches a preset exactly,
 * that preset is preselected; otherwise the control opens on "Custom…" with
 * the text in the box, ready to edit.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { ScenarioSelect, hasAnyScenarioOptions } from '@/components/scenario/ScenarioSelect'
import {
  scenarioSelectionToPayload,
  type CharacterScenario,
  type GeneralScenarioOption,
  type GroupScenarioOption,
  type ProjectScenarioOption,
  type ScenarioSelection,
} from '@/components/scenario/types'

interface GroupScenarioGroup {
  groupId: string
  groupName: string
  scenarios: Omit<GroupScenarioOption, 'groupId' | 'groupName'>[]
}

export interface ChatScenarioControlProps {
  chatId: string
  /** The chat's project, when it has one — gates the project tier. */
  projectId?: string | null
  /** The scene as currently stored on the chat. */
  scenarioText?: string | null
  /** Character IDs of the LLM-controlled cast, for the group tier. */
  llmCharacterIds: string[]
  /**
   * The single LLM character's ID, or null when the room holds several. Only a
   * one-character room can offer character scenarios unambiguously.
   */
  singleLlmCharacterId: string | null
  /** Gates the reference-data fetches until the section has been opened once. */
  enabled: boolean
  /** Fired after the scenario is saved (typically `fetchChat`). */
  onChatUpdated?: () => void
}

export function ChatScenarioControl({
  chatId,
  projectId,
  scenarioText,
  llmCharacterIds,
  singleLlmCharacterId,
  enabled,
  onChatUpdated,
}: ChatScenarioControlProps) {
  /**
   * What the user has picked in this sitting. Null means "nothing touched
   * yet", in which case the control shows the scene the chat already has —
   * derived below, so it keeps up as the option tiers arrive.
   */
  const [draft, setDraft] = useState<{ selection: ScenarioSelection; customText: string } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)

  const characterIdsKey = useMemo(
    () => [...llmCharacterIds].sort().join(','),
    [llmCharacterIds],
  )

  const { data: generalData } = useQuery({
    queryKey: queryKeys.scenarios.general,
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: GeneralScenarioOption[] }>('/api/v1/scenarios', { signal }),
    enabled,
  })

  const { data: projectData } = useQuery({
    queryKey: queryKeys.scenarios.project(projectId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: ProjectScenarioOption[] }>(
        `/api/v1/projects/${projectId}/scenarios`,
        { signal },
      ),
    enabled: enabled && Boolean(projectId),
  })

  const { data: groupData } = useQuery({
    queryKey: queryKeys.scenarios.group(characterIdsKey),
    queryFn: ({ signal }) =>
      apiFetch<{ groupScenarios: GroupScenarioGroup[] }>(
        `/api/v1/groups/scenarios?characterIds=${encodeURIComponent(characterIdsKey)}`,
        { signal },
      ),
    enabled: enabled && characterIdsKey.length > 0,
  })

  const { data: characterData } = useQuery({
    queryKey: queryKeys.scenarios.character(singleLlmCharacterId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: CharacterScenario[] }>(
        `/api/v1/characters/${singleLlmCharacterId}/scenarios`,
        { signal },
      ),
    enabled: enabled && Boolean(singleLlmCharacterId),
  })

  const generalScenarios = useMemo(() => generalData?.scenarios ?? [], [generalData])
  const projectScenarios = useMemo(
    () => (projectId ? projectData?.scenarios ?? [] : []),
    [projectId, projectData],
  )
  const characterScenarios = useMemo(
    () => (singleLlmCharacterId ? characterData?.scenarios ?? [] : []),
    [singleLlmCharacterId, characterData],
  )

  // Flatten the grouped payload into the flat shape <ScenarioSelect> renders.
  const groupScenarios: GroupScenarioOption[] = useMemo(() => {
    const flat: GroupScenarioOption[] = []
    for (const group of groupData?.groupScenarios ?? []) {
      for (const scenario of group.scenarios) {
        flat.push({ ...scenario, groupId: group.groupId, groupName: group.groupName })
      }
    }
    return flat
  }, [groupData])

  // The scene the chat already has, expressed as a picker state: an exact body
  // match preselects that preset, anything else (including a preset with notes
  // layered beneath it) reads as Custom with the text ready to edit. Derived
  // rather than seeded into state, so it settles as the tiers finish loading
  // without ever fighting a choice the user has since made.
  const currentAsSelection = useMemo((): { selection: ScenarioSelection; customText: string } => {
    const current = (scenarioText ?? '').trim()
    if (current.length === 0) return { selection: { kind: 'custom' }, customText: '' }

    const projectMatch = projectScenarios.find((s) => s.body.trim() === current)
    if (projectMatch) return { selection: { kind: 'project', path: projectMatch.path }, customText: '' }

    const generalMatch = generalScenarios.find((s) => s.body.trim() === current)
    if (generalMatch) return { selection: { kind: 'general', path: generalMatch.path }, customText: '' }

    const groupMatch = groupScenarios.find((s) => s.body.trim() === current)
    if (groupMatch) {
      return {
        selection: { kind: 'group', groupId: groupMatch.groupId, path: groupMatch.path },
        customText: '',
      }
    }

    const characterMatch = characterScenarios.find((s) => s.content.trim() === current)
    if (characterMatch) {
      return { selection: { kind: 'character', scenarioId: characterMatch.id }, customText: '' }
    }

    return { selection: { kind: 'custom' }, customText: scenarioText ?? '' }
  }, [scenarioText, projectScenarios, generalScenarios, groupScenarios, characterScenarios])

  const { selection, customText } = draft ?? currentAsSelection

  const setSelection = (next: ScenarioSelection) => {
    setDraft({ selection: next, customText })
  }
  const setCustomText = (next: string) => {
    setDraft({ selection, customText: next })
  }

  // The body behind the current selection, previewed under the dropdown the
  // way the New Chat dialog previews it.
  const selectedPresetBody = useMemo(() => {
    switch (selection.kind) {
      case 'project':
        return projectScenarios.find((s) => s.path === selection.path)?.body ?? null
      case 'general':
        return generalScenarios.find((s) => s.path === selection.path)?.body ?? null
      case 'group':
        return (
          groupScenarios.find(
            (s) => s.path === selection.path && s.groupId === selection.groupId,
          )?.body ?? null
        )
      case 'character':
        return characterScenarios.find((s) => s.id === selection.scenarioId)?.content ?? null
      default:
        return null
    }
  }, [selection, projectScenarios, generalScenarios, groupScenarios, characterScenarios])

  const handleSave = async () => {
    try {
      setSaving(true)
      const payload: Record<string, unknown> = scenarioSelectionToPayload(selection)
      if (selection.kind === 'custom') {
        payload.scenario = customText
      }
      const res = await fetch(`/api/v1/chats/${chatId}?action=scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      showSuccessToast(data?.message || 'Scenario updated')
      // Drop the draft so the control re-derives from what actually persisted —
      // the refetched chat is the authority on what the scene now is.
      setDraft(null)
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update scenario')
    } finally {
      setSaving(false)
    }
  }

  const showDropdown = hasAnyScenarioOptions({
    projectScenarios,
    generalScenarios,
    groupScenarios,
    characterScenarios,
  })

  return (
    <div className="qt-label">
      <span className="block mb-1">Scenario</span>
      {showDropdown && (
        <ScenarioSelect
          id="chat-scenario-select"
          selection={selection}
          onChange={setSelection}
          projectScenarios={projectScenarios}
          generalScenarios={generalScenarios}
          groupScenarios={groupScenarios}
          characterScenarios={singleLlmCharacterId ? characterScenarios : null}
          disabled={saving}
          className="qt-select text-sm mb-2"
          aria-label="Scenario"
        />
      )}
      {selection.kind === 'custom' ? (
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          disabled={saving}
          rows={6}
          className="qt-textarea text-sm"
          placeholder="Set the scene for this conversation…"
          aria-label="Custom scenario text"
        />
      ) : (
        selectedPresetBody && (
          <div className="max-h-40 overflow-y-auto rounded-lg border qt-border-default qt-bg-muted/40 px-2 py-1.5 text-xs qt-text-secondary whitespace-pre-wrap">
            {selectedPresetBody}
          </div>
        )
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="qt-tool-palette-button mt-2"
      >
        {saving ? 'Setting the scene…' : 'Change scenario'}
      </button>
      <span className="block mt-1 qt-text-secondary text-xs">
        Changing the scene rewrites every character&rsquo;s standing instructions, and the Host
        announces the revision to the company.
      </span>
    </div>
  )
}
