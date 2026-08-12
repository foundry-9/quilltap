/**
 * Help Chats API v1 - Collection Endpoint
 *
 * GET /api/v1/help-chats - List help chats for current user
 * POST /api/v1/help-chats - Create a new help chat
 * GET /api/v1/help-chats?action=eligibility - Get eligible help characters
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import type { ChatParticipantBaseInput, ChatEvent } from '@/lib/schemas/types';
import { notFound, badRequest, created, successResponse } from '@/lib/api/responses';
import { enrichParticipantSummary } from '@/lib/services/chat-enrichment.service';
import type { RepositoryContainer } from '@/lib/repositories/factory';

const logger = createServiceLogger('HelpChatsRoute');

type Repos = RepositoryContainer;

const GET_ACTIONS = ['eligibility'] as const;
type GetAction = typeof GET_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

const createHelpChatSchema = z.object({
  characterIds: z.array(z.string().uuid()).min(1, 'At least one character is required'),
  pageUrl: z.string(),
});

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List help chats for the current user
 */
async function handleList(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const allChats = await repos.chats.findByUserId(user.id);
  const helpChats = allChats
    .filter((c: any) => c.chatType === 'help')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const enrichedChats = await Promise.all(
    helpChats.map(async (chat) => {
      const enrichedParticipants = await Promise.all(
        chat.participants.map((p) => enrichParticipantSummary(p, repos))
      );

      // Get message count
      const messages = await repos.chats.getMessages(chat.id);
      const messageCount = messages.length;

      return {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        participants: enrichedParticipants,
        messageCount,
        helpPageUrl: (chat as any).helpPageUrl || null,
      };
    })
  );

  return successResponse({ chats: enrichedChats });
}

/**
 * Get eligible help characters
 */
async function handleEligibility(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const characters = await repos.characters.findByUserId(user.id);
  const helpCharacters = characters.filter((c: any) => c.defaultHelpToolsEnabled === true);

  // Get all connection profiles for tool-use check
  const profiles = await repos.connections.findByUserId(user.id);
  const toolCapableProfiles = profiles.filter((p: any) => p.allowToolUse !== false);

  const eligibleCharacters = [];
  for (const char of helpCharacters) {
    const charAny = char as any;

    // Check if this character has a tool-capable connection profile
    const hasToolCapable = charAny.defaultConnectionProfileId
      ? toolCapableProfiles.some((p) => p.id === charAny.defaultConnectionProfileId)
      : toolCapableProfiles.length > 0;

    // Get avatar
    let avatarUrl: string | null = charAny.avatarUrl || null;
    if (!avatarUrl) {
      const images = await repos.files.findByLinkedTo(char.id);
      const avatarImg = images.find((img: any) => img.tags?.includes('avatar')) || images[0];
      if (avatarImg) avatarUrl = `/api/v1/files/${avatarImg.id}`;
    }

    eligibleCharacters.push({
      id: char.id,
      name: charAny.name,
      avatarUrl,
      defaultHelpToolsEnabled: true,
      connectionProfileId: charAny.defaultConnectionProfileId || null,
      hasToolCapableProfile: hasToolCapable,
    });
  }

  const eligible = eligibleCharacters.some((c) => c.hasToolCapableProfile);
  const reasons: string[] = [];
  if (helpCharacters.length === 0) reasons.push('No characters have help tools enabled');
  if (!eligible && helpCharacters.length > 0) reasons.push('No tool-capable connection profiles available');

  return successResponse({ eligible, characters: eligibleCharacters, reasons });
}

/**
 * Create a new help chat
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const validatedData = createHelpChatSchema.parse(body);

  // Validate all characters exist and at least one has help tools enabled
  const characters = [];
  let hasHelpEnabled = false;
  for (const charId of validatedData.characterIds) {
    const character = await repos.characters.findById(charId);
    if (!character) {
      return notFound('Character');
    }
    characters.push(character);
    if ((character as any).defaultHelpToolsEnabled) {
      hasHelpEnabled = true;
    }
  }

  if (!hasHelpEnabled) {
    return badRequest('At least one character must have help tools enabled');
  }

  // Build participants
  const now = new Date().toISOString();
  const participants: ChatParticipantBaseInput[] = [];
  for (let i = 0; i < characters.length; i++) {
    const char = characters[i] as any;
    participants.push({
      id: crypto.randomUUID(),
      type: 'CHARACTER',
      characterId: char.id,
      controlledBy: 'llm',
      connectionProfileId: char.defaultConnectionProfileId || null,
      imageProfileId: null,
      displayOrder: i,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Create the chat
  const firstChar = characters[0] as any;
  const chat = await repos.chats.create({
    userId: user.id,
    participants,
    title: `Help: ${firstChar.name}`,
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
    chatType: 'help',
    helpPageUrl: validatedData.pageUrl,
  });

  // Add initial system message
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: `Help chat initiated for page: ${validatedData.pageUrl}`,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(chat.id, systemMessage);

  // Enrich participants for response
  const enrichedParticipants = await Promise.all(
    chat.participants.map((p) => enrichParticipantSummary(p, repos))
  );

  logger.info('Help chat created', {
    chatId: chat.id,
    userId: user.id,
    characterCount: characters.length,
    pageUrl: validatedData.pageUrl,
  });

  return created({ chat: { ...chat, participants: enrichedParticipants } });
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/help-chats
 * List help chats or check eligibility
 */
export const GET = createContextHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action) {
    return handleList(req, context);
  }

  if (!isValidAction(action, GET_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${GET_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<GetAction, () => Promise<NextResponse>> = {
    eligibility: () => handleEligibility(req, context),
  };

  return actionHandlers[action]();
});

/**
 * POST /api/v1/help-chats
 * Create a new help chat
 */
export const POST = createContextHandler(async (req, context) => {
  return handleCreate(req, context);
});
