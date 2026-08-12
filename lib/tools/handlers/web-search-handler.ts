/**
 * Web Search Tool Handler
 *
 * This handler performs web searches when the LLM explicitly requests
 * real-time information from the internet.
 *
 * Uses pluggable search provider plugins registered via the search provider
 * registry. Falls back to SERPER_API_KEY env var for backwards compatibility.
 */

import {
  WebSearchToolOutput,
  WebSearchResult,
  validateWebSearchInput,
} from '../web-search-tool'
import { logger } from '@/lib/logger'
import { searchProviderRegistry } from '@/lib/plugins/search-provider-registry'

import { getUserRepositories } from '@/lib/repositories/user-scoped'

// ============================================================================
// LEGACY SERPER TYPES (for env var fallback — deprecated)
// ============================================================================

interface SerperOrganicResult {
  title: string
  link: string
  snippet: string
  date?: string
  position?: number
}

interface SerperKnowledgeGraph {
  title?: string
  type?: string
  description?: string
  source?: { name: string; link: string }
}

interface SerperResponse {
  organic?: SerperOrganicResult[]
  knowledgeGraph?: SerperKnowledgeGraph
  searchParameters?: {
    q: string
    num?: number
  }
  credits?: number
}

/**
 * Context required for web search execution
 */
export interface WebSearchToolContext {
  /** User ID for authentication and logging */
  userId: string
}

/**
 * Error thrown during web search execution
 */
export class WebSearchError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'SEARCH_ERROR' | 'API_ERROR' | 'CONFIG_ERROR'
  ) {
    super(message)
    this.name = 'WebSearchError'
  }
}

/** Legacy Serper API endpoint (for env var fallback) */
const SERPER_API_URL = 'https://google.serper.dev/search'

/**
 * Check if web search is configured
 *
 * Returns true if a search provider plugin is registered OR the legacy
 * SERPER_API_KEY env var is set.
 */
export function isWebSearchConfigured(): boolean {
  return searchProviderRegistry.isSearchConfigured() || !!process.env.SERPER_API_KEY
}

/**
 * Look up and decrypt the API key for a search provider from the user's stored keys
 */
