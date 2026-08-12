/**
 * Projects API v1 - Project CRUD Actions
 *
 * GET /api/v1/projects/[id] - Get project details (default)
 * PUT /api/v1/projects/[id] - Update project (default)
 * DELETE /api/v1/projects/[id] - Delete project (default)
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists, enrichWithDefaultImage } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { updateProjectSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Get project details with enriched roster and counts
 */
export async function handleGetDefault(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);

    if (!exists(project)) {
      return notFound('Project');
    }

    // Get chats in this project
    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === project.id);

    // Get files in this project
    const allFiles = await repos.files.findAll();
    const projectFiles = allFiles.filter(f => f.projectId === project.id);

    // Get characters in roster with their details
    const enrichedCharacterRoster = await Promise.all(
      project.characterRoster.map(async (charId: string) => {
        const char = await repos.characters.findById(charId);
        if (!char) return null;

        // Count chats with this character in this project
        const charProjectChats = projectChats.filter(chat =>
          chat.participants?.some((p: any) => p.characterId === charId)
        );

        // Get default image for avatar display
        const defaultImage = await enrichWithDefaultImage(char.defaultImageId, repos);

        return {
          id: char.id,
          name: char.name,
          defaultImageId: char.defaultImageId,
          defaultImage,
          tags: char.tags || [],
          chatCount: charProjectChats.length,
        };
      })
    );

    const enrichedProject = {
      ...project,
      characterRoster: enrichedCharacterRoster.filter(Boolean),
      _count: {
        chats: projectChats.length,
        files: projectFiles.length,
        characters: project.characterRoster.length,
      },
    };

    return successResponse({ project: enrichedProject });
  } catch (error) {
    logger.error('[Projects v1] Error fetching project', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch project');
  }
}

/**
 * Update project
 */
export async function handlePutDefault(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const existingProject = await repos.projects.findById(projectId);

  if (!exists(existingProject)) {
    return notFound('Project');
  }

  const body = await req.json();
  const validatedData = updateProjectSchema.parse(body);

  const project = await repos.projects.update(projectId, validatedData);

  logger.info('[Projects v1] Project updated', { projectId, userId: user.id });

  return successResponse({ project });
}

/**
 * Delete project and disassociate chats/files
 */
export async function handleDeleteProject(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const existingProject = await repos.projects.findById(projectId);

    if (!exists(existingProject)) {
      return notFound('Project');
    }

    // Remove projectId from associated chats
    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === projectId);
    for (const chat of projectChats) {
      await repos.chats.update(chat.id, { projectId: null });
    }

    // Remove projectId from associated files
    const allFiles = await repos.files.findAll();
    const projectFiles = allFiles.filter(f => f.projectId === projectId);
    for (const file of projectFiles) {
      await repos.files.update(file.id, { projectId: null });
    }

    // Delete the project
    await repos.projects.delete(projectId);

    logger.info('[Projects v1] Project deleted', { projectId, userId: user.id });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Projects v1] Error deleting project', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete project');
  }
}
