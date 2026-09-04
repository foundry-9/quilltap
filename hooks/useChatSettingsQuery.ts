'use client'

/**
 * The chat-settings row, as a query.
 *
 * One hook for every component that only needs to *read* a field or two off
 * `/api/v1/settings/chat` — the composer plugins, the message renderer. They
 * all share the canonical query key, so TanStack dedupes the fetch across
 * every mounted consumer and re-renders them all when the settings mutate.
 *
 * Lives in top-level `hooks/` rather than under `components/settings/` so the
 * composer bundle doesn't pull the settings UI in; the `ChatSettings` import
 * below is type-only and erased at compile time.
 *
 * @param select Optional projection, passed straight to TanStack's `select`.
 * @param options.enabled Gate the fetch (e.g. a modal that only needs the row
 *   while open). Defaults to `true`.
 *
 * @module hooks/useChatSettingsQuery
 */

import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

export function useChatSettingsQuery<T = ChatSettings>(
  select?: (settings: ChatSettings) => T,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettings>('/api/v1/settings/chat', { signal }),
    select,
    enabled: options?.enabled,
  })
}
