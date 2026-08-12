/**
 * General Scenarios — collection endpoint.
 *
 * GET  /api/v1/scenarios          — list every scenario in the instance-wide
 *                                   "Quilltap General" mount's `Scenarios/`
 *                                   folder, with frontmatter parsed and
 *                                   default-conflict resolution applied.
 * POST /api/v1/scenarios          — create a new scenario file.
 *                                   Body: { filename, name?, description?,
 *                                   isDefault?, body }.
 *
 * Both routes call `ensureGeneralScenariosFolder` first so callers don't
 * have to wait for the next startup heal pass. GET tolerates the
 * pre-migration race (returns an empty list with `mountPointId: null`);
 * POST rejects writes in that window.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, created } from '@/lib/api/responses';
import {
  ensureGeneralScenariosFolder,
  listGeneralScenarios,
  setGeneralScenarioDefault,
  GENERAL_SCENARIOS_FOLDER,
} from '@/lib/mount-index/general-scenarios';
import { buildScenarioFileContent } from '@/lib/mount-index/scenarios-common';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';

// ============================================================================
// Schemas
// ============================================================================

const createScenarioSchema = z.object({
  filename: z.string().min(1).max(100),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  body: z.string().min(1, 'Scenario body cannot be empty'),
});

// ============================================================================
// GET — list scenarios
// ============================================================================

export const GET = createContextHandler(
  async (_req: NextRequest, _ctx: RequestContext) => {
    try {
      const ensured = await ensureGeneralScenariosFolder();
      if (!ensured.mountPointId) {
        // Pre-migration race: report empty list rather than 500.
        return NextResponse.json({
          mountPointId: null,
          scenarios: [],
          warnings: [],
        });
      }
      const { mountPointId, scenarios, warnings } = await listGeneralScenarios();
      return NextResponse.json({ mountPointId, scenarios, warnings });
    } catch (error) {
      logger.error(
        '[General v1] Failed to list general scenarios',
        {},
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to list general scenarios');
    }
  },
);

// ============================================================================
// POST — create a new scenario
// ============================================================================

export const POST = createContextHandler(
  async (req: NextRequest, { user }: RequestContext) => {
    try {
      const body = await req.json();
      const validated = createScenarioSchema.parse(body);

      const ensured = await ensureGeneralScenariosFolder();
      if (!ensured.mountPointId) {
        return badRequest('Quilltap General mount has not been provisioned yet — restart the server');
      }
      const mountPointId = ensured.mountPointId;

      const cleanedFilename = sanitizeFileName(validated.filename).replace(/\.md$/i, '');
      if (!cleanedFilename) {
        return badRequest('Filename cannot be empty after sanitisation');
      }
      const relativePath = `${GENERAL_SCENARIOS_FOLDER}/${cleanedFilename}.md`;

      const { getRepositories } = await import('@/lib/repositories/factory');
      const repos = getRepositories();
      const existing = await repos.docMountDocuments.findByMountPointAndPath(
        mountPointId,
        relativePath,
      );
      if (existing) {
        return badRequest(`A scenario named "${cleanedFilename}" already exists`);
      }

      const fileContent = buildScenarioFileContent({
        name: validated.name,
        description: validated.description,
        isDefault: validated.isDefault,
        body: validated.body,
      });

      await writeDatabaseDocument(mountPointId, relativePath, fileContent);

      if (validated.isDefault) {
        await setGeneralScenarioDefault(relativePath);
      }

      logger.info('[General v1] Created general scenario', {
        userId: user.id,
        mountPointId,
        relativePath,
        isDefault: validated.isDefault === true,
      });

      const fresh = await listGeneralScenarios();
      return created({
        mountPointId: fresh.mountPointId,
        path: relativePath,
        scenarios: fresh.scenarios,
        warnings: fresh.warnings,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
      }
      logger.error(
        '[General v1] Failed to create general scenario',
        {},
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to create general scenario');
    }
  },
);
