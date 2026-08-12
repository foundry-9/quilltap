/**
 * Unit tests for tabbed-workspace persistence: serialize round-trip, shape
 * validation, dead-tab pruning, and the hydrate convenience.
 */

import {
  serializeWorkspaceState,
  deserializeWorkspaceState,
  pruneWorkspaceState,
  hydrateWorkspaceState,
  workspaceStorageKey,
  WORKSPACE_STORAGE_KEY_BASE,
} from '@/lib/workspace/workspace-persistence'
import {
  workspaceReducer,
  createInitialState,
} from '@/lib/workspace/workspace-reducer'
import type { TabKind, WorkspaceState } from '@/lib/workspace/types'

function build(): WorkspaceState {
  // home + salon(c1) in left; salon(c2) + terminal(c2) in right.
  let s = createInitialState('home')
  s = workspaceReducer(s, {
    type: 'OPEN_TAB',
    id: 's1',
    kind: 'salon',
    payload: { chatId: 'c1' },
  })
  s = workspaceReducer(s, {
    type: 'OPEN_TAB',
    id: 's2',
    kind: 'salon',
    payload: { chatId: 'c2' },
    pane: 'right',
  })
  s = workspaceReducer(s, {
    type: 'OPEN_TAB',
    id: 't2',
    kind: 'terminal',
    payload: { chatId: 'c2' },
    parentTabId: 's2',
    pane: 'right',
  })
  return s
}

describe('workspaceStorageKey', () => {
  it('scopes by instance id when provided', () => {
    expect(workspaceStorageKey()).toBe(WORKSPACE_STORAGE_KEY_BASE)
    expect(workspaceStorageKey(null)).toBe(WORKSPACE_STORAGE_KEY_BASE)
    expect(workspaceStorageKey('inst-1')).toBe(`${WORKSPACE_STORAGE_KEY_BASE}.inst-1`)
  })
})

describe('serialize/deserialize', () => {
  it('round-trips a workspace state', () => {
    const s = build()
    const restored = deserializeWorkspaceState(serializeWorkspaceState(s))
    expect(restored).toEqual(s)
  })

  it('returns null for empty/garbage/invalid shapes', () => {
    expect(deserializeWorkspaceState(null)).toBeNull()
    expect(deserializeWorkspaceState('')).toBeNull()
    expect(deserializeWorkspaceState('not json')).toBeNull()
    expect(deserializeWorkspaceState('{"tabs":{}}')).toBeNull()
    expect(
      deserializeWorkspaceState(JSON.stringify({ ...build(), focusedPane: 'middle' }))
    ).toBeNull()
  })

  it('drops only an unknown-kind tab, keeping the rest of the layout', () => {
    // A future/older build could persist a tab kind this build does not know.
    // It must not nuke the whole saved workspace — only that tab is dropped.
    const s = build()
    const withBogus = {
      ...s,
      tabs: {
        ...s.tabs,
        bogus: { id: 'bogus', kind: 'from-the-future', title: 'Mystery' },
      },
      panes: {
        ...s.panes,
        left: { ...s.panes.left, order: [...s.panes.left.order, 'bogus'] },
      },
    }
    const restored = deserializeWorkspaceState(JSON.stringify(withBogus))
    expect(restored).not.toBeNull()
    expect(restored!.tabs.bogus).toBeUndefined()
    // Every known tab survives.
    for (const id of Object.keys(s.tabs)) {
      expect(restored!.tabs[id]).toEqual(s.tabs[id])
    }
  })

  it('round-trips every TabKind (TAB_KINDS stays complete)', () => {
    const kinds: TabKind[] = [
      'home', 'salon', 'terminal', 'document', 'aurora', 'prospero',
      'scriptorium', 'settings', 'files', 'photos', 'scenarios', 'brahma',
      'wardrobe', 'profile', 'about', 'generate-image', 'document-standalone',
      'character-new', 'character-edit', 'character-view', 'settings-wizard',
    ]
    const tabs: WorkspaceState['tabs'] = {}
    for (const kind of kinds) {
      const id = `t_${kind}`
      tabs[id] = { id, kind, title: kind }
    }
    const state: WorkspaceState = {
      tabs,
      panes: { left: { order: Object.keys(tabs), activeTabId: Object.keys(tabs)[0] }, right: null },
      focusedPane: 'left',
      splitRatio: 0.5,
    }
    const restored = deserializeWorkspaceState(serializeWorkspaceState(state))
    expect(restored).toEqual(state)
    expect(Object.keys(restored!.tabs)).toHaveLength(kinds.length)
  })
})

