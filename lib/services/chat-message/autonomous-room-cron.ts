/**
 * Autonomous-room cron helper (4.6 Private Character Rooms)
 *
 * One place that turns a room's `scheduleCron` expression into its next
 * occurrence. Four sites need this — the create route and the edit service
 * (which reject an unparseable expression with the same message), the schedule
 * tick (which seeds/advances `scheduleNextRunAt`) and the turn handler (which
 * recomputes it at run end) — and they used to each hold their own copy of the
 * `new Cron(expr).nextRun(...)` dance and its error shape.
 *
 * Cron evaluation uses `croner` (zero-dep, isomorphic) in the *instance's*
 * local time, matching the daily user-token rollover.
 *
 * @module lib/services/chat-message/autonomous-room-cron
 */

import { Cron } from 'croner';

export type CronNextRunResult =
  | { ok: true; nextRunAt: string | null }
  | {
      ok: false;
      /** User-facing rejection, e.g. for a 400 or an `invalid_cron` edit result. */
      message: string;
      /** croner's own parse error, for the caller's log line. */
      error: string;
    };

/**
 * Compute the next occurrence of `cron` strictly after `anchor` (default: now)
 * as an ISO timestamp. `nextRunAt` is null when the expression is valid but has
 * no future occurrence; an unparseable expression yields `ok: false` with the
 * shared `Invalid cron expression: …` message.
 */
export function computeNextRunFromCron(cron: string, anchor: Date = new Date()): CronNextRunResult {
  try {
    const next = new Cron(cron).nextRun(anchor);
    return { ok: true, nextRunAt: next ? next.toISOString() : null };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid cron expression: ${cron}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
