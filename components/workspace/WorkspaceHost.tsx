'use client'

/**
 * WorkspaceHost — the two-pane tab host.
 *
 * Renders **every open tab's view at once** as a flat list of siblings in one
 * CSS grid; each view is positioned into its pane via `grid-column` and hidden
 * (not unmounted) when it is not its pane's active tab. Because no view ever
 * changes its React parent — moving a tab between panes only changes a CSS
 * column — the keep-alive constraint holds and a streaming Salon survives every
 * tab switch and the split. See `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/workspace/WorkspaceHost
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { isActiveInItsPane, paneOfTab } from '@/lib/workspace/workspace-reducer'
import { DEFAULT_SPLIT_RATIO, type PaneId } from '@/lib/workspace/types'
import { TabStrip } from './TabStrip'
import { TabView } from './TabView'
import { WorkspaceDivider } from './WorkspaceDivider'
import { WorkspaceBackdrop } from './workspace-backdrop'
import { useWorkspaceShortcuts } from './useWorkspaceShortcuts'

/** Divider column thickness (px). */
const DIVIDER_PX = 8

export function WorkspaceHost() {
  const { state, setActive, closeTab, moveTab, splitTo, setFocusedPane, setSplitRatio } =
    useWorkspace()
  useWorkspaceShortcuts()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const split = state.panes.right != null
  const ratio = state.splitRatio

  const gridTemplateColumns = useMemo(() => {
    if (!split) return '1fr'
    return `minmax(0, ${ratio}fr) ${DIVIDER_PX}px minmax(0, ${1 - ratio}fr)`
  }, [split, ratio])

  const onDragStartTab = useCallback((id: string) => setDraggingId(id), [])
  const onDragEndTab = useCallback(() => setDraggingId(null), [])

  const moveIntoLeft = useCallback((id: string, idx: number) => moveTab(id, 'left', idx), [moveTab])
  const moveIntoRight = useCallback((id: string, idx: number) => moveTab(id, 'right', idx), [moveTab])

  const onResetRatio = useCallback(() => setSplitRatio(DEFAULT_SPLIT_RATIO), [setSplitRatio])

  const allTabs = Object.values(state.tabs)

  return (
    <div
      ref={gridRef}
      className="qt-workspace"
      style={{ gridTemplateColumns, gridTemplateRows: 'auto minmax(0, 1fr)' }}
    >
      {/* ---- Single arbitrated background behind both panes ---- */}
      <WorkspaceBackdrop />

      {/* ---- Left pane chrome (strip + contextual toolbar) ---- */}
      <div className="qt-workspace-pane-chrome" style={{ gridColumn: 1, gridRow: 1 }}>
        <TabStrip
          pane="left"
          paneState={state.panes.left}
          tabs={state.tabs}
          draggingId={draggingId}
          onDragStartTab={onDragStartTab}
          onDragEndTab={onDragEndTab}
          onSelect={(id) => setActive('left', id)}
          onClose={closeTab}
          onMove={moveIntoLeft}
        />
      </div>

      {/* ---- Divider + right pane chrome (only when split) ---- */}
      {split && state.panes.right && (
        <>
          <div style={{ gridColumn: 2, gridRow: '1 / 3' }} className="qt-workspace-divider-cell">
            <WorkspaceDivider
              containerRef={gridRef}
              ratio={ratio}
              onRatioChange={setSplitRatio}
              onReset={onResetRatio}
            />
          </div>
          <div className="qt-workspace-pane-chrome" style={{ gridColumn: 3, gridRow: 1 }}>
            <TabStrip
              pane="right"
              paneState={state.panes.right}
              tabs={state.tabs}
              draggingId={draggingId}
              onDragStartTab={onDragStartTab}
              onDragEndTab={onDragEndTab}
              onSelect={(id) => setActive('right', id)}
              onClose={closeTab}
              onMove={moveIntoRight}
            />
          </div>
        </>
      )}

      {/* ---- Flat, always-mounted content list ---- */}
      {allTabs.map((tab) => {
        const pane: PaneId = paneOfTab(state, tab.id) ?? 'left'
        const visible = isActiveInItsPane(state, tab.id)
        // Mount (but don't show) a Salon view whenever one of its child
        // (terminal/document) tabs is visible, so it can portal that pane into
        // the child even while the Salon tab itself is hidden.
        const childActive =
          tab.kind === 'salon' &&
          allTabs.some((t) => t.parentTabId === tab.id && isActiveInItsPane(state, t.id))
        const mounted = visible || childActive
        const column = pane === 'left' ? 1 : 3
        return (
          <div
            key={tab.id}
            className={'qt-tab-pane' + (visible ? '' : ' hidden')}
            aria-hidden={!visible}
            style={{ gridColumn: column, gridRow: 2, display: visible ? undefined : 'none' }}
            onMouseDownCapture={() => {
              if (state.focusedPane !== pane) setFocusedPane(pane)
            }}
          >
            <TabView tab={tab} active={mounted} />
          </div>
        )
      })}

      {/* ---- Empty-pane affordance (defensive: the reducer keeps a home tab, but
              guard any transient state where a pane has no resolvable view) ---- */}
      {(['left', 'right'] as PaneId[]).map((p) => {
        const ps = p === 'left' ? state.panes.left : state.panes.right
        if (!ps) return null
        const hasView = ps.activeTabId != null && state.tabs[ps.activeTabId] != null
        if (hasView) return null
        return (
          <div
            key={`empty-${p}`}
            className="qt-workspace-empty"
            style={{ gridColumn: p === 'left' ? 1 : 3, gridRow: 2 }}
          >
            <p className="qt-workspace-empty-hint">
              This half of the desk is clear. Drag a tab across, or summon one from the rail.
            </p>
          </div>
        )
      })}

      {/* ---- Split drop-zone: drag a tab here (unsplit) to open the right pane ---- */}
      {!split && draggingId && (
        <div
          className="qt-tab-drop-zone"
          style={{ gridColumn: 1, gridRow: 2 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (draggingId) splitTo(draggingId, 'right')
            setDraggingId(null)
          }}
        >
          <span className="qt-tab-drop-zone-hint">Release here to split the workspace</span>
        </div>
      )}

    </div>
  )
}
