/**
 * Project Scenarios — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/scenarios          — list every scenario in
 *                                                  the project's `Scenarios/`
 *                                                  folder, with frontmatter
 *                                                  parsed and default-conflict
 *                                                  resolution applied.
 *                                                  `?includeArchived=true` also
 *                                                  returns archived scenarios.
 * POST /api/v1/projects/[id]/scenarios          — create a new scenario file.
 *                                                  Body: { filename, name?,
 *                                                  description?, isDefault?,
 *                                                  body }.
 *
 * Both routes call `ensureProjectOfficialStore` and
 * `ensureProjectScenariosFolder` first so users hitting this endpoint don't
 * have to wait for the next startup-time heal pass to see their scenarios
 * folder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  ensureProjectScenariosFolder,
  listProjectScenarios,
  setProjectScenarioDefault,
  PROJECT_SCENARIOS_FOLDER,
} from '@/lib/mount-index/project-scenarios';
import { buildScenarioFileContent, createScenarioSchema } from '@/lib/mount-index/scenarios-common';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';

// ============================================================================
// GET — list scenarios
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { repos }: RequestContext, { id }) => {
    try {
      const includeArchived = readIncludeArchived(req);
      const project = await repos.projects.findById(id);
      if (!project) return notFound('Project');

      const ensured = await ensureProjectOfficialStore(project.id, project.name);
      if (!ensured) {
        return serverError('Failed to ensure project document store');
      }
      await ensureProjectScenariosFolder(ensured.mountPointId);

      const { scenarios, warnings } = await listProjectScenarios(ensured.mountPointId, {
        includeArchived,
      });

      return NextResponse.json({
        mountPointId: ensured.mountPointId,
        scenarios,
        warnings,
      });
    } catch (error) {
      logger.error(
        '[Projects v1] Failed to list project scenarios',
        { projectId: id },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to list project scenarios');
    }
  },
);

// ============================================================================
// POST — create a new scenario
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const project = await repos.projects.findById(id);
      if (!project) return notFound('Project');

      const body = await req.json();
      const validated = createScenarioSchema.parse(body);

      const ensured = await ensureProjectOfficialStore(project.id, project.name);
      if (!ensured) {
        return serverError('Failed to ensure project document store');
      }
      await ensureProjectScenariosFolder(ensured.mountPointId);

      const cleanedFilename = sanitizeFileName(validated.filename).replace(/\.md$/i, '');
      if (!cleanedFilename) {
        return badRequest('Filename cannot be empty after sanitisation');
      }
      const relativePath = `${PROJECT_SCENARIOS_FOLDER}/${cleanedFilename}.md`;

      // Reject collision — caller can rename.
      const existing = await repos.docMountDocuments.findByMountPointAndPath(
        ensured.mountPointId,
        relativePath,
      );
      if (existing) {
        return badRequest(`A scenario named "${cleanedFilename}" already exists`);
      }

      const fileContent = buildScenarioFileContent({
        name: validated.name,
        description: validated.description,
        isDefault: validated.isDefault,
        archived: validated.archived,
        body: validated.body,
      });

      await writeDatabaseDocument(ensured.mountPointId, relativePath, fileContent);

      // If this scenario was marked default, demote any siblings that were
      // also default. setProjectScenarioDefault handles both directions.
      if (validated.isDefault) {
        await setProjectScenarioDefault(ensured.mountPointId, relativePath);
      }

      logger.info('[Projects v1] Created project scenario', {
        projectId: id,
        userId: user.id,
        mountPointId: ensured.mountPointId,
        relativePath,
        isDefault: validated.isDefault === true,
      });

      // Return the freshly listed scenarios so the client doesn't need a follow-up GET.
      const { scenarios, warnings } = await listProjectScenarios(ensured.mountPointId, {
        includeArchived: validated.archived === true,
      });
      return created({
        mountPointId: ensured.mountPointId,
        path: relativePath,
        scenarios,
        warnings,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[Projects v1] Failed to create project scenario',
        { projectId: id },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to create project scenario');
    }
  },
);
