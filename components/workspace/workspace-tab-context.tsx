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

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

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
