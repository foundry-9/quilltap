/**
 * Brahma Console API v1 - Collection Endpoint
 *
 * GET  /api/v1/brahma-console  - List the user's Brahma Console chats
 * POST /api/v1/brahma-console  - Create a new Brahma Console chat
 *
 * The Brahma Console is a character-less, memory-free generic-LLM surface, so
 * there is no eligibility action — the only precondition is "at least one
 * connection profile exists", which the provider checks via the connections
 * query directly.
 */

import { NextRequest } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import { badRequest, created, successResponse } from '@/lib/api/responses';

const logger = createServiceLogger('BrahmaConsoleRoute');

// ============================================================================
// Schemas
// ============================================================================

const createBrahmaChatSchema = z.object({
  /** Connection profile (model) to start on. Defaults to the user's default profile. */
  connectionProfileId: z.string().uuid().optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List the user's Brahma Console chats (most-recent first).
 */
async function handleList(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const allChats = await repos.chats.findByUserId(user.id);
  const brahmaChats = allChats
    .filter((c) => c.chatType === 'brahma')
    .sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime());

  const enrichedChats = await Promise.all(
    brahmaChats.map(async (chat) => {
      const messages = await repos.chats.getMessages(chat.id);
      return {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        lastMessageAt: chat.lastMessageAt ?? null,
        messageCount: messages.length,
        consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
      };
    })
  );

  return successResponse({ chats: enrichedChats });
}

/**
 * Create a new Brahma Console chat.
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json().catch(() => ({}));
  const validatedData = createBrahmaChatSchema.parse(body ?? {});

  // Resolve the starting connection profile: the one requested, else the
  // user's default profile.
  let profileId = validatedData.connectionProfileId ?? null;
  if (profileId) {
    const profile = await repos.connections.findById(profileId);
    if (!profile || profile.userId !== user.id) {
      return badRequest('Connection profile not found');
    }
  } else {
    const defaultProfile = await repos.connections.findDefault(user.id);
    if (!defaultProfile) {
      return badRequest('No connection profile available — establish one before opening the Console.');
    }
    profileId = defaultProfile.id;
  }

  const chat = await repos.chats.create({
    userId: user.id,
    participants: [],
    title: 'A Fresh Audience at the Console',
    contextSummary: null,
    tags: [],
    roleplayTemplateId: null,
    timestampConfig: null,
    messageCount: 0,
    lastMessageAt: null,
    lastRenameCheckInterchange: 0,
    projectId: null,
    disabledTools: [],
    disabledToolGroups: [],
    imageProfileId: null,
    chatType: 'brahma',
    consoleConnectionProfileId: profileId,
  });

  logger.info('Brahma Console chat created', {
    chatId: chat.id,
    userId: user.id,
    connectionProfileId: profileId,
  });

  return created({ chat });
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/brahma-console
 */
export const GET = createContextHandler(async (req, context) => {
  return handleList(req, context);
});

/**
 * POST /api/v1/brahma-console
 */
export const POST = createContextHandler(async (req, context) => {
  return handleCreate(req, context);
});
