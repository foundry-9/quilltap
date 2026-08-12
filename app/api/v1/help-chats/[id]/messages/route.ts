/**
 * Help Chat Messages API v1 Route
 *
 * POST /api/v1/help-chats/[id]/messages - Send message, get streaming response
 * GET /api/v1/help-chats/[id]/messages - Load messages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import { handleHelpChatMessage } from '@/lib/services/help-chat/orchestrator.service';
import { notFound, successResponse } from '@/lib/api/responses';

const logger = createServiceLogger('HelpChatMessagesRoute');

// ============================================================================
// Schemas
// ============================================================================

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  fileIds: z.array(z.string().uuid()).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify chat exists, belongs to user, and is a help chat.
 * Returns the chat or a NextResponse error.
 */
async function verifyHelpChat(
  id: string,
  context: RequestContext
): Promise<{ chat: any } | NextResponse> {
  const { user, repos } = context;
  const chat = await repos.chats.findById(id);

  if (!chat) {
    return notFound('Help chat');
  }

  if ((chat as any).chatType !== 'help') {
    return notFound('Help chat');
  }

  return { chat };
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Send a message to a help chat and receive a streaming response
 */
async function handleSendMessage(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const parsed = sendMessageSchema.parse(body);

  const stream = await handleHelpChatMessage(repos, id, user.id, {
    content: parsed.content,
    fileIds: parsed.fileIds,
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Load messages for a help chat
 */
async function handleGetMessages(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;

  const messages = await repos.chats.getMessages(id);

  return successResponse({ messages });
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /api/v1/help-chats/[id]/messages
 * Send a message and get streaming response
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleSendMessage(req, context, id);
  }
);

/**
 * GET /api/v1/help-chats/[id]/messages
 * Load messages for a help chat
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGetMessages(req, context, id);
  }
);
