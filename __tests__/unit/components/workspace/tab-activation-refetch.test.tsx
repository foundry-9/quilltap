/**
 * Tab re-activation refresh: navigating back to a kept-alive tab must refresh
 * its data sources. Two layers under test:
 *
 *  1. `useOnTabActivated` — fires on every hidden→visible transition of the
 *     containing tab, never on the initial mount, and never outside the
 *     workspace.
 *  2. `tabActivationQueryKeys` — the kind→query-key-prefix map that TabView's
 *     invalidator feeds to TanStack Query, including the deliberate blanks
 *     (live streams, editors with unsaved state).
 */

import { render } from '@testing-library/react'
import {
  WorkspaceTabVisibilityProvider,
  useOnTabActivated,
} from '@/components/workspace/workspace-tab-context'
import { tabActivationQueryKeys } from '@/lib/workspace/tab-refetch'
import { queryKeys } from '@/lib/query/keys'
import type { WorkspaceTab } from '@/lib/workspace/types'

function Probe({ onActivated }: { onActivated: () => void }) {
  useOnTabActivated(onActivated)
  return null
}

describe('useOnTabActivated', () => {
  it('does not fire on the initial mount', () => {
    const spy = jest.fn()
    render(
      <WorkspaceTabVisibilityProvider visible={true}>
        <Probe onActivated={spy} />
      </WorkspaceTabVisibilityProvider>
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('fires on every hidden→visible transition, not on visible→hidden', () => {
    const spy = jest.fn()
    const view = (visible: boolean) => (
      <WorkspaceTabVisibilityProvider visible={visible}>
        <Probe onActivated={spy} />
      </WorkspaceTabVisibilityProvider>
    )
    const { rerender } = render(view(true))
    rerender(view(false))
    expect(spy).not.toHaveBeenCalled()
    rerender(view(true))
    expect(spy).toHaveBeenCalledTimes(1)
    rerender(view(false))
    rerender(view(true))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('invokes the latest callback, not the one from the render that hid the tab', () => {
    const first = jest.fn()
    const second = jest.fn()
    const view = (visible: boolean, cb: () => void) => (
      <WorkspaceTabVisibilityProvider visible={visible}>
        <Probe onActivated={cb} />
      </WorkspaceTabVisibilityProvider>
    )
    const { rerender } = render(view(true, first))
    rerender(view(false, first))
    rerender(view(false, second))
    rerender(view(true, second))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('never fires outside the workspace (no visibility provider)', () => {
    const spy = jest.fn()
    const { rerender } = render(<Probe onActivated={spy} />)
    rerender(<Probe onActivated={spy} />)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('tabActivationQueryKeys', () => {
  const tab = (kind: WorkspaceTab['kind'], payload?: unknown): WorkspaceTab => ({
    id: 't1',
    kind,
    payload,
    title: 'x',
  })

  it('refreshes the home dashboard and the entities it summarizes', () => {
    expect(tabActivationQueryKeys(tab('home'))).toEqual([
      queryKeys.home.all,
      queryKeys.chats.lists,
      queryKeys.projects.all,
      queryKeys.characters.all,
    ])
  })

  it('uses the chats *list* prefix, never the all-chats prefix that would sweep per-chat detail/state', () => {
    for (const kind of ['home', 'salon-list'] as const) {
      const keys = tabActivationQueryKeys(tab(kind))
      expect(keys).toContainEqual(queryKeys.chats.lists)
      expect(keys).not.toContainEqual(queryKeys.chats.all)
    }
  })

  it('scopes character-view invalidation to the payload character', () => {
    expect(tabActivationQueryKeys(tab('character-view', { characterId: 'c9' }))).toEqual([
      queryKeys.characters.detail('c9'),
      queryKeys.characters.prompts('c9'),
      queryKeys.characters.photos('c9'),
    ])
    expect(tabActivationQueryKeys(tab('character-view'))).toEqual([])
  })

  it('leaves live surfaces and unsaved-state editors alone', () => {
    for (const kind of [
      'salon',
      'terminal',
      'document',
      'document-standalone',
      'brahma',
      'character-edit',
      'character-new',
      'settings-wizard',
      'about',
    ] as const) {
      expect(tabActivationQueryKeys(tab(kind))).toEqual([])
    }
  })
})
