/**
 * Lightweight feature flags.
 *
 * The codebase had no general flag system; this is a single, dependency-light
 * place to gate in-progress features. Flags are evaluated at module load and
 * are safe to read on the client.
 *
 * @module lib/config/feature-flags
 */

/**
 * The tabbed workspace (`/workspace`). Phase 6 cutover: this is now ON by
 * default — the workspace is the post-login landing surface, the workspace store
 * lives app-level (in `AppLayout`), and the legacy per-surface routes redirect
 * into it carrying a `?open=` intent. The old routes still render their views
 * when reached with the workspace disabled.
 *
 * Opt back out at build/run time with `NEXT_PUBLIC_WORKSPACE_TABS=0` (everything
 * then renders via the old per-surface routes, exactly as before the cutover).
 */
export const WORKSPACE_TABS_ENABLED: boolean =
  process.env.NEXT_PUBLIC_WORKSPACE_TABS !== '0'

export function isWorkspaceTabsEnabled(): boolean {
  return WORKSPACE_TABS_ENABLED
}
