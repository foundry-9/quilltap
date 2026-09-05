/**
 * Group Wardrobe — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/wardrobe          — list every wardrobe item in the
 *                                               group's `Wardrobe/` folder.
 * POST /api/v1/groups/[id]/wardrobe          — create a new group wardrobe
 *                                               item. Body: { title, description?,
 *                                               types, appropriateness?, isDefault?,
 *                                               componentItemIds?, replace? }.
 * GET  /api/v1/groups/[id]/wardrobe?action=instructions — read the store's
 *                                               `Wardrobe/instructions.md`
 *                                               dressing instructions.
 * POST /api/v1/groups/[id]/wardrobe?action=instructions — write (or clear,
 *                                               with null/blank) them.
 *                                               Body: { instructions }.
 *
 * Group wardrobe is the group tier of the four-tier wardrobe model (character
 * vault > group stores > project stores > Quilltap General), mirroring the
 * project wardrobe routes. Both routes ensure the group's official store and
 * its `Wardrobe/` folder first so callers don't have to wait for a startup
 * heal pass. Group and project items share the same mount-folder storage, so
 * the writes reuse the mount-scoped helpers in `wardrobe-writes.ts`.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/mount-wardrobe-route-factory.ts`); this file only
 * supplies the group tier's config.
 *
 * @module app/api/v1/groups/[id]/wardrobe
 */

import { logger } from '@/lib/logger';
import { createMountWardrobeHandlers } from '@/lib/mount-index/mount-wardrobe-route-factory';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupWardrobeFolder,
  readGroupWardrobe,
} from '@/lib/mount-index/group-wardrobe';

export const { GET, POST } = createMountWardrobeHandlers({
  ownerLabel: 'Group',
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
  findOwner: (repos, id) => repos.groups.findById(id),
  ensureOfficialStore: ensureGroupOfficialStore,
  readWardrobe: readGroupWardrobe,
  ensureWardrobeFolder: ensureGroupWardrobeFolder,
  logListedItems: ({ ownerId, mountPointId, count }) => {
    logger.debug('[Groups v1] Listed group wardrobe items', {
      groupId: ownerId,
      mountPointId,
      count,
      context: 'wardrobe',
    });
  },
});
