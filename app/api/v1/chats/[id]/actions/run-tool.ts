/**
 * Chats API v1 - Run Tool Action
 *
 * Handles user-initiated tool execution from the Run Tool modal
 * POST /api/v1/chats/[id]?action=run-tool
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { executeToolCallWithContext } from '@/lib/chat/tool-executor';
import type { ToolExecutionContext } from '@/lib/chat/tool-executor';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Tools that cannot be invoked directly by users
 */
const NON_USER_INVOCABLE_TOOLS = new Set([
  'submit_final_response',
  'request_full_context',
]);

/**
 * Schema for run-tool request
 */
const runToolRequestSchema = z.object({
  toolName: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.string(), z.unknown()).default({}),
  characterId: z.string().optional(),
  /** When true, the run is whispered: hidden from the salon UI by default
   *  (only visible when "show all whispers" is on) and excluded from every
   *  character's LLM context. */
  private: z.boolean().default(false),
});

/**
 * Execute an arbitrary tool and add result as a message to the chat
 */
export async function handleRunTool(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validated = runToolRequestSchema.parse(body);

  // Reject non-user-invocable tools
  if (NON_USER_INVOCABLE_TOOLS.has(validated.toolName)) {
    logger.warn('[Chats v1] Rejected user invocation of internal tool', {
      chatId,
      userId: user.id,
      toolName: validated.toolName,
    });
    return badRequest(`Tool '${validated.toolName}' cannot be invoked directly`);
  }

  // Load chat to derive execution context
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  // Find the active character participant for context
  // If a characterId was provided, match that specific character; otherwise fall back to first active
  const characterParticipant = validated.characterId
    ? chat.participants.find(
        p => p.type === 'CHARACTER' && p.isActive && p.characterId === validated.characterId
      )
    : chat.participants.find(
        p => p.type === 'CHARACTER' && p.isActive
      );

  const executionContext: ToolExecutionContext = {
    chatId,
    userId: user.id,
    imageProfileId: chat.imageProfileId || characterParticipant?.imageProfileId || undefined,
    characterId: characterParticipant?.characterId || undefined,
    callingParticipantId: characterParticipant?.id || undefined,
    projectId: chat.projectId || undefined,
  };

  // Execute the tool
  const result = await executeToolCallWithContext(
    { name: validated.toolName, arguments: validated.arguments },
    executionContext
  );

  // Preserve structured result payloads for the chat UI.
  // Components like `ToolMessage` use rich fields (for example wardrobe action metadata)
  // to render inline summaries, so avoid flattening objects into JSON strings here.
  const resultContent = result.result;

  // Build a human-readable prompt description
  const argsEntries = Object.entries(validated.arguments);
  const promptParts = argsEntries.length > 0
    ? argsEntries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
    : '';
  const requestPrompt = promptParts
    ? `${validated.toolName}(${promptParts})`
    : validated.toolName;

  // Operator name shown in the Prospero attribution line ("Charles ran rng").
  const operatorName = user.name || user.username;

  // Add the result as a TOOL message to the chat, authored by Prospero. When
  // private, target the operator's userId — it is a UUID but not a participant
  // ID, so the salon visibility filter and `filterWhisperMessages` exclude
  // every character context while the "show all whispers" toggle still reveals
  // it to the operator.
  const toolResultMessage = await repos.chats.addMessage(chatId, {
    type: 'message',
    id: randomUUID(),
    role: 'TOOL',
    systemSender: 'prospero',
    systemKind: 'tool-run',
    targetParticipantIds: validated.private ? [user.id] : null,
    content: JSON.stringify({
      tool: validated.toolName,
      toolName: validated.toolName,
      initiatedBy: 'user',
      operatorName,
      private: validated.private,
      success: result.success,
      result: resultContent,
      error: result.error || undefined,
      prompt: requestPrompt,
      arguments: validated.arguments,
    }),
    createdAt: new Date().toISOString(),
    attachments: [],
  });

  logger.info('[Chats v1] User-invoked tool result added to chat', {
    chatId,
    userId: user.id,
    toolName: validated.toolName,
    success: result.success,
    private: validated.private,
  });

  return NextResponse.json({
    success: true,
    message: toolResultMessage,
    result: {
      toolName: result.toolName,
      success: result.success,
      result: result.result,
      error: result.error,
    },
  });
}
