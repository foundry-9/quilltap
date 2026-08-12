/**
 * New Chat Route — when the tabbed workspace is enabled, redirects into it with
 * an `open=new-chat` intent (the workspace pops the new-chat modal, carrying
 * the project/character/autonomous deep-links); otherwise renders the legacy
 * full-page form via {@link NewChatPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { NewChatPageClient } from './NewChatPageClient'

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined
  const characterId = typeof sp.characterId === 'string' ? sp.characterId : undefined
  const autonomous = sp.autonomous === '1' ? '1' : undefined
  redirectToWorkspaceTab('new-chat', { projectId, characterId, autonomous })
  return <NewChatPageClient />
}
