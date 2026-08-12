/**
 * Files Route
 *
 * Thin wrapper around {@link FilesView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { FilesView } from './FilesView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function FilesPage() {
  redirectToWorkspaceTab('files')
  return <FilesView />
}
