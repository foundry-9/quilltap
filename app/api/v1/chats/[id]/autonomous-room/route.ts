/**
 * Autonomous Room API v1 (4.6 Private Character Rooms)
 *
 * Manual run-control surface for `chatType: 'autonomous'` rooms. The Salon
 * UI's autonomous-room management list and the per-room control bar both
 * dispatch through this endpoint.
 *
 * POST /api/v1/chats/[id]/autonomous-room?action=start
 *   - Manually start a run. Refuses when runState === 'running'.
 * POST /api/v1/chats/[id]/autonomous-room?action=pause
 *   - Pause the current run. The next scheduled tick re-evaluates.
 * POST /api/v1/chats/[id]/autonomous-room?action=stop
 *   - Stop the current run. Bumps currentRunId so any queued turn job
 *     exits via the stale-run guard.
 * POST /api/v1/chats/[id]/autonomous-room?action=resume
 *   - Equivalent to start; convenience for paused / budgetExhausted rooms.
 * POST /api/v1/chats/[id]/autonomous-room?action=update-settings
 *   - Edit the room's schedule / budget caps / visibility / destructive-tool
 *     authorization / title. Applies to the live run on its next turn and
 *     becomes the settings for future runs. Recomputes scheduleNextRunAt when
 *     the cron changes; rejects an invalid cron with 400.
 *
 * GET  /api/v1/chats/[id]/autonomous-room
 *   - Read run status snapshot for the management UI.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createContextParamsHandler,
  type RequestContext,
} from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import {
  badRequest,
  notFound,
  successResponse,
  serverError,
  validationError,
} from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  startAutonomousRoomManually,
  pauseAutonomousRoom,
  resumeAutonomousRoom,
  stopAutonomousRoom,
  updateAutonomousRoomSettings,
} from '@/lib/services/chat-message/autonomous-room.service';

const HANDLER = 'api.v1.chats.autonomous-room';

/**
 * Editable room settings. Mirrors the autonomous block of `createChatSchema`
 * (app/api/v1/chats/route.ts) for field names/types/ranges, but every cap and
 * the cron/visibility are `.nullish()` so the Edit Enclave modal can *clear* a
 * previously-set value (null), not just set or omit it. Values are in the same
 * units as the DB (milliseconds for the windows/caps); the modal converts
 * hours/minutes → ms before posting.
 */
const updateSettingsSchema = z.object({
  title: z.string().max(300).optional(),
  scheduleCron: z.string().max(120).nullish(),
  scheduleFreshnessWindowMs: z.number().int().positive().nullish(),
  budgetMaxTurns: z.number().int().positive().nullish(),
  budgetMaxTokens: z.number().int().positive().nullish(),
  budgetMaxWallClockMs: z.number().int().positive().nullish(),
  budgetEstimatedSpendCapUSD: z.number().positive().nullish(),
  runVisibility: z.enum(['owner_only', 'household', 'open']).nullish(),
  runDestructiveToolsAllowed: z.boolean().optional(),
  budgetExcludeCacheHits: z.boolean().optional(),
});

async function ensureAutonomousChat(
  ctx: RequestContext,
  chatId: string,
) {
  const chat = await ctx.repos.chats.findById(chatId);
  if (!chat) return { ok: false as const, response: notFound('Chat') };
  if (chat.chatType !== 'autonomous') {
    return {
      ok: false as const,
      response: badRequest('Chat is not an autonomous room'),
    };
  }
  return { ok: true as const, chat };
}

async function handleStart(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  try {
    const result = await startAutonomousRoomManually(id, ctx.user.id);
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return notFound('Chat');
      return badRequest(result.message);
    }
    return successResponse({ runId: result.runId, jobId: result.jobId });
  } catch (error) {
    logger.error('Manual autonomous-room start failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to start autonomous run');
  }
}

async function handlePause(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  try {
    const result = await pauseAutonomousRoom(id);
    if (!result.ok) return badRequest(result.message ?? 'Pause failed');
    return successResponse({ paused: true });
  } catch (error) {
    logger.error('Autonomous-room pause failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to pause autonomous run');
  }
}

async function handleStop(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  try {
    const result = await stopAutonomousRoom(id);
    if (!result.ok) return badRequest(result.message ?? 'Stop failed');
    return successResponse({ stopped: true });
  } catch (error) {
    logger.error('Autonomous-room stop failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to stop autonomous run');
  }
}

async function handleResume(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  try {
    const result = await resumeAutonomousRoom(id, ctx.user.id);
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return notFound('Chat');
      return badRequest(result.message);
    }
    return successResponse({ runId: result.runId, jobId: result.jobId });
  } catch (error) {
    logger.error('Autonomous-room resume failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to resume autonomous run');
  }
}

async function handleUpdateSettings(
  req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  const guard = await ensureAutonomousChat(ctx, id);
  if (!guard.ok) return guard.response;

  let parsed: z.infer<typeof updateSettingsSchema>;
  try {
    parsed = updateSettingsSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    return badRequest('Invalid request body');
  }

  try {
    const result = await updateAutonomousRoomSettings(id, ctx.user.id, parsed);
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return notFound('Chat');
      return badRequest(result.message);
    }
    return successResponse({ updated: true, clampedDestructive: result.clampedDestructive });
  } catch (error) {
    logger.error('Autonomous-room settings update failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to update autonomous-room settings');
  }
}

async function handleStatus(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
) {
  const guard = await ensureAutonomousChat(ctx, id);
  if (!guard.ok) return guard.response;
  const c = guard.chat as unknown as Record<string, unknown>;
  return successResponse({
    chatId: id,
    chatType: 'autonomous',
    runState: c.runState ?? null,
    currentRunId: c.currentRunId ?? null,
    runStateMessage: c.runStateMessage ?? null,
    runStartedAt: c.runStartedAt ?? null,
    runEndedAt: c.runEndedAt ?? null,
    runPausedAccumMs: c.runPausedAccumMs ?? 0,
    runTurnsConsumed: c.runTurnsConsumed ?? 0,
    runTokensConsumed: c.runTokensConsumed ?? 0,
    scheduleCron: c.scheduleCron ?? null,
    scheduleNextRunAt: c.scheduleNextRunAt ?? null,
    scheduleLastRunAt: c.scheduleLastRunAt ?? null,
    scheduleFreshnessWindowMs: c.scheduleFreshnessWindowMs ?? null,
    budgetMaxTurns: c.budgetMaxTurns ?? null,
    budgetMaxTokens: c.budgetMaxTokens ?? null,
    budgetMaxWallClockMs: c.budgetMaxWallClockMs ?? null,
    budgetEstimatedSpendCapUSD: c.budgetEstimatedSpendCapUSD ?? null,
    budgetExcludeCacheHits: c.budgetExcludeCacheHits ?? 1,
    runDestructiveToolsAllowed: c.runDestructiveToolsAllowed ?? 0,
    runVisibility: c.runVisibility ?? null,
  });
}

export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch({
    start: handleStart,
    pause: handlePause,
    stop: handleStop,
    resume: handleResume,
    'update-settings': handleUpdateSettings,
  }),
);

export const GET = createContextParamsHandler<{ id: string }>(
  withActionDispatch(
    {},
    handleStatus,
  ),
);
