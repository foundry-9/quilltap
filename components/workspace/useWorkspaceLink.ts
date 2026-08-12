'use client'

/**
 * useWorkspaceLink — intercept an in-app link click when inside the workspace.
 *
 * Returns a handler `(href, event?) => boolean`. Inside the workspace, if the
 * href maps to a tab, it opens/focuses that tab, calls `preventDefault()`, and
 * returns `true` (so the link does NOT navigate and the workspace is not
 * unmounted). Outside the workspace, or for hrefs with no tab equivalent, it
 * returns `false` and lets the normal navigation happen.
 *
 * Usage: `<Link href={h} onClick={(e) => openIn(h, e)}>` — keep the `href` so
 * middle-click / open-in-new-tab and the no-workspace path still work.
 *
 * @module components/workspace/useWorkspaceLink
 */

import { useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'

export function useWorkspaceLink(): (
  href: string,
  event?: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }
) => boolean {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  return useCallback(
    (href, event) => {
      if (!ws) return false
      // Respect modifier-clicks (open in new browser tab / window).
      if (event?.metaKey || event?.ctrlKey) return false
      // Only intercept while already on the workspace surface. Elsewhere, let the
      // link navigate — the old-route redirect funnels it back into the workspace
      // (the store is app-level, so nothing is lost). This also keeps the hook
      // free of useRouter, which throws outside an app-router context (tests).
      if (pathname !== '/workspace') return false
      const intent = parseHrefToIntent(href)
      if (!intent) return false
      event?.preventDefault()
      ws.openTab(intent.kind, intent.payload)
      return true
    },
    [ws, pathname]
  )
}
