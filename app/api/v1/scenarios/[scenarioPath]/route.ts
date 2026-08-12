/**
 * General Scenarios — single-scenario endpoint.
 *
 * Routes:
 *   GET    /api/v1/scenarios/[scenarioPath]                — read one
 *   PUT    /api/v1/scenarios/[scenarioPath]                — update content + frontmatter
 *   POST   /api/v1/scenarios/[scenarioPath]?action=rename  — rename the file
 *   DELETE /api/v1/scenarios/[scenarioPath]                — delete the file
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The route accepts the bare filename (with or without `.md`) and prefixes
 * `Scenarios/` server-side; `..` segments are rejected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  ensureGeneralScenariosFolder,
  listGeneralScenarios,
  readGeneralScenario,
  setGeneralScenarioDefault,
  GENERAL_SCENARIOS_FOLDER,
} from '@/lib/mount-index/general-scenarios';
import {
  buildScenarioFileContent,
  resolveScenarioPath,
} from '@/lib/mount-index/scenarios-common';
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
  body: z.string().min(1, 'Scenario body cannot be empty'),
});

const renameScenarioSchema = z.object({
  newFilename: z.string().min(1).max(100),
});

// ============================================================================
// Helpers
// ============================================================================

async function loadGeneralStore(): Promise<
  | { ok: true; mountPointId: string }
  | { ok: false; response: NextResponse }
> {
  const ensured = await ensureGeneralScenariosFolder();
  if (!ensured.mountPointId) {
    return {
      ok: false,
      response: notFound('Quilltap General mount has not been provisioned yet'),
    };
  }
  return { ok: true, mountPointId: ensured.mountPointId };
}

// ============================================================================
// GET — read one scenario
// ============================================================================

export const GET = createContextParamsHandler<{ scenarioPath: string }>(
  async (_req: NextRequest, _ctx: RequestContext, { scenarioPath }) => {
    try {
      const resolved = resolveScenarioPath(scenarioPath, GENERAL_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadGeneralStore();
      if (!lookup.ok) return lookup.response;

      const scenario = await readGeneralScenario(resolved.path);
      if (!scenario) return notFound('Scenario');

      return successResponse({ scenario });
    } catch (error) {
      logger.error(
        '[General v1] Failed to read general scenario',
        { scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to read general scenario');
    }
  },
);

// ============================================================================
// PUT — update scenario content + frontmatter
// ============================================================================

export const PUT = createContextParamsHandler<{ scenarioPath: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { scenarioPath }) => {
    try {
      const resolved = resolveScenarioPath(scenarioPath, GENERAL_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadGeneralStore();
      if (!lookup.ok) return lookup.response;

      const body = await req.json();
      const validated = updateScenarioSchema.parse(body);

      const existing = await repos.docMountDocuments.findByMountPointAndPath(
        lookup.mountPointId,
        resolved.path,
      );
      if (!existing) return notFound('Scenario');

      const fileContent = buildScenarioFileContent({
        name: validated.name,
        description: validated.description,
        isDefault: validated.isDefault,
        body: validated.body,
      });

      await writeDatabaseDocument(lookup.mountPointId, resolved.path, fileContent);

      if (validated.isDefault) {
        await setGeneralScenarioDefault(resolved.path);
      }

      const fresh = await listGeneralScenarios();

      logger.info('[General v1] Updated general scenario', {
        userId: user.id,
        mountPointId: lookup.mountPointId,
        relativePath: resolved.path,
        isDefault: validated.isDefault === true,
      });

      return successResponse({ scenarios: fresh.scenarios, warnings: fresh.warnings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[General v1] Failed to update general scenario',
        { scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to update general scenario');
    }
  },
);

// ============================================================================
// POST ?action=rename — rename a scenario file
// ============================================================================

export const POST = createContextParamsHandler<{ scenarioPath: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { scenarioPath }) => {
    try {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      if (action !== 'rename') {
        return badRequest('Unknown action — supported: rename');
      }

      const resolved = resolveScenarioPath(scenarioPath, GENERAL_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadGeneralStore();
      if (!lookup.ok) return lookup.response;

      const body = await req.json();
      const validated = renameScenarioSchema.parse(body);

      const cleaned = sanitizeFileName(validated.newFilename).replace(/\.md$/i, '');
      if (!cleaned) return badRequest('newFilename cannot be empty after sanitisation');
      const newPath = `${GENERAL_SCENARIOS_FOLDER}/${cleaned}.md`;

      if (newPath === resolved.path) {
        const fresh = await listGeneralScenarios();
        return successResponse({ path: newPath, scenarios: fresh.scenarios, warnings: fresh.warnings });
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

      const fresh = await listGeneralScenarios();

      logger.info('[General v1] Renamed general scenario', {
        userId: user.id,
        mountPointId: lookup.mountPointId,
        from: resolved.path,
        to: newPath,
      });

      return successResponse({ path: newPath, scenarios: fresh.scenarios, warnings: fresh.warnings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[General v1] Failed to rename general scenario',
        { scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to rename general scenario');
    }
  },
);

// ============================================================================
// DELETE — delete a scenario file
// ============================================================================

export const DELETE = createContextParamsHandler<{ scenarioPath: string }>(
  async (_req: NextRequest, { user }: RequestContext, { scenarioPath }) => {
    try {
      const resolved = resolveScenarioPath(scenarioPath, GENERAL_SCENARIOS_FOLDER);
      if (!resolved.ok) return badRequest(resolved.error);

      const lookup = await loadGeneralStore();
      if (!lookup.ok) return lookup.response;

      const deleted = await deleteDatabaseDocument(lookup.mountPointId, resolved.path);
      if (!deleted) return notFound('Scenario');

      const fresh = await listGeneralScenarios();

      logger.info('[General v1] Deleted general scenario', {
        userId: user.id,
        mountPointId: lookup.mountPointId,
        relativePath: resolved.path,
      });

      return successResponse({ scenarios: fresh.scenarios, warnings: fresh.warnings });
    } catch (error) {
      logger.error(
        '[General v1] Failed to delete general scenario',
        { scenarioPath },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to delete general scenario');
    }
  },
);
