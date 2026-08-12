/**
 * Autonomous Room Turn Handler (4.6 Private Character Rooms)
 *
 * Drives one turn of a `chatType: 'autonomous'` chat. The substrate is the
 * ordinary Salon path — speaker selection via `selectNextSpeaker`, message
 * processing via `handleSendMessage` with `continueMode: true,
 * respondingParticipantId`. This handler adds:
 *   - a stale-run guard (`payload.runId !== chat.currentRunId` → exit clean)
 *   - run-state lifecycle (idle → running → ...)
 *   - per-turn budget bookkeeping (turns, tokens, wall-clock)
 *   - the `neverPauseForUser` + `suppressAutomaticImages` flags
 *   - self-re-enqueue for the next turn if the run is still alive
 *
 * Budget enforcement (daily user-token cap, spend cap) and tool filtering
 * land in Sub-task C; this handler's pre-turn budget check covers the three
 * caps that read off the chat row directly (turns, room tokens, wall-clock).
 *
 * Memory extraction kicks off through the ordinary `handleSendMessage` path
 * — no special wiring is needed here; the extractor consults `chat.chatType`
 * in Sub-task D to attribute memories correctly.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { handleSendMessage } from '@/lib/services/chat-message/orchestrator.service';
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager';
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary';
import type {
  AutonomousRunState,
  Character,
  ChatMetadataBase,
  MessageEvent,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { Cron } from 'croner';
import type { AutonomousRoomTurnPayload } from '../queue-service';
import { enqueueAutonomousRoomTurn } from '../queue-service';
import { runWithAutonomousRunId } from '../autonomous-run-context';
import {
  postAutonomousRoomAnnouncement,
  postRunStartAnnouncement,
  type AutonomousRoomKind,
} from './autonomous-room-announce';

const HANDLER = 'background-jobs.autonomous-room-turn';

// @port-oracle-export — exported only because it appears in the signature of
// the oracle-exported `checkBudget` (below): a private name in an exported
// function's return type breaks `tsc --declaration`. The export exists to keep
// the quilltap-v5 differential port harness wiring valid; do NOT strip it as an
// "unused export" just because nothing in THIS repo imports it by name.
export interface BudgetVerdict {
  exhausted: false;
}

// @port-oracle-export — see note on BudgetVerdict above.
export interface BudgetExhausted {
  exhausted: true;
  nextState: 'budgetExhausted' | 'paused';
  reason: string;
}

// @port-oracle-export — see note on BudgetVerdict above.
export type BudgetCheckResult = BudgetVerdict | BudgetExhausted;

/**
 * Compute the ISO timestamp of the most recent instance-local midnight.
 * The autonomous-room daily user-token cap rolls over at the *instance's*
 * local-time midnight (per the resolved-decisions section of the spec).
 */
function lastLocalMidnightIso(now: number): string {
  const d = new Date(now);
  // Construct a Date at 00:00:00 in the instance's local timezone.
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return midnight.toISOString();
}

/**
 * Pre-turn budget verdict. Reads the per-row chat caps directly; for the
 * daily user-token cap, the caller passes in the summed usage since
 * instance-local midnight (read off llm_logs).
 *
 * @port-oracle-export — exported solely for the quilltap-v5 differential port
 * harness (quilltap-v5/harness/oracle/cases/enclave-budget.ts), which imports
 * the REAL function to check the Rust port against. Has no other importer in
 * this repo; do NOT delete the `export` as unused — it would break the
 * equivalence test guarding the budget-math port.
 */
export function checkBudget(
  chat: ChatMetadataBase,
  now: number,
  options: {
    dailyTokenBudget: number | null;
    dailyTokensSpent: number;
  },
): BudgetCheckResult {
  if (chat.budgetMaxWallClockMs != null && chat.runStartedAt) {
    // Exclude time spent paused: runStartedAt stays fixed (it anchors token
    // accounting), so we subtract the accumulated paused duration here.
    const elapsed = now - Date.parse(chat.runStartedAt) - (chat.runPausedAccumMs ?? 0);
    if (elapsed >= chat.budgetMaxWallClockMs) {
      return { exhausted: true, nextState: 'budgetExhausted', reason: 'wall_clock' };
    }
  }
  if (chat.budgetMaxTurns != null && (chat.runTurnsConsumed ?? 0) >= chat.budgetMaxTurns) {
    return { exhausted: true, nextState: 'budgetExhausted', reason: 'turns' };
  }
  if (chat.budgetMaxTokens != null && (chat.runTokensConsumed ?? 0) >= chat.budgetMaxTokens) {
    return { exhausted: true, nextState: 'budgetExhausted', reason: 'tokens_room' };
  }
  // Daily user-token cap: transitions to 'paused' (not 'budgetExhausted')
  // because the room resumes tomorrow when the scheduler re-evaluates.
  if (options.dailyTokenBudget != null && options.dailyTokensSpent >= options.dailyTokenBudget) {
    return { exhausted: true, nextState: 'paused', reason: 'tokens_user_daily' };
  }
  return { exhausted: false };
}

