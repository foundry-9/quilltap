/**
 * Chats API v1 - Title Actions
 *
 * Handles regenerate-title action
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';
import { titleChat, titleHelpChat, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks';
import type { RequestContext } from '@/lib/api/middleware';
import { isHelpLikeChatType, type ChatMetadata } from '@/lib/schemas/types';

/**
 * Regenerate a chat's title using LLM
 */
export async function handleRegenerateTitle(
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    if (!chatSettings?.cheapLLMSettings) {
      return badRequest('Cheap LLM settings not configured');
    }

    const availableProfiles = await repos.connections.findByUserId(user.id);
    if (availableProfiles.length === 0) {
      return badRequest('No connection profiles available');
    }

    const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER');
    let connectionProfile = availableProfiles[0];

    if (characterParticipant?.connectionProfileId) {
      const participantProfile = availableProfiles.find((p) => p.id === characterParticipant.connectionProfileId);
      if (participantProfile) {
        connectionProfile = participantProfile;
      }
    }

    const cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: chatSettings.cheapLLMSettings.strategy,
        userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    );

    if (!cheapLLM) {
      return badRequest('No cheap LLM available for title generation');
    }

    const allMessages = await repos.chats.getMessages(chatId);
    const conversationMessages = extractVisibleConversation(allMessages);

    if (conversationMessages.length === 0) {
      return badRequest('No messages in chat to generate title from');
    }

    const result = isHelpLikeChatType(chat.chatType)
      ? await titleHelpChat(conversationMessages, undefined, cheapLLM, user.id, chatId)
      : await titleChat(conversationMessages, undefined, cheapLLM, user.id, chatId);

    if (!result.success || !result.result) {
      logger.error('[Chats v1] Title generation failed', { chatId, error: result.error });
      return serverError(result.error || 'Failed to generate title');
    }

    const newTitle = result.result;

    await repos.chats.update(chatId, {
      title: newTitle,
      isManuallyRenamed: false,
      updatedAt: new Date().toISOString(),
    });

    logger.info('[Chats v1] Title regenerated', { chatId, newTitle });

    return NextResponse.json({ success: true, title: newTitle });
  } catch (error) {
    logger.error('[Chats v1] Error regenerating title', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to regenerate title');
  }
}
