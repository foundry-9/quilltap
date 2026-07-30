/**
 * Chats API v1 - Tool Actions
 *
 * Handles add-tool-result and update-tool-settings actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';
import { toolResultSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Schema for updating tool settings
 */
const updateToolSettingsSchema = z.object({
  disabledTools: z.array(z.string()).default([]),
  disabledToolGroups: z.array(z.string()).default([]),
});

/**
 * Add a tool result message to the chat
 */
export async function handleAddToolResult(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validated = toolResultSchema.parse(body);

  // User-initiated tool results render as Prospero-authored standalone bubbles
  // in the salon UI; character-initiated results stay attached to the
  // preceding ASSISTANT message and don't carry a Staff sender.
  const isUserInitiated = validated.initiatedBy === 'user';
  const operatorName = isUserInitiated ? (user.name || user.username) : undefined;

  const toolResultMessage = await repos.chats.addMessage(chatId, {
    type: 'message',
    id: randomUUID(),
    role: 'TOOL',
    systemSender: isUserInitiated ? 'prospero' : null,
    systemKind: isUserInitiated ? 'tool-run' : null,
    content: JSON.stringify({
      tool: validated.tool,
      toolName: validated.tool,
      initiatedBy: validated.initiatedBy,
      operatorName,
      prompt: validated.prompt,
      result: validated.result,
      images: validated.images,
      success: validated.initiatedBy === 'user' ? true : validated.result?.success ?? false,
    }),
    createdAt: new Date().toISOString(),
    attachments: [],
  });

  logger.info('[Chats v1] Tool result added', { chatId, tool: validated.tool });

  return NextResponse.json({
    success: true,
    message: toolResultMessage,
  });
}

/**
 * Update tool settings for a chat
 */
export async function handleUpdateToolSettings(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validated = updateToolSettingsSchema.parse(body);

  // Update the chat with new tool settings
  // Set forceToolsOnNextMessage flag to trigger tool change notification on next message
  await repos.chats.update(chatId, {
    disabledTools: validated.disabledTools,
    disabledToolGroups: validated.disabledToolGroups,
    forceToolsOnNextMessage: true,
  });

  logger.info('[Chats v1] Tool settings updated', {
    chatId,
    disabledToolsCount: validated.disabledTools.length,
    disabledTools: validated.disabledTools,
    disabledGroupsCount: validated.disabledToolGroups.length,
    disabledToolGroups: validated.disabledToolGroups,
  });

  return successResponse({
    disabledTools: validated.disabledTools,
    disabledToolGroups: validated.disabledToolGroups,
  });
}
