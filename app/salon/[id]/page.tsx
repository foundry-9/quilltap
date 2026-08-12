/**
 * Salon Conversation Route
 *
 * Thin wrapper around {@link SalonView}; the conversation body — including the
 * SSE streaming hooks and virtualized message list, which must not be touched —
 * is extracted so it can also render kept-alive as a workspace tab. When the
 * tabbed workspace is enabled, this route redirects into it for the chat.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { SalonView } from './SalonView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirectToWorkspaceTab('salon', { chatId: id })
  return <SalonView chatId={id} />
}