/**
 * Default number of turns a token-budgeted autonomous run should aim to span
 * when the room has no explicit `budgetMaxTurns`. Used to slice the per-run
 * token budget into a per-turn context cap so a run paces itself across several
 * turns instead of spending most of the budget on a single oversized turn.
 */
export const DEFAULT_AUTONOMOUS_TARGET_TURNS = 6;

/**
 * Floor for the per-turn context cap (tokens). Below this a turn can't carry a
 * functioning context (system prompt + character cards + scene state + a little
 * history), so the cap never clamps below it — we let the run's own budget
 * check end the run rather than ship a starved turn.
 */
export const MIN_AUTONOMOUS_CONTEXT_TOKENS = 16_000;

/**
 * Derive this turn's context-budget cap (tokens) from the room's per-run token
 * budget, sliced across the turns the run should still span. The context-manager
 * clamps its model-derived `maxAvailable` down to this value, so a room running
 * on a big-context model still paces its per-run token budget across turns.
 *
 * Returns undefined when the room has no token budget (`budgetMaxTokens == null`)
 * — leaving the model-derived context budget untouched (unchanged behavior).
 *
 * The slice is `remaining / turnsLeft`:
 *   - `remaining` = `budgetMaxTokens − runTokensConsumed`, read off the local
 *     chat snapshot (0 at run start, one turn behind thereafter — the same
 *     basis the budget gate uses, so the cap never diverges from it; the lag
 *     only makes the early-run cap marginally generous and self-corrects).
 *   - `turnsLeft` = `budgetMaxTurns − runTurnsConsumed` when a turn budget is
 *     also set (the two budgets cooperate), else `DEFAULT_AUTONOMOUS_TARGET_TURNS`.
 *
 * Floored at `MIN_AUTONOMOUS_CONTEXT_TOKENS` so a nearly-spent run still ships a
 * usable context for its final turn(s).
 *
 * @port-oracle-export — exported for the quilltap-v5 differential port harness
 * (the budget-math equivalence tests) and for unit coverage; do NOT strip the
 * `export` as unused.
 */
export function computeAutonomousContextCap(chat: ChatMetadataBase): number | undefined {
  if (chat.budgetMaxTokens == null) return undefined;
  const remaining = Math.max(0, chat.budgetMaxTokens - (chat.runTokensConsumed ?? 0));
  const turnsLeft = chat.budgetMaxTurns != null
    ? Math.max(1, chat.budgetMaxTurns - (chat.runTurnsConsumed ?? 0))
    : DEFAULT_AUTONOMOUS_TARGET_TURNS;
  return Math.max(MIN_AUTONOMOUS_CONTEXT_TOKENS, Math.floor(remaining / turnsLeft));
}

// ---------------------------------------------------------------------------
// Pacing milestones. As a run approaches its budget the Host nudges the room
// — once at the halfway mark, once at 10% remaining — so the characters can
// pace themselves and wrap up gracefully before the run stops. We track which
// milestones have fired with a bitmask on the chat row (reset at run start),
// so each fires exactly once even though the budget is only sampled at turn
// boundaries.
// ---------------------------------------------------------------------------

const MILESTONE_HALFWAY = 1; // bit 0
const MILESTONE_NEAR_END = 2; // bit 1
const MILESTONE_GRACE = 4; // bit 2 — a one-turn grace round was granted (budget reached without a near-end warning)
const HALFWAY_THRESHOLD = 0.5;
const NEAR_END_THRESHOLD = 0.9; // 10% of the budget remaining

// Host-voiced + persona-free bodies for the grace round. When a run reaches its
// budget WITHOUT the near-end (90%) nudge ever having fired — a single turn can
// vault the entire [90%, 100%) band when per-turn spend exceeds 10% of a small
// budget — the company never got their "wrap up" warning. Rather than cut them
// off mid-thought, the Host grants one last turn over budget so the scene can
// close gracefully. If the near-end nudge DID fire, they were already warned and
// no grace turn is given.
const GRACE_CONTENT =
  'The Host rises with a rueful smile: we have, in candour, run past the allowance set aside for this gathering — yet it would be the height of rudeness to cut a guest off mid-thought. Let there be one last word, and then we shall close.';
const GRACE_OPAQUE =
  'This conversation has reached its budget limit. You have one final turn to speak before it ends — say what most needs saying and bring the present scene to a graceful close.';

// @port-oracle-export — exported only because it appears in the return-type
// signature of the oracle-exported `computeBudgetProgress` (a private name there
// breaks `tsc --declaration`). It is also used internally, so a cleanup may be
// tempted to drop just the `export` keyword — don't: that re-breaks the
// declaration emit the port harness depends on. See @port-oracle-export above.
export type MilestoneBinding = 'time' | 'turns' | 'tokens' | 'daily';

