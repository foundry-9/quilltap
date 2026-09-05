/**
 * Autonomous Room run-start core + child-aware bridge.
 *
 * Both run-start entry points — the manual start (`startAutonomousRoomManually`,
 * parent/API) and the scheduled tick (`handleAutonomousRoomScheduleTick`, forked
 * job child) — funnel through {@link beginAutonomousRun} so the run-start
 * contract lives in exactly one place: flip the row straight to `running`
 * (counters zeroed via `runStartPatch`), enqueue the first
 * `AUTONOMOUS_ROOM_TURN`, then post the "run begun" banner; on an enqueue
 * failure roll the row back rather than leave it falsely `running`.
 *
 * **Why the bridge exists.** The scheduled path runs in the forked child, where
 * repo writes are *buffered* and only applied by the parent when the job
 * completes. Doing the run-start write (`currentRunId = NEW`) and the turn-job
 * enqueue both in that buffered batch let the enqueued turn job become claimable
 * and execute *before* the buffered `currentRunId` write landed — so the turn
 * handler's stale-run guard (`autonomous-room-turn.ts`,
 * `chat.currentRunId !== runId`) read the *previous* run's id and self-aborted
 * as `stale_run_job` without re-enqueuing, wedging the room `running` with zero
 * turns and nothing in flight. {@link startScheduledAutonomousRun} routes the
 * whole run-start to the parent's RW connection via host-RPC (mirroring the
 * avatar/lantern/uploadFile bridges), so the write commits and is visible
 * *before* the turn job exists — identical to the always-race-free manual path.
 *
 * @module lib/background-jobs/handlers/autonomous-run-start
 */

import { getRepositories } from '@/lib/repositories/factory';
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service';
import { runStartPatch, postRunStartAnnouncement } from './autonomous-room-announce';
import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import type { ChatMetadataBase } from '@/lib/schemas/types';

const HANDLER = 'background-jobs.autonomous-run-start';

export interface BeginAutonomousRunInput {
  chatId: string;
  userId: string;
  runId: string;
  nowIso: string;
  /** Stamp the run-start time onto `scheduleLastRunAt`. Omit to leave untouched. */
  scheduleLastRunAt?: string | null;
  /**
   * Tri-state, distinguished by *presence* of the key:
   *   - omit  → leave `scheduleNextRunAt` untouched (manual start that didn't
   *             consume a cron slot);
   *   - null  → clear it (scheduled tick whose cron failed to advance);
   *   - value → write it (scheduled tick advancing past the consumed slot, or a
   *             manual start consuming the upcoming slot).
   */
  scheduleNextRunAt?: string | null;
  /**
   * Where to roll the row if the turn enqueue fails *after* the row already
   * flipped to `running`. Manual start uses `'error'` (surfaces as a failed
   * request); the scheduled tick uses `'idle'` so the next cron slot can retry.
   */
  onEnqueueFailure: 'idle' | 'error';
}

export type BeginAutonomousRunResult =
  | { ok: true; runId: string; jobId: string }
  | {
      ok: false;
      reason: 'chat_not_found' | 'not_autonomous' | 'enqueue_failed';
      message: string;
      /**
       * The original thrown error for `enqueue_failed`, so the manual-start
       * caller can re-throw it verbatim (the route maps it to a 500). Survives
       * the host-RPC hop via structured-clone ('advanced' serialization); the
       * scheduled caller ignores it.
       */
      cause?: unknown;
    };

/**
 * The parent-executed run-start core. MUST run on the parent (the sole DB
 * writer) so the `currentRunId`/`runState` write commits synchronously *before*
 * the turn job is enqueued. The scheduled tick reaches it via
 * {@link startScheduledAutonomousRun}'s host-RPC hop; the manual path calls it
 * directly (it already runs in the parent).
 */
export async function beginAutonomousRun(
  input: BeginAutonomousRunInput,
): Promise<BeginAutonomousRunResult> {
  const { chatId, userId, runId, nowIso, onEnqueueFailure } = input;
  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, reason: 'chat_not_found', message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, reason: 'not_autonomous', message: 'This chat is not an autonomous room.' };
  }

  // Flip straight to `running` (counters zeroed, pause state cleared) plus any
  // schedule bookkeeping the caller asked for. This commits before the enqueue
  // below, so the first turn job always sees the live `currentRunId`.
  const patch: Record<string, unknown> = { ...runStartPatch(nowIso, runId) };
  if (input.scheduleLastRunAt !== undefined) patch.scheduleLastRunAt = input.scheduleLastRunAt;
  if ('scheduleNextRunAt' in input) patch.scheduleNextRunAt = input.scheduleNextRunAt;
  await repos.chats.update(chatId, patch as unknown as Partial<ChatMetadataBase>);
  // Every run-state transition in this core announces itself, so the toolbar's
  // room badges reflect the flip without waiting out their fallback poll. In
  // the scheduled path this runs in the job child and is a no-op; the parent
  // republishes when the tick job's writes commit.
  publishRealtime('autonomousRooms');

  let jobId: string;
  try {
    jobId = await enqueueAutonomousRoomTurn(userId, { chatId, runId });
  } catch (error) {
    // The row already flipped to `running`; with no turn on the queue it would
    // wedge (the scheduler filter excludes `running`). Roll it back so it's
    // eligible again — `'idle'` for the scheduled path (next cron slot retries),
    // `'error'` for the manual path (the request fails loudly).
    const runStateMessage =
      onEnqueueFailure === 'error' ? 'start:enqueue_failed' : 'schedule:enqueue_failed';
    logger.error('Autonomous run-start: enqueue failed, rolling run state back', {
      context: HANDLER, chatId, runId, onEnqueueFailure,
      error: error instanceof Error ? error.message : String(error),
    });
    await repos.chats.update(chatId, {
      runState: onEnqueueFailure,
      runStateMessage,
      runEndedAt: new Date().toISOString(),
    } as unknown as Partial<ChatMetadataBase>);
    publishRealtime('autonomousRooms');
    return { ok: false, reason: 'enqueue_failed', message: runStateMessage, cause: error };
  }

  // Run is live and a turn is queued — post the "run begun" banner. Best-effort
  // (the helper swallows its own write failures); `chat` is the pre-update
  // snapshot, whose participants and budget caps are unchanged by the flip.
  await postRunStartAnnouncement(chatId, runId, chat);

  logger.info('Autonomous run-start: run begun', { context: HANDLER, chatId, runId, jobId });
  return { ok: true, runId, jobId };
}

/**
 * Child-aware wrapper around {@link beginAutonomousRun}. When invoked inside the
 * forked job child (`QUILLTAP_JOB_CHILD === '1'`), route the entire run-start to
 * the parent's RW connection via host-RPC so the write+enqueue happen
 * synchronously and in order on the host; the parent re-enters this same
 * function (where the env var is unset) and runs the core directly. Mirrors
 * `writeCharacterAvatarToVault` / `writeLanternBackgroundToMountStore`.
 */
export async function startScheduledAutonomousRun(
  input: BeginAutonomousRunInput,
): Promise<BeginAutonomousRunResult> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    logger.debug('Autonomous run-start: routing scheduled start to host via RPC', {
      context: HANDLER, chatId: input.chatId, runId: input.runId,
    });
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    return callHost<BeginAutonomousRunResult>('startScheduledAutonomousRun', input);
  }
  return beginAutonomousRun(input);
}
