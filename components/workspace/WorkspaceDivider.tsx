'use client'

/**
 * Draggable divider between the two workspace panes. Pointer-drag adjusts the
 * left pane's fraction of total width; arrow keys nudge it; double-click /
 * Enter / Home resets to an even split. Clamping to sensible bounds happens in
 * the reducer (`SET_SPLIT_RATIO`). Mirrors the Chat Sidebar resize handler.
 *
 * @module components/workspace/WorkspaceDivider
 */

import { useCallback, useEffect, useRef } from 'react'

/** Keyboard nudge step (fraction of width). */
const KEY_STEP = 0.02

export interface WorkspaceDividerProps {
  containerRef: React.RefObject<HTMLElement | null>
  ratio: number
  onRatioChange: (ratio: number) => void
  onReset: () => void
}

export function WorkspaceDivider({ containerRef, ratio, onRatioChange, onReset }: WorkspaceDividerProps) {
  const onRatioChangeRef = useRef(onRatioChange)
  useEffect(() => {
    onRatioChangeRef.current = onRatioChange
  }, [onRatioChange])

  const handleMove = useCallback(
    (clientX: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      onRatioChangeRef.current((clientX - rect.left) / rect.width)
    },
    [containerRef]
  )

  const stopRef = useRef<() => void>(() => {})

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const onPointerMove = (ev: PointerEvent) => handleMove(ev.clientX)
      const stop = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', stop)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      stopRef.current = stop
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', stop)
    },
    [handleMove]
  )

  // Clean up any in-flight drag on unmount.
  useEffect(() => () => stopRef.current(), [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onRatioChange(ratio - KEY_STEP)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onRatioChange(ratio + KEY_STEP)
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault()
        onReset()
      }
    },
    [ratio, onRatioChange, onReset]
  )

  return (
    <div
      className="qt-workspace-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <div className="qt-workspace-divider-grip" />
    </div>
  )
}
