/**
 * Autonomous Room Schedule Tick Handler (4.6 Private Character Rooms)
 *
 * Scans the user's autonomous rooms for cron-scheduled runs that are due,
 * applies the freshness-window rule, and either enqueues a turn job (and
 * advances `scheduleNextRunAt` to the next cron occurrence) or skips a
 * stale slot.
 *
 * Cron evaluation uses `croner` (zero-dep, isomorphic). Local timezone is
 * the *instance's* local time, matching the daily user-token rollover.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { randomUUID } from 'node:crypto';
import type { ChatMetadataBase } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { enqueueAutonomousRoomTurn } from '../queue-service';
import { startScheduledAutonomousRun } from './autonomous-run-start';
import { computeNextRunFromCron } from '@/lib/services/chat-message/autonomous-room-cron';

const HANDLER = 'background-jobs.autonomous-room-schedule-tick';
const DEFAULT_FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Grace window for the self-heal sweep. A run that just started has a
 * freshly-bumped `updatedAt` and a turn job that may not be visible yet; only
 * treat a `running` room as wedged once it's been untouched this long.
 */
const WEDGE_GRACE_MS = 60 * 1000; // 60s

function freshnessWindowFor(chat: ChatMetadataBase, fallbackMs: number): number {
  return chat.scheduleFreshnessWindowMs ?? fallbackMs;
}

/**
 * Compute the next cron occurrence strictly after the given anchor time, as an
 * ISO timestamp. Returns null on parse errors (treated as "this room is
 * mis-configured — skip it for now"). croner accepts the standard 5-field cron
 * syntax.
 */
function nextCronFireFrom(cronExpr: string, anchor: Date): string | null {
  const next = computeNextRunFromCron(cronExpr, anchor);
  if (!next.ok) {
    logger.warn('Autonomous-room schedule tick: invalid cron expression', {
      context: HANDLER,
      cronExpr,
      error: next.error,
    });
    return null;
  }
  return next.nextRunAt;
}

export async function handleAutonomousRoomScheduleTick(job: BackgroundJob): Promise<void> {
  const repos = getRepositories();
  const userId = job.userId;
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const defaultFreshnessMs = chatSettings?.autonomousRoomSettings?.defaultFreshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;

  // Enumerate user-owned autonomous chats with a cron and a non-terminal
  // run state. Stopped / running rooms are skipped — the scheduler only
  // touches idle/paused/budgetExhausted rooms.
  const userChats = await repos.chats.findByUserId(userId);
  const autonomousChats = userChats.filter(
    (c) => c.chatType === 'autonomous' && c.scheduleCron && c.runState !== 'running' && c.runState !== 'stopped',
  );

  const now = Date.now();
  const nowDate = new Date(now);

  let dueCount = 0;
  let staleCount = 0;
  let enqueuedCount = 0;

  for (const chat of autonomousChats) {
    if (!chat.scheduleCron) continue;
    const nextRunIso = chat.scheduleNextRunAt;
    if (!nextRunIso) {
      // No next run computed yet — seed it from cron and skip this tick.
      const seeded = nextCronFireFrom(chat.scheduleCron, nowDate);
      if (seeded) {
        await repos.chats.update(chat.id, {
          scheduleNextRunAt: seeded,
        } as unknown as Partial<ChatMetadataBase>);
      }
      continue;
    }
    const nextRunMs = Date.parse(nextRunIso);
    if (nextRunMs > now) {
      // Not due yet.
      continue;
    }
    dueCount++;
    const window = freshnessWindowFor(chat, defaultFreshnessMs);
    const overdueBy = now - nextRunMs;

    if (overdueBy > window) {
      // Stale slot: log and advance past it. Compute next cron occurrence
      // starting from now — the missed slot is skipped, not caught up.
      logger.info('Autonomous-room scheduler: stale_slot, skipping', {
        context: HANDLER,
        chatId: chat.id,
        scheduleNextRunAt: nextRunIso,
        overdueByMs: overdueBy,
        freshnessWindowMs: window,
      });
      const advanced = nextCronFireFrom(chat.scheduleCron, nowDate);
      if (advanced) {
        await repos.chats.update(chat.id, {
          scheduleNextRunAt: advanced,
        } as unknown as Partial<ChatMetadataBase>);
      }
      staleCount++;
      continue;
    }

    // Within freshness window — start a new run. Generate a fresh runId and
    // hand the whole run-start to the shared, parent-ordered core. We MUST NOT
    // do the `currentRunId` write + turn enqueue here in the child's buffered
    // batch: the enqueued turn could run before the buffered write landed, read
    // the prior run's id, and self-abort as `stale_run_job` — wedging the room
    // `running` with zero turns. `startScheduledAutonomousRun` routes the
    // write+enqueue to the parent's RW connection (host-RPC) so they commit in
    // order, exactly like the always-race-free manual start.
    const runId = randomUUID();
    const nowIso = new Date(now).toISOString();
    const nextNext = nextCronFireFrom(chat.scheduleCron, nowDate);
    const result = await startScheduledAutonomousRun({
      chatId: chat.id,
      userId,
      runId,
      nowIso,
      scheduleLastRunAt: nowIso,
      scheduleNextRunAt: nextNext,
      onEnqueueFailure: 'idle',
    });
    if (result.ok) {
      enqueuedCount++;
      logger.info('Autonomous-room scheduler: enqueued run', {
        context: HANDLER,
        chatId: chat.id,
        runId,
        nextRunAt: nextNext,
      });
    } else {
      // The core already rolled the row back (to 'idle') on an enqueue failure;
      // scheduleNextRunAt has advanced, so the next due slot can retry.
      logger.error('Autonomous-room scheduler: run-start failed', {
        context: HANDLER,
        chatId: chat.id,
        runId,
        reason: result.reason,
        message: result.message,
      });
    }
  }

  // Defense-in-depth: re-engage any room left `running` with nothing in flight.
  const healedCount = await healWedgedRuns(userId);

  logger.info('Autonomous-room scheduler tick complete', {
    context: HANDLER,
    userId,
    autonomousChats: autonomousChats.length,
    dueCount,
    staleCount,
    enqueuedCount,
    healedCount,
  });
}

