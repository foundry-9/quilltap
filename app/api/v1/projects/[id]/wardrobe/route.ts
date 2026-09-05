/**
 * Project Wardrobe — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/wardrobe          — list every wardrobe item in the
 *                                                 project's `Wardrobe/` folder.
 * POST /api/v1/projects/[id]/wardrobe          — create a new project wardrobe
 *                                                 item. Body: { title, description?,
 *                                                 types, appropriateness?, isDefault?,
 *                                                 componentItemIds?, replace? }.
 * GET  /api/v1/projects/[id]/wardrobe?action=instructions — read the store's
 *                                                 `Wardrobe/instructions.md`
 *                                                 dressing instructions.
 * POST /api/v1/projects/[id]/wardrobe?action=instructions — write (or clear,
 *                                                 with null/blank) them.
 *                                                 Body: { instructions }.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model (character
 * vault + project stores + Quilltap General), mirroring project scenarios. Both
 * routes ensure the project's official store and its `Wardrobe/` folder first so
 * callers don't have to wait for a startup heal pass.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/mount-wardrobe-route-factory.ts`); this file only
 * supplies the project tier's config.
 *
 * @module app/api/v1/projects/[id]/wardrobe
 */

import { createMountWardrobeHandlers } from '@/lib/mount-index/mount-wardrobe-route-factory';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  ensureProjectWardrobeFolder,
  readProjectWardrobe,
} from '@/lib/mount-index/project-wardrobe';

export const { GET, POST } = createMountWardrobeHandlers({
  ownerLabel: 'Project',
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
  findOwner: (repos, id) => repos.projects.findById(id),
  ensureOfficialStore: ensureProjectOfficialStore,
  readWardrobe: readProjectWardrobe,
  ensureWardrobeFolder: ensureProjectWardrobeFolder,
});
