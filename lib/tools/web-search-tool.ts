/**
 * Web Search Tool Definition
 *
 * Provides a tool interface for LLMs to search the web for real-time
 * information during conversations. This allows the LLM to access
 * current information beyond its training data.
 */

/**
 * Input parameters for the web search tool
 */
export interface WebSearchToolInput {
  query: string
  maxResults?: number
}

/**
 * Result of a single web search
 */
export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

/**
 * Output from the web search tool
 */
export interface WebSearchToolOutput {
  success: boolean
  results?: WebSearchResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const webSearchToolDefinition = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search the web for current information, recent events, real-time data, or facts beyond your training data. Use this when you need up-to-date information about news, current events, recent developments, or when the user asks about something that requires real-time or recent data. This tool provides access to current web search results.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query to execute. Be specific and use keywords that will help find relevant information. Examples: "latest news about AI", "current weather in Tokyo", "recent developments in quantum computing"',
          minLength: 1,
          maxLength: 500,
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Maximum number of search results to retrieve. Default is 5.',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicWebSearchToolDefinition = {
  name: 'search_web',
  description:
    'Search the web for current information, recent events, real-time data, or facts beyond your training data. Use this when you need up-to-date information about news, current events, recent developments, or when the user asks about something that requires real-time or recent data. This tool provides access to current web search results.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'The search query to execute. Be specific and use keywords that will help find relevant information. Examples: "latest news about AI", "current weather in Tokyo", "recent developments in quantum computing"',
        minLength: 1,
        maxLength: 500,
      },
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Maximum number of search results to retrieve. Default is 5.',
        default: 5,
      },
    },
    required: ['query'],
  },
}

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIWebSearchTool() {
  return webSearchToolDefinition
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicWebSearchTool() {
  return anthropicWebSearchToolDefinition
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleWebSearchTool() {
  return {
    name: anthropicWebSearchToolDefinition.name,
    description: anthropicWebSearchToolDefinition.description,
    parameters: anthropicWebSearchToolDefinition.input_schema,
  }
}

/**
 * Helper to validate tool input parameters
 */
export function validateWebSearchInput(
  input: unknown
): input is WebSearchToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // query is required
  if (typeof obj.query !== 'string' || obj.query.trim().length === 0) {
    return false
  }

  // Optional maxResults
  if (obj.maxResults !== undefined) {
    const maxResults = Number(obj.maxResults)
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
      return false
    }
  }

  return true
}
