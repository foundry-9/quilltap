/**
 * Salon List Route
 *
 * Thin wrapper around {@link SalonListView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { SalonListView } from './SalonListView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ChatsPage() {
  redirectToWorkspaceTab('salon-list')
  return <SalonListView />
}
