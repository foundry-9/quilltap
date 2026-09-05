/**
 * Scenario single-item route factory.
 *
 * The group and project single-scenario endpoints
 * (`/api/v1/groups/[id]/scenarios/[scenarioPath]` and
 * `/api/v1/projects/[id]/scenarios/[scenarioPath]`) are identical modulo the
 * owning tier: its labels, its `Scenarios/` helpers, and (for groups) an
 * extra Knowledge-folder ensure. This factory owns the shared GET / PUT /
 * POST(?action=rename) / DELETE bodies once; each route file supplies a small
 * config and re-exports the produced handlers.
 *
 * Behaviour contract: every status code, response body, error string, log
 * message and the hand-rolled `?action=` dispatch (`rename` only, with its
 * exact unknown-action 400 text) are preserved byte-for-byte from the two
 * original route files.
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The routes accept the bare filename (with or without `.md`) and prefix
 * `Scenarios/` server-side; `..` segments are rejected. PUT, POST and DELETE
 * all honour `?includeArchived=true` on the freshly-listed scenarios they
 * return.
 *
 * @module mount-index/scenario-item-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  buildScenarioFileContent,
  isScenarioContentArchived,
  resolveScenarioPath,
  updateScenarioSchema,
  renameScenarioSchema,
  type ParsedScenario,
  type ListScenariosResult,
} from '@/lib/mount-index/scenarios-common';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
  moveDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';

export interface ScenarioItemRouteConfig {
  /** Capitalised owner label — `'Group'` / `'Project'`. Feeds `notFound(...)`
   *  bodies and, lower-cased, the error strings and log messages. */
  ownerLabel: 'Group' | 'Project';
  /** Log-message prefix — `'[Groups v1]'` / `'[Projects v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines — `'groupId'` / `'projectId'`. */
  logIdKey: string;
  /** The tier's scenarios folder constant (`GROUP_SCENARIOS_FOLDER` / `PROJECT_SCENARIOS_FOLDER`). */
  scenariosFolder: string;
  /** Repo lookup for the owning row (must expose `officialMountPointId`). */
  findOwner: (
    repos: RequestContext['repos'],
    id: string,
  ) => Promise<{ officialMountPointId?: string | null } | null>;
  /** Cheap idempotent folder ensure(s) run once the store is known — the
   *  group tier also ensures its Knowledge folder here. */
  ensureFolders: (mountPointId: string) => Promise<void>;
  listScenarios: (
    mountPointId: string,
    options: { includeArchived?: boolean },
  ) => Promise<ListScenariosResult>;
  readScenario: (mountPointId: string, relativePath: string) => Promise<ParsedScenario | null>;
  setScenarioDefault: (mountPointId: string, relativePath: string) => Promise<void>;
}

export interface ScenarioItemHandlers {
  GET: ReturnType<typeof createContextParamsHandler<{ id: string; scenarioPath: string }>>;
  PUT: ReturnType<typeof createContextParamsHandler<{ id: string; scenarioPath: string }>>;
  POST: ReturnType<typeof createContextParamsHandler<{ id: string; scenarioPath: string }>>;
  DELETE: ReturnType<typeof createContextParamsHandler<{ id: string; scenarioPath: string }>>;
}

/**
 * Build the four route handlers for one tier's single-scenario endpoint.
 */
