/**
 * Memory Search Tool Handler
 * Sprint 6: Executes memory search tool calls during chat
 *
 * This handler performs semantic search across character memories
 * when the LLM explicitly requests memory lookup.
 */

import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import {
  MemorySearchToolInput,
  MemorySearchToolOutput,
  MemorySearchResult,
  validateMemorySearchInput,
} from '../memory-search-tool'

/**
 * Context required for memory search execution
 */
export interface MemorySearchToolContext {
  /** User ID for authentication */
  userId: string
  /** Character ID whose memories to search */
  characterId: string
  /** Optional embedding profile ID for semantic search */
  embeddingProfileId?: string
}

/**
 * Error thrown during memory search execution
 */
export class MemorySearchError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'SEARCH_ERROR'
  ) {
    super(message)
    this.name = 'MemorySearchError'
  }
}

/**
 * Execute a memory search tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user and character IDs
 * @returns Tool output with search results
 */
export async function executeMemorySearchTool(
  input: unknown,
  context: MemorySearchToolContext
): Promise<MemorySearchToolOutput> {
  try {
    // Validate input
    if (!validateMemorySearchInput(input)) {
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string',
        totalFound: 0,
        query: '',
      }
    }

    const { query, limit = 5, minImportance = 0 } = input

    // Verify character exists and belongs to user
    const repos = getRepositories()
    const character = await repos.characters.findById(context.characterId)

    if (!character || character.userId !== context.userId) {
      return {
        success: false,
        error: 'Character not found',
        totalFound: 0,
        query,
      }
    }

    // Perform semantic search
    const searchResults = await searchMemoriesSemantic(
      context.characterId,
      query,
      {
        userId: context.userId,
        embeddingProfileId: context.embeddingProfileId,
        limit,
        minImportance,
      }
    )

    // Update access time for retrieved memories
    for (const result of searchResults) {
      try {
        await repos.memories.updateAccessTime(context.characterId, result.memory.id)
      } catch (err) {
        // Non-critical, just log
        logger.warn(`[MemorySearch] Failed to update access time for memory ${result.memory.id}`, { characterId: context.characterId, memoryId: result.memory.id, userId: context.userId, error: String(err) })
      }
    }

    // Convert to output format
    const memories: MemorySearchResult[] = searchResults.map(result => ({
      id: result.memory.id,
      summary: result.memory.summary,
      content: result.memory.content,
      importance: result.memory.importance,
      relevanceScore: result.score,
      createdAt: result.memory.createdAt,
      source: result.memory.source,
    }))

    return {
      success: true,
      memories,
      totalFound: memories.length,
      query,
    }
  } catch (error) {
    logger.error('[MemorySearch] Tool execution error', { characterId: context.characterId, userId: context.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during memory search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format memory search results for inclusion in conversation context
 *
 * @param results - Search results to format
 * @returns Formatted string suitable for LLM context
 */
export function formatMemorySearchResults(results: MemorySearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant memories found.'
  }

  const formatted = results.map((memory, index) => {
    const importanceLabel = memory.importance >= 0.7 ? 'High' :
      memory.importance >= 0.4 ? 'Medium' : 'Low'

    return `[Memory ${index + 1}] (Importance: ${importanceLabel}, Relevance: ${(memory.relevanceScore * 100).toFixed(0)}%)
Summary: ${memory.summary}
Details: ${memory.content}`
  })

  return `Found ${results.length} relevant memories:\n\n${formatted.join('\n\n')}`
}
