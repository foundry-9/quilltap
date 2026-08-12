/**
 * Characters Route (Aurora)
 *
 * Thin wrapper around {@link AuroraView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { AuroraView } from './AuroraView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function CharactersPage() {
  redirectToWorkspaceTab('aurora')
  return <AuroraView />
}
