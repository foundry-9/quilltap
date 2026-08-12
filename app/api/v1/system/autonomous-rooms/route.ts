/**
 * Autonomous Rooms System Listing (4.6 Private Character Rooms)
 *
 * GET /api/v1/system/autonomous-rooms
 *   - List every autonomous room owned by the authenticated user, with
 *     enough context for the Settings → System management surface to
 *     render runState badges, last/next run, budgets-consumed, and route
 *     into the transcript on demand.
 */

import { NextRequest } from 'next/server';
import {
  createContextHandler,
  type RequestContext,
} from '@/lib/api/middleware';
import { successResponse, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

const HANDLER = 'api.v1.system.autonomous-rooms';

export const GET = createContextHandler(
  async (_req: NextRequest, ctx: RequestContext) => {
    try {
      const userChats = await ctx.repos.chats.findByUserId(ctx.user.id);
      const autonomousChats = userChats.filter((c) => c.chatType === 'autonomous');

      const projectIds = Array.from(
        new Set(
          autonomousChats
            .map((c) => (c as unknown as Record<string, unknown>).projectId)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      );
      const projectNameById = new Map<string, string>();
      for (const projectId of projectIds) {
        const project = await ctx.repos.projects.findById(projectId);
        if (project) projectNameById.set(projectId, project.name);
      }

      const rooms = autonomousChats.map((c) => {
        const cAny = c as unknown as Record<string, unknown>;
        const projectId =
          typeof cAny.projectId === 'string' && cAny.projectId.length > 0
            ? (cAny.projectId as string)
            : null;
        return {
          id: c.id,
          title: c.title,
          projectId,
          projectName: projectId ? projectNameById.get(projectId) ?? null : null,
          participants: c.participants.map((p) => ({
            id: p.id,
            type: p.type,
            characterId: p.characterId ?? null,
            status: p.status,
          })),
          runState: cAny.runState ?? null,
          runStateMessage: cAny.runStateMessage ?? null,
          currentRunId: cAny.currentRunId ?? null,
          runStartedAt: cAny.runStartedAt ?? null,
          runEndedAt: cAny.runEndedAt ?? null,
          runPausedAccumMs: cAny.runPausedAccumMs ?? 0,
          runTurnsConsumed: cAny.runTurnsConsumed ?? 0,
          runTokensConsumed: cAny.runTokensConsumed ?? 0,
          scheduleCron: cAny.scheduleCron ?? null,
          scheduleNextRunAt: cAny.scheduleNextRunAt ?? null,
          scheduleLastRunAt: cAny.scheduleLastRunAt ?? null,
          scheduleFreshnessWindowMs: cAny.scheduleFreshnessWindowMs ?? null,
          budgetMaxTurns: cAny.budgetMaxTurns ?? null,
          budgetMaxTokens: cAny.budgetMaxTokens ?? null,
          budgetMaxWallClockMs: cAny.budgetMaxWallClockMs ?? null,
          budgetEstimatedSpendCapUSD: cAny.budgetEstimatedSpendCapUSD ?? null,
          runDestructiveToolsAllowed: cAny.runDestructiveToolsAllowed ?? 0,
          runVisibility: cAny.runVisibility ?? null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      });
      // Stable sort: running first, then idle/paused/budgetExhausted, then
      // stopped/error; within each band, most recently updated first.
      const stateOrder: Record<string, number> = {
        running: 0,
        idle: 1,
        paused: 2,
        budgetExhausted: 3,
        stopped: 4,
        error: 5,
      };
      rooms.sort((a, b) => {
        const aOrder = stateOrder[a.runState as string] ?? 99;
        const bOrder = stateOrder[b.runState as string] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      });
      return successResponse({ rooms });
    } catch (error) {
      logger.error('Failed to list autonomous rooms', {
        context: HANDLER,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : undefined);
      return serverError('Failed to list autonomous rooms');
    }
  },
);
