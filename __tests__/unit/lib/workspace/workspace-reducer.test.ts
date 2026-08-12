/**
 * Unit tests for the tabbed-workspace reducer + selectors.
 *
 * Guards the core state machine: open/close/move/split/unsplit, de-dupe,
 * last-tab-reset, the parent→child close cascade, and pane collapse/promote.
 */

import {
  workspaceReducer,
  createInitialState,
  createHomeTab,
  tabIdentity,
  paneOfTab,
  isActiveInItsPane,
  isSplit,
  type WorkspaceAction,
} from '@/lib/workspace/workspace-reducer'
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  type WorkspaceState,
} from '@/lib/workspace/types'

function reduce(state: WorkspaceState, ...actions: WorkspaceAction[]): WorkspaceState {
  return actions.reduce(workspaceReducer, state)
}

function open(
  id: string,
  kind: WorkspaceAction extends { type: 'OPEN_TAB'; kind: infer K } ? K : never,
  extra: Partial<Extract<WorkspaceAction, { type: 'OPEN_TAB' }>> = {}
): Extract<WorkspaceAction, { type: 'OPEN_TAB' }> {
  return { type: 'OPEN_TAB', id, kind, ...extra }
}

describe('createInitialState', () => {
  it('is a single home tab in an unsplit left pane focused left', () => {
    const s = createInitialState('home')
    expect(Object.keys(s.tabs)).toEqual(['home'])
    expect(s.tabs.home.kind).toBe('home')
    expect(s.panes.left).toEqual({ order: ['home'], activeTabId: 'home' })
    expect(s.panes.right).toBeNull()
    expect(s.focusedPane).toBe('left')
    expect(s.splitRatio).toBe(DEFAULT_SPLIT_RATIO)
  })
})

describe('createHomeTab', () => {
  it('builds a home tab with a title', () => {
    const t = createHomeTab('x')
    expect(t).toMatchObject({ id: 'x', kind: 'home' })
    expect(typeof t.title).toBe('string')
  })
})

describe('tabIdentity', () => {
  it('keys salon/terminal by chatId, document by chatId+documentId, and others by kind', () => {
    expect(tabIdentity({ kind: 'salon', payload: { chatId: 'c1' } })).toBe('salon:c1')
    expect(tabIdentity({ kind: 'terminal', payload: { chatId: 'c1' } })).toBe('terminal:c1')
    // Documents are keyed by chat AND open-document id, so one chat can host
    // several document tabs (one per open document).
    expect(tabIdentity({ kind: 'document', payload: { chatId: 'c1', chatDocumentId: 'd1' } })).toBe('document:c1:d1')
    expect(tabIdentity({ kind: 'document', payload: { chatId: 'c1', chatDocumentId: 'd2' } })).toBe('document:c1:d2')
    // Standalone documents are keyed by their client-minted docKey, which is
    // file identity for existing files and a uuid for new blanks.
    expect(tabIdentity({ kind: 'document-standalone', payload: { docKey: 'general::notes.md' } })).toBe('document-standalone:general::notes.md')
    expect(tabIdentity({ kind: 'aurora' })).toBe('aurora')
    expect(tabIdentity({ kind: 'settings', payload: { tab: 'system' } })).toBe('settings')
  })
})

