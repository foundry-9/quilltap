/**
 * UI API v1 - Global Search Endpoint
 *
 * GET /api/v1/ui/search?q=query - Global search across entities
 *
 * Query parameters:
 * - q: search query (required, min 2 chars)
 * - types: comma-separated list of types to search (optional, defaults to all)
 * - limit: max results to return (optional, default 20, max 50)
 * - offset: number of results to skip for pagination (optional, default 0)
 *
 * Returns results in the SearchResponse format expected by the frontend:
 * - results: flat array of SearchResult objects
 * - totalCount: total number of matching results
 * - query: the search query
 * - types: array of result types found
 * - hasMore: whether there are more results to load
 */

import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  successResponse,
} from '@/lib/api/responses';
import type { SearchResult, SearchType, MatchPriority } from '@/components/search/types';

const VALID_TYPES: SearchType[] = ['chats', 'characters', 'tags', 'memories', 'messages'];

// Helper to determine match priority
function getMatchPriority(value: string, query: string): MatchPriority {
  const lowerValue = value.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact phrase match
  if (lowerValue === lowerQuery) return 0;
  // Contains exact phrase
  if (lowerValue.includes(lowerQuery)) return 1;
  // Partial match
  return 2;
}

// Helper to create a snippet from matched content
function createSnippet(content: string, query: string, maxLength = 100): string {
  if (!content) return '';

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
  }

  // Center the snippet around the match
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(content.length, matchIndex + query.length + 70);
  let snippet = content.substring(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req, context) => {
  try {
    const { searchParams } = req.nextUrl;
    const query = searchParams.get('q')?.trim();
    const typesParam = searchParams.get('types');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;

    // Parse and validate types filter
    let requestedTypes: SearchType[] = VALID_TYPES;
    if (typesParam) {
      const parsedTypes = typesParam.split(',').filter((t): t is SearchType =>
        VALID_TYPES.includes(t as SearchType)
      );
      if (parsedTypes.length > 0) {
        requestedTypes = parsedTypes;
      }
    }

    if (!query) {
      return badRequest('Search query required');
    }

    if (query.length < 2) {
      return badRequest('Search query must be at least 2 characters');
    }const { repos, user } = context;
    const allResults: SearchResult[] = [];
    const typesFound = new Set<SearchType>();
    const lowerQuery = query.toLowerCase();

    // Search characters (if requested)
    let characters: Awaited<ReturnType<typeof repos.characters.findByUserId>> = [];
    if (requestedTypes.includes('characters')) {
      characters = await repos.characters.findByUserId(user.id);
      const matchingCharacters = characters.filter(
        (c) =>
          c.name.toLowerCase().includes(lowerQuery) ||
          c.description?.toLowerCase().includes(lowerQuery)
      );

      for (const char of matchingCharacters) {
        const nameMatch = char.name.toLowerCase().includes(lowerQuery);
        const matchedField = nameMatch ? 'name' : 'description';
        const matchedValue = nameMatch ? char.name : (char.description || '');

        allResults.push({
          id: char.id,
          type: 'characters',
          name: char.name,
          matchedField,
          matchedValue: matchedValue.substring(0, 200),
          snippet: createSnippet(matchedValue, query),
          url: `/aurora/${char.id}`,
          matchPriority: getMatchPriority(matchedValue, query),
          createdAt: char.createdAt || new Date().toISOString(),
          updatedAt: char.updatedAt || new Date().toISOString(),
          title: char.title || null,
          isFavorite: char.isFavorite || false,
        });
        typesFound.add('characters');
      }
    } else {
      // Still need characters for chat lookups
      characters = await repos.characters.findByUserId(user.id);
    }

    // Load chats if needed for chat title search or message content search
    const needChats = requestedTypes.includes('chats') || requestedTypes.includes('messages');
    const chats = needChats ? await repos.chats.findByUserId(user.id) : [];

    // Build a chat lookup map for enriching message results
    const chatMap = new Map(chats.map(c => [c.id, c]));

    // Helper to get character names for a chat
    const getCharacterNamesForChat = (chat: typeof chats[0]): string[] => {
      const names: string[] = [];
      const characterParticipants = chat.participants?.filter((p) => p.type === 'CHARACTER') || [];
      for (const participant of characterParticipants) {
        const char = characters.find((c) => c.id === participant.id);
        if (char) names.push(char.name);
      }
      return names;
    };

    // Search chats (if requested)
    if (requestedTypes.includes('chats')) {
      const matchingChats = chats.filter((c) =>
        c.title?.toLowerCase().includes(lowerQuery)
      );

      for (const chat of matchingChats) {
        allResults.push({
          id: chat.id,
          type: 'chats',
          name: chat.title || 'Untitled Chat',
          matchedField: 'title',
          matchedValue: chat.title || '',
          snippet: createSnippet(chat.title || '', query),
          url: `/salon/${chat.id}`,
          matchPriority: getMatchPriority(chat.title || '', query),
          createdAt: chat.createdAt || new Date().toISOString(),
          updatedAt: chat.updatedAt || new Date().toISOString(),
          characterNames: getCharacterNamesForChat(chat),
          messageCount: chat.messageCount || 0,
        });
        typesFound.add('chats');
      }
    }

    // Search message content (if requested)
    if (requestedTypes.includes('messages')) {
      const chatIds = chats.map(c => c.id);
      const messageMatches = await repos.chats.searchMessagesGlobal(chatIds, query, 100);

      for (const msg of messageMatches) {
        const chat = chatMap.get(msg.chatId);
        const chatTitle = chat?.title || 'Untitled Chat';
        const characterNames = chat ? getCharacterNamesForChat(chat) : [];

        allResults.push({
          id: `msg-${msg.messageId}`,
          type: 'messages',
          name: chatTitle,
          matchedField: 'content',
          matchedValue: msg.content.substring(0, 200),
          snippet: createSnippet(msg.content, query, 120),
          url: `/salon/${msg.chatId}?msg=${msg.messageId}`,
          matchPriority: getMatchPriority(msg.content, query),
          createdAt: msg.createdAt || new Date().toISOString(),
          updatedAt: msg.createdAt || new Date().toISOString(),
          chatId: msg.chatId,
          chatTitle,
          characterNames,
          role: msg.role as 'USER' | 'ASSISTANT',
          messageId: msg.messageId,
        });
        typesFound.add('messages');
      }
    }

    // Search memories (if requested)
    if (requestedTypes.includes('memories')) {
      for (const character of characters) {
        const characterMemories = await repos.memories.searchByContent(character.id, query);
        for (const memory of characterMemories) {
          allResults.push({
            id: memory.id,
            type: 'memories',
            name: memory.summary.substring(0, 50) + (memory.summary.length > 50 ? '...' : ''),
            matchedField: 'summary',
            matchedValue: memory.summary,
            snippet: createSnippet(memory.summary, query),
            url: `/aurora/${character.id}?tab=memories`,
            matchPriority: getMatchPriority(memory.summary, query),
            createdAt: memory.createdAt || new Date().toISOString(),
            updatedAt: memory.updatedAt || new Date().toISOString(),
            characterId: memory.characterId,
            characterName: character.name,
            importance: memory.importance || 5,
            source: memory.source || 'AUTO',
          });
          typesFound.add('memories');
        }
      }
    }

    // Search tags (if requested)
    if (requestedTypes.includes('tags')) {
      const tags = await repos.tags.findByUserId(user.id);
      const matchingTags = tags.filter((t) =>
        t.name.toLowerCase().includes(lowerQuery)
      );

      for (const tag of matchingTags) {
        allResults.push({
          id: tag.id,
          type: 'tags',
          name: tag.name,
          matchedField: 'name',
          matchedValue: tag.name,
          snippet: tag.name,
          url: `/gallery?tag=${encodeURIComponent(tag.name)}`,
          matchPriority: getMatchPriority(tag.name, query),
          createdAt: tag.createdAt || new Date().toISOString(),
          updatedAt: tag.updatedAt || new Date().toISOString(),
          usageCount: 0, // Tag usage count not tracked in current schema
          quickHide: tag.quickHide || false,
        });
        typesFound.add('tags');
      }
    }

    // Sort results by match priority, then by updated date
    allResults.sort((a, b) => {
      if (a.matchPriority !== b.matchPriority) {
        return a.matchPriority - b.matchPriority;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // Calculate counts by type before pagination
    const countsByType: Partial<Record<SearchType, number>> = {};
    for (const result of allResults) {
      countsByType[result.type] = (countsByType[result.type] || 0) + 1;
    }

    // Apply pagination
    const totalCount = allResults.length;
    const paginatedResults = allResults.slice(offset, offset + limit);
    const hasMore = offset + paginatedResults.length < totalCount;

    logger.info('[UI Search v1] Search completed', {
      query,
      totalCount,
      returnedCount: paginatedResults.length,
      offset,
      hasMore,
      types: Array.from(typesFound),
      countsByType,
    });

    return successResponse({
      results: paginatedResults,
      totalCount,
      query,
      types: Array.from(typesFound),
      hasMore,
      countsByType,
    });
  } catch (error) {
    logger.error(
      '[UI Search v1] Error during search',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Search failed');
  }
});
