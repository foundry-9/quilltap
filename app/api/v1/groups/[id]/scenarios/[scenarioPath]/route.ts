/**
 * Group Scenarios — single-scenario endpoint.
 *
 * Routes:
 *   GET    /api/v1/groups/[id]/scenarios/[scenarioPath]  — read one
 *   PUT    /api/v1/groups/[id]/scenarios/[scenarioPath]  — update content + frontmatter
 *   POST   /api/v1/groups/[id]/scenarios/[scenarioPath]?action=rename
 *                                                        — rename the file
 *   DELETE /api/v1/groups/[id]/scenarios/[scenarioPath]  — delete the file
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The route accepts the bare filename (with or without `.md`) and prefixes
 * `Scenarios/` server-side; `..` segments are rejected. This matches the
 * convenience accepted by `resolveGroupScenarioBody`.
 *
 * PUT, POST and DELETE all honour `?includeArchived=true` on the freshly-listed
 * scenarios they return, so a manager with "Show archived" ticked gets back a
 * list that still contains the row it just changed.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/scenario-item-route-factory.ts`); this file only supplies
 * the group tier's config.
 */

import { createScenarioItemHandlers } from '@/lib/mount-index/scenario-item-route-factory';
import {
  ensureGroupScenariosFolder,
  ensureGroupKnowledgeFolder,
  listGroupScenarios,
  readGroupScenario,
  setGroupScenarioDefault,
  GROUP_SCENARIOS_FOLDER,
} from '@/lib/mount-index/group-scenarios';

export const { GET, PUT, POST, DELETE } = createScenarioItemHandlers({
  ownerLabel: 'Group',
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
  scenariosFolder: GROUP_SCENARIOS_FOLDER,
  findOwner: (repos, id) => repos.groups.findById(id),
  ensureFolders: async (mountPointId) => {
    await ensureGroupScenariosFolder(mountPointId);
    await ensureGroupKnowledgeFolder(mountPointId);
  },
  listScenarios: listGroupScenarios,
  readScenario: readGroupScenario,
  setScenarioDefault: setGroupScenarioDefault,
});
