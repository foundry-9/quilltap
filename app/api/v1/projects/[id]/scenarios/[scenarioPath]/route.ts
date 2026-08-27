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
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/scenario-item-route-factory.ts`); this file only supplies
 * the project tier's config.
 */

import { createScenarioItemHandlers } from '@/lib/mount-index/scenario-item-route-factory';
import {
  ensureProjectScenariosFolder,
  listProjectScenarios,
  readProjectScenario,
  setProjectScenarioDefault,
  PROJECT_SCENARIOS_FOLDER,
} from '@/lib/mount-index/project-scenarios';

export const { GET, PUT, POST, DELETE } = createScenarioItemHandlers({
  ownerLabel: 'Project',
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
  scenariosFolder: PROJECT_SCENARIOS_FOLDER,
  findOwner: (repos, id) => repos.projects.findById(id),
  ensureFolders: async (mountPointId) => {
    await ensureProjectScenariosFolder(mountPointId);
  },
  listScenarios: listProjectScenarios,
  readScenario: readProjectScenario,
  setScenarioDefault: setProjectScenarioDefault,
});
