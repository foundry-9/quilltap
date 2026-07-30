/**
 * Help Docs API v1 - Collection Endpoint
 *
 * GET /api/v1/help-docs - List all help documents (metadata only)
 * GET /api/v1/help-docs?action=chat-count - Get salon chat count for current user
 */

import { NextRequest } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { getHelpSearch } from '@/lib/help-search';

const logger = createServiceLogger('HelpDocsRoute');

/**
 * Handle GET /api/v1/help-docs - List all help documents
 */
async function handleList(_request: NextRequest, _context: RequestContext) {
  try {
    const helpSearch = getHelpSearch();
    if (!helpSearch.isLoaded()) {
      await helpSearch.loadFromDatabase();
    }

    const documents = await helpSearch.listDocuments();

    logger.info('[HelpDocs] Listed help documents', { documentCount: documents.length });

    return successResponse({ documents });
  } catch (error) {
    logger.error('[HelpDocs] Error listing help documents', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to load help documents');
  }
}

/**
 * Handle GET /api/v1/help-docs?action=chat-count - Get salon chat count
 */
async function handleChatCount(_request: NextRequest, context: RequestContext) {
  try {
    const { user, repos } = context;

    const allChats = await repos.chats.findByUserId(user.id);

    // Filter to salon chats (exclude help chats and other types)
    const salonChats = allChats.filter(
      (chat) => !chat.chatType || chat.chatType === 'salon'
    );

    return successResponse({ count: salonChats.length });
  } catch (error) {
    logger.error('[HelpDocs] Error getting chat count', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get chat count');
  }
}

/**
 * GET /api/v1/help-docs or /api/v1/help-docs?action=chat-count
 */
export const GET = createContextHandler(async (request: NextRequest, context: RequestContext) => {
  const action = getActionParam(request);

  if (action === 'chat-count') {
    return handleChatCount(request, context);
  }

  return handleList(request, context);
});
