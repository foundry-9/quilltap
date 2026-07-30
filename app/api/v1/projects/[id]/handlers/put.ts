/**
 * Projects API v1 - PUT Handler
 *
 * PUT /api/v1/projects/[id] - Update project
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { handlePutDefault, handleSetState, handlePutAesthetic } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const PROJECT_PUT_ACTIONS = ['set-state', 'aesthetic'] as const;
type ProjectPutAction = typeof PROJECT_PUT_ACTIONS[number];

/**
 * PUT handler for individual project
 */
export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, PROJECT_PUT_ACTIONS)) {
    return handlePutDefault(req, projectId, ctx);
  }

  const actionHandlers: Record<ProjectPutAction, () => Promise<NextResponse>> = {
    'set-state': () => handleSetState(req, projectId, ctx),
    'aesthetic': () => handlePutAesthetic(req, projectId, ctx),
  };

  return actionHandlers[action]();
}
