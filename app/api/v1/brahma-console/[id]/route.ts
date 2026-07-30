/**
 * Brahma Console API v1 - Individual Endpoint
 *
 * GET    /api/v1/brahma-console/[id]                 - Get chat details
 * PATCH  /api/v1/brahma-console/[id]                 - Rename
 * PATCH  /api/v1/brahma-console/[id]?action=set-model - Switch model (same chat continues)
 * DELETE /api/v1/brahma-console/[id]                 - Delete
 *
 * No update-context action: the Brahma Console is not page-aware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import type { ChatMetadata } from '@/lib/schemas/types';
import { badRequest, serverError, successResponse, messageResponse } from '@/lib/api/responses';
import { verifyBrahmaChat } from '../_shared';

const logger = createServiceLogger('BrahmaConsoleItemRoute');

const PATCH_ACTIONS = ['set-model'] as const;
type PatchAction = typeof PATCH_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

const renameSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

const setModelSchema = z.object({
  connectionProfileId: z.string().uuid('A connection profile id is required'),
});

// ============================================================================
// Handler Functions
// ============================================================================

async function handleGet(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const messages = await repos.chats.getMessages(id);

  return successResponse({
    chat: {
      id: chat.id,
      title: chat.title,
      chatType: chat.chatType,
      consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
      messageCount: messages.length,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastMessageAt: chat.lastMessageAt ?? null,
    },
  });
}

async function handleRename(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const validatedData = renameSchema.parse(body);

  const updated = await repos.chats.update(id, {
    title: validatedData.title,
    isManuallyRenamed: true,
  });

  if (!updated) {
    return serverError('Failed to rename Brahma Console chat');
  }

  logger.info('Brahma Console chat renamed', { chatId: id, title: validatedData.title });

  return successResponse({ chat: updated });
}

/**
 * Switch the model for this Brahma chat. The same conversation continues; the
 * new model applies from the next turn forward.
 */
async function handleSetModel(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const { connectionProfileId } = setModelSchema.parse(body);

  // The profile must exist and belong to this user.
  const profile = await repos.connections.findById(connectionProfileId);
  if (!profile || profile.userId !== user.id) {
    return badRequest('Connection profile not found');
  }

  const updated = await repos.chats.update(id, {
    consoleConnectionProfileId: connectionProfileId,
  } as Partial<ChatMetadata>);

  if (!updated) {
    return serverError('Failed to switch the Console model');
  }

  logger.info('Brahma Console model switched', { chatId: id, connectionProfileId });

  return successResponse({ chat: updated });
}

async function handleDelete(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const deleted = await repos.chats.delete(id);
  if (!deleted) {
    return serverError('Failed to delete Brahma Console chat');
  }

  logger.info('Brahma Console chat deleted', { chatId: id });

  return messageResponse('Brahma Console chat deleted successfully');
}

// ============================================================================
// Route Handlers
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGet(req, context, id);
  }
);

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
      'set-model': () => handleSetModel(req, context, id),
    };

    return actionHandlers[action]();
  }
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleDelete(req, context, id);
  }
);
