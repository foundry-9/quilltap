/**
 * Terminal Popout Route — when the tabbed workspace is enabled, redirects into
 * it: the intent opens the conversation's Salon tab (the portal source for the
 * live PTY) plus a child terminal tab. Otherwise renders the legacy full-page
 * terminal via {@link TerminalPopoutPageClient}.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { TerminalPopoutPageClient } from './TerminalPopoutPageClient'

export default async function TerminalPopoutPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>
}) {
  const { id, sessionId } = await params
  redirectToWorkspaceTab('terminal', { chatId: id, sessionId })
  return <TerminalPopoutPageClient chatId={id} sessionId={sessionId} />
}
