/**
 * Chats API v1 - RNG Action
 *
 * Handles manual RNG invocation from the ToolPalette dropdown
 * POST /api/v1/chats/[id]?action=rng
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { executeRngTool, formatRngResults, type RngToolContext } from '@/lib/tools/handlers/rng-handler';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Schema for RNG request
 */
const rngRequestSchema = z.object({
  type: z.union([
    z.number().int().min(2).max(1000),
    z.enum(['flip_coin', 'spin_the_bottle']),
  ]),
  rolls: z.number().int().min(1).max(100).default(1),
  /** Preview mode returns result without creating a message */
  preview: z.boolean().optional().default(false),
});

/**
 * Execute RNG and add result as a message to the chat
 */
export async function handleRng(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validated = rngRequestSchema.parse(body);

  // Execute the RNG tool
  const rngContext: RngToolContext = {
    userId: user.id,
    chatId,
  };

  const result = await executeRngTool(validated, rngContext);

  if (!result.success) {
    logger.warn('[Chats v1] RNG execution failed', {
      chatId,
      userId: user.id,
      error: result.error,
    });
    return badRequest(result.error || 'RNG execution failed');
  }

  // Format the result for display
  const formattedResult = formatRngResults(result);

  // Format the request prompt for display
  let requestPrompt: string;
  if (validated.type === 'flip_coin') {
    requestPrompt = validated.rolls === 1
      ? 'Flip a coin'
      : `Flip ${validated.rolls} coins`;
  } else if (validated.type === 'spin_the_bottle') {
    requestPrompt = validated.rolls === 1
      ? 'Spin the bottle'
      : `Spin the bottle ${validated.rolls} times`;
  } else {
    requestPrompt = validated.rolls === 1
      ? `Roll a d${validated.type}`
      : `Roll ${validated.rolls}d${validated.type}`;
  }

  // Generate short summary for chip display
  let summary: string;
  if (validated.type === 'flip_coin') {
    summary = validated.rolls === 1
      ? `${result.results?.[0]}`
      : `${result.results?.join(', ')}`;
  } else if (validated.type === 'spin_the_bottle') {
    summary = validated.rolls === 1
      ? `${result.results?.[0]}`
      : `${result.results?.join(', ')}`;
  } else {
    summary = validated.rolls === 1
      ? `d${validated.type}: ${result.results?.[0]}`
      : `${validated.rolls}d${validated.type}: ${result.sum}`;
  }

  // Preview mode: return result without creating message
  if (validated.preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      result: {
        type: result.type,
        rollCount: result.rollCount,
        results: result.results,
        sum: result.sum,
        formattedText: formattedResult,
        summary,
        requestPrompt,
        arguments: {
          type: validated.type,
          rolls: validated.rolls,
        },
      },
    });
  }

  // Add the result as a TOOL message to the chat
  // Note: result field must be a string for ToolMessage component compatibility
  const toolResultMessage = await repos.chats.addMessage(chatId, {
    type: 'message',
    id: randomUUID(),
    role: 'TOOL',
    content: JSON.stringify({
      tool: 'rng',
      initiatedBy: 'user',
      success: true,
      result: formattedResult,
      // Show the request in human-readable form
      prompt: requestPrompt,
      // Store detailed data in arguments for debugging/inspection
      arguments: {
        type: validated.type,
        rolls: validated.rolls,
      },
    }),
    createdAt: new Date().toISOString(),
    attachments: [],
  });

  logger.info('[Chats v1] RNG result added to chat', {
    chatId,
    userId: user.id,
    type: result.type,
    rollCount: result.rollCount,
    results: result.results,
  });

  return NextResponse.json({
    success: true,
    message: toolResultMessage,
    result: {
      type: result.type,
      rollCount: result.rollCount,
      results: result.results,
      sum: result.sum,
      formattedText: formattedResult,
    },
  });
}
