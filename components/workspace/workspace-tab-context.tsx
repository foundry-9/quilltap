'use client'

/**
 * Per-tab context + portal registry for the tabbed workspace.
 *
 * - {@link WorkspaceTabContext} tells a mounted view which workspace tab it is
 *   (so e.g. a Salon view can parent its Terminal/Document child tabs to itself).
 * - {@link WorkspacePortalRegistryProvider} lets a view (the Salon) render a
 *   subtree into another tab's DOM container without changing its React parent —
 *   how Terminal/Document panes live in sibling tabs while their hooks (and the
 *   live PTY / editor) stay mounted inside the kept-alive Salon view.
 *
 * @module components/workspace/workspace-tab-context
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// ---------------------------------------------------------------------------
// Which tab am I?
// ---------------------------------------------------------------------------

interface WorkspaceTabContextValue {
  tabId: string
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null)

export function WorkspaceTabProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  const value = useMemo(() => ({ tabId }), [tabId])
  return <WorkspaceTabContext.Provider value={value}>{children}</WorkspaceTabContext.Provider>
}

/** The current tab's id, or `null` when rendered outside the workspace (legacy route). */
export function useWorkspaceTabId(): string | null {
  return useContext(WorkspaceTabContext)?.tabId ?? null
}

// ---------------------------------------------------------------------------
// Tab visibility + re-activation
// ---------------------------------------------------------------------------

/**
 * Whether the containing tab is its pane's active (visible) tab. `null` means
 * "not inside the workspace" (legacy full-page routes), where a view is always
 * effectively visible.
 */
const WorkspaceTabVisibilityContext = createContext<boolean | null>(null)

export function WorkspaceTabVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean
  children: ReactNode
}) {
  return (
    <WorkspaceTabVisibilityContext.Provider value={visible}>
      {children}
    </WorkspaceTabVisibilityContext.Provider>
  )
}

/**
 * Whether the containing workspace tab is currently the visible tab of its
 * pane. `true` outside the workspace (a full-page route is always visible).
 */
export function useWorkspaceTabVisible(): boolean {
  return useContext(WorkspaceTabVisibilityContext) ?? true
}

/**
 * Runs `callback` each time the containing workspace tab is **re-activated** —
 * a hidden→visible transition, i.e. the user navigated away and came back.
 *
 * Views use this to refresh their data sources so a kept-alive (never
 * unmounted) tab doesn't show the world as it stood when the user left.
 * Deliberately does NOT fire on the initial mount (the view's own on-mount
 * fetch covers that) and never fires outside the workspace.
 *
 * The latest `callback` is always the one invoked — callers don't need to
 * memoize it.
 */
export function useOnTabActivated(callback: () => void): void {
  const visible = useContext(WorkspaceTabVisibilityContext)
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })
  const prevVisibleRef = useRef(visible)
  useEffect(() => {
    const prev = prevVisibleRef.current
    prevVisibleRef.current = visible
    if (visible === true && prev === false) callbackRef.current()
  }, [visible])
}

// ---------------------------------------------------------------------------
// Cross-tab portal registry
// ---------------------------------------------------------------------------

interface PortalRegistryValue {
  nodes: Record<string, HTMLElement | null>
  setNode: (key: string, node: HTMLElement | null) => void
}

const PortalRegistryContext = createContext<PortalRegistryValue | null>(null)

export function WorkspacePortalRegistryProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Record<string, HTMLElement | null>>({})

  const setNode = useCallback((key: string, node: HTMLElement | null) => {
    setNodes((prev) => {
      if (prev[key] === node) return prev
      const next = { ...prev }
      if (node) next[key] = node
      else delete next[key]
      return next
    })
  }, [])

  const value = useMemo<PortalRegistryValue>(() => ({ nodes, setNode }), [nodes, setNode])
  return <PortalRegistryContext.Provider value={value}>{children}</PortalRegistryContext.Provider>
}

/**
 * Portal key for a chat-linked child pane (terminal/document). Terminal is one
 * per chat; documents are keyed additionally by the open document's row id so a
 * chat can portal several document panes (one per open document) at once.
 */
export function portalKey(kind: 'terminal' | 'document', chatId: string, docId?: string): string {
  return docId ? `${kind}:${chatId}:${docId}` : `${kind}:${chatId}`
}

/**
 * Registers/looks up a portal host node. A host tab calls
 * `setNode(key, el)` via a ref callback; the source view reads `nodes[key]`.
 * Returns `null` outside the workspace.
 */
export function useWorkspacePortalRegistry(): PortalRegistryValue | null {
  return useContext(PortalRegistryContext)
}
