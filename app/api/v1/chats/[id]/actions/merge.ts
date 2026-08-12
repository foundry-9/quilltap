/**
 * Chats API v1 - Merge Conversation Action
 *
 * POST /api/v1/chats/[id]?action=merge-conversation
 *
 * Folds another conversation's characters and summary into THIS chat (the
 * `[id]` chat is the merge target). The inverse of "Continue Elsewhere": rather
 * than forking forward into a new chat, it pulls a source chat's company in at
 * the latest point. Delegates the heavy lifting to `applyChatMerge`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import { mergeConversationSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { applyChatMerge } from '@/lib/chat/apply-chat-merge';

export async function handleMergeConversation(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const { sourceChatId, characterIds, outfitSelections } = mergeConversationSchema.parse(body);

  if (sourceChatId === chatId) {
    return badRequest('Cannot merge a conversation into itself');
  }

  // An explicit, empty allowlist means the operator gated everyone out.
  if (characterIds && characterIds.length === 0) {
    return badRequest('Select at least one character to merge in.');
  }

  const sourceChat = await repos.chats.findById(sourceChatId);
  if (!sourceChat) {
    return notFound('Source chat');
  }

  try {
    const mergeResult = await applyChatMerge({
      targetChatId: chatId,
      sourceChatId,
      userId: user.id,
      includeCharacterIds: characterIds,
      outfitSelections,
      repos,
    });

    if (mergeResult.mergedCharacterIds.length === 0) {
      // No bubbles were posted in this case (applyChatMerge guards on merged
      // count), so it's safe to report this as a no-op without side effects.
      return badRequest('None of the chosen characters could be merged in (already present).');
    }

    const refreshed = await repos.chats.findById(chatId);
    logger.info('[Chats v1] Conversation merged', {
      chatId,
      sourceChatId,
      mergedCount: mergeResult.mergedCharacterIds.length,
      skippedAlreadyPresentCount: mergeResult.skippedAlreadyPresentCharacterIds.length,
    });

    return NextResponse.json({ success: true, merge: mergeResult, chat: refreshed ?? chat });
  } catch (error) {
    logger.error('[Chats v1] Conversation merge failed', {
      chatId,
      sourceChatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to merge conversation');
  }
}
