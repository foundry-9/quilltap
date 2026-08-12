'use client'

/**
 * A pane's tab bar: clickable tabs (active highlight), close affordance, and
 * HTML5 drag to reorder within the strip or move a tab into this pane from the
 * other one. Split/join via the center drop-zones lives in the host.
 *
 * @module components/workspace/TabStrip
 */

import { useEffect, useRef } from 'react'
import { Icon, type IconName } from '@/components/ui/icon'
import type { PaneId, PaneState, WorkspaceTab } from '@/lib/workspace/types'

export interface TabStripProps {
  pane: PaneId
  paneState: PaneState
  tabs: Record<string, WorkspaceTab>
  draggingId: string | null
  onDragStartTab: (id: string) => void
  onDragEndTab: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** Move the dragged tab into THIS pane at `toIndex`. */
  onMove: (id: string, toIndex: number) => void
}

export function TabStrip({
  pane,
  paneState,
  tabs,
  draggingId,
  onDragStartTab,
  onDragEndTab,
  onSelect,
  onClose,
  onMove,
}: TabStripProps) {
  const dragging = draggingId != null

  // Overflow: keep the active tab visible when the strip scrolls horizontally
  // (many tabs in a narrow pane). `block: 'nearest'` avoids vertical page jumps.
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // jsdom has no scrollIntoView; guard so tests (and any non-DOM host) are safe.
    if (typeof activeTabRef.current?.scrollIntoView === 'function') {
      activeTabRef.current.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [paneState.activeTabId])

  return (
    <div
      className="qt-tab-strip"
      data-pane={pane}
      role="tablist"
      onDragOver={(e) => {
        if (dragging) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!draggingId) return
        e.preventDefault()
        onMove(draggingId, paneState.order.length)
        onDragEndTab()
      }}
    >
      {paneState.order.map((id, index) => {
        const tab = tabs[id]
        if (!tab) return null
        const isActive = id === paneState.activeTabId
        const isDragging = id === draggingId
        return (
          <div
            key={id}
            ref={isActive ? activeTabRef : undefined}
            role="tab"
            aria-selected={isActive}
            draggable
            className={
              'qt-tab' +
              (isActive ? ' qt-tab-active' : '') +
              (isDragging ? ' qt-tab-dragging' : '')
            }
            onClick={() => onSelect(id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', id)
              onDragStartTab(id)
            }}
            onDragEnd={onDragEndTab}
            onDragOver={(e) => {
              if (dragging) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onDrop={(e) => {
              if (!draggingId) return
              e.preventDefault()
              e.stopPropagation()
              onMove(draggingId, index)
              onDragEndTab()
            }}
          >
            {tab.icon && <Icon name={tab.icon as IconName} className="qt-tab-icon" />}
            <span className="qt-tab-label">{tab.title}</span>
            <button
              type="button"
              className="qt-tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Icon name="close" className="qt-tab-close-icon" title={`Close ${tab.title}`} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
