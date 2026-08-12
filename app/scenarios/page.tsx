/**
 * Scenarios Route
 *
 * Thin wrapper around {@link ScenariosView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { ScenariosView } from './ScenariosView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function GeneralScenariosPage() {
  redirectToWorkspaceTab('scenarios')
  return <ScenariosView />
}