/**
 * How far the current run has progressed toward its *binding* budget — the cap
 * closest to exhaustion, which will halt the run first. Considers the three
 * per-run room caps (turns / tokens / wall-clock) and the cross-room daily
 * user-token cap. Returns null when none is configured (nothing to count down
 * toward).
 *
 * The daily cap differs in outcome: it *pauses* the room (it resumes after the
 * cap rolls over) rather than ending the run. `buildMilestoneMessage` phrases
 * the nudge accordingly — the characters are still told to finish up, just
 * that the gathering will reconvene rather than close for good. The spend cap
 * is not counted: it is not enforced in the run loop today.
 *
 * On a tie the per-run caps win (they are considered first), so an "ending"
 * nudge is preferred over a "pausing" one when both are equally close.
 *
 * @port-oracle-export — exported solely for the quilltap-v5 differential port
 * harness (quilltap-v5/harness/oracle/cases/enclave-budget.ts), which imports
 * the REAL function to check the Rust port against. Has no other importer in
 * this repo; do NOT delete the `export` as unused — it would break the
 * equivalence test guarding the budget-math port.
 */
export function computeBudgetProgress(
  chat: Pick<
    ChatMetadataBase,
    'budgetMaxTurns' | 'budgetMaxTokens' | 'budgetMaxWallClockMs' | 'runStartedAt' | 'runPausedAccumMs'
  >,
  turnsConsumed: number,
  tokensConsumed: number,
  now: number,
  daily: { budget: number | null; spent: number },
): { fraction: number; binding: MilestoneBinding } | null {
  let best: { fraction: number; binding: MilestoneBinding } | null = null;
  const consider = (fraction: number, binding: MilestoneBinding) => {
    if (!Number.isFinite(fraction) || fraction < 0) return;
    if (!best || fraction > best.fraction) best = { fraction, binding };
  };
  if (chat.budgetMaxTurns != null && chat.budgetMaxTurns > 0) {
    consider(turnsConsumed / chat.budgetMaxTurns, 'turns');
  }
  if (chat.budgetMaxTokens != null && chat.budgetMaxTokens > 0) {
    consider(tokensConsumed / chat.budgetMaxTokens, 'tokens');
  }
  if (chat.budgetMaxWallClockMs != null && chat.budgetMaxWallClockMs > 0 && chat.runStartedAt) {
    const elapsed = now - Date.parse(chat.runStartedAt) - (chat.runPausedAccumMs ?? 0);
    consider(elapsed / chat.budgetMaxWallClockMs, 'time');
  }
  if (daily.budget != null && daily.budget > 0) {
    consider(daily.spent / daily.budget, 'daily');
  }
  return best;
}

/**
 * Per-binding phrasing for the pacing nudges. `hostHalf` / `hostEnd` are the
 * Host-voiced fragments (steampunk-Wodehouse register); `opaqueNoun` is the
 * neutral noun used in the persona-free body that steers the characters in
 * opaque-anywhere rooms. `pauses` marks budgets that *pause* the room rather
 * than end the run — the near-end nudge tells those characters they must stop
 * for now and will reconvene, not that the gathering closes for good.
 */
const MILESTONE_BINDING_PHRASE: Record<MilestoneBinding, {
  hostHalf: string;
  hostEnd: string;
  opaqueNoun: string;
  pauses: boolean;
}> = {
  time: {
    hostHalf: 'the time allotted to this gathering',
    hostEnd: 'our time together',
    opaqueNoun: 'allotted time',
    pauses: false,
  },
  turns: {
    hostHalf: 'the exchanges allotted to this gathering',
    hostEnd: 'the exchanges allotted to us',
    opaqueNoun: 'allotted exchanges',
    pauses: false,
  },
  tokens: {
    hostHalf: 'the allowance set aside for this gathering',
    hostEnd: "the gathering's allowance",
    opaqueNoun: 'allotted length',
    pauses: false,
  },
  daily: {
    hostHalf: "the day's shared allowance",
    hostEnd: "the day's allowance",
    opaqueNoun: 'allowance for the day',
    pauses: true,
  },
};

/**
 * Compose the Host-voiced + persona-free bodies (and the `systemKind`) for a
 * pacing milestone, phrased around whichever budget is binding. A binding that
 * *pauses* the room (the daily cap) is framed as "finish for now, we shall
 * reconvene" rather than a final close.
 */
function buildMilestoneMessage(
  binding: MilestoneBinding,
  milestone: 'halfway' | 'near-end',
): { content: string; opaqueContent: string; systemKind: AutonomousRoomKind } {
  const phrase = MILESTONE_BINDING_PHRASE[binding];
  if (milestone === 'halfway') {
    return {
      systemKind: 'autonomous-room-halfway',
      content: `The Host raps a crystal glass for attention: we have reached the midpoint of ${phrase.hostHalf}. There is room yet — but let the conversation begin to find its way toward what matters most.`,
      opaqueContent: `This conversation is halfway through its ${phrase.opaqueNoun}. Continue naturally, but begin steering toward what matters most before it ${phrase.pauses ? 'pauses' : 'ends'}.`,
    };
  }
  if (phrase.pauses) {
    return {
      systemKind: 'autonomous-room-nearing-end',
      content: `The Host consults a pocket-watch and clears their throat: ${phrase.hostEnd} is nearly spent, and this gathering must soon pause for the day. Finish now what most needs saying — the company shall reconvene when the allowance comes round again.`,
      opaqueContent: `This conversation is almost out of its ${phrase.opaqueNoun} and will pause shortly — it will resume later, but not before stopping for now. Say what most needs to be said, and bring the present scene to a close.`,
    };
  }
  return {
    systemKind: 'autonomous-room-nearing-end',
    content: `The Host consults a pocket-watch and clears their throat: ${phrase.hostEnd} is nearly spent, and this gathering must soon draw to a close. Say now what most needs saying, and bring your threads to a graceful rest.`,
    opaqueContent: `This conversation is almost out of its ${phrase.opaqueNoun} and will end soon. Say what most needs to be said, and begin bringing the scene to a close.`,
  };
}

