/**
 * Web Search Tool Definition
 *
 * Provides a tool interface for LLMs to search the web for real-time
 * information during conversations. This allows the LLM to access
 * current information beyond its training data.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the web-search tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const webSearchToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .refine((val) => val.trim().length > 0, {
      message: 'query cannot be empty or whitespace-only',
    })
    .describe(
      'The search query to execute. Be specific and use keywords that will help find relevant information. Examples: "latest news about AI", "current weather in Tokyo", "recent developments in quantum computing"'
    ),
  maxResults: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Maximum number of search results to retrieve. Default is 5.')
  )
    .default(5)
    .optional(),
});

/**
 * Input parameters for the web search tool
 */
export type WebSearchToolInput = z.infer<typeof webSearchToolInputSchema>;

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
    parameters: zodToOpenAISchema(webSearchToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateWebSearchInput(
  input: unknown
): WebSearchToolInput | null {
  const parsed = webSearchToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
