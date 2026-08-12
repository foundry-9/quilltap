/**
 * Project Detail Route — when the tabbed workspace is enabled, redirects into
 * it with the Prospero tab drilled into this project; otherwise renders the
 * legacy full-page detail via {@link ProjectDetailPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { ProjectDetailPageClient } from './ProjectDetailPageClient'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirectToWorkspaceTab('prospero', { projectId: id })
  return <ProjectDetailPageClient projectId={id} />
}
