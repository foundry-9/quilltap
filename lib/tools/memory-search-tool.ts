/**
 * Memory Search Tool Definition
 * Sprint 6: Memory Deep-Dive Tool
 *
 * Provides a tool interface for LLMs to search character memories
 * during conversations. This allows the LLM to explicitly request
 * memory lookup when it needs more information about past interactions.
 */

/**
 * Input parameters for the memory search tool
 */
export interface MemorySearchToolInput {
  query: string
  limit?: number
  minImportance?: number
}

/**
 * Result of a memory search
 */
export interface MemorySearchResult {
  id: string
  summary: string
  content: string
  importance: number
  relevanceScore: number
  createdAt: string
  source: 'AUTO' | 'MANUAL'
}

/**
 * Output from the memory search tool
 */
export interface MemorySearchToolOutput {
  success: boolean
  memories?: MemorySearchResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const memorySearchToolDefinition = {
  type: 'function',
  function: {
    name: 'search_memories',
    description:
      'Search your memories for specific information about the user, past conversations, or facts you should remember. Use this when you need to recall details about past interactions, user preferences, important events, or anything you have previously learned about the user. This helps you provide more personalized and contextually aware responses.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for in your memories. Be specific about the topic, person, event, or detail you want to recall. Examples: "user\'s favorite food", "their birthday", "what happened last time we talked about work", "their pet\'s name"',
          minLength: 1,
          maxLength: 500,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of memories to retrieve. Default is 5.',
          default: 5,
        },
        minImportance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Minimum importance score (0-1) for returned memories. Higher values return only the most important memories. Default is 0.',
          default: 0,
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicMemorySearchToolDefinition = {
  name: 'search_memories',
  description:
    'Search your memories for specific information about the user, past conversations, or facts you should remember. Use this when you need to recall details about past interactions, user preferences, important events, or anything you have previously learned about the user. This helps you provide more personalized and contextually aware responses.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for in your memories. Be specific about the topic, person, event, or detail you want to recall. Examples: "user\'s favorite food", "their birthday", "what happened last time we talked about work", "their pet\'s name"',
        minLength: 1,
        maxLength: 500,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of memories to retrieve. Default is 5.',
        default: 5,
      },
      minImportance: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'Minimum importance score (0-1) for returned memories. Higher values return only the most important memories. Default is 0.',
        default: 0,
      },
    },
    required: ['query'],
  },
}

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIMemorySearchTool() {
  return memorySearchToolDefinition
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicMemorySearchTool() {
  return anthropicMemorySearchToolDefinition
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleMemorySearchTool() {
  return {
    name: anthropicMemorySearchToolDefinition.name,
    description: anthropicMemorySearchToolDefinition.description,
    parameters: anthropicMemorySearchToolDefinition.input_schema,
  }
}

/**
 * Helper to validate tool input parameters
 */
export function validateMemorySearchInput(
  input: unknown
): input is MemorySearchToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // query is required
  if (typeof obj.query !== 'string' || obj.query.trim().length === 0) {
    return false
  }

  // Optional limit
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return false
    }
  }

  // Optional minImportance
  if (obj.minImportance !== undefined) {
    const importance = Number(obj.minImportance)
    if (isNaN(importance) || importance < 0 || importance > 1) {
      return false
    }
  }

  return true
}
