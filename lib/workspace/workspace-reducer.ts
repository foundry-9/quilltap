/**
 * Tabbed workspace — pure reducer + selectors.
 *
 * Owns the open-tab set, their assignment to the left/right pane, the active
 * tab per pane, the focused pane, and the split ratio. Kept deliberately pure
 * (no React, no `crypto`, no `localStorage`) so it can be exhaustively unit
 * tested — every id the reducer needs is supplied in the action by the caller.
 *
 * @module lib/workspace/workspace-reducer
 */

import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  type PaneId,
  type PaneState,
  type TabKind,
  type WorkspaceState,
  type WorkspaceTab,
} from './types'
import { defaultTabMeta } from './tab-meta'

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | {
      type: 'OPEN_TAB'
      /** Caller-minted uuid for the new tab (ignored if a matching tab exists). */
      id: string
      kind: TabKind
      payload?: unknown
      title?: string
      icon?: string
      parentTabId?: string
      /** Target pane; defaults to the focused pane. */
      pane?: PaneId
      /** Whether to activate + focus the tab. Default `true`. */
      focus?: boolean
    }
  | {
      type: 'CLOSE_TAB'
      id: string
      /** Fresh uuid used only if closing the last tab resets to a home tab. */
      homeFallbackId: string
    }
  | { type: 'MOVE_TAB'; id: string; toPane: PaneId; toIndex?: number }
  | { type: 'SET_ACTIVE'; pane: PaneId; id: string }
  | { type: 'SET_FOCUSED_PANE'; pane: PaneId }
  | { type: 'UNSPLIT' }
  | { type: 'SET_SPLIT_RATIO'; ratio: number }
  | { type: 'REPLACE_STATE'; state: WorkspaceState }

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createHomeTab(id: string): WorkspaceTab {
  const meta = defaultTabMeta('home')
  return { id, kind: 'home', title: meta.title, icon: meta.icon }
}

/** A single home tab in a single (unsplit) left pane. */
export function createInitialState(homeId: string): WorkspaceState {
  return {
    tabs: { [homeId]: createHomeTab(homeId) },
    panes: {
      left: { order: [homeId], activeTabId: homeId },
      right: null,
    },
    focusedPane: 'left',
    splitRatio: DEFAULT_SPLIT_RATIO,
  }
}

// ---------------------------------------------------------------------------
// Identity / selectors
// ---------------------------------------------------------------------------

function chatIdOf(payload: unknown): string {
  return (payload as { chatId?: string } | undefined)?.chatId ?? ''
}

function chatDocumentIdOf(payload: unknown): string {
  return (payload as { chatDocumentId?: string } | undefined)?.chatDocumentId ?? ''
}

/**
 * De-dupe key for a tab. Salon/terminal tabs are keyed by their (parent) chat
 * id and character-edit/character-view by its character id (so each character
 * gets its own editor and detail tab). Document tabs are keyed by chat id **and** the open document's
 * row id, so a single chat can have several document tabs open at once (one per
 * document). Every other kind is a singleton keyed by kind alone.
 */
export function tabIdentity(tab: { kind: TabKind; payload?: unknown }): string {
  switch (tab.kind) {
    case 'salon':
      return `salon:${chatIdOf(tab.payload)}`
    case 'terminal':
      return `terminal:${chatIdOf(tab.payload)}`
    case 'document':
      return `document:${chatIdOf(tab.payload)}:${chatDocumentIdOf(tab.payload)}`
    case 'document-standalone':
      return `document-standalone:${(tab.payload as { docKey?: string } | undefined)?.docKey ?? ''}`
    case 'character-edit':
      return `character-edit:${(tab.payload as { characterId?: string } | undefined)?.characterId ?? ''}`
    case 'character-view':
      return `character-view:${(tab.payload as { characterId?: string } | undefined)?.characterId ?? ''}`
    case 'custom-tools': {
      // One tab per open definition; the payload-less library is its own tab.
      const payload = tab.payload as { mountPointId?: string; path?: string } | undefined
      return `custom-tools:${payload?.mountPointId ?? ''}:${payload?.path ?? ''}`
    }
    default:
      return tab.kind
  }
}

export function paneOfTab(state: WorkspaceState, tabId: string): PaneId | null {
  if (state.panes.left.order.includes(tabId)) return 'left'
  if (state.panes.right?.order.includes(tabId)) return 'right'
  return null
}

export function getPaneState(state: WorkspaceState, pane: PaneId): PaneState | null {
  return pane === 'left' ? state.panes.left : state.panes.right
}

export function isActiveInItsPane(state: WorkspaceState, tabId: string): boolean {
  const pane = paneOfTab(state, tabId)
  if (!pane) return false
  return getPaneState(state, pane)?.activeTabId === tabId
}

