/**
 * Project Scenarios — single-scenario endpoint.
 *
 * Routes:
 *   GET    /api/v1/projects/[id]/scenarios/[scenarioPath]  — read one
 *   PUT    /api/v1/projects/[id]/scenarios/[scenarioPath]  — update content + frontmatter
 *   POST   /api/v1/projects/[id]/scenarios/[scenarioPath]?action=rename
 *                                                         — rename the file
 *   DELETE /api/v1/projects/[id]/scenarios/[scenarioPath]  — delete the file
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The route accepts the bare filename (with or without `.md`) and prefixes
 * `Scenarios/` server-side; `..` segments are rejected. This matches the
 * convenience accepted by `resolveProjectScenarioBody`.
 *
 * PUT, POST and DELETE all honour `?includeArchived=true` on the freshly-listed
 * scenarios they return, so a manager with "Show archived" ticked gets back a
 * list that still contains the row it just changed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  ensureProjectScenariosFolder,
  listProjectScenarios,
  readProjectScenario,
  setProjectScenarioDefault,
  PROJECT_SCENARIOS_FOLDER,
} from '@/lib/mount-index/project-scenarios';
import {
  buildScenarioFileContent,
  isScenarioContentArchived,
  resolveScenarioPath,
} from '@/lib/mount-index/scenarios-common';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
  moveDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';

// ============================================================================
// Schemas
// ============================================================================

const updateScenarioSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  /** Omit to leave the current archived state alone; the serializer rewrites
   *  the whole file, so an unmentioned flag would otherwise be dropped. */
  archived: z.boolean().optional(),
  body: z.string().min(1, 'Scenario body cannot be empty'),
});

const renameScenarioSchema = z.object({
  newFilename: z.string().min(1).max(100),
});

// ============================================================================
// Helpers
// ============================================================================

async function loadProjectAndStore(
  projectId: string,
  repos: RequestContext['repos'],
): Promise<
  | { ok: true; mountPointId: string }
  | { ok: false; response: NextResponse }
> {
  const project = await repos.projects.findById(projectId);
  if (!project) return { ok: false, response: notFound('Project') };
  if (!project.officialMountPointId) {
    return {
      ok: false,
      response: notFound('Project has no official document store yet — restart the server or call GET /scenarios first'),
    };
  }
  // Cheap idempotent check that the Scenarios folder is in place.
  await ensureProjectScenariosFolder(project.officialMountPointId);
  return { ok: true, mountPointId: project.officialMountPointId };
}

// ============================================================================
// GET — read one scenario
// ============================================================================

