/**
 * The one way the client patches fields on a chat row.
 *
 * `PUT /api/v1/chats/:id` with a `{ chat: { … } }` body. Every optimistic
 * toggle in the Salon, the sidebar's clock switch, the project-move dialog and
 * the Document/Terminal-mode layout persisters all send the same request; this
 * is the single spelling of it. Built on {@link apiFetch}, so a non-2xx
 * answer throws an {@link ApiFetchError} carrying `status` and the parsed
 * `{ error }` body — callers keep their own rollback and toast policy.
 *
 * CLIENT-SAFE: no imports beyond the fetcher.
 *
 * @module lib/chat/patch-chat
 */

import { apiFetch } from '@/lib/query/fetcher'

/** Fields accepted under the `chat` key of the update request. */
export type ChatPatch = Record<string, unknown>

/**
 * Persist `updates` onto the chat. Resolves with the route's JSON body on
 * success; rejects with an {@link ApiFetchError} (server refusal) or the
 * underlying fetch error (network fault).
 */
export async function patchChat<T = unknown>(chatId: string, updates: ChatPatch): Promise<T> {
  return apiFetch<T>(`/api/v1/chats/${chatId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat: updates }),
  })
}
