/**
 * Groups API v1 - GET Handler
 *
 * GET /api/v1/groups/[id] - Get group details
 * GET /api/v1/groups/[id]?action=members - List member characters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleGetDefault,
  handleGetMembers,
  handleGetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const GROUP_GET_ACTIONS = ['members', 'get-state'] as const;
type GroupGetAction = typeof GROUP_GET_ACTIONS[number];

/**
 * GET handler for individual group
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, GROUP_GET_ACTIONS)) {
    return handleGetDefault(groupId, ctx);
  }

  const actionHandlers: Record<GroupGetAction, () => Promise<NextResponse>> = {
    members: () => handleGetMembers(groupId, ctx),
    'get-state': () => handleGetState(groupId, ctx),
  };

  return actionHandlers[action]();
}
