'use client'

/**
 * useGeneralScenarios — fetch and mutate the instance-wide `Scenarios/*.md`
 * files in the "Quilltap General" mount via `/api/v1/scenarios/...`.
 *
 * Mirrors `useProjectScenarios` (in `app/prospero/[id]/hooks/`) but drops the
 * `projectId` argument. Each list/create/update/rename/delete response
 * includes the freshly listed scenarios plus any soft warnings, so a single
 * round trip is enough to keep the UI in sync.
 *
 * @module app/scenarios/hooks/useGeneralScenarios
 */

import { useCallback, useEffect, useState } from 'react'
import type { Scenario, ScenarioMutator } from '@/components/scenarios/types'

interface ListResponse {
  mountPointId: string | null
  scenarios: Scenario[]
  warnings: string[]
}

interface MutateResponse {
  scenarios: Scenario[]
  warnings: string[]
}

function encodePathSegment(p: string): string {
  const stripped = p.replace(/^Scenarios\//, '').replace(/\.md$/i, '')
  return encodeURIComponent(stripped)
}

export function useGeneralScenarios(): ScenarioMutator {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    // A silent refresh (workspace tab re-activation) keeps the current list on
    // screen instead of flipping the manager back to its loading state.
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/scenarios')
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
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; setState lands inside async refresh()
    void refresh()
  }, [refresh])

  const applyMutateResponse = useCallback((data: MutateResponse) => {
    setScenarios(data.scenarios || [])
    setWarnings(data.warnings || [])
  }, [])

  const createScenario = useCallback<ScenarioMutator['createScenario']>(
    async (input) => {
      try {
        const res = await fetch('/api/v1/scenarios', {
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
    [applyMutateResponse],
  )

  const updateScenario = useCallback<ScenarioMutator['updateScenario']>(
    async (scenarioPath, input) => {
      try {
        const res = await fetch(`/api/v1/scenarios/${encodePathSegment(scenarioPath)}`, {
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
    [applyMutateResponse],
  )

  const renameScenario = useCallback<ScenarioMutator['renameScenario']>(
    async (scenarioPath, newFilename) => {
      try {
        const res = await fetch(
          `/api/v1/scenarios/${encodePathSegment(scenarioPath)}?action=rename`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newFilename }),
          },
        )
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
    [applyMutateResponse],
  )

  const deleteScenario = useCallback<ScenarioMutator['deleteScenario']>(
    async (scenarioPath) => {
      try {
        const res = await fetch(`/api/v1/scenarios/${encodePathSegment(scenarioPath)}`, {
          method: 'DELETE',
        })
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
    [applyMutateResponse],
  )

  const setDefaultScenario = useCallback<ScenarioMutator['setDefaultScenario']>(
    async (scenarioPath) => {
      const current = scenarios.find((s) => s.path === scenarioPath)
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

  return {
    scenarios,
    warnings,
    loading,
    error,
    refresh,
    createScenario,
    updateScenario,
    renameScenario,
    deleteScenario,
    setDefaultScenario,
  }
}
