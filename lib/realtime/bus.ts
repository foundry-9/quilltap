/**
 * Realtime invalidation bus
 *
 * The parent process's one fan-out point for "this slice of server state just
 * changed." Publishers call {@link publishRealtime}; every open tab gets a
 * ~40-byte hint and decides for itself whether it cares.
 *
 * Design notes:
 *   - **`globalThis`-backed singleton**, the same HMR-survival trick the
 *     activity registry uses: Next's dev server re-evaluates modules freely,
 *     and a fresh module instance holding an empty socket set would silently
 *     strand every connected client.
 *   - **Coalescing is mandatory, not a nicety.** An `EMBEDDING_REINDEX_ALL`
 *     sweep completes thousands of jobs and a memory-extraction batch commits
 *     dozens of writes; without a trailing-edge debounce per topic(+id) the
 *     socket would carry a storm the UI can't use. Clients are built to
 *     tolerate both duplicates (invalidation is idempotent) and gaps (a
 *     reconnect invalidates everything), so collapsing is always safe.
 *   - **Parent process only.** Job handlers run in the forked child, which
 *     owns no sockets; their changes reach here through the existing IPC (the
 *     activity mirror and the committed write batch). Importing this module in
 *     the child is harmless — every publish is a no-op — so shared code paths
 *     like `queue-service` need no guard of their own.
 *
 * @module lib/realtime/bus
 */

import type { WebSocket } from 'ws';

import { logger } from '@/lib/logger';
import {
  REALTIME_PROTOCOL_VERSION,
  type RealtimeEvent,
  type RealtimeTopic,
} from '@/lib/schemas/realtime.types';

const log = logger.child({ module: 'realtime-bus' });

/**
 * Trailing-edge debounce window. Long enough to swallow a job batch's worth of
 * completions, short enough that a chip lighting up still feels immediate.
 */
const COALESCE_WINDOW_MS = 250;

/** Running in the forked job child, where publishing is a no-op. */
const IS_JOB_CHILD = process.env.QUILLTAP_JOB_CHILD === '1';

interface PendingEvent {
  topic: string;
  id?: string;
  timer: ReturnType<typeof setTimeout>;
  /** How many publishes this pending event has absorbed, for the debug log. */
  coalesced: number;
}

interface BusState {
  sockets: Set<WebSocket>;
  pending: Map<string, PendingEvent>;
}

declare global {
  var __quilltapRealtimeBus: BusState | undefined;
}

function state(): BusState {
  if (!global.__quilltapRealtimeBus) {
    global.__quilltapRealtimeBus = { sockets: new Set(), pending: new Map() };
  }
  return global.__quilltapRealtimeBus;
}

function pendingKey(topic: string, id?: string): string {
  return id ? `${topic}:${id}` : topic;
}

/**
 * Send one event to every open socket. Per-socket failures are swallowed and
 * the socket dropped — a wedged client must never stall a publisher.
 */
function fanOut(event: RealtimeEvent): void {
  const s = state();
  if (s.sockets.size === 0) {
    log.debug('Realtime event dropped — no listeners', { topic: event.topic, id: event.id });
    return;
  }

  const frame = JSON.stringify(event);
  let delivered = 0;
  for (const ws of [...s.sockets]) {
    try {
      ws.send(frame);
      delivered++;
    } catch (err) {
      s.sockets.delete(ws);
      log.debug('Realtime send failed; dropping socket', {
        topic: event.topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log.debug('Realtime event fanned out', { topic: event.topic, id: event.id, delivered });
}

/**
 * Announce that `topic` (optionally, just row `id` within it) has changed.
 *
 * Cheap and fire-and-forget: safe to call from any parent-process chokepoint,
 * including hot ones. Repeated calls inside the debounce window collapse into
 * a single delivered event on the trailing edge.
 *
 * @example
 * publishRealtime('jobs')
 * publishRealtime('chats', chatId)
 */
export function publishRealtime(topic: RealtimeTopic | string, id?: string): void {
  if (IS_JOB_CHILD) return;

  const s = state();
  const key = pendingKey(topic, id);
  const existing = s.pending.get(key);
  if (existing) {
    existing.coalesced++;
    log.debug('Realtime publish coalesced', { topic, id, coalesced: existing.coalesced });
    return;
  }

  const timer = setTimeout(() => {
    const entry = s.pending.get(key);
    s.pending.delete(key);
    fanOut({
      v: REALTIME_PROTOCOL_VERSION,
      topic,
      ...(id ? { id } : {}),
      at: Date.now(),
    });
    if (entry && entry.coalesced > 0) {
      log.debug('Realtime publish flushed', { topic, id, coalesced: entry.coalesced });
    }
  }, COALESCE_WINDOW_MS);
  // Never hold the process open for a pending invalidation hint.
  timer.unref?.();

  s.pending.set(key, { topic, id, timer, coalesced: 0 });
  log.debug('Realtime publish queued', { topic, id });
}

/**
 * Register a freshly upgraded socket. Returns a detach function; the handler
 * calls it on `close`/`error`.
 */
export function attachRealtimeSocket(ws: WebSocket): () => void {
  const s = state();
  s.sockets.add(ws);
  log.debug('Realtime socket attached', { sockets: s.sockets.size });

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    s.sockets.delete(ws);
    log.debug('Realtime socket detached', { sockets: s.sockets.size });
  };
}

/** How many clients are currently listening. Diagnostics and tests. */
export function realtimeListenerCount(): number {
  return state().sockets.size;
}

/** Test seam: drop every socket and cancel every pending flush. */
export function __resetRealtimeBusForTests(): void {
  const s = state();
  for (const entry of s.pending.values()) clearTimeout(entry.timer);
  s.pending.clear();
  s.sockets.clear();
}
