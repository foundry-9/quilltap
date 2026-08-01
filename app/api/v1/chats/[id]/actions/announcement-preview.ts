/**
 * Chats API v1 - Announcement Preview Action
 *
 * Generates an in-character rewrite of a seed announcement for an off-scene
 * character, using their connection profile, system prompt, and Commonplace
 * Book memories. Does not persist — the caller (the Insert Announcement
 * dialog) shows the result to the operator for approval, edit, or regenerate,
 * and only the approved text is posted via `?action=announcement`.
 *
 * POST /api/v1/chats/[id]?action=announcement-preview
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound } from '@/lib/api/responses';
import { generateCharacterVoicedAnnouncement } from '@/lib/services/announcer/character-voiced';
import { resolveAnnouncementAudience } from '@/lib/services/announcer/audience';
import { insertAnnouncementPreviewSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleAnnouncementPreview(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validated = insertAnnouncementPreviewSchema.parse(body);

  const character = await repos.characters.findById(validated.characterId);
  if (!character) {
    return notFound('Character');
  }

  const profile = await repos.connections.findById(validated.connectionProfileId);
  if (!profile) {
    return notFound('Connection profile');
  }

  // Nothing is persisted here, so an unresolvable target is not worth failing
  // the rehearsal over — it simply doesn't contribute a name to the audience.
  // The post action is the gate that refuses dangling ids.
  const audience = await resolveAnnouncementAudience(chatId, validated.targetParticipantIds);

  const result = await generateCharacterVoicedAnnouncement({
    chatId,
    character,
    profile,
    seedMarkdown: validated.seedMarkdown,
    systemPromptId: validated.systemPromptId,
    userId: user.id,
    audienceNames: audience.targetNames,
  });

  if (!result.success) {
    return badRequest(result.error || 'Failed to generate in-character announcement.');
  }

  logger.info('[Chats v1] Announcement preview generated', {
    chatId,
    characterId: validated.characterId,
    profileId: validated.connectionProfileId,
    audienceCount: audience.targetNames.length,
    proposedLength: result.proposedMarkdown.length,
  });

  return NextResponse.json({
    success: true,
    proposedMarkdown: result.proposedMarkdown,
  });
}
