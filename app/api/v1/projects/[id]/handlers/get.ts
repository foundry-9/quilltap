/**
 * Projects API v1 - GET Handler
 *
 * GET /api/v1/projects/[id] - Get project details
 * GET /api/v1/projects/[id]?action=list-characters - List character roster
 * GET /api/v1/projects/[id]?action=list-chats - List project chats
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * GET /api/v1/projects/[id]?action=get-background - Get project story background URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import {
  handleGetDefault,
  handleListCharacters,
  handleListChats,
  handleListFiles,
  handleGetState,
  handleGetBackground,
  handleGetAesthetic,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

const PROJECT_GET_ACTIONS = ['list-characters', 'list-chats', 'list-files', 'get-state', 'get-background', 'aesthetic'] as const;
type ProjectGetAction = typeof PROJECT_GET_ACTIONS[number];

/**
 * GET handler for individual project
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, PROJECT_GET_ACTIONS)) {
    return handleGetDefault(projectId, ctx);
  }

  const actionHandlers: Record<ProjectGetAction, () => Promise<NextResponse>> = {
    'list-characters': () => handleListCharacters(projectId, ctx),
    'list-chats': () => handleListChats(req, projectId, ctx),
    'list-files': () => handleListFiles(projectId, ctx),
    'get-state': () => handleGetState(projectId, ctx),
    'get-background': () => handleGetBackground(projectId, ctx),
    'aesthetic': () => handleGetAesthetic(req, projectId, ctx),
  };

  return actionHandlers[action]();
}