describe('OPEN_TAB', () => {
  it('opens a new tab into the focused pane and activates it', () => {
    const s = reduce(createInitialState('home'), open('a', 'aurora'))
    expect(s.panes.left.order).toEqual(['home', 'a'])
    expect(s.panes.left.activeTabId).toBe('a')
    expect(s.focusedPane).toBe('left')
    expect(s.tabs.a.kind).toBe('aurora')
  })

  it('de-dupes singletons — re-opening focuses the existing tab, no duplicate', () => {
    const s = reduce(
      createInitialState('home'),
      open('a', 'aurora'),
      open('b', 'prospero'),
      open('zzz', 'aurora') // duplicate aurora with a different id
    )
    expect(s.panes.left.order).toEqual(['home', 'a', 'b'])
    expect(s.tabs.zzz).toBeUndefined()
    expect(s.panes.left.activeTabId).toBe('a') // existing aurora focused
  })

  it('treats salon tabs with different chatIds as distinct', () => {
    const s = reduce(
      createInitialState('home'),
      open('a', 'salon', { payload: { chatId: 'c1' } }),
      open('b', 'salon', { payload: { chatId: 'c2' } })
    )
    expect(s.panes.left.order).toEqual(['home', 'a', 'b'])
    expect(isSplit(s)).toBe(false)
  })

  it('de-dupes a salon tab by chatId', () => {
    const s = reduce(
      createInitialState('home'),
      open('a', 'salon', { payload: { chatId: 'c1' } }),
      open('dup', 'salon', { payload: { chatId: 'c1' } })
    )
    expect(s.panes.left.order).toEqual(['home', 'a'])
    expect(s.tabs.dup).toBeUndefined()
  })

  it('updates payload/title when re-opening a singleton (settings deep-link)', () => {
    const s = reduce(
      createInitialState('home'),
      open('a', 'settings', { payload: { tab: 'system' }, title: 'System' }),
      open('ignored', 'settings', { payload: { tab: 'memory' }, title: 'Memory' })
    )
    expect(s.tabs.a.payload).toEqual({ tab: 'memory' })
    expect(s.tabs.a.title).toBe('Memory')
    expect(s.panes.left.order).toEqual(['home', 'a'])
  })

  it('opening explicitly into the right pane creates the split', () => {
    const s = reduce(createInitialState('home'), open('a', 'aurora', { pane: 'right' }))
    expect(s.panes.right).not.toBeNull()
    expect(s.panes.right!.order).toEqual(['a'])
    expect(s.panes.right!.activeTabId).toBe('a')
    expect(s.focusedPane).toBe('right')
    expect(isSplit(s)).toBe(true)
  })

  it('focus:false inserts without changing active/focused pane', () => {
    const s = reduce(createInitialState('home'), open('a', 'aurora', { focus: false }))
    expect(s.panes.left.order).toEqual(['home', 'a'])
    expect(s.panes.left.activeTabId).toBe('home')
    expect(s.focusedPane).toBe('left')
  })

  it('respects an explicit parentTabId', () => {
    const s = reduce(
      createInitialState('home'),
      open('s', 'salon', { payload: { chatId: 'c1' } }),
      open('t', 'terminal', { payload: { chatId: 'c1' }, parentTabId: 's' })
    )
    expect(s.tabs.t.parentTabId).toBe('s')
  })
})

describe('SET_ACTIVE / SET_FOCUSED_PANE', () => {
  it('SET_ACTIVE sets the active tab and focuses its pane', () => {
    let s = reduce(createInitialState('home'), open('a', 'aurora'))
    s = workspaceReducer(s, { type: 'SET_ACTIVE', pane: 'left', id: 'home' })
    expect(s.panes.left.activeTabId).toBe('home')
    expect(s.focusedPane).toBe('left')
  })

  it('SET_ACTIVE ignores an id not in the pane', () => {
    const s = createInitialState('home')
    expect(workspaceReducer(s, { type: 'SET_ACTIVE', pane: 'left', id: 'nope' })).toBe(s)
  })

  it('SET_FOCUSED_PANE ignores a non-existent right pane', () => {
    const s = createInitialState('home')
    expect(workspaceReducer(s, { type: 'SET_FOCUSED_PANE', pane: 'right' })).toBe(s)
  })
})

describe('MOVE_TAB', () => {
  it('reorders within the same pane', () => {
    let s = reduce(
      createInitialState('home'),
      open('a', 'aurora'),
      open('b', 'prospero')
    )
    // order: home, a, b — move b to the front
    s = workspaceReducer(s, { type: 'MOVE_TAB', id: 'b', toPane: 'left', toIndex: 0 })
    expect(s.panes.left.order).toEqual(['b', 'home', 'a'])
    expect(s.panes.left.activeTabId).toBe('b')
  })

  it('moves a tab to the right pane, creating the split', () => {
    let s = reduce(createInitialState('home'), open('a', 'aurora'))
    s = workspaceReducer(s, { type: 'MOVE_TAB', id: 'a', toPane: 'right' })
    expect(s.panes.left.order).toEqual(['home'])
    expect(s.panes.right!.order).toEqual(['a'])
    expect(s.panes.right!.activeTabId).toBe('a')
    expect(s.focusedPane).toBe('right')
  })

  it('collapses the source pane when it empties after a move', () => {
    // Split first: home in left, a in right. Then move a back to left.
    let s = reduce(createInitialState('home'), open('a', 'aurora', { pane: 'right' }))
    s = workspaceReducer(s, { type: 'MOVE_TAB', id: 'a', toPane: 'left' })
    expect(s.panes.right).toBeNull()
    expect(s.panes.left.order).toEqual(['home', 'a'])
    expect(isSplit(s)).toBe(false)
  })

  it('picks a new source active tab when the moved tab was active', () => {
    let s = reduce(
      createInitialState('home'),
      open('a', 'aurora'),
      open('b', 'prospero')
    ) // active: b
    s = workspaceReducer(s, { type: 'MOVE_TAB', id: 'b', toPane: 'right' })
    expect(s.panes.left.activeTabId).toBe('a')
    expect(s.panes.right!.activeTabId).toBe('b')
  })
})

