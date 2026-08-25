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
    if (!projectId) {
      logger.warn(`${logTag} projectScenarioPath provided without projectId; ignoring`, {
        projectScenarioPath: fields.projectScenarioPath,
      });
    } else {
      // Only the store pointer is needed here, which lives on the raw row — use
      // findByIdRaw so scenario resolution doesn't throw on a degraded store.
      const project = await repos.projects.findByIdRaw(projectId);
      if (!project?.officialMountPointId) {
        logger.warn(`${logTag} projectScenarioPath provided but project has no officialMountPointId`, {
          projectId,
          projectScenarioPath: fields.projectScenarioPath,
        });
      } else {
        const { resolveProjectScenarioBody } = await import('@/lib/mount-index/project-scenarios');
        const body = await resolveProjectScenarioBody(
          project.officialMountPointId,
          fields.projectScenarioPath,
        );
        if (body) {
          presetBody = body;
        } else {
          logger.warn(`${logTag} projectScenarioPath did not resolve to a body`, {
            projectId,
            projectScenarioPath: fields.projectScenarioPath,
          });
        }
      }
    }
  }

  if (!presetBody && fields.groupScenarioPath) {
    if (!fields.groupScenarioGroupId) {
      logger.warn(`${logTag} groupScenarioPath provided without groupScenarioGroupId; ignoring`, {
        groupScenarioPath: fields.groupScenarioPath,
      });
    } else {
      // Only the store pointer is needed — read the slim row so resolution
      // doesn't throw on a degraded store.
      const group = await repos.groups.findByIdRaw(fields.groupScenarioGroupId);
      if (!group?.officialMountPointId) {
        logger.warn(`${logTag} groupScenarioPath provided but group has no officialMountPointId`, {
          groupScenarioGroupId: fields.groupScenarioGroupId,
          groupScenarioPath: fields.groupScenarioPath,
        });
      } else {
        const { resolveGroupScenarioBody } = await import('@/lib/mount-index/group-scenarios');
        const body = await resolveGroupScenarioBody(
          group.officialMountPointId,
          fields.groupScenarioPath,
        );
        if (body) {
          presetBody = body;
        } else {
          logger.warn(`${logTag} groupScenarioPath did not resolve to a body`, {
            groupScenarioGroupId: fields.groupScenarioGroupId,
            groupScenarioPath: fields.groupScenarioPath,
          });
        }
      }
    }
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
