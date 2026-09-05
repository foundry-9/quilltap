'use client'

/**
 * Queue Status Badges
 *
 * The compact chip group in the page toolbar — "Mem", "Emb", "Sum", "Dgr",
 * "Img" — reporting how much work of each kind is in flight right now.
 *
 * What a chip counts is defined once, server-side and client-side alike, in
 * `lib/background-jobs/activity-kinds`: active `background_jobs` rows mapped to
 * their kind, plus non-job work registered with the activity registry (the
 * inline image tool, the Concierge classifier, live embedding calls). A chip is
 * lit for the entire span of the work it names, from the first token of prompt
 * crafting through to the result landing.
 *
 * How the counts arrive:
 * - **Push, normally.** The server publishes a `jobs` hint from every queue
 *   chokepoint — enqueue, claim, complete, fail, cancel, and both edges of an
 *   activity span — and the realtime provider invalidates this query. The bus
 *   coalesces, so a thousand-job reindex is a stream of hints the chips can
 *   actually keep up with.
 * - **Polling, as the fallback.** While the socket is down the original
 *   adaptive heartbeat comes back: a fast tick while something is in flight, a
 *   slow one while everything is idle. A dropped connection costs latency, not
 *   correctness.
 * - `notifyQueueChange()` remains as an instant same-tab kick after a
 *   known-enqueuing action, but nothing depends on it any more.
 *
 * Work that starts and finishes between two reads would otherwise be invisible,
 * so the API also returns a monotonic `startedByKind` counter; a chip that has
 * advanced since the previous read pulses even if its live count is back to
 * zero. That stays exactly as it was — it is the missed-event insurance this
 * design wants, push or no push.
 *
 * @module components/layout/queue-status-badges
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeConnected } from '@/hooks/useRealtime'
import {
  ACTIVITY_CHIPS,
  ACTIVITY_KINDS,
  emptyActivityCounts,
  type ActivityKind,
} from '@/lib/background-jobs/activity-kinds'

/** Custom event name for queue change notifications */
const QUEUE_CHANGE_EVENT = 'quilltap:queue-change'

/**
 * Nudge the toolbar chips to re-read immediately.
 *
 * Optional — the chips are pushed to by the server and fall back to their own
 * heartbeat, and will notice the work regardless. Call this after an action you
 * know enqueues something, purely so the chip lights within this tab's next
 * frame instead of within a round trip.
 */
export function notifyQueueChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT))
  }
}

/** Fallback poll cadence while something is in flight. */
const ACTIVE_POLL_INTERVAL = 1_500
/** Fallback poll cadence while everything is idle. */
const IDLE_POLL_INTERVAL = 8_000
/** How long a chip keeps pulsing after between-read work is detected. */
const PULSE_DURATION = 1_200

type Counts = Record<ActivityKind, number>

interface ActivityResponse {
  activeByKind?: unknown
  startedByKind?: unknown
}

function coerceCounts(raw: unknown): Counts {
  const out = emptyActivityCounts()
  if (!raw || typeof raw !== 'object') return out
  for (const kind of ACTIVITY_KINDS) {
    const value = (raw as Record<string, unknown>)[kind]
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[kind] = value
    }
  }
  return out
}

function hasActivity(counts: Counts): boolean {
  return ACTIVITY_KINDS.some((kind) => counts[kind] > 0)
}

/**
 * Read the activity snapshot — pushed while the socket is up, polled on the
 * old adaptive cadence while it is down — and report both live counts and the
 * kinds that blipped between reads.
 */
function useActivitySnapshot(): { counts: Counts; pulsing: Set<ActivityKind> } {
  const queryClient = useQueryClient()
  const [pulsing, setPulsing] = useState<Set<ActivityKind>>(() => new Set())
  const previousStartedRef = useRef<Counts | null>(null)
  const pulseTimersRef = useRef(new Map<ActivityKind, ReturnType<typeof setTimeout>>())

  const connected = useRealtimeConnected()

  const { data } = useQuery({
    queryKey: queryKeys.system.jobs,
    queryFn: ({ signal }) =>
      apiFetch<ActivityResponse>('/api/v1/system/jobs', { signal, cache: 'no-store' }),
    // Counts are a live readout; a cached one is worse than none.
    staleTime: 0,
    // The old adaptive heartbeat, kept whole but gated. Reading the cadence off
    // the query's own last response is what lets it stay adaptive without a
    // second timer racing the first.
    refetchInterval: connected
      ? false
      : (query) =>
          hasActivity(coerceCounts(query.state.data?.activeByKind))
            ? ACTIVE_POLL_INTERVAL
            : IDLE_POLL_INTERVAL,
    // Keep the last good snapshot on a transient error rather than blanking
    // every chip, matching the old fetch-returns-null behaviour.
    retry: false,
  })

  const counts = coerceCounts(data?.activeByKind)
  const started = coerceCounts(data?.startedByKind)

  // A kind whose monotonic completed-span counter advanced did work since the
  // last read — pulse it even though the work has already finished. The counter
  // resets when the server restarts, so a decrease is a fresh baseline rather
  // than a blip.
  useEffect(() => {
    if (!data) return
    const previous = previousStartedRef.current
    previousStartedRef.current = started
    if (!previous) return

    const blipped = ACTIVITY_KINDS.filter((kind) => started[kind] > previous[kind])
    if (blipped.length === 0) return

    setPulsing((prev) => {
      const next = new Set(prev)
      for (const kind of blipped) next.add(kind)
      return next
    })

    const timers = pulseTimersRef.current
    for (const kind of blipped) {
      const existing = timers.get(kind)
      if (existing) clearTimeout(existing)
      timers.set(
        kind,
        setTimeout(() => {
          timers.delete(kind)
          setPulsing((prev) => {
            if (!prev.has(kind)) return prev
            const next = new Set(prev)
            next.delete(kind)
            return next
          })
        }, PULSE_DURATION)
      )
    }
    // `started` is derived fresh each render; `data` identity is the real signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Clear any pulse timers still running when the toolbar unmounts.
  useEffect(() => {
    const timers = pulseTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // Same-tab zero-latency kick, unchanged in spirit: an action that just
  // enqueued something invalidates instead of driving a bespoke re-poll.
  useEffect(() => {
    const handleQueueChange = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.jobs })
    }
    window.addEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)
    return () => window.removeEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)
  }, [queryClient])

  return { counts, pulsing }
}

/**
 * Queue Status Badges component
 *
 * Renders the chip group. Chips dim when idle and pulse when work passed
 * through between two reads.
 */
export function QueueStatusBadges() {
  const { counts, pulsing } = useActivitySnapshot()

  return (
    <div className="qt-queue-badge-group" title="Background activity">
      {ACTIVITY_CHIPS.map((chip) => {
        const count = counts[chip.kind]
        const isIdle = count === 0
        const isPulsing = pulsing.has(chip.kind)

        return (
          <span
            key={chip.kind}
            className={[
              chip.badgeClass,
              isIdle ? 'qt-queue-badge-idle' : '',
              isPulsing ? 'qt-queue-badge-pulse' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`${chip.title}: ${count} active`}
          >
            <span>{chip.label}</span>
            <span>{count}</span>
          </span>
        )
      })}
    </div>
  )
}
