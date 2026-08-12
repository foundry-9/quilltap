/**
 * Character Detail Route — when the tabbed workspace is enabled, redirects into
 * it as a `character-view` tab (carrying the `?tab=` / `?action=chat`
 * deep-links); otherwise renders the legacy full-page detail via
 * {@link ViewCharacterPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { ViewCharacterPageClient } from './ViewCharacterPageClient'

export default async function ViewCharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const tab = typeof sp.tab === 'string' ? sp.tab : undefined
  const action = typeof sp.action === 'string' ? sp.action : undefined
  redirectToWorkspaceTab('character-view', { characterId: id, tab, action })
  return <ViewCharacterPageClient characterId={id} initialTab={tab} />
}
