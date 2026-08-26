'use client'

/**
 * useProjectScenarios — fetch and mutate the project's `Scenarios/*.md`
 * files via `/api/v1/projects/[id]/scenarios/...`.
 *
 * Each list/create/update/rename/delete response includes the freshly listed
 * scenarios + any soft warnings (e.g. multiple `isDefault: true` files), so
 * a single round trip is enough to keep the UI in sync.
 *
 * Implements the shared `ScenarioMutator` contract so this hook and
 * `useGeneralScenarios` stay interchangeable behind `ScenariosManager` — the
 * on-disk shape is identical across scopes, only the mount point differs.
 *
 * @module app/prospero/[id]/hooks/useProjectScenarios
 */

import { useCallback, useEffect, useState } from 'react'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import type { Scenario, ScenarioMutator } from '@/components/scenarios/types'

/** Re-exported under the historical names to keep external call sites working. */
export type ProjectScenario = Scenario
export type UseProjectScenariosReturn = ScenarioMutator

interface ListResponse {
  mountPointId: string
  scenarios: Scenario[]
  warnings: string[]
}

interface MutateResponse {
  scenarios: Scenario[]
  warnings: string[]
}

function encodePathSegment(p: string): string {
  // Strip the Scenarios/ prefix if present and the .md extension; the API
  // accepts the bare filename for ergonomic URLs.
  const stripped = p.replace(/^Scenarios\//, '').replace(/\.md$/i, '')
  return encodeURIComponent(stripped)
}

export function useProjectScenarios(projectId: string): ScenarioMutator {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const collectionUrl = withArchivedParam(
    `/api/v1/projects/${projectId}/scenarios`,
    showArchived,
  )

  const itemUrl = useCallback(
    (scenarioPath: string, query = '') =>
      withArchivedParam(
        `/api/v1/projects/${projectId}/scenarios/${encodePathSegment(scenarioPath)}${query}`,
        showArchived,
      ),
    [projectId, showArchived],
  )

  const refresh = useCallback<ScenarioMutator['refresh']>(async (opts) => {
    // A silent refresh (workspace tab re-activation) keeps the current list on
    // screen instead of flipping the manager back to its loading state.
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(collectionUrl)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Failed to load scenarios (${res.status})`)
      }
      const data = (await res.json()) as ListResponse
      setScenarios(data.scenarios || [])
      setWarnings(data.warnings || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [collectionUrl])

  useEffect(() => {
    // Initial fetch, and a refetch whenever "Show archived" flips — the server
    // decides what's visible, so the toggle is a new request, not a filter.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState lands inside async refresh()
    void refresh()
  }, [refresh])

  const applyMutateResponse = useCallback((data: MutateResponse) => {
    setScenarios(data.scenarios || [])
    setWarnings(data.warnings || [])
  }, [])

  const createScenario = useCallback<ScenarioMutator['createScenario']>(
    async (input) => {
      try {
        const res = await fetch(collectionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to create (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true, path: body.path as string }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [collectionUrl, applyMutateResponse],
  )

  const updateScenario = useCallback<ScenarioMutator['updateScenario']>(
    async (scenarioPath, input) => {
      try {
        const res = await fetch(itemUrl(scenarioPath), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to update (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [itemUrl, applyMutateResponse],
  )

  const renameScenario = useCallback<ScenarioMutator['renameScenario']>(
    async (scenarioPath, newFilename) => {
      try {
        const res = await fetch(itemUrl(scenarioPath, '?action=rename'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newFilename }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to rename (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true, path: body.path as string }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [itemUrl, applyMutateResponse],
  )

  const deleteScenario = useCallback<ScenarioMutator['deleteScenario']>(
    async (scenarioPath) => {
      try {
        const res = await fetch(itemUrl(scenarioPath), { method: 'DELETE' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to delete (${res.status})` }
        }
        applyMutateResponse(body as MutateResponse)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [itemUrl, applyMutateResponse],
  )

  const setDefaultScenario = useCallback<ScenarioMutator['setDefaultScenario']>(
    async (scenarioPath) => {
      // "Set default" = PUT with the existing fields and `isDefault: true`.
      // Find the current scenario state in our local list to preserve other fields.
      const current = scenarios.find(s => s.path === scenarioPath)
      if (!current) {
        return { ok: false, error: 'Scenario not found in current list' }
      }
      return updateScenario(scenarioPath, {
        name: current.name,
        ...(current.description !== undefined && { description: current.description }),
        isDefault: true,
        body: current.body,
      })
    },
    [scenarios, updateScenario],
  )

  const setScenarioArchived = useCallback<ScenarioMutator['setScenarioArchived']>(
    async (scenarioPath, archived) => {
      const current = scenarios.find(s => s.path === scenarioPath)
      if (!current) {
        return { ok: false, error: 'Scenario not found in current list' }
      }
      return updateScenario(scenarioPath, {
        name: current.name,
        ...(current.description !== undefined && { description: current.description }),
        // An archived scenario can never be the default; drop the claim on the
        // way in rather than leaving a dead `isDefault: true` in the file.
        isDefault: archived ? false : current.isDefault,
        archived,
        body: current.body,
      })
    },
    [scenarios, updateScenario],
  )

  return {
    scenarios,
    warnings,
    loading,
    error,
    showArchived,
    setShowArchived,
    refresh,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
    setDefaultScenario,
    setScenarioArchived,
  }
}
