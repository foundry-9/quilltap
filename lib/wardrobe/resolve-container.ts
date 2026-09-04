/**
 * Server-side resolution of a wardrobe container (see `wardrobe-container.ts`
 * for the client-safe shape) into the place its items are read from and
 * written to: a character id for the personal tier, a mount point for a
 * project or group store, neither for Quilltap General.
 *
 * Project and group stores are *ensured* on the way — the official store and
 * its `Wardrobe/` folder are provisioned if missing — because every caller
 * (the transfer route today) is about to read or write there. A character is
 * resolved only if `userId` owns it.
 *
 * @module lib/wardrobe/resolve-container
 */

import { logger } from '@/lib/logger';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import { ensureProjectWardrobeFolder, readProjectWardrobe } from '@/lib/mount-index/project-wardrobe';
import { ensureGroupWardrobeFolder, readGroupWardrobe } from '@/lib/mount-index/group-wardrobe';
import { readGeneralWardrobe } from '@/lib/mount-index/general-wardrobe';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WardrobeContainerScope } from '@/lib/wardrobe/wardrobe-container';

export interface ResolvedWardrobeContainer {
  scope: WardrobeContainerScope;
  /** Owning character — set only for the `character` scope. */
  characterId: string | null;
  /** Backing mount — set only for the `project` / `group` scopes. */
  mountPointId: string | null;
  /** Every item in the container, archived included. */
  readItems(): Promise<WardrobeItem[]>;
}

/**
 * Resolve `{ scope, id }` to a readable container, or `null` when the owning
 * entity is missing (or, for a character, not `userId`'s), when a non-General
 * scope arrives without an id, or when a project/group store can't be ensured.
 */
export async function resolveWardrobeContainer(
  scope: WardrobeContainerScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
): Promise<ResolvedWardrobeContainer | null> {
  const resolved = await resolveContainer(scope, id, repos, userId);
  logger.debug('[WardrobeContainer] Resolved wardrobe container', {
    scope,
    id: id ?? null,
    found: resolved !== null,
    mountPointId: resolved?.mountPointId ?? null,
    context: 'wardrobe',
  });
  return resolved;
}

async function resolveContainer(
  scope: WardrobeContainerScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
): Promise<ResolvedWardrobeContainer | null> {
  if (scope === 'general') {
    return {
      scope,
      characterId: null,
      mountPointId: null,
      readItems: () => readGeneralWardrobe(true),
    };
  }

  if (!id) return null;

  if (scope === 'character') {
    const character = await repos.characters.findById(id);
    if (!character || character.userId !== userId) return null;
    const characterId = character.id;
    return {
      scope,
      characterId,
      mountPointId: null,
      readItems: () => repos.wardrobe.findByCharacterId(characterId, true),
    };
  }

  if (scope === 'project') {
    const project = await repos.projects.findById(id);
    if (!project) return null;
    const ensured = await ensureProjectOfficialStore(project.id, project.name || 'Project');
    if (!ensured) return null;
    await ensureProjectWardrobeFolder(ensured.mountPointId);
    const mountPointId = ensured.mountPointId;
    return {
      scope,
      characterId: null,
      mountPointId,
      readItems: () => readProjectWardrobe(mountPointId, true),
    };
  }

  const group = await repos.groups.findById(id);
  if (!group) return null;
  const ensured = await ensureGroupOfficialStore(group.id, group.name || 'Group');
  if (!ensured) return null;
  await ensureGroupWardrobeFolder(ensured.mountPointId);
  const mountPointId = ensured.mountPointId;
  return {
    scope,
    characterId: null,
    mountPointId,
    readItems: () => readGroupWardrobe(mountPointId, true),
  };
}