export const GET = createContextParamsHandler<{ id: string; scenarioPath: string }>(
  async (_req: NextRequest, { repos }: RequestContext, { id, scenarioPath }) => {
    try {
      const resolved = resolveScenarioPath(scenarioPath, PROJECT_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadProjectAndStore(id, repos);
      if (!lookup.ok) return lookup.response;

      const scenario = await readProjectScenario(lookup.mountPointId, resolved.path);
      if (!scenario) return notFound('Scenario');

      return successResponse({ scenario });
    } catch (error) {
      logger.error(
        '[Projects v1] Failed to read project scenario',
        { projectId: id, scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to read project scenario');
    }
  },
);

// ============================================================================
// PUT — update scenario content + frontmatter
// ============================================================================

export const PUT = createContextParamsHandler<{ id: string; scenarioPath: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
    try {
      const resolved = resolveScenarioPath(scenarioPath, PROJECT_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadProjectAndStore(id, repos);
      if (!lookup.ok) return lookup.response;

      const includeArchived = readIncludeArchived(req);
      const body = await req.json();
      const validated = updateScenarioSchema.parse(body);

      // 404 if the file doesn't exist (use POST on the collection to create).
      const existing = await repos.docMountDocuments.findByMountPointAndPath(
        lookup.mountPointId,
        resolved.path,
      );
      if (!existing) return notFound('Scenario');

      const fileContent = buildScenarioFileContent({
        name: validated.name,
        description: validated.description,
        isDefault: validated.isDefault,
        archived: validated.archived ?? isScenarioContentArchived(existing.content),
        body: validated.body,
      });

      await writeDatabaseDocument(lookup.mountPointId, resolved.path, fileContent);

      if (validated.isDefault) {
        await setProjectScenarioDefault(lookup.mountPointId, resolved.path);
      }

      const { scenarios, warnings } = await listProjectScenarios(lookup.mountPointId, { includeArchived });

      logger.info('[Projects v1] Updated project scenario', {
        projectId: id,
        userId: user.id,
        mountPointId: lookup.mountPointId,
        relativePath: resolved.path,
        isDefault: validated.isDefault === true,
      });

      return successResponse({ scenarios, warnings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[Projects v1] Failed to update project scenario',
        { projectId: id, scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to update project scenario');
    }
  },
);

// ============================================================================
// POST ?action=rename — rename a scenario file
// ============================================================================

export const POST = createContextParamsHandler<{ id: string; scenarioPath: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
    try {
      const includeArchived = readIncludeArchived(req);
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      if (action !== 'rename') {
        return badRequest('Unknown action — supported: rename');
      }

      const resolved = resolveScenarioPath(scenarioPath, PROJECT_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadProjectAndStore(id, repos);
      if (!lookup.ok) return lookup.response;

      const body = await req.json();
      const validated = renameScenarioSchema.parse(body);

      const cleaned = sanitizeFileName(validated.newFilename).replace(/\.md$/i, '');
      if (!cleaned) return badRequest('newFilename cannot be empty after sanitisation');
      const newPath = `${PROJECT_SCENARIOS_FOLDER}/${cleaned}.md`;

      if (newPath === resolved.path) {
        // No-op rename — return current state.
        const { scenarios, warnings } = await listProjectScenarios(lookup.mountPointId, { includeArchived });
        return successResponse({ path: newPath, scenarios, warnings });
      }

      const existing = await repos.docMountDocuments.findByMountPointAndPath(
        lookup.mountPointId,
        resolved.path,
      );
      if (!existing) return notFound('Scenario');

      const conflict = await repos.docMountDocuments.findByMountPointAndPath(
        lookup.mountPointId,
        newPath,
      );
      if (conflict) {
        return badRequest(`A scenario named "${cleaned}" already exists`);
      }

      await moveDatabaseDocument(lookup.mountPointId, resolved.path, newPath);

      const { scenarios, warnings } = await listProjectScenarios(lookup.mountPointId, { includeArchived });

      logger.info('[Projects v1] Renamed project scenario', {
        projectId: id,
        userId: user.id,
        mountPointId: lookup.mountPointId,
        from: resolved.path,
        to: newPath,
      });

      return successResponse({ path: newPath, scenarios, warnings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[Projects v1] Failed to rename project scenario',
        { projectId: id, scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to rename project scenario');
    }
  },
);

// ============================================================================
// DELETE — delete a scenario file
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string; scenarioPath: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
    try {
      const includeArchived = readIncludeArchived(req);
      const resolved = resolveScenarioPath(scenarioPath, PROJECT_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadProjectAndStore(id, repos);
      if (!lookup.ok) return lookup.response;

      const deleted = await deleteDatabaseDocument(lookup.mountPointId, resolved.path);
      if (!deleted) return notFound('Scenario');

      const { scenarios, warnings } = await listProjectScenarios(lookup.mountPointId, { includeArchived });

      logger.info('[Projects v1] Deleted project scenario', {
        projectId: id,
        userId: user.id,
        mountPointId: lookup.mountPointId,
        relativePath: resolved.path,
      });

      return successResponse({ scenarios, warnings });
    } catch (error) {
      logger.error(
        '[Projects v1] Failed to delete project scenario',
        { projectId: id, scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to delete project scenario');
    }
  },
);