/**
 * Self-heal sweep for wedged autonomous runs.
 *
 * A healthy `running` room always has a turn job either PROCESSING or PENDING —
 * each turn enqueues the next one (paced via `scheduledAt`) before it finishes,
 * so there's never a gap. A room in `runState: 'running'` with NO
 * pending/processing `AUTONOMOUS_ROOM_TURN`, untouched for longer than the grace
 * window, is therefore wedged: the schedule tick's start filter excludes
 * `running` rooms, so nothing would ever re-engage it. We re-enqueue a turn for
 * the live run so it resumes on its own.
 *
 * `currentRunId` is long-committed by the time a room can satisfy this
 * condition, so a plain enqueue is race-free (unlike a fresh start). The grace
 * window keeps us from racing a run that's still starting (freshly-bumped
 * `updatedAt`, turn job not yet visible), and the "no turn in flight" check
 * keeps a paced room — or one already healed by a prior tick — untouched. A rare
 * double-enqueue is harmless: the turn handler's stale/concurrency guards let at
 * most one turn proceed.
 */
export async function healWedgedRuns(userId: string): Promise<number> {
  const repos = getRepositories();
  const userChats = await repos.chats.findByUserId(userId);
  const running = userChats.filter(
    (c) => c.chatType === 'autonomous' && c.runState === 'running',
  );
  if (running.length === 0) return 0;

  const now = Date.now();
  let healedCount = 0;
  for (const chat of running) {
    if (!chat.currentRunId) continue;

    const updatedMs = chat.updatedAt ? Date.parse(chat.updatedAt) : 0;
    if (Number.isFinite(updatedMs) && now - updatedMs < WEDGE_GRACE_MS) continue;

    const inFlight = await repos.backgroundJobs.findPendingForChat(chat.id);
    if (inFlight.some((j) => j.type === 'AUTONOMOUS_ROOM_TURN')) continue;

    try {
      const jobId = await enqueueAutonomousRoomTurn(userId, {
        chatId: chat.id,
        runId: chat.currentRunId,
      });
      healedCount++;
      logger.warn('Autonomous-room scheduler: re-enqueued stalled run (self-heal)', {
        context: HANDLER,
        chatId: chat.id,
        runId: chat.currentRunId,
        jobId,
        idleForMs: Number.isFinite(updatedMs) ? now - updatedMs : null,
      });
    } catch (error) {
      logger.error('Autonomous-room scheduler: self-heal enqueue failed', {
        context: HANDLER,
        chatId: chat.id,
        runId: chat.currentRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return healedCount;
}
