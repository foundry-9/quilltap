/**
 * Operation Progress Bus
 *
 * A general side-channel for "blocking POST + live progress" flows. The request
 * itself must keep returning JSON (clients depend on the body), so progress
 * travels separately, keyed by a client-generated correlation id (`progressId`).
 * The handler publishes events here; a standalone SSE route subscribes and
 * streams them to whatever UI is watching.
 *
 * This started life as the Green Room's chat-creation bus (`lib/chat/creation-progress.ts`,
 * which now re-exports this module) and was generalized when The Almanack needed
 * exactly the same machinery for its seven-phase report run.
 *
 * Design notes:
 *   - Single-user, single-process server → an in-memory `globalThis` singleton
 *     is sufficient (same reload-safe storage trick as `lib/startup/progress.ts`).
 *   - Each channel BUFFERS its events so a subscriber that connects a tick late
 *     (the dialog opens its reader around the same instant the POST fires)
 *     replays everything and never misses early events or the terminal signal.
 *     This is also what lets a collapsed-and-reopened card re-attach mid-run.
 *   - `done`/`error` are terminal; after either, the channel is scheduled for
 *     cleanup on a TTL so a late reconnect still resolves before the buffer is
 *     dropped.
 *   - When `progressId` is absent (tests, older callers), the emitter is a
 *     no-op and the operation behaves exactly as before.
 *
 * @module lib/progress/operation-progress
 */

import { EventEmitter } from 'events';

/** Every event on the bus carries a discriminant and a timestamp. */
export interface BaseProgressEvent {
  kind: string;
  ts: number;
}

/**
 * The events every consumer of the bus understands. Features may publish
 * additional event shapes of their own (chat creation publishes wardrobe
 * previews); subscribers ignore what they don't recognise.
 */
export type CoreProgressEvent =
  | { kind: 'status'; message: string; ts: number }
  | { kind: 'log'; message: string; level?: 'info' | 'warn' | 'error'; ts: number }
  /** A named pipeline phase has begun. `index` is 1-based. */
  | { kind: 'phase'; key: string; index: number; total: number; label: string; ts: number }
  | { kind: 'done'; ts: number }
  | { kind: 'error'; message: string; ts: number };

interface Channel {
  buffer: BaseProgressEvent[];
  emitter: EventEmitter;
  /** Set once a terminal `done`/`error` has been published. */
  finished: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/** Cap the per-channel buffer — a tracked operation emits a few dozen events at most. */
const MAX_BUFFER = 200;
/** Keep a finished channel around briefly so a late reconnect still resolves. */
const CLEANUP_TTL_MS = 60_000;

declare global {
  var __quilltapOperationProgress: Map<string, Channel> | undefined;
}

function channels(): Map<string, Channel> {
  if (!global.__quilltapOperationProgress) {
    global.__quilltapOperationProgress = new Map();
  }
  return global.__quilltapOperationProgress;
}

function getOrCreateChannel(id: string): Channel {
  const map = channels();
  let ch = map.get(id);
  if (!ch) {
    const emitter = new EventEmitter();
    // A single watching dialog/card is the usual subscriber, but a reconnect
    // can briefly overlap — lift the cap so Node doesn't warn.
    emitter.setMaxListeners(50);
    ch = { buffer: [], emitter, finished: false };
    map.set(id, ch);
  }
  return ch;
}

function scheduleCleanup(id: string): void {
  const ch = channels().get(id);
  if (!ch) return;
  if (ch.cleanupTimer) clearTimeout(ch.cleanupTimer);
  ch.cleanupTimer = setTimeout(() => {
    channels().delete(id);
  }, CLEANUP_TTL_MS);
  // Never keep the process alive just to clean up a channel.
  ch.cleanupTimer.unref?.();
}

/**
 * Append an event to a channel and fan it out to live subscribers. No-op after
 * the channel has finished (a terminal event was already published).
 */
export function publishOperationProgress<E extends BaseProgressEvent>(id: string, event: E): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  ch.buffer.push(event);
  if (ch.buffer.length > MAX_BUFFER) {
    ch.buffer.splice(0, ch.buffer.length - MAX_BUFFER);
  }
  ch.emitter.emit('event', event);
}

