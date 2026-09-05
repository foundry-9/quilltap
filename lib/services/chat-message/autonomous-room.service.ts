/**
 * Autonomous Room Service (4.6 Private Character Rooms)
 *
 * Manual-start entry point. The scheduled-run path lives in
 * `lib/background-jobs/handlers/autonomous-room-schedule-tick.ts`; both
 * funnel into the same run-start contract (`runStartPatch` /
 * `postRunStartAnnouncement` in `autonomous-room-announce.ts`): generate a
 * fresh runId, flip the row straight to `runState = 'running'` with the
 * per-run counters zeroed, advance any consumed cron slot, enqueue the first
 * `AUTONOMOUS_ROOM_TURN`, and post the "run begun" banner. Flipping to
 * `running` at request time (rather than parking at `idle` for the turn job to
 * promote) is what lets the Salon header badges reflect the live status the
 * instant the household hits start/resume, instead of lagging until the first
 * turn comes around. The turn handler runs the turns from there.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service';
import { beginAutonomousRun } from '@/lib/background-jobs/handlers/autonomous-run-start';
import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import { computeNextRunFromCron } from './autonomous-room-cron';
import type { ChatMetadataBase } from '@/lib/schemas/types';

const HANDLER = 'autonomous-room.service';
const DEFAULT_FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;

export type StartManualRunResult =
  | { ok: true; runId: string; jobId: string }
  | { ok: false; reason: 'not_autonomous' | 'already_running' | 'chat_not_found'; message: string };

/**
 * Start an autonomous-room run manually, immediately. Rejects if the chat
 * isn't autonomous, or if there's already a non-terminal run in flight
 * (running). Idle/paused/budgetExhausted rooms are eligible — the new
 * runId atomically supersedes any prior state.
 */
export async function startAutonomousRoomManually(
  chatId: string,
  userId: string,
): Promise<StartManualRunResult> {
  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, reason: 'chat_not_found', message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, reason: 'not_autonomous', message: 'This chat is not an autonomous room.' };
  }
  if (chat.runState === 'running') {
    return {
      ok: false,
      reason: 'already_running',
      message: 'An autonomous run is already in progress for this room.',
    };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const runId = randomUUID();

  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const defaultFreshnessMs = chatSettings?.autonomousRoomSettings?.defaultFreshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
  const freshnessWindowMs = chat.scheduleFreshnessWindowMs ?? defaultFreshnessMs;

  // Consume the upcoming cron slot if it falls inside the freshness window:
  // a manual start that happens close to the scheduled slot replaces it,
  // and the next scheduled run advances forward past the consumed slot.
  let nextScheduledRunAt = chat.scheduleNextRunAt ?? null;
  if (chat.scheduleCron && chat.scheduleNextRunAt) {
    const nextMs = Date.parse(chat.scheduleNextRunAt);
    const distance = Math.abs(nextMs - now);
    if (distance <= freshnessWindowMs) {
      const advanced = computeNextRunFromCron(chat.scheduleCron, new Date(now));
      if (advanced.ok) {
        nextScheduledRunAt = advanced.nextRunAt ?? nextScheduledRunAt;
      } else {
        logger.warn('Manual start: failed to advance scheduleNextRunAt past consumed slot', {
          context: HANDLER,
          chatId,
          cron: chat.scheduleCron,
          error: advanced.error,
        });
      }
    }
  }

  // Delegate the run-start (flip to `running`, enqueue the first turn, post the
  // banner, roll back on enqueue failure) to the shared parent-ordered core —
  // the same one the scheduled tick reaches via host-RPC. This path already runs
  // in the parent, so it calls the core directly. Only write `scheduleNextRunAt`
  // when we actually consumed a cron slot.
  const advancedNextRunAt = nextScheduledRunAt !== chat.scheduleNextRunAt;
  const result = await beginAutonomousRun({
    chatId,
    userId,
    runId,
    nowIso,
    scheduleLastRunAt: nowIso,
    ...(advancedNextRunAt ? { scheduleNextRunAt: nextScheduledRunAt } : {}),
    onEnqueueFailure: 'error',
  });
  if (!result.ok) {
    // chat existence/type were already validated above, so the only reachable
    // failure here is an enqueue error — the core already rolled the row to
    // `error`. Re-throw the original cause (the route maps a throw to a 500),
    // preserving the manual-start contract.
    throw result.cause instanceof Error
      ? result.cause
      : new Error(`Autonomous-room start failed: ${result.message}`);
  }

  logger.info('Manual autonomous-room run started', {
    context: HANDLER,
    chatId,
    runId,
    jobId: result.jobId,
    advancedNextRunAt,
  });

  return { ok: true, runId, jobId: result.jobId };
}

