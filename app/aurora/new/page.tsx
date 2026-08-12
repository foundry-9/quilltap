/**
 * Create Character Route — thin wrapper around {@link NewCharacterView}. When the
 * tabbed workspace is enabled, redirects into it; otherwise renders the view.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { NewCharacterView } from './NewCharacterView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function NewCharacterPage() {
  redirectToWorkspaceTab('character-new')
  return <NewCharacterView />
}
