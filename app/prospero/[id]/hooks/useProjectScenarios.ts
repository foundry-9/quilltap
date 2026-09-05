'use client'

/**
 * useProjectScenarios — fetch and mutate the project's `Scenarios/*.md`
 * files via `/api/v1/projects/[id]/scenarios/...`.
 *
 * Thin wrapper over the shared `useScenarioMutator` body; only the API base
 * path is project-specific. Implements the shared `ScenarioMutator` contract
 * so this hook and `useGeneralScenarios` stay interchangeable behind
 * `ScenariosManager` — the on-disk shape is identical across scopes, only the
 * mount point differs.
 *
 * @module app/prospero/[id]/hooks/useProjectScenarios
 */

import { useScenarioMutator } from '@/components/scenarios/use-scenario-mutator'
import type { Scenario, ScenarioMutator } from '@/components/scenarios/types'

/** Re-exported under the historical names to keep external call sites working. */
export type ProjectScenario = Scenario
export type UseProjectScenariosReturn = ScenarioMutator

export function useProjectScenarios(projectId: string): ScenarioMutator {
  return useScenarioMutator(`/api/v1/projects/${projectId}/scenarios`)
}
