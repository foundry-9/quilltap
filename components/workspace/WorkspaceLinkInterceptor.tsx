'use client'

/**
 * WorkspaceLinkInterceptor — one delegated click handler that keeps the whole
 * app's links keep-alive-safe inside the workspace.
 *
 * The keep-alive constraint (see `docs/developer/features/tabbed-workspace.md`)
 * forbids navigating to an old route while in the workspace: the route change
 * redirects back to `/workspace` and **remounts the entire workspace**, which
 * tears down a streaming Salon (its EventSource) and any in-flight async UI.
 * Retrofitting every `<a>`/`<Link>` across the app with an `openTab` handler is
 * fragile and easy to forget, so instead this component listens once, at the
 * document level, and intercepts any anchor click whose href maps to a tab —
 * opening (or focusing) that tab in place with no navigation.
 *
 * It runs in the **capture** phase and `preventDefault()`s before the anchor's
 * own handlers, which is what makes it work for Next's `<Link>` too: `<Link>`
 * only navigates `if (!e.defaultPrevented)` inside its own (bubble-phase) click
 * handler, so preventing default first cleanly cancels its client navigation —
 * a plain bubble listener runs too late, after `<Link>` has already pushed the
 * route. Anchors with no tab equivalent (new-chat, detail pages, external
 * links) are left untouched and navigate normally. Only active on `/workspace`.
 *
 * The rail / recent-chat items still carry their own `openTab` handlers; because
 * `openTab` de-dupes (a second call just focuses the existing tab), the brief
 * overlap is idempotent and harmless.
 *
 * Programmatic navigations (`router.push`) don't dispatch an anchor click and
 * are handled separately via {@link useWorkspaceNavigate}.
 *
 * @module components/workspace/WorkspaceLinkInterceptor
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'

export function WorkspaceLinkInterceptor() {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  const openTab = ws?.openTab
  const openNewChat = useNewChatModalOptional()?.open

  useEffect(() => {
    if (!openTab || pathname !== '/workspace') return

    const onClick = (e: MouseEvent) => {
      // Left-click only; let modified clicks open a real browser tab/window.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (e.defaultPrevented) return

      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.hasAttribute('download')) return
      const linkTarget = anchor.getAttribute('target')
      if (linkTarget && linkTarget !== '_self') return

      const href = anchor.getAttribute('href') || ''
      if (!href.startsWith('/')) return // external / hash / relative

      // /salon/new → open the new-chat modal in place rather than routing to the
      // full-page form (which would leave the workspace). Autonomous-room
      // creation (`?autonomous=1`) opens the same modal in autonomous mode.
      const [path, queryStr] = href.split('?')
      if (path === '/salon/new') {
        if (!openNewChat) return
        const q = new URLSearchParams(queryStr ?? '')
        e.preventDefault()
        openNewChat({
          projectId: q.get('projectId') ?? undefined,
          characterId: q.get('characterId') ?? undefined,
          autonomous: q.get('autonomous') === '1',
        })
        return
      }

      const intent = parseHrefToIntent(href)
      if (!intent) return // no tab equivalent → navigate normally

      // preventDefault BEFORE the anchor's own handler so Next's <Link> skips its
      // client navigation (it only pushes when !e.defaultPrevented).
      e.preventDefault()
      openTab(intent.kind, intent.payload)
    }

    document.addEventListener('click', onClick, true) // capture
    return () => document.removeEventListener('click', onClick, true)
  }, [openTab, openNewChat, pathname])

  return null
}
