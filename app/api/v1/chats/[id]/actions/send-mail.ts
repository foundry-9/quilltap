/**
 * Chats API v1 - Compose Mail Action (The Post Office)
 *
 * Posts a letter as one of the operator's player-characters, delivered through
 * the same shared Post Office service the `send_mail` tool uses. The operator
 * can only sign as a character they actually play in THIS chat, so the
 * `fromCharacterId` is re-verified against the participant list server-side.
 *
 * POST /api/v1/chats/[id]?action=send-mail
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound, created } from '@/lib/api/responses';
import { composeAndDeliverLetter } from '@/lib/post-office/deliver';
import { sendMailActionSchema } from '../schemas';
import { findOperatorPlayedParticipant } from '../participant-auth';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

export async function handleSendMail(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validated = sendMailActionSchema.parse(body);

  // The operator may only post AS a character they actually play in this chat.
  // Re-verify against the participant list — never trust the client to send as
  // an LLM character or a stranger.
  const fromParticipant = findOperatorPlayedParticipant(chat, validated.fromCharacterId);
  if (!fromParticipant) {
    logger.warn('[Chats v1] Compose Mail rejected: from-character not a player in this chat', {
      chatId,
      fromCharacterId: validated.fromCharacterId,
    });
    return badRequest('You can only post a letter as a character you are playing in this scene.');
  }

  // Use raw rows (existence-only) so a hollow-but-present vault doesn't 503 here;
  // delivery re-provisions the vault idempotently anyway.
  const sender = await repos.characters.findByIdRaw(validated.fromCharacterId);
  if (!sender) {
    return notFound('Sender character');
  }
  if (sender.archivedAt) {
    return badRequest('That character is archived; rehydrate it to continue.');
  }
  const recipient = await repos.characters.findByIdRaw(validated.toCharacterId);
  if (!recipient) {
    return notFound('Recipient character');
  }
  if (recipient.archivedAt) {
    return badRequest('That recipient is archived; rehydrate them to continue.');
  }

  const result = await composeAndDeliverLetter({
    sender,
    recipient,
    message: validated.bodyMarkdown,
    inReplyTo: validated.inReplyToPath ?? null,
  });

  if (!result.ok) {
    return badRequest(
      "That letter is no longer in your own postbox, so there's nothing to reply to.",
    );
  }

  logger.info('[Chats v1] Compose Mail delivered', {
    chatId,
    fromCharacterId: sender.id,
    toCharacterId: recipient.id,
    path: result.path,
  });

  return created({ success: true, path: result.path });
}
