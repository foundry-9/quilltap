/**
 * Document Store Detail Route — when the tabbed workspace is enabled, redirects
 * into it with the Scriptorium tab drilled into this store; otherwise renders
 * the legacy full-page detail via {@link DocumentStoreDetailPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { DocumentStoreDetailPageClient } from './DocumentStoreDetailPageClient'

export default async function DocumentStoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirectToWorkspaceTab('scriptorium', { storeId: id })
  return <DocumentStoreDetailPageClient storeId={id} />
}
