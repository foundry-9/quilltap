'use client'

/**
 * useWorkspaceNavigate — a keep-alive-safe replacement for `router.push(href)`.
 *
 * For programmatic navigations (card clicks, keyboard handlers) that don't go
 * through an `<a>` and so aren't caught by {@link WorkspaceLinkInterceptor}.
 * Inside the workspace, if the target href maps to a tab it opens/focuses that
 * tab in place (no remount, streaming Salon survives); otherwise — and anywhere
 * outside the workspace — it falls back to a normal `router.push`.
 *
 * Usage: `const navigate = useWorkspaceNavigate(); navigate('/salon/' + id)`.
 *
 * @module components/workspace/useWorkspaceNavigate
 */

import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'

export function useWorkspaceNavigate(): (href: string) => void {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  const router = useRouter()
  return useCallback(
    (href: string) => {
      if (ws && pathname === '/workspace') {
        const intent = parseHrefToIntent(href)
        if (intent) {
          ws.openTab(intent.kind, intent.payload)
          return
        }
      }
      router.push(href)
    },
    [ws, pathname, router]
  )
}
