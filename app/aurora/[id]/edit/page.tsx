/**
 * Character Edit Route — thin wrapper around {@link CharacterEditView}. When the
 * tabbed workspace is enabled, redirects into it preserving the character id and
 * `?tab=` deep-link; otherwise renders the view.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { CharacterEditView } from './CharacterEditView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function EditCharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab } = await searchParams
  redirectToWorkspaceTab('character-edit', { characterId: id, tab })
  return <CharacterEditView characterId={id} initialTab={tab} />
}
