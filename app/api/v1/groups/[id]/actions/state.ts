/**
 * Groups API v1 - State Actions
 *
 * GET    /api/v1/groups/[id]?action=get-state   - Get group state
 * PUT    /api/v1/groups/[id]?action=set-state   - Set group state
 * DELETE /api/v1/groups/[id]?action=reset-state - Reset group state to empty
 *
 * Groups are instance-global (no per-user ownership), so state mutations reuse
 * the shared handlers with an existence-only check — the chat pattern, NOT the
 * project pattern's `exists`. Unlike chats, a group has no parent tier
 * in the cascade at this endpoint, so `handleGetState` simply returns the
 * group's own state (the cascade merge happens on the chat get-state route).
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError, notFound } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { createResetStateHandler, createSetStateHandler } from '@/lib/api/state-handlers';

const STATE_CFG = {
  entityName: 'Group',
  idLogKey: 'groupId',
  selectRepo: (repos: RequestContext['repos']) => repos.groups,
} as const;

/**
 * Get a single group's own state (no parent tier at this endpoint).
 */
export async function handleGetState(
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    return NextResponse.json({
      success: true,
      state: (group.state ?? {}) as Record<string, unknown>,
    });
  } catch (error) {
    logger.error('[Groups v1] Error getting state', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get state');
  }
}

export const handleSetState = createSetStateHandler(STATE_CFG);
export const handleResetState = createResetStateHandler(STATE_CFG);
