/**
 * Project Wardrobe — item detail endpoint.
 *
 * GET    /api/v1/projects/[id]/wardrobe/[itemId] — fetch one project wardrobe item.
 * PUT    /api/v1/projects/[id]/wardrobe/[itemId] — update one project wardrobe item.
 * DELETE /api/v1/projects/[id]/wardrobe/[itemId] — delete one project wardrobe item.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/mount-wardrobe-route-factory.ts`); this file only
 * supplies the project tier's config.
 *
 * @module app/api/v1/projects/[id]/wardrobe/[itemId]
 */

import { createMountWardrobeItemHandlers } from '@/lib/mount-index/mount-wardrobe-route-factory';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import { readProjectWardrobe } from '@/lib/mount-index/project-wardrobe';

export const { GET, PUT, DELETE } = createMountWardrobeItemHandlers({
  ownerLabel: 'Project',
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
  findOwner: (repos, id) => repos.projects.findById(id),
  ensureOfficialStore: ensureProjectOfficialStore,
  readWardrobe: readProjectWardrobe,
});
