'use client'

/**
 * The one client-side choreography for opening a document *inside a chat*.
 *
 * Three steps that must always happen together, and used to live only in the
 * `qtap://` link provider:
 *
 *  1. `POST …?action=open-document` — creates (or reactivates) the
 *     `chat_documents` row and posts the Librarian's "opened" announcement.
 *  2. Inside the workspace shell, open the `document` tab for the returned
 *     `chatDocumentId` so the editor is visible immediately (`openTab`
 *     de-dupes, so the Salon's own tab reconciliation is a no-op afterwards).
 *  3. Dispatch `qtap-document-opened` so a mounted Salon reconciles its open-
 *     document set and focuses the new pane without a manual refresh.
 *
 * In-chat opens are chat-visible **on purpose** — the Librarian announces the
 * open and every later save, exactly as for a picker-opened document. The
 * silent alternative is standalone Document Mode
 * (`document-standalone` / `/api/v1/documents`), which touches no chat at all.
 *
 * @module lib/documents/open-document-in-chat
 */

import { openDocumentForChat } from '@/app/salon/[id]/hooks/documentModeApi'
import type { DocumentStandaloneTabPayload, TabKind } from '@/lib/workspace/types'

/** Scope of the document being opened, as the chat API understands it. */
export type ChatDocumentScope = 'document_store' | 'project' | 'general'

export interface OpenDocumentInChatParams {
  filePath: string
  scope: ChatDocumentScope
  /** Store name or UUID; required for `document_store` scope. */
  mountPoint?: string | null
  /** Split (side by side) or focus (document alone). Defaults to `split`. */
  mode?: 'split' | 'focus'
}

export interface OpenDocumentInChatDeps {
  /**
   * The workspace's `openTab`, when the caller is inside the `/workspace`
   * shell. Omitted (or null) in the legacy single-page shell, where the Salon
   * renders the document pane itself off the dispatched event.
   */
  openTab?: ((kind: TabKind, payload?: unknown, opts?: { focus?: boolean; parentTabId?: string; title?: string }) => string) | null
  /** The Salon tab the document belongs under, when it is known. */
  parentTabId?: string
}

/**
 * Open `params` as a document of `chatId`. Resolves once the chat row exists
 * and the UI has been told about it; rejects with the server's message when
 * the open fails, so callers can surface a toast.
 */
export async function openDocumentInChat(
  chatId: string,
  params: OpenDocumentInChatParams,
  deps: OpenDocumentInChatDeps = {},
): Promise<void> {
  const data = await openDocumentForChat(chatId, {
    filePath: params.filePath,
    scope: params.scope,
    mountPoint: params.mountPoint ?? undefined,
    mode: params.mode ?? 'split',
  })

  deps.openTab?.(
    'document',
    {
      chatId,
      chatDocumentId: data.document.id,
      displayTitle: data.document.displayTitle,
    },
    { focus: true, parentTabId: deps.parentTabId },
  )

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('qtap-document-opened', {
      detail: { chatId, chatDocumentId: data.document.id },
    }))
  }
}

/**
 * The standalone (chat-less) counterpart's tab payload. Kept here so both
 * halves of the "open a document" decision read from one place; the caller
 * hands it to `openTab('document-standalone', …)`.
 */
export function standaloneTabPayload(
  docKey: string,
  params: { scope: DocumentStandaloneTabPayload['scope']; mountPoint?: string | null; filePath: string; displayTitle?: string },
): DocumentStandaloneTabPayload {
  return {
    docKey,
    scope: params.scope,
    mountPoint: params.mountPoint ?? null,
    filePath: params.filePath,
    displayTitle: params.displayTitle,
  }
}
