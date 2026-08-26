/**
 * Group Scenarios — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/scenarios          — list every scenario in
 *                                                the group's `Scenarios/`
 *                                                folder, with frontmatter
 *                                                parsed and default-conflict
 *                                                resolution applied.
 *                                                `?includeArchived=true` also
 *                                                returns archived scenarios.
 * POST /api/v1/groups/[id]/scenarios          — create a new scenario file.
 *                                                Body: { filename, name?,
 *                                                description?, isDefault?,
 *                                                body }.
 *
 * Both routes call `ensureGroupOfficialStore` and
 * `ensureGroupScenariosFolder` first so users hitting this endpoint don't
 * have to wait for the next startup-time heal pass to see their scenarios
 * folder.
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupScenariosFolder,
  ensureGroupKnowledgeFolder,
  listGroupScenarios,
  setGroupScenarioDefault,
  GROUP_SCENARIOS_FOLDER,
} from '@/lib/mount-index/group-scenarios';
import { buildScenarioFileContent } from '@/lib/mount-index/scenarios-common';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';

// ============================================================================
// Schemas
// ============================================================================

const createScenarioSchema = z.object({
  /** Desired filename without `.md` extension. Will be sanitised. */
  filename: z.string().min(1).max(100),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
  body: z.string().min(1, 'Scenario body cannot be empty'),
});

// ============================================================================
// GET — list scenarios
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { repos }: RequestContext, { id }) => {
    const includeArchived = readIncludeArchived(req);
    const group = await repos.groups.findById(id);
    if (!group) return notFound('Group');

    const ensured = await ensureGroupOfficialStore(group.id, group.name);
    if (!ensured) {
      return serverError('Failed to ensure group document store');
    }
    await ensureGroupScenariosFolder(ensured.mountPointId);
    await ensureGroupKnowledgeFolder(ensured.mountPointId);

    const { scenarios, warnings } = await listGroupScenarios(ensured.mountPointId, {
      includeArchived,
    });

    return successResponse({
      mountPointId: ensured.mountPointId,
      scenarios,
      warnings,
    });
  },
);

// ============================================================================
// POST — create a new scenario
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    const group = await repos.groups.findById(id);
    if (!group) return notFound('Group');

    const body = await req.json();
    const validated = createScenarioSchema.parse(body);

    const ensured = await ensureGroupOfficialStore(group.id, group.name);
    if (!ensured) {
      return serverError('Failed to ensure group document store');
    }
    await ensureGroupScenariosFolder(ensured.mountPointId);
    await ensureGroupKnowledgeFolder(ensured.mountPointId);

    const cleanedFilename = sanitizeFileName(validated.filename).replace(/\.md$/i, '');
    if (!cleanedFilename) {
      return badRequest('Filename cannot be empty after sanitisation');
    }
    const relativePath = `${GROUP_SCENARIOS_FOLDER}/${cleanedFilename}.md`;

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
    // also default. setGroupScenarioDefault handles both directions.
    if (validated.isDefault) {
      await setGroupScenarioDefault(ensured.mountPointId, relativePath);
    }

    logger.info('[Groups v1] Created group scenario', {
      groupId: id,
      userId: user.id,
      mountPointId: ensured.mountPointId,
      relativePath,
      isDefault: validated.isDefault === true,
    });

    // Return the freshly listed scenarios so the client doesn't need a follow-up GET.
    const { scenarios, warnings } = await listGroupScenarios(ensured.mountPointId, {
      includeArchived: validated.archived === true,
    });
    return created({
      mountPointId: ensured.mountPointId,
      path: relativePath,
      scenarios,
      warnings,
    });
  },
);