export function isSplit(state: WorkspaceState): boolean {
  return state.panes.right != null
}

// ---------------------------------------------------------------------------
// Internal pure utilities
// ---------------------------------------------------------------------------

function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))
}

function setPane(
  panes: WorkspaceState['panes'],
  pane: PaneId,
  value: PaneState | null
): WorkspaceState['panes'] {
  return pane === 'left'
    ? { ...panes, left: value as PaneState }
    : { ...panes, right: value }
}

function clampIndex(idx: number | undefined, len: number): number {
  if (idx == null || !Number.isFinite(idx)) return len
  return Math.max(0, Math.min(len, Math.floor(idx)))
}

/** After removing `removedId`, pick the neighbouring tab to activate. */
function pickNeighbor(order: string[], removedId: string): string | null {
  const idx = order.indexOf(removedId)
  const remaining = order.filter((id) => id !== removedId)
  if (remaining.length === 0) return null
  return remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
}

/** Choose the surviving active tab after a removal set is applied to a pane. */
function pickActiveAfterRemoval(
  oldPane: PaneState,
  removeIds: Set<string>
): string | null {
  const survivors = oldPane.order.filter((id) => !removeIds.has(id))
  if (survivors.length === 0) return null
  const current = oldPane.activeTabId
  if (current && !removeIds.has(current)) return current
  // The active tab was removed — walk forward from its old position to the
  // first survivor, then backward.
  const oldIndex = current ? oldPane.order.indexOf(current) : 0
  for (let i = Math.max(oldIndex, 0); i < oldPane.order.length; i++) {
    if (!removeIds.has(oldPane.order[i])) return oldPane.order[i]
  }
  for (let i = oldIndex - 1; i >= 0; i--) {
    if (!removeIds.has(oldPane.order[i])) return oldPane.order[i]
  }
  return survivors[0]
}

function payloadEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

/**
 * Remove a set of tab ids, repair active references, collapse an emptied right
 * pane, promote the right pane into the left if the left empties, and reset to
 * a fresh home tab if everything is gone.
 */
