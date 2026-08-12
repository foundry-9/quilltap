/**
 * Chats API v1 - Photo Albums Action
 *
 * GET /api/v1/chats/[id]?action=photo-albums
 *
 * Returns the list of photo-album targets the Salon's Save-Image dialog
 * can offer for a given chat:
 *
 *   - one entry per chat participant with a character vault
 *   - the project's own mount point (`officialMountPointId`) if any
 *   - every document store linked to the project
 *   - the instance-wide "Quilltap General" mount point
 *
 * Exactly one option is flagged `isDefault: true`. Preference order:
 *   1. The active impersonated user character (if any)
 *   2. The first user-controlled participant with a vault
 *   3. The Quilltap General album (fallback for all-LLM chats)
 */
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import type { RequestContext } from '@/lib/api/middleware';

export type PhotoAlbumKind = 'character' | 'project' | 'document-store' | 'general';

export interface PhotoAlbumOption {
  mountPointId: string;
  /** Display label. Character albums use the character name; others use the mount-point name. */
  name: string;
  kind: PhotoAlbumKind;
  /** Present for `kind: 'character'`. */
  characterId?: string;
  /** Present for `kind: 'character'` — the chat participant whose vault this is. */
  participantId?: string;
  /** Present for `kind: 'character'` — true when the participant is user-controlled. */
  isUserCharacter?: boolean;
  /** Exactly one option in the response is marked default. */
  isDefault?: boolean;
}

export async function handleGetPhotoAlbums(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const options: PhotoAlbumOption[] = [];
    const seenMountIds = new Set<string>();

    // 1. Participant character vaults.
    for (const participant of chat.participants) {
      if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
      if (participant.status === 'removed') continue;
      const vault = await getCharacterVaultStore(participant.characterId);
      if (!vault) continue;
      if (seenMountIds.has(vault.mountPointId)) continue;

      const character = await repos.characters.findById(participant.characterId);
      const displayName = character?.name ?? vault.mountPointName;
      options.push({
        mountPointId: vault.mountPointId,
        name: displayName,
        kind: 'character',
        characterId: participant.characterId,
        participantId: participant.id,
        isUserCharacter: participant.controlledBy === 'user',
      });
      seenMountIds.add(vault.mountPointId);
    }

    // 2. Project album (officialMountPointId).
    let project = null;
    if (chat.projectId) {
      project = await repos.projects.findById(chat.projectId);
      if (project?.officialMountPointId && !seenMountIds.has(project.officialMountPointId)) {
        const mp = await repos.docMountPoints.findById(project.officialMountPointId);
        if (mp) {
          options.push({
            mountPointId: mp.id,
            name: mp.name,
            kind: 'project',
          });
          seenMountIds.add(mp.id);
        }
      }
    }

    // 3. Linked document stores for the project.
    if (chat.projectId) {
      const links = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
      for (const link of links) {
        if (seenMountIds.has(link.mountPointId)) continue;
        const mp = await repos.docMountPoints.findById(link.mountPointId);
        if (!mp) continue;
        options.push({
          mountPointId: mp.id,
          name: mp.name,
          kind: 'document-store',
        });
        seenMountIds.add(mp.id);
      }
    }

    // 4. Quilltap General.
    const generalId = await getGeneralMountPointId();
    if (generalId && !seenMountIds.has(generalId)) {
      const mp = await repos.docMountPoints.findById(generalId);
      if (mp) {
        options.push({
          mountPointId: mp.id,
          name: mp.name,
          kind: 'general',
        });
        seenMountIds.add(mp.id);
      }
    }

    // 5. Default selection.
    const activeTypingId = chat.activeTypingParticipantId ?? null;
    const activeImpersonated = activeTypingId
      ? options.find(o => o.kind === 'character' && o.participantId === activeTypingId && o.isUserCharacter)
      : undefined;
    const firstUserCharacter = options.find(o => o.kind === 'character' && o.isUserCharacter);
    const generalOption = options.find(o => o.kind === 'general');
    const defaultOption = activeImpersonated ?? firstUserCharacter ?? generalOption ?? options[0];
    if (defaultOption) {
      defaultOption.isDefault = true;
    }

    return NextResponse.json({ albums: options });
  } catch (error) {
    logger.error('[Chats v1] Failed to resolve photo albums', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to resolve photo albums');
  }
}
