/**
 * General State Settings Routes (v1)
 *
 * GET    /api/v1/settings/general-state - Read instance-wide general state
 * PUT    /api/v1/settings/general-state - Replace instance-wide general state
 * DELETE /api/v1/settings/general-state - Reset general state to {}
 *
 * General state is the bottom tier of the four-tier state cascade
 * (chat → project → group → general). Unlike chat/project/group state there is
 * no entity row or repo — it lives as a `state.json` document at the root of
 * the singleton "Quilltap General" mount, provisioned idempotently at startup
 * (see `lib/mount-index/general-state.ts`). Hence this route is bespoke rather
 * than built on the shared entity state handlers.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, serverError, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { stateBodySchema } from '@/lib/api/state-handlers';
import { readGeneralState, writeGeneralState } from '@/lib/mount-index/general-state';

export const GET = createContextHandler(async () => {
  try {
    const state = await readGeneralState();
    return successResponse({ success: true, state });
  } catch (error) {
    logger.error('[Settings v1] Error reading general state', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to read general state');
  }
});

export const PUT = createContextHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = stateBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await writeGeneralState(parsed.data.state);
    logger.info('[Settings v1] General state updated (instance-wide)', {
      stateKeys: Object.keys(parsed.data.state),
    });
    return successResponse({ success: true, state: parsed.data.state });
  } catch (error) {
    logger.error('[Settings v1] Error updating general state', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to update general state');
  }
});

export const DELETE = createContextHandler(async () => {
  try {
    const previousState = await readGeneralState();
    await writeGeneralState({});
    logger.info('[Settings v1] General state reset (instance-wide)');
    return successResponse({ success: true, previousState });
  } catch (error) {
    logger.error('[Settings v1] Error resetting general state', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to reset general state');
  }
});
