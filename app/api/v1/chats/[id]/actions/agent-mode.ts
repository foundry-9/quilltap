/**
 * Chats API v1 - Agent Mode Actions
 *
 * Handles toggle-agent-mode action
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { resolveAgentModeSetting } from '@/lib/services/chat-message/agent-mode-resolver.service';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Schema for toggle agent mode request
 */
const toggleAgentModeSchema = z.object({
  enabled: z.boolean().nullable().optional(),
});

/**
 * Toggle agent mode for a chat
 *
 * @param req - The request object containing optional { enabled: boolean | null }
 * @param chatId - The ID of the chat
 * @param context - The authenticated context with user and repos
 */
export async function handleToggleAgentMode(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = toggleAgentModeSchema.parse(body);

  // Fetch the chat to verify it exists and user has access
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Update the chat with new agent mode setting
  const enabled = validatedData.enabled;
  const updatedChat = await repos.chats.update(chatId, {
    agentModeEnabled: enabled,
  });

  if (!updatedChat) {
    return serverError('Failed to update chat');
  }

  // Resolve the cascade to return the effective state
  let primaryCharacter = null;
  const characterParticipant = updatedChat.participants.find(
    (p) => p.type === 'CHARACTER' && p.characterId
  );
  if (characterParticipant?.characterId) {
    try {
      primaryCharacter = await repos.characters.findById(characterParticipant.characterId);
    } catch {
      // Character might have been deleted
    }
  }

  let project = null;
  if (updatedChat.projectId) {
    try {
      project = await repos.projects.findById(updatedChat.projectId);
    } catch {
      // Project might have been deleted
    }
  }

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const resolved = resolveAgentModeSetting(updatedChat, project, primaryCharacter, chatSettings);

  logger.info('[Chats v1] Agent mode toggled', {
    chatId,
    agentModeEnabled: enabled,
    resolvedAgentModeEnabled: resolved.enabled,
    agentModeSource: resolved.enabledSource,
    chatTitle: updatedChat.title,
  });

  return successResponse({
    agentModeEnabled: updatedChat.agentModeEnabled,
    resolvedAgentModeEnabled: resolved.enabled,
    agentModeSource: resolved.enabledSource,
    message: enabled === null ? 'Agent mode set to inherit' : enabled ? 'Agent mode enabled' : 'Agent mode disabled',
  });
}
