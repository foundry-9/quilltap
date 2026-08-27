/**
 * Scenario selection — the one place a chosen scenario becomes text.
 *
 * Both the New Chat dialog and the in-chat scenario picker offer the same four
 * tiers of preset, plus free-text notes. This module owns the precedence chain
 * and the resolution of each tier's pointer into a body:
 *
 *   character `scenarioId` > project path > group path > general path
 *
 * The free text is NOT part of that chain — whatever the chain resolves is the
 * preset, and the notes are layered beneath it by `combineScenarioText`. When
 * nothing resolves and no notes were typed, the result is `undefined`, which
 * callers persist as a `null` `chat.scenarioText`.
 *
 * Every tier fails soft: an unresolvable pointer logs a warning and falls
 * through to the next tier rather than refusing the whole operation. A chat is
 * still worth having when its scenario file has been renamed out from under it.
 *
 * @module chat/scenario-selection
 */

import { logger } from '@/lib/logger';
import { combineScenarioText } from '@/lib/chat/scenario-text';
import type { RepositoryContainer } from '@/lib/repositories/factory';

/**
 * The scenario fields as they arrive from a client — the New Chat dialog's
 * create payload and the in-chat picker's `?action=scenario` body use the same
 * names, so the same resolver serves both.
 */
export interface ScenarioSelectionFields {
  /** Free-text notes. Appended beneath a resolved preset, or used alone. */
  scenario?: string | null;
  /** A character scenario's UUID, looked up on `character.scenarios`. */
  scenarioId?: string | null;
  /** `Scenarios/<file>.md` inside the project's official store. Needs `projectId`. */
  projectScenarioPath?: string | null;
  /** `Scenarios/<file>.md` inside a group's official store. Needs `groupScenarioGroupId`. */
  groupScenarioPath?: string | null;
  groupScenarioGroupId?: string | null;
  /** `Scenarios/<file>.md` inside the instance-wide "Quilltap General" mount. */
  generalScenarioPath?: string | null;
}

/** The character whose `scenarios` array backs a `scenarioId` lookup. */
interface ScenarioCharacter {
  id: string;
  scenarios?: Array<{ id: string; content: string }> | null;
}

export interface ResolveScenarioSelectionOptions {
  repos: RepositoryContainer;
  /** Required for `projectScenarioPath` to resolve. */
  projectId?: string | null;
  /** Required for `scenarioId` to resolve. */
  character?: ScenarioCharacter | null;
  /** Log prefix, so warnings read as coming from the calling route. */
  logTag?: string;
}

/**
 * Resolve one store-backed tier (project or group) into a scenario body.
 *
 * The two tiers are the same dance with different owners: guard on the owning
 * id, read the slim raw row for its store pointer, then resolve the path
 * inside that store. Every miss logs a warning and returns `undefined` so the
 * chain falls through to the next tier.
 */
async function resolveStoreScenarioTier(options: {
  logTag: string;
  /** The owner word in the "has no officialMountPointId" warning. */
  ownerLabel: 'project' | 'group';
  /** The path field's name as it reads in warnings and their metadata. */
  pathField: string;
  /** The owning id's name as it reads in warnings and their metadata. */
  ownerIdField: string;
  ownerId: string | null | undefined;
  path: string;
  /** Slim raw-row read — only the store pointer is needed, and the raw row
   * keeps resolution from throwing on a degraded store. */
  findRaw: (id: string) => Promise<{ officialMountPointId?: string | null } | null | undefined>;
  /** Dynamic-import thunk for the tier's body resolver. */
  loadResolver: () => Promise<(mountPointId: string, scenarioPath: string) => Promise<string | null>>;
}): Promise<string | undefined> {
  const { logTag, ownerLabel, pathField, ownerIdField, ownerId, path } = options;

  if (!ownerId) {
    logger.warn(`${logTag} ${pathField} provided without ${ownerIdField}; ignoring`, {
      [pathField]: path,
    });
    return undefined;
  }

  const owner = await options.findRaw(ownerId);
  if (!owner?.officialMountPointId) {
    logger.warn(`${logTag} ${pathField} provided but ${ownerLabel} has no officialMountPointId`, {
      [ownerIdField]: ownerId,
      [pathField]: path,
    });
    return undefined;
  }

  const resolveBody = await options.loadResolver();
  const body = await resolveBody(owner.officialMountPointId, path);
  if (!body) {
    logger.warn(`${logTag} ${pathField} did not resolve to a body`, {
      [ownerIdField]: ownerId,
      [pathField]: path,
    });
    return undefined;
  }
  return body;
}

/**
 * Resolve a scenario selection into the text that lands on `chat.scenarioText`.
 * Returns `undefined` when nothing was chosen and nothing was typed.
 */
export async function resolveScenarioSelection(
  fields: ScenarioSelectionFields,
  options: ResolveScenarioSelectionOptions,
): Promise<string | undefined> {
  const { repos, projectId, character, logTag = '[Scenario]' } = options;

  let presetBody: string | undefined;

  if (!presetBody && fields.scenarioId) {
    const matchingScenario = character?.scenarios?.find((s) => s.id === fields.scenarioId);
    if (matchingScenario) {
      presetBody = matchingScenario.content;
    } else {
      logger.warn(`${logTag} scenarioId not found on character`, {
        characterId: character?.id ?? null,
        scenarioId: fields.scenarioId,
      });
    }
  }

  if (!presetBody && fields.projectScenarioPath) {
    presetBody = await resolveStoreScenarioTier({
      logTag,
      ownerLabel: 'project',
      pathField: 'projectScenarioPath',
      ownerIdField: 'projectId',
      ownerId: projectId,
      path: fields.projectScenarioPath,
      findRaw: (id) => repos.projects.findByIdRaw(id),
      loadResolver: async () =>
        (await import('@/lib/mount-index/project-scenarios')).resolveProjectScenarioBody,
    });
  }

  if (!presetBody && fields.groupScenarioPath) {
    presetBody = await resolveStoreScenarioTier({
      logTag,
      ownerLabel: 'group',
      pathField: 'groupScenarioPath',
      ownerIdField: 'groupScenarioGroupId',
      ownerId: fields.groupScenarioGroupId,
      path: fields.groupScenarioPath,
      findRaw: (id) => repos.groups.findByIdRaw(id),
      loadResolver: async () =>
        (await import('@/lib/mount-index/group-scenarios')).resolveGroupScenarioBody,
    });
  }

  if (!presetBody && fields.generalScenarioPath) {
    const { resolveGeneralScenarioBody } = await import('@/lib/mount-index/general-scenarios');
    const body = await resolveGeneralScenarioBody(fields.generalScenarioPath);
    if (body) {
      presetBody = body;
    } else {
      logger.warn(`${logTag} generalScenarioPath did not resolve to a body`, {
        generalScenarioPath: fields.generalScenarioPath,
      });
    }
  }

  // Append the user's free-text scenario notes. When a preset resolved above, the
  // notes are layered beneath it; when none did, the notes ARE the scenario.
  return combineScenarioText(presetBody, fields.scenario);
}
