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
  /** True when the file carries `archived: true`. Absence of the key means active. */
  archived: boolean
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
  /**
   * "Show archived" state. Flipping it REFETCHES with `?includeArchived=true`
   * rather than filtering `scenarios` client-side — the server is the single
   * source of truth for what's hidden, so a surface that never asks is safe by
   * construction.
   */
  showArchived: boolean
  setShowArchived: (next: boolean) => void
  /** `silent` refreshes in place without flipping `loading` (tab re-activation). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>
  createScenario: (input: {
    filename: string
    name?: string
    description?: string
    isDefault?: boolean
    archived?: boolean
    body: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  updateScenario: (
    scenarioPath: string,
    input: {
      name?: string
      description?: string
      isDefault?: boolean
      /** Omit to leave the file's current archived state untouched. */
      archived?: boolean
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
  /**
   * Archive or restore one scenario. Archiving hides it from every list and
   * picker; it does not forbid the human from choosing it with "Show archived"
   * ticked, and it never breaks a chat that already resolved its body.
   */
  setScenarioArchived: (
    scenarioPath: string,
    archived: boolean,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}
