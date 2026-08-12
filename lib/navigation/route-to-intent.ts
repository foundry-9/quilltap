/**
 * Map an in-app href to a workspace tab intent.
 *
 * The inverse of the old-route redirects: when a link is clicked *inside* the
 * workspace, we open (or focus) the matching tab client-side instead of doing a
 * route navigation that would unmount and rebuild the whole workspace. Returns
 * `null` for hrefs with no tab equivalent (new-chat — a modal, handled by the
 * interceptor — and external links) so those navigate normally.
 *
 * @module lib/navigation/route-to-intent
 */

import type { TabKind } from '@/lib/workspace/types'

export interface TabIntent {
  kind: TabKind
  payload?: unknown
}

export function parseHrefToIntent(href: string): TabIntent | null {
  if (!href || !href.startsWith('/')) return null // external / non-path

  let path = href
  let query = ''
  const qIdx = href.indexOf('?')
  if (qIdx >= 0) {
    path = href.slice(0, qIdx)
    query = href.slice(qIdx + 1)
  }
  const hashIdx = path.indexOf('#')
  if (hashIdx >= 0) path = path.slice(0, hashIdx)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  // /salon/<id> — a specific conversation (not the list, not new-chat).
  const salonMatch = path.match(/^\/salon\/([^/]+)$/)
  if (salonMatch) {
    const id = salonMatch[1]
    if (id === 'new') return null
    return { kind: 'salon', payload: { chatId: id } }
  }

  // /prospero/<id> (or legacy /projects/<id>) — the Projects tab drilled into
  // that project.
  const projectMatch = path.match(/^\/(?:prospero|projects)\/([^/]+)$/)
  if (projectMatch) {
    return { kind: 'prospero', payload: { projectId: projectMatch[1] } }
  }

  // /scriptorium/<id> — the Scriptorium tab drilled into that store.
  const storeMatch = path.match(/^\/scriptorium\/([^/]+)$/)
  if (storeMatch) {
    return { kind: 'scriptorium', payload: { storeId: storeMatch[1] } }
  }

  // /aurora/groups/<id> — the Characters tab drilled into that group's editor.
  const groupMatch = path.match(/^\/aurora\/groups\/([^/]+)$/)
  if (groupMatch) {
    return { kind: 'aurora', payload: { groupId: groupMatch[1] } }
  }

  // /aurora/<id>/edit (or legacy /characters/<id>/edit) — the character editor.
  // Note: a bare /aurora/<id> (which redirects to /view) has NO tab equivalent —
  // when linked to it renders in-place inside the Aurora tab — so it
  // intentionally falls through to `null` below.
  const editMatch = path.match(/^\/(?:aurora|characters)\/([^/]+)\/edit$/)
  if (editMatch) {
    const sp = new URLSearchParams(query)
    return {
      kind: 'character-edit',
      payload: { characterId: editMatch[1], tab: sp.get('tab') ?? undefined },
    }
  }

  // /aurora/<id>/view (or legacy /characters/<id>/view) — the read-only character
  // detail page, opened as its own tab (e.g. from the Salon header) so it never
  // navigates away from the workspace.
  const viewMatch = path.match(/^\/(?:aurora|characters)\/([^/]+)\/view$/)
  if (viewMatch) {
    const sp = new URLSearchParams(query)
    return {
      kind: 'character-view',
      payload: { characterId: viewMatch[1], tab: sp.get('tab') ?? undefined },
    }
  }

  switch (path) {
    case '/':
      return { kind: 'home' }
    case '/salon':
    case '/chats':
      return { kind: 'salon-list' }
    case '/aurora':
      return { kind: 'aurora' }
    case '/aurora/new':
      return { kind: 'character-new' }
    case '/profile':
      return { kind: 'profile' }
    case '/about':
      return { kind: 'about' }
    case '/generate-image':
      return { kind: 'generate-image' }
    case '/settings/wizard':
      return { kind: 'settings-wizard' }
    case '/prospero':
      return { kind: 'prospero' }
    case '/scriptorium':
      return { kind: 'scriptorium' }
    case '/files':
      return { kind: 'files' }
    case '/photos':
      return { kind: 'photos' }
    case '/scenarios':
      return { kind: 'scenarios' }
    case '/custom-tools': {
      const sp = new URLSearchParams(query)
      const mountPointId = sp.get('mount') ?? undefined
      const path = sp.get('path') ?? undefined
      const create = sp.get('new') === '1' || undefined
      return {
        kind: 'custom-tools',
        payload: mountPointId || path || create ? { mountPointId, path, create } : undefined,
      }
    }
    case '/settings': {
      const sp = new URLSearchParams(query)
      return {
        kind: 'settings',
        payload: { tab: sp.get('tab') ?? undefined, section: sp.get('section') ?? undefined },
      }
    }
    default:
      return null
  }
}
