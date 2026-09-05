'use client'

/**
 * useNow — the shared clock
 *
 * Relative timestamps ("4m ago", "Yesterday") go stale for a reason that has
 * nothing to do with the server: the *client's* clock advanced. Before this
 * hook, nothing in the interface ticked — a "3m ago" only ever changed when
 * some unrelated state happened to re-render the component around it, so a
 * chat card could sit at "Just now" for an hour.
 *
 * Design notes:
 *   - **One timer per granularity, not one per component.** Every component
 *     asking for 60 000 ms shares a single `setTimeout` chain and a single
 *     subscriber set. Fifty chat cards cost one timer.
 *   - **Boundary-aligned ticks.** The timer fires just *after* each minute (or
 *     second, or local midnight) boundary rather than 60 s after whenever the
 *     first subscriber mounted, so every "4m ago" on screen flips to "5m ago"
 *     together instead of drifting apart.
 *   - **Inert on the server.** Backed by `useSyncExternalStore`, whose
 *     `subscribe` never runs during SSR; the server snapshot is a plain
 *     `Date.now()`, exactly what the formatters read before this hook existed.
 *   - **Hidden tabs don't get fine-grained ticks.** Anything finer than a
 *     minute pauses while `document.hidden`, and resyncs on the way back so
 *     the first visible frame is already correct.
 *
 * @module hooks/useNow
 */

import { useMemo, useSyncExternalStore } from 'react'

/**
 * Granularity for anything that only changes at a day boundary — chat-list
 * dates rolling "today" → "Yesterday" → weekday. Ticks at *local* midnight,
 * not every 24 h from mount.
 */
export const DAY_GRANULARITY_MS = 86_400_000

/** Below this, ticking is suspended while the tab is hidden. */
const HIDDEN_TAB_PAUSE_BELOW_MS = 60_000

interface Ticker {
  subscribers: Set<() => void>
  timer: ReturnType<typeof setTimeout> | null
  now: number
}

const tickers = new Map<number, Ticker>()
let visibilityWired = false

/**
 * Delay until just after the next boundary of `granularityMs`. Day granularity
 * aligns to local midnight; everything else to a multiple of the granularity
 * since the epoch. The extra millisecond keeps us on the far side of the
 * boundary, so `Math.floor((now - then) / 60000)` has actually advanced.
 */
function nextBoundaryDelay(granularityMs: number, from: number): number {
  if (granularityMs === DAY_GRANULARITY_MS) {
    const midnight = new Date(from)
    midnight.setHours(24, 0, 0, 0)
    return Math.max(1, midnight.getTime() - from)
  }
  return granularityMs - (from % granularityMs) + 1
}

function isPaused(granularityMs: number): boolean {
  return (
    granularityMs < HIDDEN_TAB_PAUSE_BELOW_MS &&
    typeof document !== 'undefined' &&
    document.hidden
  )
}

/**
 * Arm the next tick, if one isn't already armed. Idempotent by design: fifty
 * chat cards mounting at once must not each tear down and re-create the shared
 * timer.
 */
function schedule(granularityMs: number, ticker: Ticker): void {
  if (ticker.timer) return
  if (ticker.subscribers.size === 0) return
  if (isPaused(granularityMs)) return

  const now = Date.now()
  ticker.timer = setTimeout(() => {
    ticker.timer = null
    ticker.now = Date.now()
    for (const notify of ticker.subscribers) notify()
    schedule(granularityMs, ticker)
  }, nextBoundaryDelay(granularityMs, now))
}

/** Drop any armed tick and arm a fresh one from the current instant. */
function reschedule(granularityMs: number, ticker: Ticker): void {
  if (ticker.timer) {
    clearTimeout(ticker.timer)
    ticker.timer = null
  }
  schedule(granularityMs, ticker)
}

/**
 * Bring every ticker back in step after the tab was hidden. Fine-grained
 * tickers were parked; coarse ones kept running but may have been throttled by
 * the browser, so both get a fresh reading and a re-armed timer.
 */
function resyncAll(): void {
  const now = Date.now()
  for (const [granularityMs, ticker] of tickers) {
    if (ticker.subscribers.size === 0) continue
    if (ticker.now !== now) {
      ticker.now = now
      for (const notify of ticker.subscribers) notify()
    }
    reschedule(granularityMs, ticker)
  }
}

function wireVisibility(): void {
  if (visibilityWired || typeof document === 'undefined') return
  visibilityWired = true
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resyncAll()
    else {
      // Park the fine-grained tickers; coarse ones are cheap enough to leave.
      for (const [granularityMs, ticker] of tickers) {
        if (granularityMs < HIDDEN_TAB_PAUSE_BELOW_MS && ticker.timer) {
          clearTimeout(ticker.timer)
          ticker.timer = null
        }
      }
    }
  })
}

function getTicker(granularityMs: number): Ticker {
  let ticker = tickers.get(granularityMs)
  if (!ticker) {
    ticker = { subscribers: new Set(), timer: null, now: Date.now() }
    tickers.set(granularityMs, ticker)
  }
  return ticker
}

/**
 * Subscribe to a shared, boundary-aligned clock.
 *
 * @param granularityMs How often the value may change — `60_000` for "m ago"
 *   readouts, `1_000` for second-resolution ones, {@link DAY_GRANULARITY_MS}
 *   for calendar-day rollovers.
 * @param enabled Pass `false` to freeze the value and stop subscribing at all.
 *   Hooks can't be called conditionally, so this is how a component that only
 *   *sometimes* needs a fast tick (a badge with a time budget, say) avoids
 *   re-rendering every second the rest of the time.
 * @returns The current epoch milliseconds, changing only on a tick.
 *
 * @example
 * const now = useNow(60_000)
 * return <span>{formatRelativeDate(task.createdAt, now)}</span>
 */
export function useNow(granularityMs = 60_000, enabled = true): number {
  const store = useMemo(() => {
    if (!enabled) {
      // Read the shared ticker without subscribing: a pure snapshot that simply
      // stops advancing on our account. Never `Date.now()` here — `getSnapshot`
      // must return the same value until it notifies, or React re-renders on
      // every read.
      return {
        subscribe: () => () => {},
        getSnapshot: () => getTicker(granularityMs).now,
      }
    }
    return {
      subscribe: (onStoreChange: () => void) => {
        wireVisibility()
        const ticker = getTicker(granularityMs)
        const firstSubscriber = ticker.subscribers.size === 0
        ticker.subscribers.add(onStoreChange)
        // A ticker nobody was watching holds a stale reading; refresh it before
        // arming, so the first subscriber back isn't a minute behind. While
        // others are already subscribed the shared reading is current and must
        // not be disturbed — they would render a different instant than they
        // last committed.
        if (firstSubscriber) ticker.now = Date.now()
        schedule(granularityMs, ticker)
        return () => {
          ticker.subscribers.delete(onStoreChange)
          if (ticker.subscribers.size === 0 && ticker.timer) {
            clearTimeout(ticker.timer)
            ticker.timer = null
          }
        }
      },
      getSnapshot: () => getTicker(granularityMs).now,
    }
  }, [granularityMs, enabled])

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => Date.now())
}

/** Test seam: drop every ticker and its timer. */
export function __resetNowTickersForTests(): void {
  for (const ticker of tickers.values()) {
    if (ticker.timer) clearTimeout(ticker.timer)
  }
  tickers.clear()
}
