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
 * Polling is a heartbeat, not an invitation:
 * - Idle: a slow tick, so server-initiated work (autonomous rooms, scheduled
 *   housekeeping, a wardrobe change enqueuing an avatar) shows up without any
 *   client having to remember to announce it.
 * - Active: a fast tick, so counts track the work as it drains.
 * - `notifyQueueChange()` remains as an instant kick after a known-enqueuing
 *   action, but nothing depends on it any more.
 *
 * Work that starts and finishes between two polls would otherwise be invisible,
 * so the API also returns a monotonic `startedByKind` counter; a chip that has
 * advanced since the previous poll pulses even if its live count is back to
 * zero.
 *
 * @module components/layout/queue-status-badges
 */

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  ACTIVITY_CHIPS,
  ACTIVITY_KINDS,
  emptyActivityCounts,
  type ActivityKind,
} from '@/lib/background-jobs/activity-kinds'

/** Custom event name for queue change notifications */
const QUEUE_CHANGE_EVENT = 'quilltap:queue-change'

/**
 * Nudge the toolbar chips to re-poll immediately.
 *
 * Optional — the chips poll on their own heartbeat and will notice the work
 * regardless. Call this after an action you know enqueues something, purely so
 * the chip lights within a tick instead of within a heartbeat.
 */
export function notifyQueueChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT))
  }
}

/** Poll cadence while something is in flight. */
const ACTIVE_POLL_INTERVAL = 1_500
/** Poll cadence while everything is idle. */
const IDLE_POLL_INTERVAL = 8_000
/** How long a chip keeps pulsing after between-poll work is detected. */
const PULSE_DURATION = 1_200

type Counts = Record<ActivityKind, number>

interface ActivitySnapshot {
  active: Counts
  started: Counts
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
 * Poll the activity snapshot, fast while busy and slow while idle, and report
 * both live counts and the kinds that blipped between polls.
 */
function useActivitySnapshot(): { counts: Counts; pulsing: Set<ActivityKind> } {
  const [counts, setCounts] = useState<Counts>(() => emptyActivityCounts())
  const [pulsing, setPulsing] = useState<Set<ActivityKind>>(() => new Set())
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let previousStarted: Counts | null = null
    const pulseTimers = new Map<ActivityKind, ReturnType<typeof setTimeout>>()

    const pulse = (kind: ActivityKind) => {
      setPulsing((prev) => {
        if (prev.has(kind)) return prev
        const next = new Set(prev)
        next.add(kind)
        return next
      })
      const existing = pulseTimers.get(kind)
      if (existing) clearTimeout(existing)
      pulseTimers.set(
        kind,
        setTimeout(() => {
          pulseTimers.delete(kind)
          if (cancelled) return
          setPulsing((prev) => {
            if (!prev.has(kind)) return prev
            const next = new Set(prev)
            next.delete(kind)
            return next
          })
        }, PULSE_DURATION)
      )
    }

    const fetchSnapshot = async (): Promise<ActivitySnapshot | null> => {
      try {
        const res = await fetch('/api/v1/system/jobs', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        })
        if (!res.ok) return null

        const data = await res.json()
        return {
          active: coerceCounts(data.activeByKind),
          started: coerceCounts(data.startedByKind),
        }
      } catch {
        return null
      }
    }

    const tick = async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      const snapshot = await fetchSnapshot()
      if (cancelled) return

      if (!snapshot) {
        // Server unreachable or erroring — back off to the idle cadence
        // rather than hammering it.
        timer = setTimeout(() => void tick(), IDLE_POLL_INTERVAL)
        return
      }

      setCounts(snapshot.active)

      // A kind whose monotonic completed-span counter advanced did work since
      // the last poll — pulse it even though the work has already finished.
      // The counter resets when the server restarts, so a decrease is a fresh
      // baseline rather than a blip.
      if (previousStarted) {
        for (const kind of ACTIVITY_KINDS) {
          if (snapshot.started[kind] > previousStarted[kind]) pulse(kind)
        }
      }
      previousStarted = snapshot.started

      timer = setTimeout(
        () => void tick(),
        hasActivity(snapshot.active) ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL
      )
    }

    void tick()

    const handleQueueChange = () => {
      void tick()
    }
    window.addEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      for (const pending of pulseTimers.values()) clearTimeout(pending)
      pulseTimers.clear()
      window.removeEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)
    }
    // Restarting on navigation is deliberate: it re-reads immediately on the
    // new page rather than waiting out the current interval.
  }, [pathname])

  return { counts, pulsing }
}

/**
 * Queue Status Badges component
 *
 * Renders the chip group. Chips dim when idle and pulse when work passed
 * through between two polls.
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
