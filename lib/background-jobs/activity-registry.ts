/**
 * In-flight activity registry
 *
 * The toolbar chips used to count only rows in `background_jobs`, which meant
 * every piece of work that happens inline in a request — the Lantern's
 * `generate_image` tool, the wardrobe avatar preview, the Concierge's
 * per-message classification, an embedding minted to answer a search — ran to
 * completion without a chip ever moving.
 *
 * This registry is the other half of the readout. Any code path that does work
 * a user would expect to see in a chip wraps itself in {@link trackActivity};
 * the count is live for the whole span, from the first token of prompt
 * crafting to the moment the result lands.
 *
 * Design notes:
 *   - Single-user, single-process server → a `globalThis` counter map is
 *     enough, and survives Next.js dev module reloads.
 *   - Counters, not booleans. Overlapping work of different kinds (a
 *     summarizer ticking up in the middle of an image generation) is the
 *     intended reading, and two concurrent images read as `Img 2`.
 *   - Job handlers run in the forked child, so the child mirrors its deltas to
 *     the parent over IPC (`ChildActivityMessage`). The parent keeps that
 *     mirror separate from its own counts and zeroes it whenever the child
 *     dies, so a crash mid-generation can't strand a chip at a nonzero count.
 *   - `started` is a monotonic per-kind counter. The UI compares successive
 *     polls against it so work that begins and ends between two polls still
 *     registers as a blip instead of vanishing.
 *
 * @module lib/background-jobs/activity-registry
 */

import { AsyncLocalStorage } from 'async_hooks';

import { publishRealtime } from '@/lib/realtime/bus';

import { ACTIVITY_KINDS, emptyActivityCounts, type ActivityKind } from './activity-kinds';
import type { ChildActivityMessage } from './ipc-types';

interface ActivityState {
  /** In-flight counts for work running in *this* process. */
  local: Record<ActivityKind, number>;
  /** In-flight counts mirrored from the job-runner child (parent only). */
  child: Record<ActivityKind, number>;
  /**
   * Monotonic count of spans that lasted long enough to be worth showing, for
   * between-poll blip detection. Incremented when a span *ends*, so a cache
   * hit or other sub-threshold call never makes a chip flicker.
   */
  started: Record<ActivityKind, number>;
}

declare global {
  var __quilltapActivityRegistry: ActivityState | undefined;
}

function state(): ActivityState {
  if (!global.__quilltapActivityRegistry) {
    global.__quilltapActivityRegistry = {
      local: emptyActivityCounts(),
      child: emptyActivityCounts(),
      started: emptyActivityCounts(),
    };
  }
  return global.__quilltapActivityRegistry;
}

/**
 * A span shorter than this is not worth telling the user about — a cached
 * classification, a memoized embedding. Only longer spans register as a blip.
 */
const BLIP_THRESHOLD_MS = 250;

/** True when this module is running inside the forked job-runner child. */
function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1' && typeof process.send === 'function';
}

function mirrorToParent(kind: ActivityKind, delta: 1 | -1 | 'blip'): void {
  if (!isJobChild()) return;
  const msg: ChildActivityMessage = { type: 'activity', kind, delta };
  try {
    process.send!(msg);
  } catch {
    // The parent may have gone away mid-span. The parent zeroes the whole
    // child mirror on child exit, so a dropped delta can't strand a count.
  }
}

/**
 * Kinds already accounted for by an enclosing span (or by the job row of the
 * handler we are running inside). Nesting the *same* kind would read as two
 * images for one image; nesting a *different* kind is exactly the overlap the
 * chips are meant to show, so only same-kind nesting is collapsed.
 */
const attributed = new AsyncLocalStorage<ReadonlySet<ActivityKind>>();

function withAttribution<T>(kind: ActivityKind, fn: () => Promise<T>): Promise<T> {
  const next = new Set(attributed.getStore() ?? []);
  next.add(kind);
  return attributed.run(next, fn);
}

/**
 * Mark a span of work as started. Returns the matching `end` function, which
 * is idempotent — calling it twice will not double-decrement.
 *
 * Does **not** participate in same-kind collapsing — prefer
 * {@link trackActivity} unless the start and end genuinely live in different
 * scopes.
 */
export function beginActivity(kind: ActivityKind): () => void {
  const s = state();
  s.local[kind]++;
  mirrorToParent(kind, 1);
  // Both edges of the span move a chip, so both are worth a hint. In the job
  // child this is a no-op — the child's counts reach the parent through
  // `mirrorToParent`, and the parent republishes from
  // `applyChildActivityDelta`.
  publishRealtime('jobs');
  const startedAt = Date.now();

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    s.local[kind] = Math.max(0, s.local[kind] - 1);
    if (Date.now() - startedAt >= BLIP_THRESHOLD_MS) {
      s.started[kind]++;
      mirrorToParent(kind, 'blip');
    }
    mirrorToParent(kind, -1);
    publishRealtime('jobs');
  };
}

/**
 * Run `fn` with `kind` counted as in flight for its whole duration, including
 * failures. This is the normal way to register non-job work.
 *
 * Re-entrant by kind: if an enclosing span (or the job handler this is running
 * inside) already accounts for `kind`, this call is transparent. That makes it
 * safe to wrap a shared chokepoint — the Concierge classifier, the embedding
 * service — without inflating the chip when a job of the same kind calls it.
 */
export async function trackActivity<T>(kind: ActivityKind, fn: () => Promise<T>): Promise<T> {
  if (attributed.getStore()?.has(kind)) {
    return fn();
  }

  const end = beginActivity(kind);
  try {
    return await withAttribution(kind, fn);
  } finally {
    end();
  }
}

/**
 * Run a job handler attributed to its own activity kind *without* adding a
 * count — the job's PENDING/PROCESSING row is already the count, and has been
 * since before the handler started. Inline work of the same kind inside the
 * handler then collapses into it; inline work of any other kind still counts.
 */
export function runAttributedToJob<T>(kind: ActivityKind | null, fn: () => Promise<T>): Promise<T> {
  if (!kind) return fn();
  return withAttribution(kind, fn);
}

/**
 * Current in-flight counts: this process plus, in the parent, whatever the
 * job-runner child has reported.
 */
export function getActivityCounts(): Record<ActivityKind, number> {
  const s = state();
  const out = emptyActivityCounts();
  for (const kind of ACTIVITY_KINDS) {
    out[kind] = s.local[kind] + s.child[kind];
  }
  return out;
}

/** Monotonic per-kind totals of spans started since this process booted. */
export function getActivityStartTotals(): Record<ActivityKind, number> {
  return { ...state().started };
}

/**
 * Apply a delta reported by the job-runner child. Parent side only; called
 * from the host's IPC message router.
 */
export function applyChildActivityDelta(msg: ChildActivityMessage): void {
  const s = state();
  if (!ACTIVITY_KINDS.includes(msg.kind)) return;
  if (msg.delta === 'blip') {
    s.started[msg.kind]++;
  } else if (msg.delta === 1) {
    s.child[msg.kind]++;
  } else {
    s.child[msg.kind] = Math.max(0, s.child[msg.kind] - 1);
  }
  // This is where the child's chips become visible; the parent owns the socket.
  publishRealtime('jobs');
}

/**
 * Zero the child mirror. Called when the child exits for any reason — a crash
 * mid-span would otherwise leave its counts pinned above zero forever.
 */
export function resetChildActivity(): void {
  state().child = emptyActivityCounts();
  publishRealtime('jobs');
}

/** Test hook: drop all counters. */
export function __resetActivityRegistryForTests(): void {
  global.__quilltapActivityRegistry = undefined;
}