async function getSearchProviderApiKey(
  providerName: string,
  userId: string
): Promise<string | null> {
  try {
    const repos = getUserRepositories(userId)
    const allKeys = await repos.connections.getAllApiKeys()

    // Find an active API key for this provider
    const apiKeyRecord = allKeys.find(
      (key) => key.provider === providerName && key.isActive
    )

    if (!apiKeyRecord) {
      return null
    }

    return apiKeyRecord.key_value
  } catch (error) {
    logger.error('Failed to retrieve API key for search provider', {
      provider: providerName,
      userId,
    }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Execute a web search using the registered search provider plugin
 *
 * Uses the search provider registry to find the appropriate backend.
 * Falls back to SERPER_API_KEY env var for backwards compatibility.
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID
 * @returns Tool output with search results
 */
export async function executeWebSearchTool(
  input: unknown,
  context: WebSearchToolContext
): Promise<WebSearchToolOutput> {
  try {
    // Validate input
    const parsed = validateWebSearchInput(input)
    if (!parsed) {
      logger.warn('Web search validation failed', { userId: context.userId, input })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string',
        totalFound: 0,
        query: '',
      }
    }

    const { query, maxResults = 5 } = parsed

    // Try to use a registered search provider plugin
    const provider = searchProviderRegistry.getDefaultProvider()

    if (provider) {
      // Look up the API key from the database
      let apiKey: string | null = null

      if (provider.config.requiresApiKey) {
        apiKey = await getSearchProviderApiKey(
          provider.metadata.providerName,
          context.userId
        )

        if (!apiKey) {
          logger.warn('Web search provider requires API key but none found', {
            userId: context.userId,
            provider: provider.metadata.providerName,
          })
          return {
            success: false,
            error: `No API key configured for ${provider.metadata.displayName}. Please add your API key in Settings > API Keys.`,
            totalFound: 0,
            query,
          }
        }
      }

      // Execute search via the provider plugin
      const providerResult = await provider.executeSearch(
        query,
        maxResults,
        apiKey ?? '',
        undefined
      )

      // Map provider results to our internal format
      const results: WebSearchResult[] = (providerResult.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        publishedDate: r.publishedDate,
      }))

      logger.info('Web search completed via provider plugin', {
        userId: context.userId,
        provider: provider.metadata.providerName,
        query,
        resultsCount: results.length,
        success: providerResult.success,
      })

      if (!providerResult.success) {
        return {
          success: false,
          error: providerResult.error ?? 'Search provider returned an error',
          totalFound: 0,
          query,
        }
      }

      return {
        success: true,
        results,
        totalFound: results.length,
        query,
      }
    }

    // Fallback: Use legacy SERPER_API_KEY env var (deprecated)
    return await executeSerperFallback(query, maxResults, context)
  } catch (error) {
    logger.error('Web search tool execution failed', { userId: context.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during web search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Legacy Serper.dev fallback for when no search provider plugin is registered
 * but SERPER_API_KEY env var is set.
 *
 * @deprecated Use a search provider plugin instead. Store API keys in Settings > API Keys.
 */
async function executeSerperFallback(
  query: string,
  maxResults: number,
  context: WebSearchToolContext
): Promise<WebSearchToolOutput> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    logger.warn('Web search attempted without any search provider or API key', {
      userId: context.userId,
      query,
    })
    return {
      success: false,
      error: 'Web search is not configured. Please add a search provider API key in Settings > API Keys.',
      totalFound: 0,
      query,
    }
  }

  logger.warn('Using deprecated SERPER_API_KEY env var for web search. Please configure the Serper search provider plugin and store the API key in Settings > API Keys instead.', {
    userId: context.userId,
    query,
  })

  // Call Serper API directly (legacy path)
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: maxResults,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Serper API request failed (legacy fallback)', {
      userId: context.userId,
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    })

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'Invalid Serper API key. Please check your SERPER_API_KEY environment variable or configure the API key in Settings > API Keys.',
        totalFound: 0,
        query,
      }
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'Serper API rate limit exceeded. Please try again later or upgrade your plan at serper.dev.',
        totalFound: 0,
        query,
      }
    }

    return {
      success: false,
      error: `Search API error: ${response.status} ${response.statusText}`,
      totalFound: 0,
      query,
    }
  }

  const data: SerperResponse = await response.json()

  // Map Serper results to our format
  const results: WebSearchResult[] = (data.organic ?? []).map((result) => ({
    title: result.title,
    url: result.link,
    snippet: result.snippet,
    publishedDate: result.date,
  }))

  // If we have a knowledge graph result and few organic results, include it
  const kg = data.knowledgeGraph
  if (kg?.description && results.length < maxResults) {
    results.unshift({
      title: kg.title ?? 'Knowledge Graph',
      url: kg.source?.link ?? '',
      snippet: kg.description,
    })
  }

  logger.info('Web search completed (legacy Serper fallback)', {
    userId: context.userId,
    query,
    resultsCount: results.length,
  })

  return {
    success: true,
    results,
    totalFound: results.length,
    query,
  }
}

/**
 * Format web search results for inclusion in conversation context
 *
 * Delegates to the search provider plugin's formatResults() if available,
 * otherwise uses the built-in formatter.
 *
 * @param results - Search results to format
 * @returns Formatted string suitable for LLM context
 */
export function formatWebSearchResults(results: WebSearchResult[]): string {
  // Try to use the active search provider's formatter
  const provider = searchProviderRegistry.getDefaultProvider()
  if (provider?.formatResults) {
    try {
      return provider.formatResults(results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        publishedDate: r.publishedDate,
      })))
    } catch (error) {
      logger.warn('Search provider formatResults failed, using built-in formatter', {
        provider: provider.metadata.providerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Built-in formatter (fallback)
  if (results.length === 0) {
    return 'No search results found.'
  }

  const formatted = results.map((result, index) => {
    const dateStr = result.publishedDate
      ? ` (Published: ${new Date(result.publishedDate).toLocaleDateString()})`
      : ''

    return `[Result ${index + 1}]${dateStr}
Title: ${result.title}
URL: ${result.url}
Summary: ${result.snippet}`
  })

  return `Found ${results.length} search results:\n\n${formatted.join('\n\n')}`
}
