/**
 * Shared scenario types used by both the project-scoped and instance-wide
 * scenarios management UI. The on-disk shape is identical across scopes — only
 * the mount point that backs the `Scenarios/` folder differs.
 *
 * @module components/scenarios/types
 */

export interface Scenario {
  path: string
  filename: string
  name: string
  description?: string
  isDefault: boolean
  rawIsDefault: boolean
  body: string
  lastModified: string
  createdAt: string
  updatedAt: string
}

export interface ScenarioMutator {
  scenarios: Scenario[]
  warnings: string[]
  loading: boolean
  error: string | null
  /** `silent` refreshes in place without flipping `loading` (tab re-activation). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>
  createScenario: (input: {
    filename: string
    name?: string
    description?: string
    isDefault?: boolean
    body: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  updateScenario: (
    scenarioPath: string,
    input: {
      name?: string
      description?: string
      isDefault?: boolean
      body: string
    },
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  renameScenario: (
    scenarioPath: string,
    newFilename: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  deleteScenario: (
    scenarioPath: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  setDefaultScenario: (
    scenarioPath: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}
