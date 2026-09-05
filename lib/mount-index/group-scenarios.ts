/**
 * Group Scenarios and Knowledge — read/write helpers for the per-group
 * `Scenarios/` and `Knowledge/` folders that live inside each group's
 * official document store.
 *
 * Each scenario is a plain markdown file with optional YAML frontmatter:
 *
 *   ---
 *   name: Optional Display Name        # overrides filename (without .md) as the title
 *   description: Optional subtitle      # one-line summary shown in the new-chat dropdown
 *   isDefault: true                     # marks this as the group default (one wins)
 *   archived: true                      # hidden from lists unless "Show archived"
 *   ---
 *   <body — the scenario content delivered to the LLM>
 *
 * Thin wrappers around the shared primitives in `scenarios-common.ts`, which
 * are also used by the instance-wide `general-scenarios.ts`.
 *
 * @module mount-index/group-scenarios
 */

import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  listScenariosInFolder,
  readScenarioByPath,
  resolveScenarioBody,
  setScenarioDefaultInFolder,
  type ParsedScenario,
  type ListScenariosResult,
} from '@/lib/mount-index/scenarios-common';

export const GROUP_SCENARIOS_FOLDER = 'Scenarios';
export const GROUP_KNOWLEDGE_FOLDER = 'Knowledge';

/** Re-export under the historical name to keep external call sites working. */
export type ParsedGroupScenario = ParsedScenario;
export type ListGroupScenariosResult = ListScenariosResult;

/**
 * Idempotent: ensure the `Scenarios/` folder exists in the given mount point.
 * Returns the folder ID.
 */
export async function ensureGroupScenariosFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  const folderId = await ensureFolderPath(mountPointId, GROUP_SCENARIOS_FOLDER);
  return { folderId };
}

/**
 * Idempotent: ensure the `Knowledge/` folder exists in the given mount point.
 * Returns the folder ID.
 */
export async function ensureGroupKnowledgeFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  const folderId = await ensureFolderPath(mountPointId, GROUP_KNOWLEDGE_FOLDER);
  return { folderId };
}

/**
 * List all `Scenarios/*.md` files in a group's official store, parsed and
 * sorted alphabetically by path. Multiple `isDefault: true` entries resolve
 * to the alphabetically-first; the others are demoted and a warning is
 * returned. Archived scenarios are omitted unless `options.includeArchived`.
 */
export async function listGroupScenarios(
  mountPointId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ListGroupScenariosResult> {
  return listScenariosInFolder(mountPointId, GROUP_SCENARIOS_FOLDER, options);
}

/**
 * Read a single scenario by relative path and return its parsed shape.
 */
export async function readGroupScenario(
  mountPointId: string,
  relativePath: string,
): Promise<ParsedGroupScenario | null> {
  return readScenarioByPath(mountPointId, relativePath);
}

/**
 * Resolve a group scenario's body by `Scenarios/<filename>.md` path. Used
 * by the chat creation API to bake the scenario into `chat.scenarioText`.
 */
export async function resolveGroupScenarioBody(
  mountPointId: string,
  scenarioPath: string,
): Promise<string | null> {
  return resolveScenarioBody(mountPointId, scenarioPath, GROUP_SCENARIOS_FOLDER);
}

/**
 * Set a single file as the group default. Demotes any siblings that also
 * had `isDefault: true`.
 */
export async function setGroupScenarioDefault(
  mountPointId: string,
  defaultPath: string,
): Promise<void> {
  return setScenarioDefaultInFolder(mountPointId, defaultPath, GROUP_SCENARIOS_FOLDER);
}
