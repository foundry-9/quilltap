'use client'

/**
 * useWorkspaceShortcuts — keyboard shortcuts for the tabbed workspace.
 *
 * All shortcuts are namespaced under **Ctrl/Cmd + Alt** so they don't collide
 * with the browser's or Electron shell's own bindings (Cmd+W, Ctrl+Tab, …), and
 * are inert while the user is typing in a field (input/textarea/contenteditable)
 * so the Salon composer is never hijacked.
 *
 *  - Ctrl/Cmd+Alt+→ / ←   — next / previous tab in the focused pane (wraps)
 *  - Ctrl/Cmd+Alt+1 … 9   — jump to the nth tab in the focused pane
 *  - Ctrl/Cmd+Alt+W       — close the focused pane's active tab
 *  - Ctrl/Cmd+Alt+\       — toggle split (split off the active tab / rejoin)
 *
 * The listener attaches once and reads the latest store through a ref, so it
 * never re-binds on every state change.
 *
 * @module components/workspace/useWorkspaceShortcuts
 */

import { useEffect, useRef } from 'react'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { getPaneState, isSplit } from '@/lib/workspace/workspace-reducer'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useWorkspaceShortcuts(): void {
  const ws = useWorkspace()
  const wsRef = useRef(ws)
  useEffect(() => {
    wsRef.current = ws
  }, [ws])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Namespace: require Alt AND (Ctrl or Cmd). Bail otherwise so plain typing
      // and single-modifier chords are untouched.
      if (!e.altKey || !(e.ctrlKey || e.metaKey)) return
      if (isEditableTarget(e.target)) return

      const { state, setActive, closeTab, unsplit, splitTo } = wsRef.current
      const pane = state.focusedPane
      const ps = getPaneState(state, pane)
      if (!ps) return
      const { order, activeTabId } = ps
      const activeIndex = activeTabId ? order.indexOf(activeTabId) : -1

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowLeft': {
          if (order.length < 2) return
          e.preventDefault()
          const dir = e.key === 'ArrowRight' ? 1 : -1
          const base = activeIndex < 0 ? 0 : activeIndex
          const next = (base + dir + order.length) % order.length
          setActive(pane, order[next])
          return
        }
        case 'w':
        case 'W': {
          if (!activeTabId) return
          e.preventDefault()
          closeTab(activeTabId)
          return
        }
        case '\\': {
          e.preventDefault()
          if (isSplit(state)) {
            unsplit()
          } else if (activeTabId && order.length >= 2) {
            // Only split off a tab when one would remain behind in this pane.
            splitTo(activeTabId, 'right')
          }
          return
        }
        default: {
          if (e.key >= '1' && e.key <= '9') {
            const n = Number(e.key) - 1
            if (n < order.length) {
              e.preventDefault()
              setActive(pane, order[n])
            }
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
