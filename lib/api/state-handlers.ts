/**
 * Shared factory for entity state-mutation route handlers
 * (`?action=set-state` / `?action=reset-state`).
 *
 * Both `app/api/v1/chats/[id]/actions/state.ts` and
 * `app/api/v1/projects/[id]/actions/state.ts` follow the same template:
 * look up the entity, confirm it exists, replace or clear the JSON `state`
 * column, and log. `handleGetState` stays bespoke per entity — chats merge in
 * their parent project's state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { exists } from '@/lib/api/middleware';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';

interface StatefulEntity {
  id: string;
  userId?: string;
  state?: Record<string, unknown> | null;
}

interface StatefulRepo {
  findById(id: string): Promise<StatefulEntity | null>;
  update(id: string, data: { state: Record<string, unknown> }): Promise<StatefulEntity | null>;
}

export interface StateHandlerConfig {
  /** Capitalized entity name for notFound + log tag (e.g. 'Chat', 'Project'). */
  entityName: string;
  /** Property name used in log payloads (e.g. 'chatId', 'projectId'). */
  idLogKey: string;
  /** Pick the right repo off `repos`. */
  selectRepo: (repos: RequestContext['repos']) => StatefulRepo;
}

/**
 * Body schema for `?action=set-state`. Either entity can override its own
 * schema by passing one to `createSetStateHandler`.
 */
export const stateBodySchema = z.object({
  state: z.record(z.string(), z.unknown()),
});

function requireEntity(
  entity: StatefulEntity | null,
  entityName: string,
): NextResponse | null {
  return exists(entity) ? null : notFound(entityName);
}

export function createSetStateHandler(cfg: StateHandlerConfig) {
  return async function handleSetState(
    req: NextRequest,
    entityId: string,
    { user, repos }: RequestContext,
  ): Promise<NextResponse> {
    const repo = cfg.selectRepo(repos);
    const entity = await repo.findById(entityId);
    const denied = requireEntity(entity, cfg.entityName);
    if (denied) return denied;

    const body = await req.json();
    const validated = stateBodySchema.parse(body);

    const updated = await repo.update(entityId, { state: validated.state });

    logger.info(`[${cfg.entityName}s v1] State updated`, {
      [cfg.idLogKey]: entityId,
      userId: user.id,
      stateKeys: Object.keys(validated.state),
    });

    return successResponse({
      success: true,
      state: updated?.state || validated.state,
    });
  };
}

export function createResetStateHandler(cfg: StateHandlerConfig) {
  return async function handleResetState(
    entityId: string,
    { user, repos }: RequestContext,
  ): Promise<NextResponse> {
    try {
      const repo = cfg.selectRepo(repos);
      const entity = await repo.findById(entityId);
      const denied = requireEntity(entity, cfg.entityName);
      if (denied) return denied;

      const previousState = (entity!.state || {}) as Record<string, unknown>;

      await repo.update(entityId, { state: {} });

      logger.info(`[${cfg.entityName}s v1] State reset`, {
        [cfg.idLogKey]: entityId,
        userId: user.id,
      });

      return successResponse({ success: true, previousState });
    } catch (error) {
      logger.error(
        `[${cfg.entityName}s v1] Error resetting state`,
        { [cfg.idLogKey]: entityId },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to reset state');
    }
  };
}
