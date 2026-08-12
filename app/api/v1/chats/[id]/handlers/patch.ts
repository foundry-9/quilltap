/**
 * Chats API v1 - PATCH Handler
 *
 * PATCH /api/v1/chats/[id]?action=turn - Persist turn state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import { notFound, badRequest } from '@/lib/api/responses';
import { persistTurnSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * PATCH handler for persisting turn state
 */
export async function handlePatch(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Only support turn action for PATCH
  if (action !== 'turn') {
    return badRequest('PATCH only supports action=turn for persisting turn state');
  }

  // Verify ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Parse and validate request body
  const body = await req.json();
  const { lastTurnParticipantId } = persistTurnSchema.parse(body);

  // If a participant ID is provided, verify it exists and is active
  if (lastTurnParticipantId !== null) {
    const participant = chat.participants.find(p => p.id === lastTurnParticipantId);
    if (!participant) {
      return notFound('Participant');
    }
    if (!participant.isActive) {
      // If the participant is no longer active, continue without logging
    }
  }

  // Update the chat metadata with the turn state
  await repos.chats.update(chatId, {
    lastTurnParticipantId,
  });

  return NextResponse.json({
    success: true,
    lastTurnParticipantId,
  });
}
