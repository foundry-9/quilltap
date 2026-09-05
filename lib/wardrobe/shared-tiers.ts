/**
 * Shared Wardrobe Tiers
 *
 * The mounts that make up everything a character can wear *without owning it*:
 * their groups' stores and the chat's project stores. (Quilltap General is the
 * instance singleton — always in scope, never passed around.)
 *
 * One type and one resolver, so the tiers travel together. A call site that
 * threads only `projectMountPointIds` is the bug this module exists to prevent:
 * items moved into a group's `Wardrobe/` folder were invisible to every read
 * path, so nobody could wear the household livery hanging by the door.
 *
 * Precedence, mirroring `dedupeTierTriple` in `tiered-mount-pool.ts`:
 * **character > group > project > general**.
 *
 * @module wardrobe/shared-tiers
 */

import {
  resolveGroupMountPointIdsForCharacter,
  resolveProjectMountPointIdsForChat,
} from '@/lib/mount-index/tiered-mount-pool';

/**
 * The shared mounts in scope for one character's wardrobe.
 *
 * Both fields are optional so a caller with no chat/project context can pass a
 * partial object, but callers that *have* the context must pass both — the
 * whole point of the single type is that you can't thread one tier and quietly
 * drop the other.
 */
export interface SharedWardrobeTiers {
  /**
   * Group stores (official + linked) of every group the character belongs to.
   * Resolved per character, never per chat: a character never gains a
   * co-participant's group stores.
   */
  groupMountPointIds?: string[];
  /** Document stores linked to the chat's project. */
  projectMountPointIds?: string[];
}

/** Resolved tiers with both lists present. */
export interface ResolvedSharedWardrobeTiers extends SharedWardrobeTiers {
  groupMountPointIds: string[];
  projectMountPointIds: string[];
}

/**
 * Resolve both shared tiers for a character in a chat. Each tier fails soft to
 * `[]` on its own (the underlying resolvers swallow and log), so a missing chat
 * or a character with no group memberships simply narrows the pool.
 */
export async function resolveSharedWardrobeTiersForChat(
  chatId: string | null | undefined,
  characterId: string | null | undefined,
): Promise<ResolvedSharedWardrobeTiers> {
  const [groupMountPointIds, projectMountPointIds] = await Promise.all([
    resolveGroupMountPointIdsForCharacter(characterId),
    resolveProjectMountPointIdsForChat(chatId),
  ]);
  return { groupMountPointIds, projectMountPointIds };
}

/**
 * Pair an already-resolved project tier with one character's group tier.
 *
 * For the loops that resolve a whole cast against a single chat: the project
 * stores are the same for everyone and are fetched once by the caller, while
 * the group stores differ per character and must be fetched inside the loop.
 */
export async function sharedWardrobeTiersForCharacter(
  characterId: string | null | undefined,
  projectMountPointIds: string[] | undefined,
): Promise<ResolvedSharedWardrobeTiers> {
  return {
    groupMountPointIds: await resolveGroupMountPointIdsForCharacter(characterId),
    projectMountPointIds: projectMountPointIds ?? [],
  };
}
