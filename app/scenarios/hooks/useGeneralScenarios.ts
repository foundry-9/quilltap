'use client'

/**
 * useGeneralScenarios — fetch and mutate the instance-wide `Scenarios/*.md`
 * files in the "Quilltap General" mount via `/api/v1/scenarios/...`.
 *
 * Thin wrapper over the shared `useScenarioMutator` body; mirrors
 * `useProjectScenarios` (in `app/prospero/[id]/hooks/`) but drops the
 * `projectId` argument.
 *
 * @module app/scenarios/hooks/useGeneralScenarios
 */

import { useScenarioMutator } from '@/components/scenarios/use-scenario-mutator'
import type { ScenarioMutator } from '@/components/scenarios/types'

export function useGeneralScenarios(): ScenarioMutator {
  return useScenarioMutator('/api/v1/scenarios')
}
