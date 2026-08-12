/**
 * About Route — thin wrapper around {@link AboutView}. When the tabbed
 * workspace is enabled, redirects into it; otherwise renders the view.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { AboutView } from './AboutView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function AboutPage() {
  redirectToWorkspaceTab('about')
  return <AboutView />
}
