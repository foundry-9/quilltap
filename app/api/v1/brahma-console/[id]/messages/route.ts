/**
 * Brahma Console Messages API v1 Route
 *
 * POST /api/v1/brahma-console/[id]/messages - Send a message, get an SSE stream
 * GET  /api/v1/brahma-console/[id]/messages - Load messages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { z } from 'zod';
import { handleBrahmaConsoleMessage } from '@/lib/services/brahma-console/orchestrator.service';
import { successResponse } from '@/lib/api/responses';
import { verifyBrahmaChat } from '../../_shared';

// ============================================================================
// Schemas
// ============================================================================

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  fileIds: z.array(z.string().uuid()).optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

async function handleSendMessage(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const parsed = sendMessageSchema.parse(body);

  const stream = await handleBrahmaConsoleMessage(repos, id, user.id, {
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

async function handleGetMessages(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const messages = await repos.chats.getMessages(id);

  return successResponse({ messages });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleSendMessage(req, context, id);
  }
);

export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGetMessages(req, context, id);
  }
);
