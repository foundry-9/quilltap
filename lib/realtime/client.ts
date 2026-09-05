'use client'

/**
 * Realtime client hub
 *
 * One WebSocket per tab, shared by every consumer, holding the connection to
 * `/api/v1/system/realtime/stream`. What arrives are invalidation hints, never
 * data — see `lib/schemas/realtime.types.ts`.
 *
 * Everything here is module-level rather than React state on purpose: the
 * socket must outlive any single component, survive route changes, and be the
 * only one in the tab regardless of how many hooks read it.
 *
 * Behaviour worth knowing:
 *   - **Reconnect is expected, not exceptional.** Backoff runs 1 s → 30 s with
 *     jitter, and every successful open fires the `onOpen` callbacks so the
 *     provider can sweep-invalidate. A dropped connection therefore costs
 *     latency, never correctness.
 *   - **Hidden tabs don't thrash.** While `document.hidden`, a failed connect
 *     stops retrying; becoming visible reconnects immediately rather than
 *     waiting out the backoff.
 *   - **Polling is the fallback, not a relic.** {@link getRealtimeStatus} is
 *     what lets each migrated query keep its original interval and use it only
 *     while the socket is down.
 *
 * @module lib/realtime/client
 */

import {
  REALTIME_STREAM_PATH,
  RealtimeEventSchema,
  type RealtimeEvent,
} from '@/lib/schemas/realtime.types'

export type RealtimeStatus = 'idle' | 'connecting' | 'connected'

export interface RealtimeSubscriber {
  /** A hint arrived. */
  onEvent: (event: RealtimeEvent) => void
  /** The socket (re)opened — the caller should catch up on anything it missed. */
  onOpen?: () => void
}

const PING_INTERVAL_MS = 30_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

let socket: WebSocket | null = null
let status: RealtimeStatus = 'idle'
let attempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let visibilityWired = false

const subscribers = new Set<RealtimeSubscriber>()
const statusListeners = new Set<() => void>()

function setStatus(next: RealtimeStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

/** Exponential backoff with full jitter, so several tabs don't retry in lockstep. */
function backoffDelay(): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt)
  return BACKOFF_MIN_MS + Math.random() * (ceiling - BACKOFF_MIN_MS)
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || subscribers.size === 0) return
  // A hidden tab gains nothing from retrying; the visibility handler will
  // reconnect the moment it comes back.
  if (typeof document !== 'undefined' && document.hidden) return

  const delay = backoffDelay()
  attempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function wireVisibility(): void {
  if (visibilityWired || typeof document === 'undefined') return
  visibilityWired = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    if (subscribers.size === 0) return
    if (socket && socket.readyState <= WebSocket.OPEN) return
    // Back in view with no socket: retry now rather than waiting out a backoff
    // that may have been armed minutes ago.
    attempt = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connect()
  })
}

function connect(): void {
  if (typeof window === 'undefined') return
  if (subscribers.size === 0) return
  if (socket && socket.readyState <= WebSocket.OPEN) return

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${protocol}://${window.location.host}${REALTIME_STREAM_PATH}`

  setStatus('connecting')
  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch {
    setStatus('idle')
    scheduleReconnect()
    return
  }
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    attempt = 0
    setStatus('connected')
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // The close handler will pick up the pieces.
        }
      }
    }, PING_INTERVAL_MS)
    // Catch-up: whatever changed while we were away, we didn't hear about.
    for (const subscriber of [...subscribers]) subscriber.onOpen?.()
  }

  ws.onmessage = (message) => {
    if (socket !== ws) return
    try {
      const parsed = RealtimeEventSchema.safeParse(JSON.parse(String(message.data)))
      if (!parsed.success) return
      for (const subscriber of [...subscribers]) subscriber.onEvent(parsed.data)
    } catch {
      // Malformed frame — ignore rather than tear down a healthy socket.
    }
  }

  ws.onerror = () => {
    // `close` always follows; handled there so the teardown lives in one place.
  }

  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    clearTimers()
    setStatus('idle')
    scheduleReconnect()
  }
}

function disconnect(): void {
  clearTimers()
  const ws = socket
  socket = null
  attempt = 0
  setStatus('idle')
  if (ws) {
    try {
      ws.close(1000, 'no subscribers')
    } catch {
      // ignore
    }
  }
}

/**
 * Subscribe to realtime hints, opening the shared socket if this is the first
 * subscriber.
 *
 * @returns An unsubscribe function. The socket closes when the last subscriber
 *   leaves.
 */
export function subscribeRealtime(subscriber: RealtimeSubscriber): () => void {
  subscribers.add(subscriber)
  wireVisibility()
  connect()

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) disconnect()
  }
}

/** Current connection status of the shared socket. */
export function getRealtimeStatus(): RealtimeStatus {
  return status
}

/** Subscribe to connection-status changes (for `useSyncExternalStore`). */
export function subscribeRealtimeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

/** Test seam: tear the singleton down between cases. */
export function __resetRealtimeClientForTests(): void {
  subscribers.clear()
  statusListeners.clear()
  disconnect()
}