export function createScenarioItemHandlers(config: ScenarioItemRouteConfig): ScenarioItemHandlers {
  const {
    ownerLabel,
    logTag,
    logIdKey,
    scenariosFolder,
    findOwner,
    ensureFolders,
    listScenarios,
    readScenario,
    setScenarioDefault,
  } = config;
  const owner = ownerLabel.toLowerCase();

  async function loadOwnerAndStore(
    ownerId: string,
    repos: RequestContext['repos'],
  ): Promise<
    | { ok: true; mountPointId: string }
    | { ok: false; response: NextResponse }
  > {
    const row = await findOwner(repos, ownerId);
    if (!row) return { ok: false, response: notFound(ownerLabel) };
    if (!row.officialMountPointId) {
      return {
        ok: false,
        response: notFound(`${ownerLabel} has no official document store yet — restart the server or call GET /scenarios first`),
      };
    }
    // Cheap idempotent check that the Scenarios folder is in place.
    await ensureFolders(row.officialMountPointId);
    return { ok: true, mountPointId: row.officialMountPointId };
  }

  // ==========================================================================
  // GET — read one scenario
  // ==========================================================================

  const GET = createContextParamsHandler<{ id: string; scenarioPath: string }>(
    async (_req: NextRequest, { repos }: RequestContext, { id, scenarioPath }) => {
      try {
        const resolved = resolveScenarioPath(scenarioPath, scenariosFolder);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadOwnerAndStore(id, repos);
        if (!lookup.ok) return lookup.response;

        const scenario = await readScenario(lookup.mountPointId, resolved.path);
        if (!scenario) return notFound('Scenario');

        return successResponse({ scenario });
      } catch (error) {
        logger.error(
          `${logTag} Failed to read ${owner} scenario`,
          { [logIdKey]: id, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to read ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // PUT — update scenario content + frontmatter
  // ==========================================================================

  const PUT = createContextParamsHandler<{ id: string; scenarioPath: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
      try {
        const resolved = resolveScenarioPath(scenarioPath, scenariosFolder);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadOwnerAndStore(id, repos);
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
          await setScenarioDefault(lookup.mountPointId, resolved.path);
        }

        const { scenarios, warnings } = await listScenarios(lookup.mountPointId, { includeArchived });

        logger.info(`${logTag} Updated ${owner} scenario`, {
          [logIdKey]: id,
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
          `${logTag} Failed to update ${owner} scenario`,
          { [logIdKey]: id, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to update ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // POST ?action=rename — rename a scenario file
  // ==========================================================================

  const POST = createContextParamsHandler<{ id: string; scenarioPath: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
      try {
        const includeArchived = readIncludeArchived(req);
        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        if (action !== 'rename') {
          return badRequest('Unknown action — supported: rename');
        }

        const resolved = resolveScenarioPath(scenarioPath, scenariosFolder);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadOwnerAndStore(id, repos);
        if (!lookup.ok) return lookup.response;

        const body = await req.json();
        const validated = renameScenarioSchema.parse(body);

        const cleaned = sanitizeFileName(validated.newFilename).replace(/\.md$/i, '');
        if (!cleaned) return badRequest('newFilename cannot be empty after sanitisation');
        const newPath = `${scenariosFolder}/${cleaned}.md`;

        if (newPath === resolved.path) {
          // No-op rename — return current state.
          const { scenarios, warnings } = await listScenarios(lookup.mountPointId, { includeArchived });
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

        const { scenarios, warnings } = await listScenarios(lookup.mountPointId, { includeArchived });

        logger.info(`${logTag} Renamed ${owner} scenario`, {
          [logIdKey]: id,
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
          `${logTag} Failed to rename ${owner} scenario`,
          { [logIdKey]: id, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to rename ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // DELETE — delete a scenario file
  // ==========================================================================

  const DELETE = createContextParamsHandler<{ id: string; scenarioPath: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id, scenarioPath }) => {
      try {
        const includeArchived = readIncludeArchived(req);
        const resolved = resolveScenarioPath(scenarioPath, scenariosFolder);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadOwnerAndStore(id, repos);
        if (!lookup.ok) return lookup.response;

        const deleted = await deleteDatabaseDocument(lookup.mountPointId, resolved.path);
        if (!deleted) return notFound('Scenario');

        const { scenarios, warnings } = await listScenarios(lookup.mountPointId, { includeArchived });

        logger.info(`${logTag} Deleted ${owner} scenario`, {
          [logIdKey]: id,
          userId: user.id,
          mountPointId: lookup.mountPointId,
          relativePath: resolved.path,
        });

        return successResponse({ scenarios, warnings });
      } catch (error) {
        logger.error(
          `${logTag} Failed to delete ${owner} scenario`,
          { [logIdKey]: id, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to delete ${owner} scenario`);
      }
    },
  );

  return { GET, PUT, POST, DELETE };
}