describe('pruneWorkspaceState', () => {
  it('keeps everything when all chats are valid', () => {
    const s = build()
    const pruned = pruneWorkspaceState(s, { isChatValid: () => true }, 'h2')
    expect(pruned).toEqual(s)
  })

  it('drops salon tabs whose chat no longer exists', () => {
    const s = build()
    const pruned = pruneWorkspaceState(s, { isChatValid: (id) => id !== 'c1' }, 'h2')
    expect(pruned.tabs.s1).toBeUndefined()
    expect(pruned.panes.left.order).toEqual(['home'])
    // c2 + its terminal survive in the right pane.
    expect(pruned.tabs.s2).toBeDefined()
    expect(pruned.tabs.t2).toBeDefined()
  })

  it('drops a terminal child when its parent chat is gone', () => {
    const s = build()
    const pruned = pruneWorkspaceState(s, { isChatValid: (id) => id !== 'c2' }, 'h2')
    expect(pruned.tabs.s2).toBeUndefined()
    expect(pruned.tabs.t2).toBeUndefined() // orphaned child removed
    // Right pane emptied → collapse.
    expect(pruned.panes.right).toBeNull()
    expect(pruned.panes.left.order).toEqual(['home', 's1'])
  })

  it('falls back to a fresh home tab when everything is pruned', () => {
    // A state with only a salon tab whose chat is invalid.
    let s = createInitialState('home')
    s = workspaceReducer(s, {
      type: 'OPEN_TAB',
      id: 's1',
      kind: 'salon',
      payload: { chatId: 'c1' },
    })
    s = workspaceReducer(s, { type: 'CLOSE_TAB', id: 'home', homeFallbackId: 'x' })
    // Now only s1 remains.
    const pruned = pruneWorkspaceState(s, { isChatValid: () => false }, 'h2')
    expect(Object.keys(pruned.tabs)).toEqual(['h2'])
    expect(pruned.panes.left.order).toEqual(['h2'])
    expect(pruned.panes.right).toBeNull()
  })

  it('keeps a standalone document tab with a resolved file, drops one without', () => {
    let s = createInitialState('home')
    s = workspaceReducer(s, {
      type: 'OPEN_TAB',
      id: 'ds1',
      kind: 'document-standalone',
      payload: { docKey: 'general::notes.md', scope: 'general', filePath: 'notes.md' },
    })
    s = workspaceReducer(s, {
      type: 'OPEN_TAB',
      id: 'ds2',
      kind: 'document-standalone',
      // A blank doc whose payload refresh never landed (no filePath yet) —
      // reopening it would mint a fresh untitled document every reload.
      payload: { docKey: 'uuid-blank', scope: 'general' },
    })
    const pruned = pruneWorkspaceState(s, {}, 'h2')
    expect(pruned.tabs.ds1).toBeDefined()
    expect(pruned.tabs.ds2).toBeUndefined()
  })

  it('repairs a dangling active reference and stray order ids', () => {
    const s = build()
    // Corrupt: point left.activeTabId at a tab that will be pruned.
    const corrupt: WorkspaceState = {
      ...s,
      panes: {
        ...s.panes,
        left: { order: [...s.panes.left.order, 'ghost'], activeTabId: 'ghost' },
      },
    }
    const pruned = pruneWorkspaceState(corrupt, { isChatValid: () => true }, 'h2')
    expect(pruned.panes.left.order).not.toContain('ghost')
    expect(pruned.panes.left.order).toContain(pruned.panes.left.activeTabId)
  })
})

describe('hydrateWorkspaceState', () => {
  it('round-trips through serialized storage and prunes dead tabs', () => {
    const s = build()
    const raw = serializeWorkspaceState(s)
    const hydrated = hydrateWorkspaceState(raw, { isChatValid: (id) => id !== 'c1' }, 'h2')
    expect(hydrated.tabs.s1).toBeUndefined()
    expect(hydrated.tabs.s2).toBeDefined()
  })

  it('returns a fresh home state for missing/garbage storage', () => {
    expect(hydrateWorkspaceState(null, {}, 'h2')).toEqual(createInitialState('h2'))
    expect(hydrateWorkspaceState('garbage', {}, 'h2')).toEqual(createInitialState('h2'))
  })
})
