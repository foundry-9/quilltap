/**
 * Projects API v1 - Collection Endpoint
 *
 * GET /api/v1/projects - List all projects
 * POST /api/v1/projects - Create a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { created, notFound, serverError, badRequest } from '@/lib/api/responses';
import { createProjectSchema } from './schemas';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {

    let projects = await repos.projects.findAll();

    // Sort by createdAt descending
    projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich with counts
    const enrichedProjects = await Promise.all(
      projects.map(async (project) => {
        // Get chats in this project
        const allChats = await repos.chats.findAll();
        const projectChats = allChats.filter(c => c.projectId === project.id);

        // Get files in this project
        const allFiles = await repos.files.findAll();
        const projectFiles = allFiles.filter(f => f.projectId === project.id);

        return {
          ...project,
          _count: {
            chats: projectChats.length,
            files: projectFiles.length,
            characters: project.characterRoster.length,
          },
        };
      })
    );


    return NextResponse.json({ projects: enrichedProjects });
  } catch (error) {
    logger.error('[Projects v1] Error fetching projects', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch projects');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextHandler(async (req: NextRequest, { repos }) => {
  const body = await req.json();
  const validatedData = createProjectSchema.parse(body);

  // `repos.projects.create` provisions the official document store and writes
  // the four overlay files (description/instructions/state/properties) before
  // returning a fully-hydrated project. It fails hard if the store can't be
  // provisioned — a storeless project would throw on every read.
  const project = await repos.projects.create({
    name: validatedData.name,
    description: validatedData.description || null,
    instructions: validatedData.instructions || null,
    allowAnyCharacter: validatedData.allowAnyCharacter,
    characterRoster: validatedData.characterRoster,
    color: validatedData.color || null,
    icon: validatedData.icon || null,
    defaultDisabledTools: [],
    defaultDisabledToolGroups: [],
    state: {},
    backgroundDisplayMode: 'theme',
  });

  logger.info('[Projects v1] Project created', {
    projectId: project.id,
    name: project.name,
  });

  // create() handles the store + overlay files; ensure the Scenarios/ folder
  // too (it doesn't) so it's usable immediately. Non-fatal — the GET /scenarios
  // endpoint and the startup hook also ensure it.
  try {
    if (project.officialMountPointId) {
      const { ensureProjectScenariosFolder } = await import('@/lib/mount-index/project-scenarios');
      await ensureProjectScenariosFolder(project.officialMountPointId);
    }
  } catch (ensureError) {
    logger.warn('[Projects v1] Failed to ensure project Scenarios folder on create', {
      projectId: project.id,
      error: ensureError instanceof Error ? ensureError.message : String(ensureError),
    });
  }

  return created({ project });
});
