/**
 * @jest-environment jsdom
 *
 * The virtualized message list hands TanStack Virtual a `ref` to measure each
 * row. Measuring inline makes the virtualizer call `flushSync` from inside
 * React's commit phase, which React refuses ("flushSync was called from inside
 * a lifecycle method") and silently downgrades — so the synchronous scroll
 * correction never happened anyway, and we paid a console error for it.
 *
 * These pin the deferral: measure on a microtask (after commit unwinds, still
 * before paint), skip rows that vanished in the meantime, and let detach
 * through synchronously so the virtualizer's element cache doesn't outlive the
 * DOM.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import { createDeferredMeasureRef } from '@/app/salon/[id]/hooks/useDeferredMeasureRef'

/** Let queued microtasks drain. */
const flushMicrotasks = () => Promise.resolve()

let measureElement: jest.Mock
let ref: (node: HTMLElement | null) => void

beforeEach(() => {
  measureElement = jest.fn()
  ref = createDeferredMeasureRef(measureElement as never)
})

describe('createDeferredMeasureRef', () => {
  it('does not measure synchronously when the ref fires', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)

    ref(node)

    // This is the whole point: nothing runs while React is still committing.
    expect(measureElement).not.toHaveBeenCalled()
  })

  it('measures the node once the microtask runs', async () => {
    const node = document.createElement('div')
    node.setAttribute('data-index', '7')
    document.body.appendChild(node)

    ref(node)
    await flushMicrotasks()

    expect(measureElement).toHaveBeenCalledTimes(1)
    expect(measureElement).toHaveBeenCalledWith(node)
  })

  it('skips a row unmounted between the ref firing and the microtask', async () => {
    const node = document.createElement('div')
    document.body.appendChild(node)

    ref(node)
    node.remove() // row scrolled out of the window before the microtask ran
    await flushMicrotasks()

    expect(measureElement).not.toHaveBeenCalled()
  })

  it('passes detach through synchronously', () => {
    // Detach is pure cache pruning inside the virtualizer — it never notifies,
    // so it never reaches flushSync, and deferring it would let the element
    // cache outlive the DOM node.
    ref(null)

    expect(measureElement).toHaveBeenCalledTimes(1)
    expect(measureElement).toHaveBeenCalledWith(null)
  })

  it('measures every row of a batch, in order', async () => {
    const nodes = [0, 1, 2].map((i) => {
      const node = document.createElement('div')
      node.setAttribute('data-index', String(i))
      document.body.appendChild(node)
      return node
    })

    for (const node of nodes) ref(node)
    await flushMicrotasks()

    expect(measureElement.mock.calls.map((c) => c[0])).toEqual(nodes)
  })
})
