/**
 * Messages API v1 - Collection Endpoint
 *
 * GET /api/v1/messages?chatId= - List messages for a chat
 * POST /api/v1/messages?chatId= - Send a message (returns streaming SSE response)
 *
 * The POST endpoint returns Server-Sent Events for real-time streaming.
 */

import { createAuthenticatedHandler } from '@/lib/api/middleware';
import {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
  buildSendMessageOptions,
  buildContinueMessageOptions,
  sseStreamResponse,
} from '@/lib/services/chat-message';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, successResponse } from '@/lib/api/responses';
import { scrubUserAgent } from '@/lib/utils/user-agent';

/**
 * GET /api/v1/messages?chatId= - List messages for a chat
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  try {// Verify chat ownership
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    // Get messages
    const messages = await repos.chats.getMessages(chatId);

    // Filter to only message events (not system events, context summaries, etc.)
    const messageEvents = messages.filter((m) => m.type === 'message');

    return successResponse({
      messages: messageEvents,
      count: messageEvents.length,
    });
  } catch (error) {
    logger.error('[Messages API v1] Error listing messages', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list messages');
  }
});

/**
 * POST /api/v1/messages?chatId= - Send a message and get streaming response
 *
 * Returns Server-Sent Events (SSE) stream for real-time response.
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  // Get chatId from query string
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  // Validate chatId is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(chatId)) {
    return badRequest('Invalid chatId format');
  }

  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Parse request body
  const body = await req.json();
  const isContinueMode = body.continueMode === true;

  // Capture browser User-Agent for tool use (e.g., curl), scrubbing
  // Electron/Quilltap tokens so it looks like a normal browser.
  const browserUserAgent = scrubUserAgent(req.headers.get('user-agent') || undefined);

  // Validate request based on mode, then build options via the shared helper
  // so the forwarded field set stays in lockstep with /api/v1/chats/[id]/messages.
  const options = isContinueMode
    ? buildContinueMessageOptions(continueMessageSchema.parse(body), { browserUserAgent })
    : buildSendMessageOptions(sendMessageSchema.parse(body), { browserUserAgent });

  const stream = await handleSendMessage(repos, chatId, user.id, options);
  return sseStreamResponse(stream);
});
