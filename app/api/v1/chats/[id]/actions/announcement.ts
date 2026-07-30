/**
 * Chats API v1 - Insert Announcement Action
 *
 * Posts an ad-hoc announcement bubble (Insert Announcement composer button).
 *
 * POST /api/v1/chats/[id]?action=announcement
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound } from '@/lib/api/responses';
import { postAdhocAnnouncement } from '@/lib/services/announcer/writer';
import { insertAnnouncementSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleInsertAnnouncement(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validated = insertAnnouncementSchema.parse(body);

  // For the 'character' branch, verify the referenced character actually exists
  // so we fail fast with a clear error rather than persisting a dangling reference.
  if (validated.sender.kind === 'character') {
    const character = await repos.characters.findById(validated.sender.characterId);
    if (!character) {
      return notFound('Character');
    }
  }

  const message = await postAdhocAnnouncement({
    chatId,
    contentMarkdown: validated.contentMarkdown,
    sender: validated.sender,
  });

  if (!message) {
    return badRequest('Failed to post announcement (empty content or unknown chat).');
  }

  logger.info('[Chats v1] Ad-hoc announcement posted', {
    chatId,
    messageId: message.id,
    senderKind: validated.sender.kind,
  });

  return NextResponse.json({ success: true, message }, { status: 201 });
}
