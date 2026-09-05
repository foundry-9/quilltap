/**
 * Group Wardrobe — item detail endpoint.
 *
 * GET    /api/v1/groups/[id]/wardrobe/[itemId] — fetch one group wardrobe item.
 * PUT    /api/v1/groups/[id]/wardrobe/[itemId] — update one group wardrobe item.
 * DELETE /api/v1/groups/[id]/wardrobe/[itemId] — delete one group wardrobe item.
 *
 * Mirrors the project wardrobe item routes; group and project items share the
 * same mount-folder storage, so the writes reuse the mount-scoped helpers.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/mount-wardrobe-route-factory.ts`); this file only
 * supplies the group tier's config.
 *
 * @module app/api/v1/groups/[id]/wardrobe/[itemId]
 */

import { createMountWardrobeItemHandlers } from '@/lib/mount-index/mount-wardrobe-route-factory';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import { readGroupWardrobe } from '@/lib/mount-index/group-wardrobe';

export const { GET, PUT, DELETE } = createMountWardrobeItemHandlers({
  ownerLabel: 'Group',
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
  findOwner: (repos, id) => repos.groups.findById(id),
  ensureOfficialStore: ensureGroupOfficialStore,
  readWardrobe: readGroupWardrobe,
});
