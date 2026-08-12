/**
 * Group Editor Route — when the tabbed workspace is enabled, redirects into it
 * with the Aurora tab drilled into this group's editor; otherwise renders the
 * legacy full-page editor via {@link GroupEditorPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { GroupEditorPageClient } from './GroupEditorPageClient'

export default async function GroupEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirectToWorkspaceTab('aurora', { groupId: id })
  return <GroupEditorPageClient groupId={id} />
}
