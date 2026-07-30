/**
 * Chats API v1 - Group Stores Action
 *
 * GET /api/v1/chats/[id]?action=group-stores
 *
 * Returns the document stores belonging to the groups that the current
 * chat's user-persona character(s) are members of. Used by the
 * LibraryFilePickerModal to show a "Group Files" section above the
 * Projects section.
 */
import { NextResponse } from 'next/server';
import { notFound, successResponse } from '@/lib/api/responses';
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleGetGroupStores(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const mountIdSet = new Set<string>();

  for (const participant of chat.participants) {
    if (participant.type !== 'CHARACTER') continue;
    if (!participant.characterId) continue;
    if (participant.controlledBy !== 'user') continue;
    if (participant.status === 'removed') continue;

    const ids = await resolveGroupMountPointIdsForCharacter(participant.characterId);
    for (const id of ids) {
      mountIdSet.add(id);
    }
  }

  const stores: Array<{
    id: string;
    name: string;
    mountType: string;
    storeType: string;
    enabled: boolean;
  }> = [];

  for (const id of mountIdSet) {
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) continue;
    if (!mp.enabled) continue;
    if (mp.mountType !== 'database') continue;
    if (mp.storeType === 'character') continue;

    stores.push({
      id: mp.id,
      name: mp.name,
      mountType: mp.mountType,
      storeType: mp.storeType ?? 'documents',
      enabled: mp.enabled,
    });
  }

  return successResponse({ stores });
}
