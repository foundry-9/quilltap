/**
 * Old-route → workspace redirect helper (Phase 6).
 *
 * When the tabbed workspace is enabled, the legacy per-surface routes redirect
 * into `/workspace` carrying a transient `?open=` intent that the workspace
 * consumes and strips. When the flag is off (the default), this is a no-op and
 * the old routes render their views as before — so the cutover is a single flag
 * flip. Server-component only (`redirect` is from `next/navigation`).
 *
 * @module lib/navigation/workspace-redirect
 */

import { redirect } from 'next/navigation'
import { isWorkspaceTabsEnabled } from '@/lib/config/feature-flags'

/**
 * Redirect to the workspace with an open-tab intent, but only when the workspace
 * is enabled. Pass extra params (e.g. `chatId`, `tab`, `section`) to deep-link.
 * Throws `NEXT_REDIRECT` (caught by Next) when it redirects, so call it at the
 * top of a server-component route before rendering.
 */
export function redirectToWorkspaceTab(
  open: string,
  params?: Record<string, string | undefined>
): void {
  if (!isWorkspaceTabsEnabled()) return
  const search = new URLSearchParams({ open })
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
    }
  }
  redirect(`/workspace?${search.toString()}`)
}
