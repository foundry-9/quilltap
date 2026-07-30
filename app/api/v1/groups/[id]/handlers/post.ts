/**
 * Groups API v1 - POST Handler
 *
 * POST /api/v1/groups/[id]?action=addMember - Add character to group
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { badRequest } from '@/lib/api/responses';
import { handleAddMember } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const GROUP_POST_ACTIONS = ['addMember'] as const;
type GroupPostAction = typeof GROUP_POST_ACTIONS[number];

/**
 * POST handler for individual group
 */
export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!isValidAction(action, GROUP_POST_ACTIONS)) {
    return badRequest('Unknown action or missing action parameter');
  }

  const actionHandlers: Record<GroupPostAction, () => Promise<NextResponse>> = {
    addMember: () => handleAddMember(req, groupId, ctx),
  };

  return actionHandlers[action]();
}