function removeTabs(
  state: WorkspaceState,
  removeIds: Set<string>,
  homeFallbackId: string
): WorkspaceState {
  const tabs: Record<string, WorkspaceTab> = {}
  for (const [id, tab] of Object.entries(state.tabs)) {
    if (!removeIds.has(id)) tabs[id] = tab
  }

  let left: PaneState = {
    order: state.panes.left.order.filter((id) => !removeIds.has(id)),
    activeTabId: pickActiveAfterRemoval(state.panes.left, removeIds),
  }
  let right: PaneState | null = state.panes.right
    ? {
        order: state.panes.right.order.filter((id) => !removeIds.has(id)),
        activeTabId: pickActiveAfterRemoval(state.panes.right, removeIds),
      }
    : null
  let focusedPane = state.focusedPane

  // Collapse an emptied right pane.
  if (right && right.order.length === 0) {
    right = null
    if (focusedPane === 'right') focusedPane = 'left'
  }
  // If the left pane emptied but the right still has tabs, promote right→left.
  if (left.order.length === 0 && right && right.order.length > 0) {
    left = right
    right = null
    focusedPane = 'left'
  }
  // Everything is gone — reset to a single home tab.
  if (left.order.length === 0 && (!right || right.order.length === 0)) {
    return createInitialState(homeFallbackId)
  }

  return { ...state, tabs, panes: { left, right }, focusedPane }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case 'OPEN_TAB': {
      const focus = action.focus ?? true
      const identity = tabIdentity({ kind: action.kind, payload: action.payload })
      const existing = Object.values(state.tabs).find(
        (t) => tabIdentity(t) === identity
      )

      // De-dupe: focus the existing tab (and refresh its payload/title so a
      // deep-link re-open, e.g. settings ?tab=, navigates).
      if (existing) {
        let tabs = state.tabs
        if (
          (action.payload !== undefined && !payloadEqual(existing.payload, action.payload)) ||
          (action.title !== undefined && action.title !== existing.title)
        ) {
          tabs = {
            ...state.tabs,
            [existing.id]: {
              ...existing,
              payload: action.payload !== undefined ? action.payload : existing.payload,
              title: action.title ?? existing.title,
            },
          }
        }
        if (!focus) return tabs === state.tabs ? state : { ...state, tabs }
        const existingPane = paneOfTab(state, existing.id) ?? 'left'
        const paneState = getPaneState({ ...state, tabs }, existingPane)!
        return {
          ...state,
          tabs,
          panes: setPane(state.panes, existingPane, {
            ...paneState,
            activeTabId: existing.id,
          }),
          focusedPane: existingPane,
        }
      }

      // Insert a fresh tab.
      let panes = state.panes
      let targetPane: PaneId = action.pane ?? state.focusedPane
      if (targetPane === 'right' && !panes.right) {
        panes = { ...panes, right: { order: [], activeTabId: null } }
      }
      // Defensive: focused pane could reference a collapsed right pane.
      if (targetPane === 'right' && !panes.right) targetPane = 'left'

      const meta = defaultTabMeta(action.kind)
      const tab: WorkspaceTab = {
        id: action.id,
        kind: action.kind,
        payload: action.payload,
        title: action.title ?? meta.title,
        icon: action.icon ?? meta.icon,
        parentTabId: action.parentTabId,
      }
      const tabs = { ...state.tabs, [tab.id]: tab }
      const paneState = getPaneState({ ...state, panes }, targetPane)!
      const order = [...paneState.order, tab.id]
      const newPaneState: PaneState = {
        order,
        activeTabId: focus ? tab.id : paneState.activeTabId ?? tab.id,
      }
      return {
        ...state,
        tabs,
        panes: setPane(panes, targetPane, newPaneState),
        focusedPane: focus ? targetPane : state.focusedPane,
      }
    }

    case 'CLOSE_TAB': {
      const tab = state.tabs[action.id]
      if (!tab) return state
      // Cascade: closing a tab also closes its child tabs (terminal/document).
      const childIds = Object.values(state.tabs)
        .filter((t) => t.parentTabId === action.id)
        .map((t) => t.id)
      return removeTabs(state, new Set([action.id, ...childIds]), action.homeFallbackId)
    }

    case 'MOVE_TAB': {
      const tab = state.tabs[action.id]
      if (!tab) return state
      const fromPane = paneOfTab(state, action.id)
      if (!fromPane) return state
      const toPane = action.toPane

      // Same-pane reorder.
      if (fromPane === toPane) {
        const pane = getPaneState(state, fromPane)!
        const without = pane.order.filter((id) => id !== action.id)
        const index = clampIndex(action.toIndex, without.length)
        const order = [...without.slice(0, index), action.id, ...without.slice(index)]
        return {
          ...state,
          panes: setPane(state.panes, fromPane, { order, activeTabId: action.id }),
          focusedPane: fromPane,
        }
      }

      // Cross-pane move — ensure the target pane exists.
      let panes = state.panes
      if (toPane === 'right' && !panes.right) {
        panes = { ...panes, right: { order: [], activeTabId: null } }
      }
      const source = getPaneState({ ...state, panes }, fromPane)!
      const target = getPaneState({ ...state, panes }, toPane)!

      const sourceOrder = source.order.filter((id) => id !== action.id)
      const sourceActive =
        source.activeTabId === action.id
          ? pickNeighbor(source.order, action.id)
          : source.activeTabId
      const index = clampIndex(action.toIndex, target.order.length)
      const targetOrder = [
        ...target.order.slice(0, index),
        action.id,
        ...target.order.slice(index),
      ]

      panes = setPane(panes, fromPane, { order: sourceOrder, activeTabId: sourceActive })
      panes = setPane(panes, toPane, { order: targetOrder, activeTabId: action.id })

      let left = panes.left
      let right = panes.right
      let focusedPane: PaneId = toPane
      if (right && right.order.length === 0) {
        right = null
      }
      if (left.order.length === 0 && right && right.order.length > 0) {
        left = right
        right = null
        focusedPane = 'left'
      }
      return { ...state, panes: { left, right }, focusedPane }
    }

    case 'SET_ACTIVE': {
      const paneState = getPaneState(state, action.pane)
      if (!paneState || !paneState.order.includes(action.id)) return state
      return {
        ...state,
        panes: setPane(state.panes, action.pane, {
          ...paneState,
          activeTabId: action.id,
        }),
        focusedPane: action.pane,
      }
    }

    case 'SET_FOCUSED_PANE': {
      if (action.pane === 'right' && !state.panes.right) return state
      if (action.pane === state.focusedPane) return state
      return { ...state, focusedPane: action.pane }
    }

    case 'UNSPLIT': {
      if (!state.panes.right) return state
      const { left, right } = state.panes
      const order = [...left.order, ...right.order]
      return {
        ...state,
        panes: {
          left: {
            order,
            activeTabId: left.activeTabId ?? right.activeTabId ?? order[0] ?? null,
          },
          right: null,
        },
        focusedPane: 'left',
      }
    }

    case 'SET_SPLIT_RATIO':
      return { ...state, splitRatio: clampSplitRatio(action.ratio) }

    case 'REPLACE_STATE':
      return action.state

    default:
      return state
  }
}
