/**
 * Chats API v1 - State Actions
 *
 * GET /api/v1/chats/[id]?action=get-state - Get merged cascade state
 * PUT /api/v1/chats/[id]?action=set-state - Set chat state
 * DELETE /api/v1/chats/[id]?action=reset-state - Reset chat state to empty
 *
 * `handleGetState` returns the full four-tier cascade (chat → project → group →
 * general) using the participants-union group scope: the group tier spans every
 * active character participant, merging only when exactly one group applies.
 * Set/reset stay bespoke via the shared handlers and only ever touch the chat's
 * own state column.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError, notFound } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { createResetStateHandler, createSetStateHandler } from '@/lib/api/state-handlers';
import { resolveStateCascade } from '@/lib/state/state-cascade';

const STATE_CFG = {
  entityName: 'Chat',
  idLogKey: 'chatId',
  selectRepo: (repos: RequestContext['repos']) => repos.chats,
} as const;

/**
 * Get the merged cascade state for a chat, plus each tier and the group-tier
 * status. Empty tiers are omitted (the "undefined when empty" convention) so
 * the response stays compatible with the previous chat/project-only shape.
 */
export async function handleGetState(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const cascade = await resolveStateCascade({
      chat,
      groupScope: { kind: 'participants-union' },
    });

    return NextResponse.json({
      success: true,
      state: cascade.merged,
      chatState: cascade.chatState,
      projectState: Object.keys(cascade.projectState).length > 0 ? cascade.projectState : undefined,
      groupState: Object.keys(cascade.groupState).length > 0 ? cascade.groupState : undefined,
      generalState: Object.keys(cascade.generalState).length > 0 ? cascade.generalState : undefined,
      groupTier: cascade.groupTier,
      projectId: cascade.projectId,
    });
  } catch (error) {
    logger.error('[Chats v1] Error getting state', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get state');
  }
}

export const handleSetState = createSetStateHandler(STATE_CFG);
export const handleResetState = createResetStateHandler(STATE_CFG);