/**
 * Pause an active or eligible autonomous-room run. Idempotent; transitions
 * to 'paused' regardless of starting state when the chat is autonomous.
 */
export async function pauseAutonomousRoom(
  chatId: string,
): Promise<{ ok: boolean; message?: string }> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, message: 'This chat is not an autonomous room.' };
  }
  await repos.chats.update(chatId, {
    runState: 'paused',
    runStateMessage: 'manual:paused',
    // Stamp when the pause took effect so a later resume can fold this
    // interval into runPausedAccumMs and keep it out of the wall-clock budget.
    runPausedAt: new Date().toISOString(),
  } as unknown as Partial<ChatMetadataBase>);
  logger.info('Autonomous-room: paused', { context: HANDLER, chatId });
  publishRealtime('autonomousRooms');
  return { ok: true };
}

/**
 * Stop an autonomous-room run. Transitions to 'stopped' and bumps
 * currentRunId to a fresh UUID so any in-flight turn job exits cleanly via
 * the stale-run guard on its next tick.
 */
export async function stopAutonomousRoom(
  chatId: string,
): Promise<{ ok: boolean; message?: string }> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, message: 'This chat is not an autonomous room.' };
  }
  await repos.chats.update(chatId, {
    runState: 'stopped',
    runStateMessage: 'manual:stopped',
    currentRunId: randomUUID(),
    runEndedAt: new Date().toISOString(),
  } as unknown as Partial<ChatMetadataBase>);
  logger.info('Autonomous-room: stopped', { context: HANDLER, chatId });
  publishRealtime('autonomousRooms');
  return { ok: true };
}

/**
 * Resume an autonomous-room run.
 *
 * When the room is genuinely *paused* (and still owns a live run), this
 * continues the SAME run rather than starting a new one: the run's counters
 * (turns / tokens), runId, and runStartedAt are preserved, and no "run begun"
 * announcement is posted. The paused interval is folded into runPausedAccumMs
 * (which the wall-clock budget subtracts) rather than shifting runStartedAt —
 * runStartedAt also anchors the token-accounting window, so moving it would
 * drop pre-pause tokens from the count. The row is flipped straight back to
 * `running`, so the turn handler skips both its not-active early-exit and its
 * idle→running start block (which is what posts the banner and zeroes the
 * counters) and goes directly to the next turn.
 *
 * For any other state (idle / stopped / budgetExhausted / error, or a paused
 * row with no runId), there's nothing meaningful to continue, so we fall back
 * to a fresh run via `startAutonomousRoomManually` — a brand-new runId with
 * reset counters and the usual start announcement.
 */
export async function resumeAutonomousRoom(
  chatId: string,
  userId: string,
): Promise<StartManualRunResult> {
  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, reason: 'chat_not_found', message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, reason: 'not_autonomous', message: 'This chat is not an autonomous room.' };
  }
  if (chat.runState === 'running') {
    return {
      ok: false,
      reason: 'already_running',
      message: 'An autonomous run is already in progress for this room.',
    };
  }

  // Anything that isn't a live paused run starts fresh.
  if (chat.runState !== 'paused' || !chat.currentRunId) {
    return startAutonomousRoomManually(chatId, userId);
  }

  const now = Date.now();
  const runId = chat.currentRunId;

  // Exclude the paused interval from the wall-clock budget by accumulating it
  // into runPausedAccumMs — NOT by shifting runStartedAt. runStartedAt is also
  // the token-accounting window start (the turn handler sums llm_logs since
  // that instant), so moving it forward would drop every pre-pause token from
  // the count. The wall-clock check subtracts runPausedAccumMs instead.
  let runPausedAccumMs = chat.runPausedAccumMs ?? 0;
  if (chat.runPausedAt) {
    const pausedForMs = now - Date.parse(chat.runPausedAt);
    if (Number.isFinite(pausedForMs) && pausedForMs > 0) {
      runPausedAccumMs += pausedForMs;
    }
  }

  await repos.chats.update(chatId, {
    runState: 'running',
    runStateMessage: null,
    runEndedAt: null,
    runPausedAt: null,
    runPausedAccumMs,
    // currentRunId / runStartedAt / runTurnsConsumed / runTokensConsumed are
    // deliberately left untouched — this continues the existing run.
  } as unknown as Partial<ChatMetadataBase>);

  const jobId = await enqueueAutonomousRoomTurn(userId, { chatId, runId });

  logger.info('Autonomous-room: resumed (continuing run)', {
    context: HANDLER,
    chatId,
    runId,
    jobId,
    runPausedAccumMs,
  });
  publishRealtime('autonomousRooms');

  return { ok: true, runId, jobId };
}

