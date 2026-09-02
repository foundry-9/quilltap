/**
 * Projects API v1 - Background Actions
 *
 * GET /api/v1/projects/[id]?action=get-background - Get project story background URL
 */

import { NextResponse } from 'next/server';
import { exists, getFilePath } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { normalizeBackgroundDisplayMode } from '@/lib/schemas/project.types';
import type { BackgroundDisplayMode } from '@/lib/schemas/project.types';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Get project story background based on backgroundDisplayMode
 */
export async function handleGetBackground(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!exists(project)) {
      return notFound('Project');
    }

    // Determine the background based on backgroundDisplayMode. A project stored
    // in a mode retired in 4.9 ('project', 'static') reads back as 'theme'; the
    // schema coerces it, and this guards a raw row that bypassed the overlay.
    const displayMode = normalizeBackgroundDisplayMode(project.backgroundDisplayMode) as
      | BackgroundDisplayMode
      | undefined ?? 'theme';

    // If mode is 'theme', no background
    if (displayMode === 'theme') {
      return NextResponse.json({ backgroundUrl: null, displayMode });
    }

    // If mode is 'latest_chat', find the most recently updated chat with a background
    if (displayMode === 'latest_chat') {
      const allChats = await repos.chats.findAll();
      const projectChats = allChats
        .filter(c => c.projectId === projectId && c.storyBackgroundImageId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      if (projectChats.length > 0 && projectChats[0].storyBackgroundImageId) {
        const file = await repos.files.findById(projectChats[0].storyBackgroundImageId);
        if (file) {
          return NextResponse.json({
            backgroundUrl: getFilePath(file),
            displayMode,
            sourceChatId: projectChats[0].id,
          });
        }
      }
    }

    // No background available
    return NextResponse.json({ backgroundUrl: null, displayMode });
  } catch (error) {
    logger.error('[Projects v1] Error getting background', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get background');
  }
}
