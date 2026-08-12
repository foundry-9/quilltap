/**
 * Read Conversation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to read the rendered Markdown
 * version of the current conversation, with sequential message numbering
 * and interchange grouping.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/**
 * Zod schema for the read conversation tool's input.
 */
export const readConversationToolInputSchema = z.object({
  conversationId: z
    .string()
    .describe(
      'Optional ID of a specific conversation to read. If omitted, reads the current conversation. Use search to find conversation IDs.'
    )
    .optional(),
  exclude_annotations: z
    .boolean()
    .default(false)
    .describe(
      'If true, returns clean conversation without any annotations. If false (default), includes all character annotations.'
    )
    .optional(),
  interchange_start: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .describe(
        'First interchange to include (1-based). Use with interchange_end to pull just the relevant slice of a long conversation instead of the whole transcript.'
      )
  ).optional(),
  interchange_end: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .describe('Last interchange to include (inclusive). Omit to read to the end.')
  ).optional(),
})

/**
 * Input parameters for the read conversation tool
 */
export type ReadConversationToolInput = z.infer<typeof readConversationToolInputSchema>

/**
 * Output from the read conversation tool
 */
export interface ReadConversationToolOutput {
  success: boolean
  markdown?: string
  messageCount?: number
  interchangeCount?: number
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const readConversationToolDefinition = {
  type: 'function',
  function: {
    name: 'read_conversation',
    description:
      'Read the rendered Markdown version of a conversation. Without a conversationId, reads the current conversation. With a conversationId (e.g., from search results), reads that specific conversation. Returns the conversation with sequential message numbering and interchange grouping; pass interchange_start/interchange_end to read just a slice of a long conversation.',
    parameters: zodToOpenAISchema(readConversationToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateReadConversationInput(
  input: unknown
): ReadConversationToolInput | null {
  const parsed = readConversationToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