/**
 * Editable per-room settings, as accepted from the Edit Enclave modal. All
 * fields are optional so the caller can send a partial patch; the values speak
 * the same units as the DB and the create payload (milliseconds for the
 * windows/caps), so the modal converts hours/minutes → ms before calling.
 *
 * Tri-state semantics, field by field:
 *   - `undefined` → leave the stored value untouched.
 *   - `null`      → clear the stored value back to NULL (for the nullable
 *                   columns: scheduleCron, the freshness window, every budget
 *                   cap, and runVisibility's "inherit default").
 *   - a value     → write it.
 *
 * `title` is special: when a non-empty string is supplied we also stamp
 * `isManuallyRenamed = true` so the cheap-LLM auto-titler stops overwriting the
 * household's chosen name. We never *clear* a title here.
 */
export interface AutonomousRoomSettingsPatch {
  title?: string;
  scheduleCron?: string | null;
  scheduleFreshnessWindowMs?: number | null;
  budgetMaxTurns?: number | null;
  budgetMaxTokens?: number | null;
  budgetMaxWallClockMs?: number | null;
  budgetEstimatedSpendCapUSD?: number | null;
  runVisibility?: 'owner_only' | 'household' | 'open' | null;
  runDestructiveToolsAllowed?: boolean;
  budgetExcludeCacheHits?: boolean;
}

export type UpdateAutonomousRoomSettingsResult =
  | { ok: true; clampedDestructive: boolean }
  | {
      ok: false;
      reason: 'not_autonomous' | 'chat_not_found' | 'invalid_cron';
      message: string;
    };

/**
 * Apply an edit to an autonomous room's settings.
 *
 * Edits land on the live chat row and take effect on the *next* turn of any
 * in-flight run — the turn handler re-reads the budget caps, the cache-counting
 * mode, and the destructive-tool flag fresh every turn, and the Salon list
 * reads `runVisibility` fresh on every fetch. Run-state and counters
 * (`runState`, `currentRunId`, `runStartedAt`, the turn/token tallies) are
 * deliberately left untouched, so editing never restarts or resets a run.
 *
 * Cron is the one field needing a follow-on write: changing the expression
 * recomputes `scheduleNextRunAt` (so the scheduler tick honours the new
 * cadence), and clearing it drops the room back to manual-only. We validate the
 * expression here and reject the whole edit on a bad cron rather than silently
 * dropping the schedule — the private `recomputeNextRun` in the turn handler
 * can't be reused because it collapses "missing" and "invalid" to the same
 * null.
 *
 * The user-level destructive-tool ceiling is enforced at write time: if the
 * household's policy is `always_refuse`, the per-room flag is forced off no
 * matter what the form sent.
 */
