/**
 * Chats API v1 - Mailbox List Action (The Post Office)
 *
 * Lists the letters in a chat-participant character's `Mail/` folder, for the
 * Compose Mail modal's "In reply to" dropdown. The operator may only inspect a
 * mailbox for a character they actually play in THIS chat — nothing else.
 *
 * GET /api/v1/chats/[id]?action=mailbox&characterId=…
 */

import { NextRequest, NextResponse } from 'next/server';
import { badRequest, notFound, forbidden } from '@/lib/api/responses';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { listMailbox } from '@/lib/post-office/mailbox';
import { findOperatorPlayedParticipant } from '../participant-auth';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleGetMailbox(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!characterId) {
    return badRequest('characterId is required');
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Authorize: only a character the operator plays in this chat.
  const participant = findOperatorPlayedParticipant(chat, characterId);
  if (!participant) {
    return forbidden('You may only inspect the mailbox of a character you are playing in this scene.');
  }

  const character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    return notFound('Character');
  }

  const { mountPointId } = await ensureCharacterVault(character);
  const letters = await listMailbox(mountPointId);

  return NextResponse.json({
    letters: letters.map((l) => ({ path: l.path, from: l.from, sentAt: l.sentAt })),
  });
}
