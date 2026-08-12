'use client'

/**
 * Deferred row-measurement ref for the virtualized message list.
 *
 * TanStack Virtual measures a row inside the `ref` callback you hand it. When
 * the measured height differs from the estimate for a row sitting above the
 * scroll fold, it corrects `scrollTop` and asks React to re-render
 * *synchronously* — via `flushSync` — so the correction and the repaint land
 * together and the list doesn't visibly jump.
 *
 * Ref callbacks run in React's commit phase, where `flushSync` is illegal.
 * React logs
 *
 *   "flushSync was called from inside a lifecycle method. React cannot flush
 *    when React is already rendering. Consider moving this call to a scheduler
 *    task or micro task."
 *
 * and downgrades the flush to an ordinary asynchronous update. So the
 * synchronous behaviour the library was reaching for never actually happened
 * on this path — we paid a console error for nothing.
 *
 * The remedy is the one React's own message suggests. A microtask queued from
 * the commit phase runs once commit has unwound (so `flushSync` is legal
 * again) but still before the browser paints, so the scroll correction lands
 * in the same frame and the list stays put.
 *
 * Only the **ref** path is deferred. The virtualizer also measures from a
 * ResizeObserver — the path that keeps a streaming message anchored as it
 * grows — and that already fires outside React, where `flushSync` works. It
 * keeps its synchronous correction untouched.
 *
 * @module app/salon/[id]/hooks/useDeferredMeasureRef
 */

import { useMemo } from 'react'

/** The measuring half of a `Virtualizer` — all this needs to know about it. */
export type MeasureElement = (node: Element | null) => void

/**
 * Wrap a virtualizer's `measureElement` in a ref callback that measures on a
 * microtask instead of during commit.
 *
 * Exported separately from the hook so the behaviour can be exercised without
 * a React renderer.
 */
export function createDeferredMeasureRef(
  measureElement: MeasureElement,
): (node: HTMLElement | null) => void {
  return (node) => {
    // Detach is pure cache pruning inside the virtualizer — it never notifies
    // and so never reaches `flushSync`. Safe to run synchronously, and it must
    // be, or the cache outlives the DOM node.
    if (!node) {
      measureElement(null)
      return
    }

    queueMicrotask(() => {
      // The row can be unmounted between the ref firing and the microtask
      // running. Measuring a detached node would read a stale `data-index` and
      // resize the wrong row.
      if (node.isConnected) {
        measureElement(node)
      }
    })
  }
}

/**
 * React binding for {@link createDeferredMeasureRef}. Stable for the life of
 * the virtualizer instance, so handing it to a row's `ref` doesn't churn the
 * measurement cache on every render.
 */
export function useDeferredMeasureRef(virtualizer: {
  measureElement: MeasureElement
}): (node: HTMLElement | null) => void {
  const { measureElement } = virtualizer
  return useMemo(() => createDeferredMeasureRef(measureElement), [measureElement])
}
