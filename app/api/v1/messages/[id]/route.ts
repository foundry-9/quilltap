/**
 * Messages API v1 - Individual Message Endpoint
 *
 * GET /api/v1/messages/[id] - Get a specific message
 * PUT /api/v1/messages/[id] - Edit a message
 * DELETE /api/v1/messages/[id] - Delete a message (with optional memory cascade)
 * POST /api/v1/messages/[id]?action=swipe - Generate alternative response
 * POST /api/v1/messages/[id]?action=reattribute - Re-attribute to different participant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, getActionParam } from '@/lib/api/middleware';
import { badRequest, notFound, serverError, successResponse, created } from '@/lib/api/responses';
import { regenerateMessageAsSwipe } from '@/lib/services/chat-message';
import { deleteMemoriesBySourceMessagesWithVectors, deleteMemoryWithVector } from '@/lib/memory/memory-service';
import { invalidateContextSummaryIfMessageCovered } from '@/lib/chat/context-summary';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { ChatEvent, MessageEvent, ChatMetadata, ChatParticipant } from '@/lib/schemas/types';
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types';

// Validation schemas
const editMessageSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

const swipeActionSchema = z.object({
  swipeIndex: z.int().min(0).optional(), // For switching swipes
});

const reattributeActionSchema = z.object({
  newParticipantId: z.uuid('New participant ID is required'),
});

// =============================================================================
// Helper: Find message across user's chats
// =============================================================================

interface MessageSearchResult {
  chat: ChatMetadata;
  message: MessageEvent;
  allMessages: ChatEvent[];
  messageIndex: number;
}

async function findMessageInUserChats(
  repos: any,
  userId: string,
  messageId: string
): Promise<MessageSearchResult | null> {
  // Resolve the owning chat with a single indexed lookup on the message id,
  // rather than loading and validating every message in every chat. Then load
  // only that one chat's messages.
  const chatId = await repos.chats.findChatIdForMessage(messageId);
  if (!chatId) {
    return null;
  }

  const chat = await repos.chats.findById(chatId);
  // Enforce the same per-user ownership the previous account-wide scan gave us:
  // a message is only reachable through chats the requesting user owns.
  if (!chat || chat.userId !== userId) {
    return null;
  }

  const messages = await repos.chats.getMessages(chatId);
  const idx = messages.findIndex(
    (m: ChatEvent): m is MessageEvent => m.type === 'message' && m.id === messageId
  );
  if (idx === -1) {
    return null;
  }

  return {
    chat,
    message: messages[idx] as MessageEvent,
    allMessages: messages,
    messageIndex: idx,
  };
}

// =============================================================================
// GET /api/v1/messages/[id] - Get a specific message
// =============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {const result = await findMessageInUserChats(repos, user.id, messageId);
      if (!result) {
        return notFound('Message');
      }

      return successResponse({ message: result.message });
    } catch (error) {
      logger.error('[Messages API v1] Error fetching message', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch message');
    }
  }
);

// =============================================================================
// PUT /api/v1/messages/[id] - Edit a message
// =============================================================================

export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    const body = await req.json();
    const { content } = editMessageSchema.parse(body);
    const result = await findMessageInUserChats(repos, user.id, messageId);
    if (!result) {
      return notFound('Message');
    }

    // Update only the edited row. (The old path deleted every message in the
    // chat and re-inserted them one by one, which was O(n²) and would silently
    // drop any sibling message that failed validation.)
    const updatedMessage = await repos.chats.updateMessage(result.chat.id, messageId, { content });
    if (!updatedMessage) {
      return notFound('Message');
    }

    // Update chat's updatedAt timestamp
    await repos.chats.update(result.chat.id, {});

    // Phase 4: invalidate the context summary if this message was part of
    // the set that fed it.
    await invalidateContextSummaryIfMessageCovered(result.chat.id, [messageId]);

    return successResponse({ message: updatedMessage });
  }
);

// =============================================================================
// DELETE /api/v1/messages/[id] - Delete a message
// =============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {
      // Parse query params for memory handling
      const { searchParams } = req.nextUrl;
      const memoryAction = searchParams.get('memoryAction') as MemoryCascadeAction | null;
      const skipConfirmation = searchParams.get('skipConfirmation') === 'true';const result = await findMessageInUserChats(repos, user.id, messageId);
      if (!result) {
        return notFound('Message');
      }

      // Collect all message IDs to be deleted (for memory cascade)
      let messageIdsToDelete: string[] = [];
      if (result.message.swipeGroupId) {
        // Get all messages in swipe group
        messageIdsToDelete = result.allMessages
          .filter(
            (m): m is MessageEvent =>
              m.type === 'message' && m.swipeGroupId === result.message.swipeGroupId
          )
          .map((m) => m.id);
      } else {
        messageIdsToDelete = [messageId];
      }

      // Check for associated memories
      const memoryCount = await repos.memories.countBySourceMessageIds(messageIdsToDelete);

      // If memories exist and no action specified, return info for confirmation dialog
      if (memoryCount > 0 && !memoryAction && !skipConfirmation) {return successResponse({
          requiresConfirmation: true,
          memoryCount,
          messageIds: messageIdsToDelete,
          isSwipeGroup: !!result.message.swipeGroupId,
        });
      }

      // Handle memory cascade based on action
      let memoriesDeleted = 0;
      if (memoryCount > 0 && memoryAction && memoryAction !== 'KEEP_MEMORIES') {
        if (memoryAction === 'DELETE_MEMORIES' || memoryAction === 'REGENERATE_MEMORIES') {
          const { deleted, vectorsRemoved } = await deleteMemoriesBySourceMessagesWithVectors(messageIdsToDelete);
          memoriesDeleted = deleted;
          logger.info('[Messages API v1] Cascade deleted memories with message', {
            messageId,
            memoriesDeleted: deleted,
            vectorsRemoved,
          });
        }
      }

      // Delete only the targeted message(s) by id, leaving every other row —
      // including any unrelated corrupted message — untouched. (The old path
      // cleared the whole chat and re-inserted the survivors, which silently
      // dropped any sibling message that failed validation on reload.)
      await repos.chats.deleteMessagesByIds(result.chat.id, messageIdsToDelete);

      // Update chat's updatedAt timestamp
      await repos.chats.update(result.chat.id, {});

      // Phase 4: invalidate the context summary if any deleted message was
      // part of the set that fed it.
      await invalidateContextSummaryIfMessageCovered(result.chat.id, messageIdsToDelete);

      logger.info('[Messages API v1] Message deleted', {
        messageId,
        chatId: result.chat.id,
        memoriesDeleted,
      });

      return successResponse({
        success: true,
        memoriesDeleted,
      });
    } catch (error) {
      logger.error('[Messages API v1] Error deleting message', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to delete message');
    }
  }
);

// =============================================================================
// POST /api/v1/messages/[id]?action= - Actions
// =============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    const action = getActionParam(req);

    if (action === 'swipe') {
      return handleSwipeAction(req, { user, repos }, messageId);
    }

    if (action === 'reattribute') {
      return handleReattributeAction(req, { user, repos }, messageId);
    }

    return badRequest('Action parameter required: swipe or reattribute');
  }
);

// =============================================================================
// Action Handlers
// =============================================================================

async function handleSwipeAction(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = swipeActionSchema.safeParse(body);

  // If swipeIndex is provided, this is a switch operation (like PUT)
  if (parsed.success && parsed.data.swipeIndex !== undefined) {
    return handleSwitchSwipe(repos, user.id, messageId, parsed.data.swipeIndex);
  }

  // Otherwise, generate a new swipe
  return handleGenerateSwipe(repos, user.id, messageId);
}

async function handleGenerateSwipe(
  repos: any,
  userId: string,
  messageId: string
): Promise<NextResponse> {
  const result = await findMessageInUserChats(repos, userId, messageId);
  if (!result) {
    return notFound('Message');
  }

  // Only character-authored assistant messages can be regenerated. Staff/system
  // messages share the ASSISTANT role but have no responder to regenerate from.
  if (result.message.role !== 'ASSISTANT') {
    return badRequest('Only assistant messages can be swiped');
  }
  if (result.message.systemSender) {
    return badRequest('Staff and system messages cannot be regenerated');
  }

  try {
    // Run the regeneration through the same context engine a normal turn uses,
    // so the swipe gets the responder's real system prompt, multi-character
    // attribution, and memory — and is attributed to the same participant.
    const newSwipe = await regenerateMessageAsSwipe({
      repos,
      userId,
      chat: result.chat,
      targetMessage: result.message,
      allMessages: result.allMessages.filter(
        (m): m is MessageEvent => m.type === 'message'
      ),
      activeUserParticipantId: result.chat.activeTypingParticipantId ?? null,
    });

    return created({ message: newSwipe });
  } catch (error) {
    logger.error(
      '[Messages API v1] Swipe generation failed',
      { messageId, chatId: result.chat.id },
      error instanceof Error ? error : undefined
    );
    return serverError(
      error instanceof Error ? error.message : 'Failed to generate alternative response'
    );
  }
}

async function handleSwitchSwipe(
  repos: any,
  userId: string,
  messageId: string,
  swipeIndex: number
): Promise<NextResponse> {
  const result = await findMessageInUserChats(repos, userId, messageId);
  if (!result) {
    return notFound('Message');
  }

  if (!result.message.swipeGroupId) {
    return badRequest('Message is not part of a swipe group');
  }

  // Find the target swipe
  const targetSwipe = result.allMessages.find(
    (m): m is MessageEvent =>
      m.type === 'message' &&
      m.swipeGroupId === result.message.swipeGroupId &&
      m.swipeIndex === swipeIndex
  );

  if (!targetSwipe) {
    return notFound('Swipe');
  }

  return successResponse({ message: targetSwipe });
}

async function handleReattributeAction(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
): Promise<NextResponse> {
  const body = await req.json();
  const { newParticipantId } = reattributeActionSchema.parse(body);
  const result = await findMessageInUserChats(repos, user.id, messageId);
  if (!result) {
    return notFound('Message');
  }

  // Validate the target participant exists in the chat
  const targetParticipant = result.chat.participants.find(
    (p: ChatParticipant) => p.id === newParticipantId
  );

  if (!targetParticipant) {
    logger.warn('[Messages API v1] Target participant not found in chat', {
      messageId,
      chatId: result.chat.id,
      newParticipantId,
    });
    return badRequest('Target participant not found in chat');
  }

  // Find and delete memories associated with this message
  const memoriesFromMessage = await repos.memories.findBySourceMessageId(messageId);
  let memoriesDeleted = 0;
  for (const memory of memoriesFromMessage) {
    try {
      const deleted = await deleteMemoryWithVector(memory.characterId, memory.id);
      if (deleted) {
        memoriesDeleted++;
      }
    } catch (error) {
      logger.error('[Messages API v1] Failed to delete memory during re-attribution', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Update only the re-attributed row's participantId.
  const updatedMessage = await repos.chats.updateMessage(result.chat.id, messageId, {
    participantId: newParticipantId,
  });
  if (!updatedMessage) {
    return notFound('Message');
  }

  // Update chat's updatedAt timestamp
  await repos.chats.update(result.chat.id, {});

  logger.info('[Messages API v1] Message re-attributed successfully', {
    messageId,
    chatId: result.chat.id,
    oldParticipantId: result.message.participantId,
    newParticipantId,
    memoriesDeleted,
  });

  return successResponse({
    success: true,
    message: updatedMessage,
    memoriesDeleted,
  });
}
