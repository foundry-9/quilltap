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
 * Characters of prose kept either side of a text hit. Deliberately lopsided:
 * the snippet renders on one truncated line, so a match sitting in the middle
 * of a balanced window gets clipped off the right-hand end — the reader is
 * shown context for a term they can no longer see. A short run-up puts the
 * matched word near the start of the line, where it survives truncation.
 */
const SNIPPET_LEAD = 30
const SNIPPET_TRAIL = 160

/**
 * Build a snippet around the first occurrence of `query`, with the document's
 * Markdown flattened enough to read on one line.
 */
function buildSnippet(content: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_LEAD)
  const end = Math.min(content.length, matchIndex + queryLength + SNIPPET_TRAIL)

  const slice = content
    .slice(start, end)
    // Markdown furniture reads as noise on a single-line snippet: fences and
    // emphasis markers, heading hashes, list bullets, table pipes.
    .replace(/```+/g, ' ')
    .replace(/[*_`#|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return `${start > 0 ? '…' : ''}${slice}${end < content.length ? '…' : ''}`
}

/**
 * Handle GET /api/v1/help-docs?action=search&q=… — substring search over
 * document *text*, not just titles.
 *
 * The Guide's search box previously filtered the topic list by title alone,
 * so any term that lives in the prose ("describe", "uncensored", "timeout")
 * returned nothing at all. Content is not shipped to the client with the
 * index — it is far too large — so the match runs here.
 *
 * Deliberately a plain case-insensitive substring match: this is the "find
 * the page with this word on it" affordance, complementary to the semantic
 * `help_search` tool. No stemming, no ranking beyond title-hits-first.
 */
async function handleSearch(request: NextRequest, _context: RequestContext) {
  try {
    const query = (request.nextUrl.searchParams.get('q') ?? '').trim()

    if (query.length < 2) {
      return successResponse({ matches: [] })
    }

    const helpSearch = getHelpSearch()
    if (!helpSearch.isLoaded()) {
      await helpSearch.loadFromDatabase()
    }

    const needle = query.toLowerCase()
    const documents = await helpSearch.getAllDocuments()

    const matches = documents
      .map((doc) => {
        const titleHit = doc.title.toLowerCase().includes(needle)
        const contentIndex = doc.content.toLowerCase().indexOf(needle)

        if (!titleHit && contentIndex === -1) {
          return null
        }

        return {
          slug: doc.slug,
          titleHit,
          snippet: contentIndex >= 0 ? buildSnippet(doc.content, contentIndex, query.length) : null,
        }
      })
      .filter((match): match is { slug: string; titleHit: boolean; snippet: string | null } => match !== null)
      // A title hit is a stronger signal than a passing mention in the prose.
      .sort((a, b) => Number(b.titleHit) - Number(a.titleHit))

    logger.info('[HelpDocs] Guide text search', { query, matchCount: matches.length })

    return successResponse({ matches })
  } catch (error) {
    logger.error('[HelpDocs] Error searching help documents', {}, error instanceof Error ? error : undefined)
    return serverError('Failed to search help documents')
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

  if (action === 'search') {
    return handleSearch(request, context);
  }

  return handleList(request, context);
});