/**
 * Subscribe to a channel. Returns the buffered backlog to replay immediately
 * (which may already include the terminal `done`/`error`) plus an unsubscribe.
 */
export function subscribeOperationProgress<E extends BaseProgressEvent>(
  id: string,
  listener: (event: E) => void,
): { replay: E[]; unsubscribe: () => void } {
  const ch = getOrCreateChannel(id);
  // A fresh subscriber to a still-running channel cancels any pending self-heal
  // cleanup (see unsubscribe) — the flow is clearly still being watched.
  if (!ch.finished && ch.cleanupTimer) {
    clearTimeout(ch.cleanupTimer);
    ch.cleanupTimer = undefined;
  }
  const replay = [...ch.buffer] as E[];
  ch.emitter.on('event', listener);
  return {
    replay,
    unsubscribe: () => {
      ch.emitter.off('event', listener);
      // Self-heal: if the channel never reached a terminal event (validation
      // error before any publish, server threw, client bailed) and nobody is
      // listening anymore, schedule cleanup so it doesn't linger forever. An
      // in-flight operation that publishes again just recreates the channel.
      if (!ch.finished && ch.emitter.listenerCount('event') === 0) {
        scheduleCleanup(id);
      }
    },
  };
}

/** Publish the terminal `done` event and schedule the channel for cleanup. */
export function finishOperationProgress(id: string): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  const event: CoreProgressEvent = { kind: 'done', ts: Date.now() };
  ch.finished = true;
  ch.buffer.push(event);
  ch.emitter.emit('event', event);
  scheduleCleanup(id);
}

/** Publish the terminal `error` event and schedule the channel for cleanup. */
export function failOperationProgress(id: string, message: string): void {
  if (!id) return;
  const ch = getOrCreateChannel(id);
  if (ch.finished) return;
  const event: CoreProgressEvent = { kind: 'error', message, ts: Date.now() };
  ch.finished = true;
  ch.buffer.push(event);
  ch.emitter.emit('event', event);
  scheduleCleanup(id);
}

/**
 * A per-id emitter handed to a tracked operation. When `id` is null/undefined
 * it is entirely inert, so callers never have to branch on whether progress is
 * being tracked.
 */
export interface OperationProgressEmitter {
  status(message: string): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  /** Announce entry into a named pipeline phase. `index` is 1-based. */
  phase(key: string, index: number, total: number, label: string): void;
  /** Publish a feature-specific event shape onto the same channel. */
  publish<E extends BaseProgressEvent>(event: E): void;
  finish(): void;
  fail(message: string): void;
}

const NOOP_EMITTER: OperationProgressEmitter = {
  status: () => {},
  log: () => {},
  phase: () => {},
  publish: () => {},
  finish: () => {},
  fail: () => {},
};

export function createOperationProgressEmitter(
  id: string | undefined | null,
): OperationProgressEmitter {
  if (!id) return NOOP_EMITTER;
  return {
    status: (message) => publishOperationProgress(id, { kind: 'status', message, ts: Date.now() }),
    log: (message, level) =>
      publishOperationProgress(id, { kind: 'log', message, level, ts: Date.now() }),
    phase: (key, index, total, label) =>
      publishOperationProgress(id, { kind: 'phase', key, index, total, label, ts: Date.now() }),
    publish: (event) => publishOperationProgress(id, event),
    finish: () => finishOperationProgress(id),
    fail: (message) => failOperationProgress(id, message),
  };
}

/** Test-only: drop all channels and their pending cleanup timers. */
export function __resetOperationProgressForTests(): void {
  const map = global.__quilltapOperationProgress;
  if (map) {
    for (const ch of map.values()) {
      if (ch.cleanupTimer) clearTimeout(ch.cleanupTimer);
    }
    map.clear();
  }
}
