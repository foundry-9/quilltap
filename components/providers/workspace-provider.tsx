'use client'

/**
 * Workspace Provider
 *
 * Client store for the tabbed workspace: the open-tab set, their pane
 * assignment, the active tab per pane, the focused pane, and the split ratio.
 * Wraps the pure {@link workspaceReducer} with localStorage persistence
 * (debounced) and uuid minting. The actual two-pane rendering lives in the
 * workspace route; this provider only owns state + actions.
 *
 * Keep-alive constraint: this store never decides whether a view is mounted —
 * the host renders every open tab and hides inactive ones via CSS. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/providers/workspace-provider
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  workspaceReducer,
  createInitialState,
  tabIdentity,
  type WorkspaceAction,
} from '@/lib/workspace/workspace-reducer'
import type { PaneId, TabKind, WorkspaceState, WorkspaceTab } from '@/lib/workspace/types'
import {
  hydrateWorkspaceState,
  serializeWorkspaceState,
  workspaceStorageKey,
  type PruneOptions,
} from '@/lib/workspace/workspace-persistence'

/** Stable id for the default home tab (home is a singleton). */
const HOME_TAB_ID = 'home'

/** How long to wait after the last change before persisting. */
const PERSIST_DEBOUNCE_MS = 250

function freshId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Extremely defensive fallback for environments without Web Crypto.
  return `tab-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

export interface OpenTabOptions {
  pane?: PaneId
  focus?: boolean
  title?: string
  icon?: string
  parentTabId?: string
}

interface WorkspaceContextValue {
  state: WorkspaceState
  /** True once the layout has been hydrated from localStorage (or confirmed empty). */
  hydrated: boolean
  tabs: Record<string, WorkspaceTab>
  /**
   * Open (or focus an existing) tab. De-dupes by kind+chat identity. Returns
   * the resulting tab id (the existing one when de-duped).
   */
  openTab: (kind: TabKind, payload?: unknown, opts?: OpenTabOptions) => string
  closeTab: (id: string) => void
  moveTab: (id: string, toPane: PaneId, toIndex?: number) => void
  reorderTab: (id: string, toIndex: number) => void
  setActive: (pane: PaneId, id: string) => void
  setFocusedPane: (pane: PaneId) => void
  /** Move a tab into the other pane, creating the split if needed. */
  splitTo: (id: string, pane: PaneId) => void
  unsplit: () => void
  setSplitRatio: (ratio: number) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export interface WorkspaceProviderProps {
  children: ReactNode
  /** Scopes the localStorage key (per Quilltap instance). */
  instanceId?: string | null
  /** Validates persisted chat references on hydrate (dead-tab pruning). */
  isChatValid?: PruneOptions['isChatValid']
}

export function WorkspaceProvider({ children, instanceId, isChatValid }: WorkspaceProviderProps) {
  // Server-safe deterministic default; real layout is hydrated after mount to
  // avoid SSR/localStorage hydration mismatches.
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    () => createInitialState(HOME_TAB_ID)
  )

  // A ref to the latest state so action callbacks can read it synchronously
  // (e.g. to resolve an existing tab's id for de-dupe) without re-binding. The
  // reducer is the source of truth for de-dupe, so a one-tick-stale ref only
  // affects the returned id of back-to-back same-kind opens (a non-issue).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const storageKey = useMemo(() => workspaceStorageKey(instanceId), [instanceId])
  const hydratedRef = useRef(false)
  // State mirror of `hydratedRef` so consumers (e.g. WorkspaceIntent) re-render
  // and can wait for hydration before acting. Crucial: an `?open=` intent must
  // be applied AFTER localStorage hydration, or the hydrate REPLACE_STATE clobbers
  // the just-opened tab — effects run child-first, so the intent would otherwise
  // win the race and then be overwritten.
  const [hydrated, setHydrated] = useState(false)

  // Keep the chat validator current without re-running hydration. Initialized
  // from the prop so the mount-only hydrate effect reads the right validator.
  const isChatValidRef = useRef(isChatValid)
  useEffect(() => {
    isChatValidRef.current = isChatValid
  }, [isChatValid])

  // Hydrate from localStorage once, after mount.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const next = hydrateWorkspaceState(
          raw,
          { isChatValid: isChatValidRef.current },
          freshId()
        )
        dispatch({ type: 'REPLACE_STATE', state: next })
      }
    } catch {
      // Corrupt/unavailable storage — keep the default.
    }
    setHydrated(true)
  }, [storageKey])

  // Persist (debounced) after every change, but only once hydrated so we never
  // clobber a stored layout with the pre-hydration default.
  useEffect(() => {
    if (!hydratedRef.current) return
    const handle = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, serializeWorkspaceState(state))
      } catch {
        // Storage full/unavailable — non-fatal; layout simply won't persist.
      }
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [state, storageKey])

  const dispatchAction = useCallback((action: WorkspaceAction) => dispatch(action), [])

  const openTab = useCallback<WorkspaceContextValue['openTab']>((kind, payload, opts = {}) => {
    const identity = tabIdentity({ kind, payload })
    const existing = Object.values(stateRef.current.tabs).find(
      (t) => tabIdentity(t) === identity
    )
    const id = existing?.id ?? freshId()
    dispatchAction({
      type: 'OPEN_TAB',
      id,
      kind,
      payload,
      title: opts.title,
      icon: opts.icon,
      parentTabId: opts.parentTabId,
      pane: opts.pane,
      focus: opts.focus,
    })
    return id
  }, [dispatchAction])

  const closeTab = useCallback<WorkspaceContextValue['closeTab']>(
    (id) => dispatchAction({ type: 'CLOSE_TAB', id, homeFallbackId: freshId() }),
    [dispatchAction]
  )

  const moveTab = useCallback<WorkspaceContextValue['moveTab']>(
    (id, toPane, toIndex) => dispatchAction({ type: 'MOVE_TAB', id, toPane, toIndex }),
    [dispatchAction]
  )

  const reorderTab = useCallback<WorkspaceContextValue['reorderTab']>(
    (id, toIndex) => {
      const pane = stateRef.current.panes.left.order.includes(id) ? 'left' : 'right'
      dispatchAction({ type: 'MOVE_TAB', id, toPane: pane, toIndex })
    },
    [dispatchAction]
  )

  const setActive = useCallback<WorkspaceContextValue['setActive']>(
    (pane, id) => dispatchAction({ type: 'SET_ACTIVE', pane, id }),
    [dispatchAction]
  )

  const setFocusedPane = useCallback<WorkspaceContextValue['setFocusedPane']>(
    (pane) => dispatchAction({ type: 'SET_FOCUSED_PANE', pane }),
    [dispatchAction]
  )

  const splitTo = useCallback<WorkspaceContextValue['splitTo']>(
    (id, pane) => dispatchAction({ type: 'MOVE_TAB', id, toPane: pane }),
    [dispatchAction]
  )

  const unsplit = useCallback<WorkspaceContextValue['unsplit']>(
    () => dispatchAction({ type: 'UNSPLIT' }),
    [dispatchAction]
  )

  const setSplitRatio = useCallback<WorkspaceContextValue['setSplitRatio']>(
    (ratio) => dispatchAction({ type: 'SET_SPLIT_RATIO', ratio }),
    [dispatchAction]
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      hydrated,
      tabs: state.tabs,
      openTab,
      closeTab,
      moveTab,
      reorderTab,
      setActive,
      setFocusedPane,
      splitTo,
      unsplit,
      setSplitRatio,
    }),
    [
      state,
      hydrated,
      openTab,
      closeTab,
      moveTab,
      reorderTab,
      setActive,
      setFocusedPane,
      splitTo,
      unsplit,
      setSplitRatio,
    ]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return ctx
}

export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
