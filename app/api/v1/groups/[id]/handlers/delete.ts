/**
 * Groups API v1 - DELETE Handler
 *
 * DELETE /api/v1/groups/[id] - Delete group
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove character from group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleDeleteGroup,
  handleRemoveMember,
  handleResetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const GROUP_DELETE_ACTIONS = ['removeMember', 'reset-state'] as const;
type GroupDeleteAction = typeof GROUP_DELETE_ACTIONS[number];

/**
 * DELETE handler for individual group
 */
export async function handleDelete(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, GROUP_DELETE_ACTIONS)) {
    return handleDeleteGroup(groupId, ctx);
  }

  const actionHandlers: Record<GroupDeleteAction, () => Promise<NextResponse>> = {
    removeMember: () => handleRemoveMember(req, groupId, ctx),
    'reset-state': () => handleResetState(groupId, ctx),
  };

  return actionHandlers[action]();
}
