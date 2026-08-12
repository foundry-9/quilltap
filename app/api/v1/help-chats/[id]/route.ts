/**
 * Help Chats API v1 - Individual Endpoint
 *
 * GET /api/v1/help-chats/[id] - Get help chat details
 * PATCH /api/v1/help-chats/[id] - Update help chat (rename)
 * DELETE /api/v1/help-chats/[id] - Delete help chat
 * PATCH /api/v1/help-chats/[id]?action=update-context - Update page context
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import type { ChatEvent } from '@/lib/schemas/types';
import { notFound, badRequest, serverError, successResponse, messageResponse } from '@/lib/api/responses';
import { enrichParticipantSummary } from '@/lib/services/chat-enrichment.service';

const logger = createServiceLogger('HelpChatsItemRoute');

const PATCH_ACTIONS = ['update-context'] as const;
type PatchAction = typeof PATCH_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

const renameSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

const updateContextSchema = z.object({
  pageUrl: z.string().min(1, 'Page URL is required'),
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
 * Get help chat details
 */
async function handleGet(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const enrichedParticipants = await Promise.all(
    chat.participants.map((p: any) => enrichParticipantSummary(p, repos))
  );

  const messages = await repos.chats.getMessages(id);

  return successResponse({
    chat: {
      ...chat,
      participants: enrichedParticipants,
      messageCount: messages.length,
    },
  });
}

/**
 * Rename a help chat
 */
async function handleRename(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const validatedData = renameSchema.parse(body);

  const updated = await repos.chats.update(id, {
    title: validatedData.title,
    isManuallyRenamed: true,
  });

  if (!updated) {
    return serverError('Failed to update help chat');
  }

  logger.info('Help chat renamed', { chatId: id, title: validatedData.title });

  return successResponse({ chat: updated });
}

/**
 * Update page context for a help chat
 */
async function handleUpdateContext(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const validatedData = updateContextSchema.parse(body);

  // Update the helpPageUrl on the chat
  const updated = await repos.chats.update(id, {
    helpPageUrl: validatedData.pageUrl,
  });

  if (!updated) {
    return serverError('Failed to update help chat context');
  }

  // Inject a system message noting the navigation
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: `[System: User navigated to ${validatedData.pageUrl}]`,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(id, systemMessage);

  logger.info('Help chat context updated', { chatId: id, pageUrl: validatedData.pageUrl });

  return successResponse({ chat: updated });
}

/**
 * Delete a help chat
 */
async function handleDelete(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyHelpChat(id, context);
  if (result instanceof NextResponse) return result;

  const deleted = await repos.chats.delete(id);
  if (!deleted) {
    return serverError('Failed to delete help chat');
  }

  logger.info('Help chat deleted', { chatId: id });

  return messageResponse('Help chat deleted successfully');
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/help-chats/[id]
 * Get help chat details
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGet(req, context, id);
  }
);

/**
 * PATCH /api/v1/help-chats/[id]
 * Update help chat — rename or update context
 */
export const PATCH = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    const action = getActionParam(req);

    if (!action) {
      return handleRename(req, context, id);
    }

    if (!isValidAction(action, PATCH_ACTIONS)) {
      return badRequest(`Unknown action: ${action}. Available actions: ${PATCH_ACTIONS.join(', ')}`);
    }

    const actionHandlers: Record<PatchAction, () => Promise<NextResponse>> = {
      'update-context': () => handleUpdateContext(req, context, id),
    };

    return actionHandlers[action]();
  }
);

/**
 * DELETE /api/v1/help-chats/[id]
 * Delete a help chat
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleDelete(req, context, id);
  }
);
