/**
 * Projects API v1 - State Actions
 *
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 */

import { NextResponse } from 'next/server';
import { exists } from '@/lib/api/middleware';
import { notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { createResetStateHandler, createSetStateHandler } from '@/lib/api/state-handlers';

const STATE_CFG = {
  entityName: 'Project',
  idLogKey: 'projectId',
  selectRepo: (repos: RequestContext['repos']) => repos.projects,
} as const;

/**
 * Get project state
 */
export async function handleGetState(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const projectState = (project.state || {}) as Record<string, unknown>;

  return successResponse({
    success: true,
    state: projectState,
  });
}

export const handleSetState = createSetStateHandler(STATE_CFG);
export const handleResetState = createResetStateHandler(STATE_CFG);
