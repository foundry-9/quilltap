'use client'

/**
 * The Tabbed Workspace route.
 *
 * Hosts the two-pane tab workspace inside the existing AppLayout shell. Renders
 * every open tab kept-alive across a draggable two-pane split. A transient
 * `?open=` intent (consumed by {@link WorkspaceIntent}) opens a specific tab —
 * the target the old per-surface routes redirect to.
 *
 * The route is reachable for development regardless of the
 * `WORKSPACE_TABS_ENABLED` flag; the flag gates the old-route redirects and the
 * post-login landing cutover (Phase 6), not whether this page renders.
 */

import { Suspense } from 'react'
import { EnsureWorkspaceProviders } from '@/components/workspace/WorkspaceProviders'
import { WorkspaceHost } from '@/components/workspace/WorkspaceHost'
import { WorkspaceIntent } from '@/components/workspace/WorkspaceIntent'

export default function WorkspacePage() {
  // When the flag is on, AppLayout already provides the workspace store; this
  // wrapper reuses it (and provides its own when reached as a dev-only preview).
  return (
    <EnsureWorkspaceProviders>
      <Suspense fallback={null}>
        <WorkspaceIntent />
      </Suspense>
      <WorkspaceHost />
    </EnsureWorkspaceProviders>
  )
}
