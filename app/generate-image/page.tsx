/**
 * Generate Image Route — thin wrapper around {@link GenerateImageView}. When the
 * tabbed workspace is enabled, redirects into it; otherwise renders the view.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { GenerateImageView } from './GenerateImageView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function GenerateImagePage() {
  redirectToWorkspaceTab('generate-image')
  return <GenerateImageView />
}
