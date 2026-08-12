/**
 * Home Dashboard Payload
 *
 * GET /api/v1/system/home
 *   - Returns the home dashboard data (greeting name, "continue last" chat id,
 *     recent chats, active projects, characters) for the client-rendered
 *     workspace home tab. The server-rendered `/` route computes the same
 *     payload directly via the shared service. See
 *     `docs/developer/features/tabbed-workspace.md`.
 */

import { NextRequest } from 'next/server';
import {
  createContextHandler,
  type RequestContext,
} from '@/lib/api/middleware';
import { successResponse, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getHomeData } from '@/lib/services/home-data.service';

const HANDLER = 'api.v1.system.home';

export const GET = createContextHandler(
  async (_req: NextRequest, ctx: RequestContext) => {
    try {
      const data = await getHomeData(ctx.repos, {
        userId: ctx.user.id,
        fallbackName: ctx.user.name ?? null,
      });
      return successResponse(data);
    } catch (error) {
      logger.error(`[${HANDLER}] failed to build home dashboard payload`, { error });
      return serverError('Failed to load the home dashboard');
    }
  }
);
