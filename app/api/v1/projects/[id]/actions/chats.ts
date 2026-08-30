/**
 * Projects API v1 - Chat Association Actions
 *
 * GET /api/v1/projects/[id]?action=list-chats - List project chats
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * DELETE /api/v1/projects/[id]?action=remove-chat - Remove chat from project
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists, enrichWithDefaultImage, getFilePath } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { addChatSchema, removeChatSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import { byChatActivityDesc } from '@/lib/chat/chat-activity';

/**
 * List chats associated with project (paginated)
 */
export async function handleListChats(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!exists(project)) {
      return notFound('Project');
    }

    // Parse pagination params
    const { searchParams } = req.nextUrl;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const allChats = await repos.chats.findAll();
    const projectChats = allChats.filter(c => c.projectId === projectId);

    // Newest conversational activity first — see `lib/chat/chat-activity.ts`.
    projectChats.sort(byChatActivityDesc);

    // Get total count before pagination
    const total = projectChats.length;

    // Apply pagination
    const paginatedChats = projectChats.slice(offset, offset + limit);

    // Fetch all tags for resolving tag names
    const allTags = await repos.tags.findAll();
    const tagMap = new Map(allTags.map(t => [t.id, t]));

    // Enrich with participant info and tags
    const enrichedChats = await Promise.all(
      paginatedChats.map(async (chat) => {
        const participants = await Promise.all(
          chat.participants.map(async (p: any) => {
            if (p.characterId) {
              const char = await repos.characters.findById(p.characterId);
              if (!char) return null;

              // Fetch defaultImage if character has one
              const defaultImage = await enrichWithDefaultImage(char.defaultImageId, repos);

              return {
                id: p.id,
                name: char.name,
                defaultImage,
                tags: char.tags || [],
              };
            }
            return null;
          })
        );

        // Resolve chat tags to include tag objects with names
        const chatTags = (chat.tags || [])
          .map((tagId: string) => {
            const tag = tagMap.get(tagId);
            return tag ? { tag: { id: tag.id, name: tag.name } } : null;
          })
          .filter(Boolean);

        // Get story background if available
        let storyBackground = null;
        if (chat.storyBackgroundImageId) {
          const bgFile = await repos.files.findById(chat.storyBackgroundImageId);
          if (bgFile) {
            storyBackground = {
              id: bgFile.id,
              filepath: getFilePath(bgFile),
            };
          }
        }

        return {
          id: chat.id,
          title: chat.title,
          messageCount: chat.messageCount,
          participants: participants.filter(Boolean),
          tags: chatTags,
          storyBackground,
          isDangerousChat: chat.isDangerousChat === true,
          lastMessageAt: chat.lastMessageAt ?? null,
          updatedAt: chat.updatedAt,
          createdAt: chat.createdAt,
        };
      })
    );

    return successResponse({
      chats: enrichedChats,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + enrichedChats.length < total,
      },
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project chats', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to list chats');
  }
}

/**
 * Associate chat with project
 */
export async function handleAddChat(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { chatId } = addChatSchema.parse(body);

  // Check chat exists and is owned by user
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Associate chat with project
  await repos.chats.update(chatId, { projectId });

  logger.info('[Projects v1] Chat added to project', { projectId, chatId });

  return successResponse({ success: true });
}

/**
 * Remove chat from project
 */
export async function handleRemoveChat(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { chatId } = removeChatSchema.parse(body);

  // Remove projectId from chat
  await repos.chats.update(chatId, { projectId: null });

  logger.info('[Projects v1] Chat removed from project', { projectId, chatId });

  return successResponse({ success: true });
}
