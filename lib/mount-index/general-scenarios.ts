/**
 * General Scenarios — read/write helpers for the instance-wide `Scenarios/`
 * folder inside the singleton "Quilltap General" mount point.
 *
 * General scenarios are offered alongside per-project and per-character
 * scenarios in the New Chat dialog, regardless of whether the chat lives
 * inside a project. The mount itself is provisioned by
 * `migrations/scripts/provision-general-mount.ts`; its id is persisted in
 * `instance_settings.generalMountPointId` and read here via
 * `getGeneralMountPointId()`.
 *
 * All helpers degrade gracefully when the mount has not yet been provisioned
 * (returning empty results / null) so a freshly-cloned database doesn't 500
 * the API during the race window before instrumentation finishes migrations.
 *
 * @module mount-index/general-scenarios
 */

import { logger } from '@/lib/logger';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  listScenariosInFolder,
  readScenarioByPath,
  resolveScenarioBody,
  setScenarioDefaultInFolder,
  type ParsedScenario,
  type ListScenariosResult,
} from '@/lib/mount-index/scenarios-common';

export const GENERAL_SCENARIOS_FOLDER = 'Scenarios';

export type GeneralScenario = ParsedScenario;
export type ListGeneralScenariosResult = ListScenariosResult & {
  /** Null when the singleton mount has not yet been provisioned. */
  mountPointId: string | null;
};

/**
 * Idempotent: ensure the `Scenarios/` folder exists in the "Quilltap General"
 * mount. Returns `{ mountPointId: null, folderId: null }` when the mount has
 * not yet been provisioned — startup callers must tolerate this race.
 */
export async function ensureGeneralScenariosFolder(): Promise<{
  mountPointId: string | null;
  folderId: string | null;
}> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    return { mountPointId: null, folderId: null };
  }
  try {
    const folderId = await ensureFolderPath(mountPointId, GENERAL_SCENARIOS_FOLDER);
    return { mountPointId, folderId };
  } catch (error) {
    logger.warn('[GeneralScenarios] Failed to ensure Scenarios folder', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { mountPointId, folderId: null };
  }
}

/**
 * List all general `Scenarios/*.md`. Returns an empty result when the mount
 * is not yet provisioned (no error). Archived scenarios are omitted unless
 * `options.includeArchived` is true.
 */
export async function listGeneralScenarios(
  options: { includeArchived?: boolean } = {},
): Promise<ListGeneralScenariosResult> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    return { mountPointId: null, scenarios: [], warnings: [] };
  }
  const result = await listScenariosInFolder(mountPointId, GENERAL_SCENARIOS_FOLDER, options);
  return { mountPointId, ...result };
}

/**
 * Read a single general scenario by relative path. Returns null when the
 * mount is not provisioned or the file is missing.
 */
export async function readGeneralScenario(
  relativePath: string,
): Promise<GeneralScenario | null> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) return null;
  return readScenarioByPath(mountPointId, relativePath);
}

/**
 * Resolve a general scenario's body for chat creation. Returns null when the
 * mount is not provisioned, the file is missing, or its body is empty.
 */
export async function resolveGeneralScenarioBody(
  scenarioPath: string,
): Promise<string | null> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) return null;
  return resolveScenarioBody(mountPointId, scenarioPath, GENERAL_SCENARIOS_FOLDER);
}

/**
 * Set a single file as the general default. Throws if the mount has not yet
 * been provisioned, since this only fires from authenticated write paths
 * where the mount should already exist.
 */
export async function setGeneralScenarioDefault(defaultPath: string): Promise<void> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    throw new Error('Quilltap General mount has not been provisioned yet');
  }
  return setScenarioDefaultInFolder(mountPointId, defaultPath, GENERAL_SCENARIOS_FOLDER);
}
