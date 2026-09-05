'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * A tooltip that Quilltap draws itself, rather than deferring to the native
 * `title` attribute.
 *
 * Native tooltips are an OS/Chromium widget: they demand a second of perfectly
 * still hovering, evaporate at the smallest twitch of the pointer, refuse to
 * return until you leave and re-enter, truncate long text, and cannot be read
 * at leisure. Under the Electron shell that unreliability is glaring. This
 * bubble is ours — themed, positioned, flipped away from viewport edges, and
 * optionally pinnable so a substantial note can be read (and selected) in peace.
 *
 * The trigger is wrapped in a layout-neutral anchor span that carries the hover
 * and focus listeners; the wrapped control keeps its own `aria-label` (an
 * icon-only button still needs one — a tooltip is not an accessible name), and
 * should carry no `title`, or the native tooltip will double up on ours.
 */

export type TooltipPlacement = 'top' | 'bottom'

/** px kept clear of every viewport edge */
const VIEWPORT_MARGIN = 8
/** px between the trigger and the bubble */
const ANCHOR_GAP = 6
/** grace period letting the pointer cross the gap into an interactive bubble */
const CLOSE_GRACE_MS = 120

interface TooltipCoords {
  top: number
  left: number
  placement: TooltipPlacement
}

export interface TooltipProps {
  /** Bubble contents — a string for a plain tip, or nodes for a structured one */
  content: ReactNode
  /** The control the tooltip describes */
  children: ReactNode
  /** Preferred side; flipped automatically when the viewport is tight */
  placement?: TooltipPlacement
  /** ms of hover before the bubble appears */
  delay?: number
  /** Clicking the trigger pins the bubble open until dismissed */
  pinnable?: boolean
  /** Let the pointer enter the bubble (needed to scroll or select its text) */
  interactive?: boolean
  /** Extra classes for the bubble */
  className?: string
  /** Extra classes for the anchor span */
  anchorClassName?: string
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 200,
  pinnable = false,
  interactive = false,
  className = '',
  anchorClassName = '',
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinnedRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [coords, setCoords] = useState<TooltipCoords | null>(null)

  // Mirrored for the timers and listeners, which read it outside of render.
  useEffect(() => { pinnedRef.current = pinned }, [pinned])

  const clearTimers = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])

  const openNow = useCallback(() => {
    clearTimers()
    setOpen(true)
  }, [clearTimers])

  const openAfterDelay = useCallback(() => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), delay)
  }, [clearTimers, delay])

  const closeNow = useCallback(() => {
    clearTimers()
    setPinned(false)
    setOpen(false)
    setCoords(null)
  }, [clearTimers])

  /** Close unless the pointer arrives in the bubble first, or it is pinned. */
  const closeSoon = useCallback(() => {
    clearTimers()
    closeTimer.current = setTimeout(() => {
      if (pinnedRef.current) return
      setOpen(false)
      setCoords(null)
    }, CLOSE_GRACE_MS)
  }, [clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  /** Measure the anchor and the (already rendered) bubble, then place it. */
  const position = useCallback(() => {
    const anchor = anchorRef.current
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return

    const a = anchor.getBoundingClientRect()
    const b = bubble.getBoundingClientRect()

    let side = placement
    if (side === 'top' && a.top - b.height - ANCHOR_GAP < VIEWPORT_MARGIN) {
      side = 'bottom'
    } else if (side === 'bottom' && a.bottom + b.height + ANCHOR_GAP > window.innerHeight - VIEWPORT_MARGIN) {
      side = 'top'
    }

    const top = side === 'top' ? a.top - b.height - ANCHOR_GAP : a.bottom + ANCHOR_GAP
    const centred = a.left + a.width / 2 - b.width / 2
    const rightmost = Math.max(VIEWPORT_MARGIN, window.innerWidth - b.width - VIEWPORT_MARGIN)
    const left = Math.min(Math.max(centred, VIEWPORT_MARGIN), rightmost)

    setCoords(prev =>
      prev && prev.top === top && prev.left === left && prev.placement === side
        ? prev
        : { top, left, placement: side }
    )
  }, [placement])

  // Place it before the browser paints, so it never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (open) position()
  }, [open, position, content])

  // Follow the anchor while the page moves under it; dismiss on Escape or on a
  // click elsewhere (only a pinned bubble survives long enough to need that).
  useEffect(() => {
    if (!open) return

    let frame = 0
    const reposition = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; position() })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNow()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!pinnedRef.current) return
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || bubbleRef.current?.contains(target)) return
      closeNow()
    }

    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, position, closeNow])

  const bubbleInteractive = interactive || pinned

  return (
    <>
      <span
        ref={anchorRef}
        className={`qt-tooltip-anchor ${anchorClassName}`.trim()}
        onPointerEnter={openAfterDelay}
        onPointerLeave={() => { if (!pinned) closeSoon() }}
        onFocus={openNow}
        onBlur={() => { if (!pinned) closeNow() }}
        onClick={pinnable
          ? () => {
              clearTimers()
              setPinned(prev => {
                const next = !prev
                setOpen(next)
                if (!next) setCoords(null)
                return next
              })
            }
          : undefined}
      >
        {children}
      </span>
      {open && content != null && typeof document !== 'undefined' && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          // The trigger carries the same words as its accessible name, so the
          // bubble itself is decoration as far as assistive tech is concerned.
          aria-hidden="true"
          className={`qt-tooltip ${className}`.trim()}
          data-interactive={bubbleInteractive ? 'true' : undefined}
          data-pinned={pinned ? 'true' : undefined}
          data-placement={coords?.placement ?? placement}
          style={{
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            // Rendered but unseen for the measuring pass that follows.
            visibility: coords ? 'visible' : 'hidden',
          }}
          onPointerEnter={() => { if (bubbleInteractive) clearTimers() }}
          onPointerLeave={() => { if (bubbleInteractive && !pinned) closeSoon() }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  )
}

export default Tooltip
