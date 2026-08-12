/**
 * Document Stores Route (The Scriptorium)
 *
 * Thin wrapper around {@link ScriptoriumView}; the view body is extracted so it can also
 * render as a workspace tab. When the tabbed workspace is enabled, this route
 * redirects into it. See `docs/developer/features/tabbed-workspace.md`.
 */

import { ScriptoriumView } from './ScriptoriumView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function DocumentStoresPage() {
  redirectToWorkspaceTab('scriptorium')
  return <ScriptoriumView />
}
