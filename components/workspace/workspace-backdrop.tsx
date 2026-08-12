'use client'

/**
 * Workspace backdrop — one arbitrated story/subsystem background for the whole
 * workspace, instead of each pane painting its own (which, being viewport-fixed,
 * overlapped in a split).
 *
 * Rule:
 *  - A **conversation with a background image wins** → it fills the screen.
 *  - Otherwise, **no split** → the single active tab's background fills the screen.
 *  - Otherwise (**split**) → each pane's active-tab background dominates its own
 *    side and softly crossfades across the divider.
 *
 * Views report their background here (no-op outside the workspace) via
 * {@link useReportWorkspaceBackdrop}; {@link WorkspaceBackdrop} reads the active
 * tabs + split state and paints the winner. The per-view `::before` layers are
 * suppressed inside `.qt-workspace` by CSS.
 *
 * @module components/workspace/workspace-backdrop
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'

interface BackdropEntry {
  url: string
  isSalon: boolean
}

interface BackdropRegistryValue {
  entries: Record<string, BackdropEntry>
  report: (tabId: string, entry: BackdropEntry) => void
  clear: (tabId: string) => void
}

const BackdropRegistryContext = createContext<BackdropRegistryValue | null>(null)

export function WorkspaceBackdropProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, BackdropEntry>>({})

  const report = useCallback((tabId: string, entry: BackdropEntry) => {
    setEntries((prev) => {
      const existing = prev[tabId]
      if (existing && existing.url === entry.url && existing.isSalon === entry.isSalon) return prev
      return { ...prev, [tabId]: entry }
    })
  }, [])

  const clear = useCallback((tabId: string) => {
    setEntries((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  const value = useMemo<BackdropRegistryValue>(
    () => ({ entries, report, clear }),
    [entries, report, clear]
  )
  return (
    <BackdropRegistryContext.Provider value={value}>{children}</BackdropRegistryContext.Provider>
  )
}

function useBackdropRegistry(): BackdropRegistryValue | null {
  return useContext(BackdropRegistryContext)
}

/**
 * Report a view's story/subsystem background to the workspace backdrop. No-op
 * outside the workspace (legacy routes), so views can call it unconditionally.
 */
export function useReportWorkspaceBackdrop(url: string | null | undefined, isSalon: boolean): void {
  const tabId = useWorkspaceTabId()
  const reg = useBackdropRegistry()
  // Depend on the STABLE report/clear callbacks, never the registry object —
  // `reg` changes identity whenever `entries` updates, so reporting would
  // otherwise re-trigger this effect and loop (report → entries change → reg
  // change → cleanup+report → …).
  const report = reg?.report
  const clear = reg?.clear
  useEffect(() => {
    if (!tabId || !report || !clear) return
    if (url) report(tabId, { url, isSalon })
    else clear(tabId)
    return () => clear(tabId)
  }, [tabId, report, clear, url, isSalon])
}

export function WorkspaceBackdrop() {
  const { state } = useWorkspace()
  const reg = useBackdropRegistry()
  const entries = reg?.entries ?? {}

  const split = state.panes.right != null
  const leftActive = state.panes.left.activeTabId
  const rightActive = state.panes.right?.activeTabId ?? null
  const leftBg = leftActive ? entries[leftActive] : undefined
  const rightBg = rightActive ? entries[rightActive] : undefined

  // A conversation (Salon) with a background always wins, full-screen; prefer
  // the focused pane when both panes are Salons-with-backgrounds.
  const order = state.focusedPane === 'right' ? [rightBg, leftBg] : [leftBg, rightBg]
  const salonWin = order.find((b) => b?.isSalon && b.url)

  let fullUrl: string | null = null // unmasked, fills the screen
  let leftUrl: string | null = null // split: dominates the left, fades at the divider
  let rightUrl: string | null = null // split: dominates the right, fades at the divider

  if (salonWin) {
    fullUrl = salonWin.url
  } else if (!split) {
    fullUrl = leftBg?.url ?? null
  } else {
    leftUrl = leftBg?.url ?? null
    rightUrl = rightBg?.url ?? null
  }

  if (!fullUrl && !leftUrl && !rightUrl) return null

  const style = { '--qt-split': `${Math.round(state.splitRatio * 100)}%` } as CSSProperties

  return (
    <div className="qt-workspace-backdrop" aria-hidden="true" style={style}>
      {fullUrl && (
        <div
          className="qt-workspace-backdrop-layer"
          style={{ backgroundImage: `url('${fullUrl}')` }}
        />
      )}
      {rightUrl && (
        <div
          className="qt-workspace-backdrop-layer qt-workspace-backdrop-right"
          style={{ backgroundImage: `url('${rightUrl}')` }}
        />
      )}
      {leftUrl && (
        <div
          className="qt-workspace-backdrop-layer qt-workspace-backdrop-left"
          style={{ backgroundImage: `url('${leftUrl}')` }}
        />
      )}
    </div>
  )
}
