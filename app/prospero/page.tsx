/**
 * Projects Route (Prospero)
 *
 * Thin wrapper around {@link ProsperoView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { ProsperoView } from './ProsperoView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ProjectsPage() {
  redirectToWorkspaceTab('prospero')
  return <ProsperoView />
}
