/**
 * Photos Route
 *
 * Thin wrapper around {@link PhotosView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { PhotosView } from './PhotosView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function PhotosPage() {
  redirectToWorkspaceTab('photos')
  return <PhotosView />
}