export async function updateAutonomousRoomSettings(
  chatId: string,
  userId: string,
  patch: AutonomousRoomSettingsPatch,
): Promise<UpdateAutonomousRoomSettingsResult> {
  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, reason: 'chat_not_found', message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return {
      ok: false,
      reason: 'not_autonomous',
      message: 'This chat is not an autonomous room.',
    };
  }

  const update: Record<string, unknown> = {};

  // --- Title (also pins isManuallyRenamed so the auto-titler backs off) ---
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (trimmed.length > 0) {
      update.title = trimmed;
      update.isManuallyRenamed = true;
    }
  }

  // --- Schedule (three-way: set+recompute / clear / reject-on-invalid) ---
  if (patch.scheduleCron !== undefined) {
    const cron = patch.scheduleCron?.trim() ?? '';
    if (cron.length === 0) {
      update.scheduleCron = null;
      update.scheduleNextRunAt = null;
    } else {
      const nextRun = computeNextRunFromCron(cron);
      if (!nextRun.ok) {
        logger.warn('Autonomous-room edit: rejected invalid cron', {
          context: HANDLER,
          chatId,
          cron,
          error: nextRun.error,
        });
        return { ok: false, reason: 'invalid_cron', message: nextRun.message };
      }
      update.scheduleCron = cron;
      update.scheduleNextRunAt = nextRun.nextRunAt;
    }
  }

  // --- Catch-up freshness window ---
  if (patch.scheduleFreshnessWindowMs !== undefined) {
    update.scheduleFreshnessWindowMs = patch.scheduleFreshnessWindowMs;
  }

  // --- Budget caps (each nullable: null clears the cap) ---
  if (patch.budgetMaxTurns !== undefined) update.budgetMaxTurns = patch.budgetMaxTurns;
  if (patch.budgetMaxTokens !== undefined) update.budgetMaxTokens = patch.budgetMaxTokens;
  if (patch.budgetMaxWallClockMs !== undefined) update.budgetMaxWallClockMs = patch.budgetMaxWallClockMs;
  if (patch.budgetEstimatedSpendCapUSD !== undefined) {
    update.budgetEstimatedSpendCapUSD = patch.budgetEstimatedSpendCapUSD;
  }

  // --- Token-budget counting mode (default: exclude cache hits) ---
  if (patch.budgetExcludeCacheHits !== undefined) {
    update.budgetExcludeCacheHits = patch.budgetExcludeCacheHits === false ? 0 : 1;
  }

  // --- Visibility (null = inherit the user default) ---
  if (patch.runVisibility !== undefined) {
    update.runVisibility = patch.runVisibility;
  }

  // --- Destructive-tool authorization, clamped by the user-level ceiling ---
  let clampedDestructive = false;
  if (patch.runDestructiveToolsAllowed !== undefined) {
    const chatSettings = await repos.chatSettings.findByUserId(userId);
    const policyRefuse =
      chatSettings?.autonomousRoomSettings?.destructiveToolPolicy === 'always_refuse';
    const allowed = policyRefuse ? false : patch.runDestructiveToolsAllowed;
    clampedDestructive = policyRefuse && patch.runDestructiveToolsAllowed;
    update.runDestructiveToolsAllowed = allowed ? 1 : 0;
  }

  if (Object.keys(update).length === 0) {
    return { ok: true, clampedDestructive };
  }

  await repos.chats.update(chatId, update as unknown as Partial<ChatMetadataBase>);

  logger.info('Autonomous-room: settings edited', {
    context: HANDLER,
    chatId,
    changedFields: Object.keys(update),
    cronChanged: 'scheduleCron' in update,
    nextRunAt: update.scheduleNextRunAt,
    clampedDestructive,
  });
  publishRealtime('autonomousRooms');

  return { ok: true, clampedDestructive };
}

/**
 * Build the chat patch that pauses an autonomous run but leaves it *resumable in
 * place*: a fresh `currentRunId` (so any zombie/retry turn job exits via the
 * stale-run guard), `runEndedAt` cleared, and `runPausedAt` anchored to the last
 * activity so a later resume excludes the outage from the wall-clock budget. The
 * cause is recorded in `runStateMessage`; the turn/token counters are
 * deliberately left untouched. Single source for both the startup reconcile and
 * the terminal-failure reconcile, so the resume contract can't drift between them.
 */
function buildResumablePausePatch(
  chat: { lastMessageAt?: string | null; runStartedAt?: string | null },
  runStateMessage: string,
  nowIso: string,
): Partial<ChatMetadataBase> {
  return {
    runState: 'paused',
    runStateMessage,
    currentRunId: randomUUID(),
    runEndedAt: null,
    runPausedAt: chat.lastMessageAt ?? chat.runStartedAt ?? nowIso,
  } as unknown as Partial<ChatMetadataBase>;
}

