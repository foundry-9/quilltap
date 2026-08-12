/**
 * Projects API v1 - DELETE Handler
 *
 * DELETE /api/v1/projects/[id] - Delete project
 * DELETE /api/v1/projects/[id]?action=remove-character - Remove character from roster
 * DELETE /api/v1/projects/[id]?action=remove-chat - Remove chat from project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleDeleteProject,
  handleRemoveCharacter,
  handleRemoveChat,
  handleRemoveFile,
  handleResetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const PROJECT_DELETE_ACTIONS = ['remove-character', 'remove-chat', 'remove-file', 'reset-state'] as const;
type ProjectDeleteAction = typeof PROJECT_DELETE_ACTIONS[number];

/**
 * DELETE handler for individual project
 */
export async function handleDelete(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, PROJECT_DELETE_ACTIONS)) {
    return handleDeleteProject(projectId, ctx);
  }

  const actionHandlers: Record<ProjectDeleteAction, () => Promise<NextResponse>> = {
    'remove-character': () => handleRemoveCharacter(req, projectId, ctx),
    'remove-chat': () => handleRemoveChat(req, projectId, ctx),
    'remove-file': () => handleRemoveFile(req, projectId, ctx),
    'reset-state': () => handleResetState(projectId, ctx),
  };

  return actionHandlers[action]();
}
