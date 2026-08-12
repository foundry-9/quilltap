/**
 * Projects API v1 - Tool Settings Actions
 *
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, successResponse } from '@/lib/api/responses';
import { updateToolSettingsSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Update default tool settings for project
 */
export async function handleUpdateToolSettings(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { defaultDisabledTools, defaultDisabledToolGroups } = updateToolSettingsSchema.parse(body);

  // Update project with new default tool settings
  await repos.projects.update(projectId, {
    defaultDisabledTools,
    defaultDisabledToolGroups,
  });

  logger.info('[Projects v1] Default tool settings updated', {
    projectId,
    disabledToolsCount: defaultDisabledTools.length,
    disabledGroupsCount: defaultDisabledToolGroups.length,
  });

  return successResponse({
    success: true,
    defaultDisabledTools,
    defaultDisabledToolGroups,
  });
}