/**
 * Drain `handleSendMessage`'s stream. Autonomous-room turns don't have a
 * client listening; the bytes are persisted via the orchestrator's internal
 * `processMessage` writes, and the stream is just SSE for the UI.
 */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

async function transitionRunState(
  chatId: string,
  to: AutonomousRunState,
  extra: Partial<{
    runStateMessage: string | null;
    runEndedAt: string | null;
    runStartedAt: string | null;
    runPausedAt: string | null;
    runTurnsConsumed: number;
    runTokensConsumed: number;
    runMilestonesAnnounced: number;
    scheduleNextRunAt: string | null;
  }> = {},
): Promise<void> {
  const repos = getRepositories();
  await repos.chats.update(chatId, {
    runState: to,
    ...extra,
  } as unknown as Partial<ChatMetadataBase>);
}

/**
 * Compute the next cron occurrence strictly after the given anchor time.
 * Returns null if the cron is missing or invalid — the caller treats null as
 * "leave scheduleNextRunAt where it is" so a misconfigured cron does not
 * accidentally clear the timestamp.
 */
function recomputeNextRun(cronExpr: string | null | undefined, anchor: Date): string | null {
  if (!cronExpr) return null;
  try {
    const next = new Cron(cronExpr).nextRun(anchor);
    return next ? next.toISOString() : null;
  } catch (error) {
    logger.warn('Autonomous-room: invalid cron expression at run end', {
      context: HANDLER,
      cronExpr,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Grant a single grace turn: record the grace bit, have the Host invite a final
 * word, and re-enqueue one more turn — without ending the run. Used at either
 * budget checkpoint when the run has reached its budget but the near-end nudge
 * never fired. The granted turn runs over budget (the pre-turn check lets it
 * through because the grace bit is set) and then ends cleanly at its own
 * post-turn check. Exactly one grace turn is ever granted per run, since the
 * bit is checked before granting.
 */
async function grantGraceTurn(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  runId: string,
  currentMask: number,
): Promise<void> {
  logger.info('Autonomous-room turn: budget reached without a near-end warning; granting one grace turn', {
    context: HANDLER, chatId, runId,
  });
  await repos.chats.update(chatId, {
    runMilestonesAnnounced: currentMask | MILESTONE_GRACE,
  } as unknown as Partial<ChatMetadataBase>);
  await postAutonomousRoomAnnouncement(chatId, 'autonomous-room-grace', GRACE_CONTENT, GRACE_OPAQUE);
  await enqueueAutonomousRoomTurn(userId, { chatId, runId });
}

export async function handleAutonomousRoomTurn(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as AutonomousRoomTurnPayload;
  const { chatId, runId } = payload;
  const userId = job.userId;
  const repos = getRepositories();

  // 1. Resolve chat
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    logger.warn('Autonomous-room turn: chat not found, exiting', {
      context: HANDLER, chatId, runId,
    });
    return;
  }
  if (chat.chatType !== 'autonomous') {
    logger.info('Autonomous-room turn: chat is not autonomous, exiting', {
      context: HANDLER, chatId, chatType: chat.chatType,
    });
    return;
  }

  // 2. Stale-run guard
  if (chat.currentRunId !== runId) {
    logger.info('Autonomous-room turn: stale_run_job (superseded by a newer run)', {
      context: HANDLER, chatId, payloadRunId: runId, currentRunId: chat.currentRunId,
    });
    return;
  }

  // 2a. Concurrency guard. The stale-run guard above only catches jobs whose
  // `runId` was *displaced* by a newer run. It does NOT catch the case where
  // two AUTONOMOUS_ROOM_TURN jobs end up PROCESSING in parallel with the same
  // `runId` — which can happen if the dispatcher's stuck-job sweep
  // (lib/background-jobs/host/job-dispatcher.ts, default 10-min timeout) flips
  // a hung PROCESSING job back to PENDING and the dispatcher then re-claims
  // it while the original handler is still alive in another child. With the
  // singleTurn fix that lands in 43e8ce35, individual turns are short enough
  // that this is very unlikely, but it's cheap insurance against future
  // regressions or unusually long single-turn LLM stalls.
  //
  // Resolution: if there's another PROCESSING AUTONOMOUS_ROOM_TURN for this
  // chat with an earlier (createdAt, id) than mine, yield to it. The
  // tie-break on id makes the decision deterministic when createdAt collides
  // at millisecond resolution, so exactly one of the two siblings proceeds.
  const inFlight = await repos.backgroundJobs.findPendingForChat(chatId);
  const concurrentSiblings = inFlight.filter(
    (j) => j.type === 'AUTONOMOUS_ROOM_TURN' && j.id !== job.id && j.status === 'PROCESSING',
  );
  const elderSibling = concurrentSiblings.find((j) => {
    if (j.createdAt < job.createdAt) return true;
    if (j.createdAt > job.createdAt) return false;
    return j.id < job.id;
  });
  if (elderSibling) {
    logger.info('Autonomous-room turn: concurrent sibling already PROCESSING, yielding', {
      context: HANDLER,
      chatId,
      runId,
      myJobId: job.id,
      elderJobId: elderSibling.id,
      elderCreatedAt: elderSibling.createdAt,
      myCreatedAt: job.createdAt,
    });
    return;
  }

  // 3. Lifecycle entry
  if (chat.runState === 'paused' || chat.runState === 'stopped'
   || chat.runState === 'budgetExhausted' || chat.runState === 'error') {
    logger.info('Autonomous-room turn: run not active, exiting', {
      context: HANDLER, chatId, runState: chat.runState,
    });
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (chat.runState == null || chat.runState === 'idle') {
    // Defensive idle→running fallback. The run-start contract now flips the row
    // straight to `running` at request time — synchronously in the parent for a
    // manual start (startAutonomousRoomManually), in the schedule-tick batch for
    // a scheduled run — so the badge/header reflect the live status the moment
    // the run is requested. A turn job therefore normally finds the row already
    // `running` and skips this block. We keep the fallback for the only paths
    // that can still hand us an `idle` row: a turn job enqueued by a pre-upgrade
    // build that wrote `idle`, or any future caller that forgets the contract.
    //
    // The model-availability precondition for individual participants is
    // enforced by the connection-profile resolution path inside
    // handleSendMessage; an unavailable model surfaces as a turn error this
    // handler classifies as 'error'.
    await transitionRunState(chatId, 'running', {
      runStartedAt: nowIso,
      runEndedAt: null,
      runStateMessage: null,
      runTurnsConsumed: 0,
      runTokensConsumed: 0,
      runMilestonesAnnounced: 0,
    });
    chat.runState = 'running';
    chat.runStartedAt = nowIso;
    chat.runTurnsConsumed = 0;
    chat.runTokensConsumed = 0;
    chat.runMilestonesAnnounced = 0;

    await postRunStartAnnouncement(chatId, runId, chat);
  }

  // 4. Pre-turn budget check
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const dailyTokenBudget = chatSettings?.autonomousRoomSettings?.dailyTokenBudget ?? null;
  let dailyTokensSpent = 0;
  if (dailyTokenBudget != null) {
    const since = lastLocalMidnightIso(now);
    const usage = await repos.llmLogs.getTotalTokenUsageSince(userId, since);
    dailyTokensSpent = usage.totalTokens;
  }

  const budget = checkBudget(chat, now, { dailyTokenBudget, dailyTokensSpent });
  if (budget.exhausted) {
    const mask = chat.runMilestonesAnnounced ?? 0;
    if ((mask & MILESTONE_GRACE) !== 0) {
      // This is the granted grace turn: let it run one last time even though
      // the budget is spent. The post-turn check (step 9) sees the grace bit
      // and ends the run cleanly once this final word is delivered.
      logger.info('Autonomous-room turn: proceeding with grace turn (over budget, one last word)', {
        context: HANDLER, chatId, runId, reason: budget.reason,
      });
      // fall through — do NOT end here
    } else if ((mask & MILESTONE_NEAR_END) !== 0) {
      // The company already had their near-end warning, so end now.
      logger.info('Autonomous-room turn: budget exhausted before turn', {
        context: HANDLER, chatId, reason: budget.reason, dailyTokensSpent, dailyTokenBudget,
      });
      const nextRunIso = recomputeNextRun(chat.scheduleCron, new Date(now));
      await transitionRunState(chatId, budget.nextState, {
        runEndedAt: nowIso,
        runStateMessage: `budget:${budget.reason}`,
        // A daily-cap pause may be manually resumed before the cap rolls over;
        // stamp runPausedAt so that resume can exclude the paused interval from
        // the wall-clock budget the same way a manual pause does.
        ...(budget.nextState === 'paused' ? { runPausedAt: nowIso } : {}),
        ...(nextRunIso ? { scheduleNextRunAt: nextRunIso } : {}),
      });
      const kind = budget.nextState === 'paused' ? 'autonomous-room-paused' : 'autonomous-room-end';
      const reasonText = budget.reason === 'tokens_user_daily'
        ? `Daily user-token budget reached. The room will resume when the budget rolls over (instance-local midnight).`
        : `Budget exhausted (reason: ${budget.reason}).`;
      await postAutonomousRoomAnnouncement(chatId, kind, reasonText);
      return;
    } else {
      // Budget reached without a near-end warning ever firing — grant one
      // grace turn so the company gets a final word before the run closes.
      await grantGraceTurn(repos, chatId, userId, runId, mask);
      return;
    }
  }

  // 5. Speaker selection
  const activeParticipants = getActiveCharacterParticipants(chat.participants);
  const charactersMap = new Map<string, Character>();
  for (const p of activeParticipants) {
    if (p.characterId) {
      const char = await repos.characters.findById(p.characterId);
      if (char) charactersMap.set(p.characterId, char);
    }
  }
  const messages = await repos.chats.getMessages(chatId);
  const messageEvents = messages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message',
  ) as unknown as MessageEvent[];
  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    // Autonomous rooms have no user participant by definition.
    userParticipantId: null,
    spokenThisCycleParticipantIds: chat.spokenThisCycleParticipantIds,
  });
  const selection = selectNextSpeaker(chat.participants, charactersMap, turnState, null);

  if (!selection.nextSpeakerId) {
    logger.warn('Autonomous-room turn: no eligible speaker', {
      context: HANDLER, chatId, reason: selection.reason,
    });
    await transitionRunState(chatId, 'error', {
      runEndedAt: nowIso,
      runStateMessage: `no_eligible_speaker:${selection.reason}`,
    });
    return;
  }

  const respondingParticipantId = selection.nextSpeakerId;

  // 6 / 7. Invoke the ordinary message pipeline with the autonomous-room flags.
  let turnSucceeded = false;
  try {
    // Wrap the whole turn (generation + stream drain) in the autonomous-run
    // context so every llm_logs row written during it — the turn itself plus
    // any agent-mode tool sub-calls — is tagged with this run's id for
    // per-run budget accounting. Streaming generation and its persistence can
    // happen as the stream is drained, so drainStream stays inside the scope.
    await runWithAutonomousRunId(runId, async () => {
      const stream = await handleSendMessage(repos, chatId, userId, {
        continueMode: true,
        respondingParticipantId,
        neverPauseForUser: true,
        suppressAutomaticImages: true,
        // One job = one character turn. The forked job child buffers writes
        // in AsyncLocalStorage until the job ends; without singleTurn the
        // turn-chain loops up to depth-20 on a single job and every iteration
        // of `shouldChainNext` re-reads the same pre-job message history,
        // re-picking the same speaker (Friday → Friday → Friday → …) and
        // bypassing this handler's per-turn budget check. We re-enqueue at
        // the end of this function instead.
        singleTurn: true,
        // Pace a token-budgeted room: cap this turn's context budget at its
        // slice of the per-run token budget (`remaining / turnsLeft`) so a
        // big-context model doesn't spend most of the run on one turn. Computed
        // off the local `chat` snapshot (reset to 0 at run start). Undefined
        // for rooms without a token budget → unchanged behavior.
        autonomousContextCap: computeAutonomousContextCap(chat),
      });
      await drainStream(stream);
    });
    turnSucceeded = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Autonomous-room turn: handleSendMessage failed', {
      context: HANDLER, chatId, runId, respondingParticipantId, error: errorMessage,
    });
    await transitionRunState(chatId, 'error', {
      runEndedAt: new Date().toISOString(),
      runStateMessage: `turn_error:${errorMessage}`,
    });
    return;
  }

  if (!turnSucceeded) {
    return;
  }

  // 8. Post-turn bookkeeping. Re-read the chat to run the stale-run guard
  //    against fresh DB state; for the actual counter values we deliberately
  //    do NOT use `post.run{Turns,Tokens}Consumed`, but the local `chat`
  //    snapshot. The reason is the forked-job child's repo proxy buffers writes
  //    in AsyncLocalStorage and serves reads from a readonly DB connection.
  //    The local `chat` is the only reliable post-reset view of the counter in
  //    every case:
  //      - Fresh run (the normal path): the run-start contract committed
  //        `runTurnsConsumed: 0` upstream (the parent for a manual start, the
  //        schedule-tick batch for a scheduled run) BEFORE this turn job ran,
  //        so the initial `findById` above already read 0 into `chat`.
  //      - Legacy idle→running fallback: the `runTurnsConsumed: 0` reset is
  //        issued by THIS child via transitionRunState and is still pending in
  //        the write buffer, so `post` reads the *previous* run's stale value
  //        off the readonly DB while the locally-mutated `chat` reads 0.
  //      - Resumed run: the contract left the counters untouched, so `chat`
  //        carries the genuine pre-pause count.
  //    A read-modify-write off `post` would, in the fallback case, pick up the
  //    previous run's stale value; the write we then queue lands after the
  //    reset at flush time and clobbers it ("last write wins"), so the counter
  //    would accumulate across runs forever and a room with `budgetMaxTurns`
  //    set would trip `budgetExhausted` after a single message on a later run.
  const post = await repos.chats.findById(chatId);
  if (!post || post.currentRunId !== runId) {
    logger.info('Autonomous-room turn: superseded during turn, not re-enqueueing', {
      context: HANDLER, chatId, runId,
    });
    return;
  }

  // Token accounting: sum the llm_logs rows tagged with this run's id (done
  // via the autonomous-run AsyncLocalStorage wrapped around the turn above).
  // This isolates the run's own turn spend — conversational turns plus their
  // agent-mode sub-calls — and excludes overlapping chat activity and
  // fire-and-forget auxiliary jobs (memory/scene/danger/title/summary), which
  // the old timestamp-window sum wrongly folded in. The sum still runs one
  // turn behind because this turn's rows are buffered in the job child until
  // it flushes; Math.max keeps the counter monotonic so a transient
  // read-zero can't un-exhaust the run.
  //
  // Cache-read (prompt-cache hit) tokens are excluded from this sum by default:
  // the provider plugins subtract them from `usage.totalTokens` at the source
  // (each provider's convention differs), so cached input never counts against
  // the budget. See the per-plugin usage normalization in plugins/dist/*.
  //
  // A room can opt into counting every token (the pre-normalization behavior)
  // by setting `budgetExcludeCacheHits = 0` at creation; in that mode the
  // repository adds the stripped cache reads back from `cacheUsage`.
  const includeCacheHits = (chat.budgetExcludeCacheHits ?? 1) === 0;
  const runUsage = await repos.llmLogs.getTotalTokenUsageForRun(runId, { includeCacheHits });
  // The monotonic floor is the local `chat` snapshot — 0 for a fresh run
  // (committed upstream by the run-start contract, or mutated to 0 in the
  // legacy idle→running fallback) or the preserved count for a resumed run —
  // NOT the re-read `post`. See the long comment above for why `post` is unsafe
  // in the fallback case (its `runTokensConsumed` reads the previous run's
  // stale total off the readonly DB while the reset is still buffered).
  const newTokensConsumed = Math.max(runUsage.totalTokens, chat.runTokensConsumed ?? 0);

  // Turn accounting: increment off the local `chat` snapshot (0 for a fresh
  // run, preserved count for a resumed run), not the re-read `post`. See the
  // long comment above.
  const newTurnsConsumed = (chat.runTurnsConsumed ?? 0) + 1;

  await repos.chats.update(chatId, {
    runTurnsConsumed: newTurnsConsumed,
    runTokensConsumed: newTokensConsumed,
  } as unknown as Partial<ChatMetadataBase>);

  // 9. End-of-run check
  const postCheck = await repos.chats.findById(chatId);
  if (!postCheck || postCheck.currentRunId !== runId) {
    return;
  }
  let postDailySpent = 0;
  if (dailyTokenBudget != null) {
    const since = lastLocalMidnightIso(Date.now());
    const usage = await repos.llmLogs.getTotalTokenUsageSince(userId, since);
    postDailySpent = usage.totalTokens;
  }
  // Pass the freshly-computed counter values into the budget check rather
  // than `postCheck.run{Turns,Tokens}Consumed` — the update we just queued
  // is still in the buffer, so the re-read sees the previous turn's value
  // and would miss budget exhaustion that just happened this turn.
  //
  // Same buffered-read hazard applies to the wall-clock anchor: on the first
  // turn of a fresh run the idle → running reset wrote `runStartedAt = now`,
  // but that write is still buffered, so `postCheck.runStartedAt` reads the
  // *previous* run's start from the readonly DB. Left unpinned, a wall-clock-
  // budgeted room on its 2nd-or-later run would compute a huge elapsed and
  // falsely exhaust after a single turn. The local `chat` snapshot carries the
  // authoritative start (mutated on the reset) and paused-accumulator, so pin
  // both from it — exactly as the turn/token counters are pinned above.
  const verdict = checkBudget(
    {
      ...postCheck,
      runStartedAt: chat.runStartedAt,
      runPausedAccumMs: chat.runPausedAccumMs,
      runTurnsConsumed: newTurnsConsumed,
      runTokensConsumed: newTokensConsumed,
    },
    Date.now(),
    { dailyTokenBudget, dailyTokensSpent: postDailySpent },
  );
  if (verdict.exhausted) {
    const mask = chat.runMilestonesAnnounced ?? 0;
    if ((mask & MILESTONE_GRACE) === 0 && (mask & MILESTONE_NEAR_END) === 0) {
      // Reached budget this turn without a near-end warning ever firing (a
      // single turn vaulted the [90%, 100%) band). Grant one grace turn so the
      // company gets a final word; this turn's own post-turn check will end the
      // run once the grace bit is set.
      await grantGraceTurn(repos, chatId, userId, runId, mask);
      return;
    }
    // Either the grace turn just completed (grace bit set), or the near-end
    // warning already fired earlier in the run — end now.
    logger.info('Autonomous-room turn: run exhausted post-turn', {
      context: HANDLER, chatId, reason: verdict.reason, turns: newTurnsConsumed, tokens: newTokensConsumed,
    });
    const endNow = new Date();
    const nextRunIso = recomputeNextRun(postCheck.scheduleCron, endNow);
    await transitionRunState(chatId, verdict.nextState, {
      runEndedAt: endNow.toISOString(),
      runStateMessage: `budget:${verdict.reason}`,
      ...(nextRunIso ? { scheduleNextRunAt: nextRunIso } : {}),
    });
    const kind = verdict.nextState === 'paused' ? 'autonomous-room-paused' : 'autonomous-room-end';
    const elapsedMs = postCheck.runStartedAt ? Date.now() - Date.parse(postCheck.runStartedAt) : 0;
    const reasonText = verdict.reason === 'tokens_user_daily'
      ? `Daily user-token budget reached after ${newTurnsConsumed} turn(s) and ${newTokensConsumed.toLocaleString()} token(s). The room will resume when the budget rolls over.`
      : `Autonomous run ended. Reason: ${verdict.reason}. ${newTurnsConsumed} turn(s), ${newTokensConsumed.toLocaleString()} token(s), ${Math.round(elapsedMs / 1000)}s elapsed.`;
    await postAutonomousRoomAnnouncement(chatId, kind, reasonText);
    return;
  }

  // 9b. Pacing milestones. The run is continuing (it did not exhaust above), so
  //     check whether the binding budget has just crossed the halfway or
  //     near-end mark and, if so, have the Host nudge the room. Each milestone
  //     fires at most once per run, tracked by a bitmask reset at run start.
  //     The per-run inputs come off the local `chat` snapshot — the bitmask,
  //     the budget caps, and the wall-clock anchor (`runStartedAt` /
  //     `runPausedAccumMs`) — for the same buffered-write reason the turn
  //     counter does: `postCheck` re-reads the readonly DB and would miss the
  //     idle → running reset still pending in the job child's write buffer. The
  //     cross-room daily cap is passed separately (it lives in llm_logs, not on
  //     the chat row); a binding daily cap yields a "pause for now" nudge.
  const progress = computeBudgetProgress(
    chat,
    newTurnsConsumed,
    newTokensConsumed,
    Date.now(),
    { budget: dailyTokenBudget, spent: postDailySpent },
  );
  if (progress) {
    const mask = chat.runMilestonesAnnounced ?? 0;
    let fire: { milestone: 'halfway' | 'near-end'; nextMask: number } | null = null;
    if (progress.fraction >= NEAR_END_THRESHOLD && (mask & MILESTONE_NEAR_END) === 0) {
      // A single long turn can vault straight past the halfway mark; fire only
      // the (more urgent) near-end nudge, but record both bits so the now-moot
      // halfway nudge never fires after it.
      fire = { milestone: 'near-end', nextMask: mask | MILESTONE_NEAR_END | MILESTONE_HALFWAY };
    } else if (progress.fraction >= HALFWAY_THRESHOLD && (mask & MILESTONE_HALFWAY) === 0) {
      fire = { milestone: 'halfway', nextMask: mask | MILESTONE_HALFWAY };
    }
    if (fire) {
      logger.info('Autonomous-room turn: pacing milestone reached', {
        context: HANDLER, chatId, runId,
        milestone: fire.milestone, binding: progress.binding,
        fraction: Number(progress.fraction.toFixed(3)),
      });
      await repos.chats.update(chatId, {
        runMilestonesAnnounced: fire.nextMask,
      } as unknown as Partial<ChatMetadataBase>);
      chat.runMilestonesAnnounced = fire.nextMask;
      const { content, opaqueContent, systemKind } = buildMilestoneMessage(progress.binding, fire.milestone);
      await postAutonomousRoomAnnouncement(chatId, systemKind, content, opaqueContent);
    }
  }

  // 9c. Context-summary fold. Run it HERE — outside the runWithAutonomousRunId
  //     scope (which exited when the generation block above returned) and
  //     before re-enqueueing the next turn. Two reasons this can't live in the
  //     ordinary finalize path for autonomous rooms:
  //       - Awaited (not fire-and-forget): the finalizer's fire-and-forget fold
  //         settles after the forked-child write-buffer flush, so its writes
  //         (the advancing fold anchor + summary whisper) are silently dropped.
  //         Awaiting it inline keeps those writes in the buffer that ships to
  //         the parent at job end.
  //       - Untagged: because the autonomous-run-id scope has already exited,
  //         getAutonomousRunId() is null here, so the fold's cheap-LLM call is
  //         NOT billed against the per-run token budget (housekeeping, not turn
  //         spend). The next turn then sees the freshly compacted room.
  //     Best-effort: a fold failure must never wedge the run, so it's caught.
  if (chatSettings?.cheapLLMSettings) {
    try {
      const availableProfiles = await repos.connections.findByUserId(userId);
      const respondingParticipant = chat.participants.find((p) => p.id === respondingParticipantId);
      const foldProfile =
        availableProfiles.find((p) => p.id === respondingParticipant?.connectionProfileId)
        ?? availableProfiles.find((p) => p.isDefault)
        ?? availableProfiles[0];
      if (foldProfile) {
        await checkAndGenerateSummaryIfNeeded(
          chatId,
          foldProfile.provider,
          foldProfile.modelName,
          userId,
          foldProfile,
          chatSettings.cheapLLMSettings,
          availableProfiles,
          { awaitFold: true },
        );
      }
    } catch (error) {
      logger.warn('Autonomous-room turn: context-summary fold failed (continuing)', {
        context: HANDLER, chatId, runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Loop continues — enqueue the next turn.
  await enqueueAutonomousRoomTurn(userId, { chatId, runId });
}
