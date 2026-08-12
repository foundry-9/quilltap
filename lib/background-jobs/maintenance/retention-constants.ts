/**
 * Retention windows for the daily maintenance sweep.
 *
 * Most of these are deliberately hardcoded constants — the maintenance tick
 * reaps data that has no bearing on characters, stories, or memories, and the
 * windows below are conservative enough that exposing every one as a tunable
 * would be more rope than value. The exception is the STALE-CHAT window,
 * which IS user-configurable via `instance_settings['dataRetention']` (a
 * key/value row, so no migration was needed) — resolve it through
 * `resolveStaleChatDays()` below rather than reading the constant, so the
 * image collapse, cache collapse, and cold-tier sweeps always agree on
 * "stale".
 *
 * All windows are expressed in days and converted to a cutoff `Date` at the
 * call site (`Date.now() - days * DAY_MS`).
 */

import { getDataRetentionSettings } from '@/lib/instance-settings';

/** Completed background jobs are reaped this many days after `completedAt`. */
export const COMPLETED_JOB_RETENTION_DAYS = 7;

/**
 * Dead (retry-exhausted) background jobs are reaped this many days after
 * `completedAt`. Longer than completed jobs because a DEAD row is the only
 * forensic trail for a job that gave up. `FAILED` is the transient
 * between-retries state and is NEVER reaped on a timer.
 */
export const DEAD_JOB_RETENTION_DAYS = 30;

/**
 * A chat is "stale" once it has had no activity for this many days
 * (`lastMessageAt`, fallback `updatedAt`). Only then do we collapse its
 * superseded generated story-backgrounds and chat-scoped avatars down to the
 * currently-referenced ones. Active chats are never touched.
 *
 * This is the FALLBACK default — the effective window is user-configurable
 * (Chat settings → Data Retention). Sweep code must call
 * `resolveStaleChatDays()` instead of reading this constant directly.
 */
export const STALE_CHAT_RETENTION_DAYS = 30;

/**
 * Resolve the effective stale-chat window in days: the user-configured
 * `dataRetention.staleChatDays` instance setting, falling back to
 * {@link STALE_CHAT_RETENTION_DAYS} when unset or unreadable. Every
 * stale-gated sweep (image collapse, cache collapse, cold-tier) computes its
 * cutoff from this one value so they always agree on "stale".
 */
export async function resolveStaleChatDays(): Promise<number> {
  try {
    const settings = await getDataRetentionSettings();
    return settings.staleChatDays ?? STALE_CHAT_RETENTION_DAYS;
  } catch {
    return STALE_CHAT_RETENTION_DAYS;
  }
}

/**
 * Closed terminal (Ariel) PTY sessions are reaped this many days after
 * `exitedAt`, along with their transcript files. Sessions still running
 * (`exitedAt IS NULL`) are never touched.
 */
export const CLOSED_TERMINAL_RETENTION_DAYS = 30;

/** Milliseconds in a day — shared cutoff helper denominator. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Convert a retention window in days to an absolute cutoff `Date`. */
export function retentionCutoff(days: number, now: number = Date.now()): Date {
  return new Date(now - days * DAY_MS);
}
