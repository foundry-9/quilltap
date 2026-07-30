/**
 * Chat Messages API v1 Route
 *
 * POST /api/v1/chats/[id]/messages - Send a message and get streaming response
 *
 * This route handles HTTP concerns and delegates business logic to the
 * chat message orchestrator service. Returns text/event-stream for real-time
 * LLM responses.
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
  buildSendMessageOptions,
  buildContinueMessageOptions,
  sseStreamResponse,
} from '@/lib/services/chat-message';
import { notFound } from '@/lib/api/responses';
import { scrubUserAgent } from '@/lib/utils/user-agent';

/**
 * POST - Send a message to a chat and receive a streaming response
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    // Verify chat ownership
    const chat = await repos.chats.findById(id);
    if (!chat) {
      return notFound('Chat');
    }

    // Parse request body
    const body = await req.json();
    const isContinueMode = body.continueMode === true;

    // Capture browser User-Agent for tool use (e.g., curl)
    // Scrub Electron/Quilltap tokens so it looks like a normal browser
    const browserUserAgent = scrubUserAgent(req.headers.get('user-agent') || undefined);

    // Validate request based on mode, then build options via the shared helper
    // so the forwarded field set stays in lockstep with /api/v1/messages.
    const options = isContinueMode
      ? buildContinueMessageOptions(continueMessageSchema.parse(body), { browserUserAgent })
      : buildSendMessageOptions(sendMessageSchema.parse(body), { browserUserAgent });

    const stream = await handleSendMessage(repos, id, user.id, options);
    return sseStreamResponse(stream);
  }
);
