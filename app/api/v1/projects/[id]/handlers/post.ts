/**
 * Projects API v1 - POST Handler
 *
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { badRequest } from '@/lib/api/responses';
import { handleAddCharacter, handleAddChat, handleAddFile, handleUpdateToolSettings } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const PROJECT_POST_ACTIONS = ['add-character', 'add-chat', 'add-file', 'update-tool-settings'] as const;
type ProjectPostAction = typeof PROJECT_POST_ACTIONS[number];

/**
 * POST handler for individual project
 */
export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!isValidAction(action, PROJECT_POST_ACTIONS)) {
    return badRequest('Unknown action or missing action parameter');
  }

  const actionHandlers: Record<ProjectPostAction, () => Promise<NextResponse>> = {
    'add-character': () => handleAddCharacter(req, projectId, ctx),
    'add-chat': () => handleAddChat(req, projectId, ctx),
    'add-file': () => handleAddFile(req, projectId, ctx),
    'update-tool-settings': () => handleUpdateToolSettings(req, projectId, ctx),
  };

  return actionHandlers[action]();
}