/**
 * Startup reconcile for autonomous-room runs interrupted by a server crash
 * or restart. Any chat with `chatType = 'autonomous'` and `runState =
 * 'running'` had its turn-worker killed mid-execution; without this sweep
 * the row stays `running` forever and `startAutonomousRoomManually` refuses
 * to re-engage.
 *
 * We transition it to `paused` (not `idle`) so the interrupted run is
 * *resumable*: `resumeAutonomousRoom` will continue it in place, preserving
 * the turn/token counters and transcript rather than starting over. We bump
 * `currentRunId` so any zombie AUTONOMOUS_ROOM_TURN job re-claimed by the
 * dispatcher's orphan reset exits cleanly via the stale-run guard, and stamp
 * `runPausedAt` from the last message (the best proxy for when the run
 * actually stopped conversing) so a later resume excludes the outage from the
 * wall-clock budget. Counters and `runEndedAt` are deliberately left as the
 * resumable state expects (counters preserved; not ended).
 *
 * Scheduled (cron) rooms are unaffected operationally: the scheduler tick
 * treats `paused` as eligible, so the next cron slot still starts a fresh run
 * if the household never resumes manually.
 *
 * Parent-process only. Idempotent — when nothing is stuck this is a single
 * findAll + filter with no writes.
 */
export async function reconcileAutonomousRunsAtStartup(): Promise<{ reconciledCount: number }> {
  const repos = getRepositories();

  const allChats = await repos.chats.findAll();
  const stuck = allChats.filter(
    (c) => c.chatType === 'autonomous' && c.runState === 'running',
  );

  if (stuck.length === 0) {
    return { reconciledCount: 0 };
  }

  const nowIso = new Date().toISOString();
  for (const chat of stuck) {
    await repos.chats.update(chat.id, buildResumablePausePatch(chat, 'restart:interrupted', nowIso));
    logger.info('Autonomous-room: reconciled stuck run at startup (paused, resumable)', {
      context: HANDLER,
      chatId: chat.id,
      previousRunId: chat.currentRunId,
      runTurnsConsumed: chat.runTurnsConsumed,
      runTokensConsumed: chat.runTokensConsumed,
    });
  }

  logger.info('Autonomous-room startup reconcile complete', {
    context: HANDLER,
    reconciledCount: stuck.length,
  });
  return { reconciledCount: stuck.length };
}

/**
 * Recover an autonomous room whose turn job failed *terminally*.
 *
 * An AUTONOMOUS_ROOM_TURN job runs in the forked child and buffers all of its
 * writes — the assistant message, the turn/token counters, and the run-state
 * transition — into one batch that the parent applies atomically. If any write
 * in that batch is rejected at apply time (e.g. a tool's `docMountFolders`
 * insert hits a unique constraint), the WHOLE batch rolls back, including the
 * handler's own run-state write, and the single-attempt job is marked DEAD.
 * Left alone the chat stays `runState: 'running'` with no turn in flight — a
 * silent wedge that {@link startAutonomousRoomManually} refuses to re-engage.
 *
 * The dispatcher calls this on terminal failure of a turn job. We mirror the
 * startup reconcile: transition to `paused` (resumable in place, and the
 * scheduler treats paused as eligible for the next cron slot), bump
 * `currentRunId` so any zombie/retry turn job exits via the stale-run guard,
 * preserve the counters, and record the cause in `runStateMessage` so the room
 * status surfaces *why* it stopped instead of freezing mid-run.
 *
 * Parent-process only (the sole DB writer), so this write applies immediately
 * and is not part of the failed batch. Fully guarded — a failure here must
 * never throw back into the dispatcher's result handling.
 */
export async function reconcileFailedAutonomousTurn(
  payload: { chatId?: string; runId?: string } | null | undefined,
  failureReason: string,
): Promise<void> {
  try {
    const chatId = payload?.chatId;
    const runId = payload?.runId;
    if (!chatId || !runId) return;

    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.chatType !== 'autonomous') return;

    // Only act on the live run, and only while it still looks active. A newer
    // run (currentRunId moved on) or an already-terminal state means something
    // else has already taken over; leave it alone.
    if (chat.currentRunId !== runId) return;
    if (chat.runState !== 'running' && chat.runState !== 'idle') return;

    const nowIso = new Date().toISOString();
    await repos.chats.update(chatId, buildResumablePausePatch(chat, `turn_failed:${failureReason}`.slice(0, 500), nowIso));

    logger.warn('Autonomous-room: turn job failed terminally; run paused (resumable)', {
      context: HANDLER,
      chatId,
      previousRunId: runId,
      failureReason,
      runTurnsConsumed: chat.runTurnsConsumed,
      runTokensConsumed: chat.runTokensConsumed,
    });
    publishRealtime('autonomousRooms');
  } catch (err) {
    logger.error('Autonomous-room: reconcile-after-failure threw', {
      context: HANDLER,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