describe('UNSPLIT', () => {
  it('merges the right pane back into the left, preserving order', () => {
    let s = reduce(
      createInitialState('home'),
      open('a', 'aurora'),
      open('b', 'prospero', { pane: 'right' })
    )
    s = workspaceReducer(s, { type: 'UNSPLIT' })
    expect(s.panes.right).toBeNull()
    expect(s.panes.left.order).toEqual(['home', 'a', 'b'])
    expect(s.focusedPane).toBe('left')
  })

  it('is a no-op when not split', () => {
    const s = createInitialState('home')
    expect(workspaceReducer(s, { type: 'UNSPLIT' })).toBe(s)
  })
})

describe('SET_SPLIT_RATIO', () => {
  it('clamps to the allowed range', () => {
    const s = createInitialState('home')
    expect(workspaceReducer(s, { type: 'SET_SPLIT_RATIO', ratio: 0.42 }).splitRatio).toBe(0.42)
    expect(workspaceReducer(s, { type: 'SET_SPLIT_RATIO', ratio: 0.01 }).splitRatio).toBe(
      MIN_SPLIT_RATIO
    )
    expect(workspaceReducer(s, { type: 'SET_SPLIT_RATIO', ratio: 0.99 }).splitRatio).toBe(
      MAX_SPLIT_RATIO
    )
    expect(workspaceReducer(s, { type: 'SET_SPLIT_RATIO', ratio: NaN }).splitRatio).toBe(
      DEFAULT_SPLIT_RATIO
    )
  })
})

describe('CLOSE_TAB', () => {
  it('removes a tab and activates a neighbour', () => {
    let s = reduce(
      createInitialState('home'),
      open('a', 'aurora'),
      open('b', 'prospero')
    ) // order: home, a, b; active b
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 'b', homeFallbackId: 'h2' })
    expect(s.panes.left.order).toEqual(['home', 'a'])
    expect(s.panes.left.activeTabId).toBe('a')
    expect(s.tabs.b).toBeUndefined()
  })

  it('closing the last remaining tab resets to a single home tab', () => {
    let s = createInitialState('home')
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 'home', homeFallbackId: 'h2' })
    expect(Object.keys(s.tabs)).toEqual(['h2'])
    expect(s.panes.left).toEqual({ order: ['h2'], activeTabId: 'h2' })
    expect(s.panes.right).toBeNull()
    expect(s.focusedPane).toBe('left')
  })

  it('cascades to child terminal/document tabs when the parent salon closes', () => {
    let s = reduce(
      createInitialState('home'),
      open('s', 'salon', { payload: { chatId: 'c1' } }),
      open('t', 'terminal', { payload: { chatId: 'c1' }, parentTabId: 's' }),
      open('d', 'document', { payload: { chatId: 'c1' }, parentTabId: 's' })
    )
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 's', homeFallbackId: 'h2' })
    expect(s.tabs.s).toBeUndefined()
    expect(s.tabs.t).toBeUndefined()
    expect(s.tabs.d).toBeUndefined()
    expect(s.panes.left.order).toEqual(['home'])
  })

  it('collapses the right pane when its last tab closes', () => {
    let s = reduce(createInitialState('home'), open('a', 'aurora', { pane: 'right' }))
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 'a', homeFallbackId: 'h2' })
    expect(s.panes.right).toBeNull()
    expect(s.focusedPane).toBe('left')
    expect(s.panes.left.order).toEqual(['home'])
  })

  it('promotes the right pane into the left when the left empties', () => {
    // home in left, a in right; close home → left empty, promote right.
    let s = reduce(createInitialState('home'), open('a', 'aurora', { pane: 'right' }))
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 'home', homeFallbackId: 'h2' })
    expect(s.panes.right).toBeNull()
    expect(s.panes.left.order).toEqual(['a'])
    expect(s.panes.left.activeTabId).toBe('a')
    expect(s.focusedPane).toBe('left')
  })

  it('is a no-op for an unknown id', () => {
    const s = createInitialState('home')
    expect(workspaceReducer(s, { type: 'CLOSE_TAB', id: 'nope', homeFallbackId: 'h2' })).toBe(s)
  })
})

describe('selectors', () => {
  it('paneOfTab / isActiveInItsPane reflect placement', () => {
    const s = reduce(createInitialState('home'), open('a', 'aurora', { pane: 'right' }))
    expect(paneOfTab(s, 'home')).toBe('left')
    expect(paneOfTab(s, 'a')).toBe('right')
    expect(paneOfTab(s, 'ghost')).toBeNull()
    expect(isActiveInItsPane(s, 'a')).toBe(true)
    expect(isActiveInItsPane(s, 'home')).toBe(true)
  })
})
