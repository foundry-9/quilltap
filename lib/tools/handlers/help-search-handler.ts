/**
 * Help Search Tool Handler
 *
 * Executes help documentation search when the LLM requests assistance
 * understanding Quilltap features, settings, or usage.
 *
 * Uses the user's configured embedding profile for semantic search,
 * with automatic fallback to keyword-based search when no embedding
 * profile is configured or when embedding fails.
 */

import { logger } from '@/lib/logger'
import { getHelpSearch } from '@/lib/help-search'
import {
  generateEmbeddingForUser,
  extractSearchTerms,
  textSimilarity,
} from '@/lib/embedding/embedding-service'
import {
  HelpSearchToolInput,
  HelpSearchToolOutput,
  HelpSearchResult,
  validateHelpSearchInput,
} from '../help-search-tool'

/**
 * Character budgets for the context block handed to the model.
 *
 * `help_search` is the only way a character can read help text — there is no
 * separate "read this doc" tool — so a result must carry enough of the
 * document to answer with, while a handful of results must still fit in a
 * turn. A matched section gets the larger share; the document excerpt beneath
 * it is orientation, not the answer.
 */
const MATCHED_SECTION_CHARS = 1500
const DOC_CONTEXT_CHARS = 600
const DOC_EXCERPT_CHARS = 1000

/** Truncate to a character budget, marking the cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.substring(0, maxChars)}...` : text
}

/**
 * Context required for help search execution
 */
export interface HelpSearchToolContext {
  /** User ID for embedding profile lookup and logging */
  userId: string
}

/**
 * Error thrown during help search execution
 */
export class HelpSearchError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'BUNDLE_ERROR' | 'SEARCH_ERROR' | 'API_ERROR'
  ) {
    super(message)
    this.name = 'HelpSearchError'
  }
}

/**
 * Perform semantic search using the user's embedding profile
 */
async function semanticSearch(
  query: string,
  limit: number,
  userId: string
): Promise<HelpSearchResult[]> {
  const helpSearch = getHelpSearch()

  // Generate embedding for the query using the user's profile
  const embeddingResult = await generateEmbeddingForUser(query, userId)

  // Pass the query through so HelpSearch can apply its literal-phrase boost
  // alongside the embedding score (see lib/embedding/literal-boost.ts).
  const results = await helpSearch.search(embeddingResult.embedding, limit, query)

  return results.map(result => ({
    id: result.document.id,
    title: result.document.title,
    path: result.document.path,
    url: result.document.url,
    score: result.score,
    content: result.document.content,
    ...(result.matchedSection
      ? {
        matchedSection: {
          heading: result.matchedSection.heading,
          content: result.matchedSection.content,
        },
      }
      : {}),
  }))
}

/**
 * Perform keyword-based fallback search
 */
async function keywordSearch(query: string, limit: number): Promise<HelpSearchResult[]> {
  const helpSearch = getHelpSearch()
  const searchTerms = extractSearchTerms(query)

  // Get all documents and score them
  const allDocs = await helpSearch.getAllDocuments()

  const scored = allDocs.map(doc => ({
    doc,
    score: textSimilarity(searchTerms, `${doc.title} ${doc.content}`),
  }))

  // Sort by score descending and take top results
  const topResults = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return topResults.map(item => ({
    id: item.doc.id,
    title: item.doc.title,
    path: item.doc.path,
    url: item.doc.url,
    score: item.score,
    content: item.doc.content,
  }))
}

/**
 * Execute a help search tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID
 * @returns Tool output with search results
 */
export async function executeHelpSearchTool(
  input: unknown,
  context: HelpSearchToolContext
): Promise<HelpSearchToolOutput> {
  try {
    // Validate input
    const parsed = validateHelpSearchInput(input)
    if (!parsed) {
      logger.warn('Help search validation failed', {
        context: 'help-search-handler',
        userId: context.userId,
        input,
      })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string (max 500 chars)',
        totalFound: 0,
        query: '',
      }
    }

    const { query, limit = 3 } = parsed

    // Ensure help docs are loaded
    const helpSearch = getHelpSearch()
    if (!helpSearch.isLoaded()) {
      await helpSearch.loadFromDatabase()
    }

    let results: HelpSearchResult[]
    let searchMethod: 'semantic' | 'keyword'

    // Try semantic search first using the user's embedding profile
    try {
      results = await semanticSearch(query, limit, context.userId)
      searchMethod = 'semantic'
    } catch (error) {
      // Fall back to keyword search on embedding error
      logger.warn('Semantic help search failed, falling back to keyword search', {
        context: 'help-search-handler',
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      })
      results = await keywordSearch(query, limit)
      searchMethod = 'keyword'
    }

    logger.info('Help search completed', {
      context: 'help-search-handler',
      userId: context.userId,
      query,
      searchMethod,
      resultsCount: results.length,
    })

    return {
      success: true,
      results,
      totalFound: results.length,
      query,
    }
  } catch (error) {
    logger.error('Help search tool execution failed', {
      context: 'help-search-handler',
      userId: context.userId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during help search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format help search results for inclusion in conversation context
 *
 * @param results - Search results to format
 * @returns Formatted string suitable for LLM context
 */
export function formatHelpSearchResults(results: HelpSearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant help documentation found.'
  }

  const formatted = results.map((result, index) => {
    const relevanceLabel = result.score >= 0.7 ? 'High' :
      result.score >= 0.4 ? 'Medium' : 'Low'

    const header = `[Help Document ${index + 1}] (Relevance: ${relevanceLabel})
Title: ${result.title}
Path: ${result.path}
URL: ${result.url}`

    // When a specific section matched, lead with it. The document excerpt
    // below is the first N characters of the file, which for a long settings
    // page is a table of contents and a preamble — never the answer. Putting
    // the matching section first is the whole point of embedding sections.
    if (result.matchedSection) {
      const sectionLabel = result.matchedSection.heading
        ? `Matching section — "${result.matchedSection.heading}":`
        : 'Matching section:'
      const section = truncate(result.matchedSection.content, MATCHED_SECTION_CHARS)
      const surrounding = truncate(result.content, DOC_CONTEXT_CHARS)

      return `${header}
${sectionLabel}
${section}

Document begins:
${surrounding}`
    }

    return `${header}
Content:
${truncate(result.content, DOC_EXCERPT_CHARS)}`
  })

  return `Found ${results.length} relevant help documents:\n\n${formatted.join('\n\n---\n\n')}`
}
