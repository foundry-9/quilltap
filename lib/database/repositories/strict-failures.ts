/**
 * Strict repository failures.
 *
 * `safeQuery`'s fallback mode answers a thrown operation with the caller's
 * fallback — `null`, `[]`, `false`. On a render path that is the right
 * default: a degraded answer beats a blank screen, and the log carries the
 * detail. On the import path it is wrong in a way that costs data, because the
 * importers consume those values as *facts about the destination* — "no such
 * row", "no collision", "no existing outfit" — and then commit a write based
 * on the answer. A destination that fails reads therefore reads as an empty
 * one: the reconcile takes the wrong branch, duplicates appear or merges are
 * skipped, and the import reports success with nothing in its warnings to say
 * a single read went wrong (Bug 79).
 *
 * The fallback was never *chosen* by the import — it is the repository
 * default, inherited. This module carries the one bit that tells the two
 * situations apart. Inside {@link withStrictRepositoryFailures}, a repository
 * operation that throws keeps throwing rather than resolving to its fallback,
 * so the distinction that matters there — *absent* versus *unreadable* —
 * survives long enough for the importers' own per-item catch arms to turn it
 * into a named warning the user can see.
 *
 * Scope note: the context follows ordinary async control flow, so anything
 * scheduled from inside the wrapped call inherits it. Work that is genuinely
 * fire-and-forget — enqueueing follow-up jobs, scheduling a refit — should be
 * wrapped back out with {@link withRepositoryFallbacks} so it keeps the
 * ordinary degrade-and-log behaviour of every other caller.
 *
 * @module database/repositories/strict-failures
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const strictFailureStore = new AsyncLocalStorage<boolean>();

/**
 * Run `fn` with repository fallbacks disabled: any operation wrapped in
 * `safeQuery`'s fallback mode re-throws instead of returning its fallback.
 */
export function withStrictRepositoryFailures<T>(fn: () => Promise<T>): Promise<T> {
  return strictFailureStore.run(true, fn);
}

/**
 * Run `fn` with the ordinary fallback behaviour restored, even when nested
 * inside {@link withStrictRepositoryFailures}.
 */
export function withRepositoryFallbacks<T>(fn: () => Promise<T>): Promise<T> {
  return strictFailureStore.run(false, fn);
}

/** Whether repository fallbacks are currently suppressed. */
export function strictRepositoryFailuresActive(): boolean {
  return strictFailureStore.getStore() === true;
}
