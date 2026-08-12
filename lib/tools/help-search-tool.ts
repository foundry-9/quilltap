/**
 * Help Search Tool Definition
 *
 * Provides a tool interface for LLMs to search Quilltap's help documentation
 * during conversations. This allows the LLM to look up feature guidance,
 * configuration help, and usage instructions to better assist users.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/**
 * Zod schema for the help search tool's input.
 */
export const helpSearchToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .refine((val) => val.trim().length > 0, {
      message: 'query cannot be empty or whitespace-only',
    })
    .describe(
      'What to search for in the help documentation. Be specific about the feature, setting, or topic. Examples: "how to configure embedding profiles", "image generation settings", "memory search", "project files"'
    ),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Maximum number of help documents to retrieve. Default is 3.')
  )
    .default(3)
    .optional(),
})

/**
 * Input parameters for the help search tool
 */
export type HelpSearchToolInput = z.infer<typeof helpSearchToolInputSchema>

/**
 * A single help search result
 */
export interface HelpSearchResult {
  id: string
  title: string
  path: string
  url: string
  score: number
  content: string
}

/**
 * Output from the help search tool
 */
export interface HelpSearchToolOutput {
  success: boolean
  results?: HelpSearchResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const helpSearchToolDefinition = {
  type: 'function',
  function: {
    name: 'help_search',
    description:
      'Search Quilltap help documentation for features, settings, configuration, or usage guidance. Use this when the user asks about how to use Quilltap, configure settings, troubleshoot issues, or understand features. This helps you provide accurate documentation-based answers.',
    parameters: zodToOpenAISchema(helpSearchToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateHelpSearchInput(
  input: unknown
): HelpSearchToolInput | null {
  const parsed = helpSearchToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
