/**
 * Audience resolution for ad-hoc announcements (Insert Announcement composer).
 *
 * An announcement is public by default. When the operator names an audience,
 * the bubble is posted as a whisper — so the ids they send must be re-verified
 * against the chat's *current* participants before anything is persisted. A
 * dangling id would produce a message no character can ever see and no filter
 * would ever surface: a whisper into the void.
 *
 * Shared by the post action (which refuses unknown ids) and the preview action
 * (which uses the resolved names to tell the character who they are addressing).
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';

export interface ResolvedAnnouncementAudience {
  /** Ids to persist — null when the announcement is public. */
  targetParticipantIds: string[] | null;
  /** Display names of the resolved targets, in the order requested. */
  targetNames: string[];
  /** Requested ids that are not current participants of this chat. */
  unknownIds: string[];
}

const PUBLIC: ResolvedAnnouncementAudience = {
  targetParticipantIds: null,
  targetNames: [],
  unknownIds: [],
};

/**
 * Resolve a requested audience against a chat's participants.
 *
 * Duplicates collapse and order is preserved. A removed participant is not a
 * valid target: whispering to someone who has left the scene is exactly the
 * dangling case this guards against. Callers decide what to do with
 * `unknownIds` — the post action rejects, the preview action ignores them and
 * carries on with whatever resolved.
 */
export async function resolveAnnouncementAudience(
  chatId: string,
  requested: string[] | null | undefined,
): Promise<ResolvedAnnouncementAudience> {
  if (!requested || requested.length === 0) {
    return PUBLIC;
  }

  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { targetParticipantIds: null, targetNames: [], unknownIds: [...new Set(requested)] };
  }

  const byId = new Map(
    chat.participants
      .filter(p => !p.removedAt && p.status !== 'removed')
      .map(p => [p.id, p] as const),
  );

  const targetParticipantIds: string[] = [];
  const unknownIds: string[] = [];
  for (const id of new Set(requested)) {
    if (byId.has(id)) {
      targetParticipantIds.push(id);
    } else {
      unknownIds.push(id);
    }
  }

  const targetNames = await Promise.all(
    targetParticipantIds.map(async id => {
      const participant = byId.get(id)!;
      if (!participant.characterId) return 'Someone';
      try {
        const character = await repos.characters.findById(participant.characterId);
        return character?.name?.trim() || 'Someone';
      } catch (error) {
        // A character whose vault is unavailable still has a valid participant
        // row; the whisper is deliverable, we just can't name them.
        logger.warn('[Announcer] Could not resolve audience name', {
          context: 'announcer',
          chatId,
          participantId: id,
          error: getErrorMessage(error),
        });
        return 'Someone';
      }
    }),
  );

  logger.debug('[Announcer] Resolved announcement audience', {
    context: 'announcer',
    chatId,
    requestedCount: requested.length,
    resolvedCount: targetParticipantIds.length,
    unknownCount: unknownIds.length,
  });

  return {
    targetParticipantIds: targetParticipantIds.length > 0 ? targetParticipantIds : null,
    targetNames,
    unknownIds,
  };
}
