/**
 * Submit Final Response Tool Definition
 * Agent Mode Feature
 *
 * Provides a tool interface for LLMs in agent mode to signal completion
 * of iterative tool use and deliver a final response to the user.
 * This tool is only available when agent mode is enabled for a chat.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/**
 * Zod schema for the submit final response tool's input.
 */
export const submitFinalResponseToolInputSchema = z.object({
  response: z
    .string()
    .describe(
      'The final response to deliver to the user. This should be your complete, well-formatted answer ' +
      'incorporating all information gathered from tool use.'
    ),
  summary: z
    .string()
    .describe(
      'Optional brief summary of what you accomplished (e.g., "Searched 3 files and found the bug in config.ts").'
    )
    .optional(),
  confidence: llmNumber(
    z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Optional confidence level (0-1) in your response. Use 0.9+ when highly confident, 0.5-0.9 for moderate confidence, below 0.5 when uncertain.'
      )
  )
    .optional(),
})

/**
 * Input parameters for the submit final response tool
 */
export type SubmitFinalResponseToolInput = z.infer<typeof submitFinalResponseToolInputSchema>

/**
 * Output from the submit final response tool
 */
export interface SubmitFinalResponseToolOutput {
  success: boolean
  message: string
  /** The final response that should be displayed to the user */
  finalResponse?: string
  /** Summary of the agent's work */
  summary?: string
  /** Confidence level if provided */
  confidence?: number
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const submitFinalResponseToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_final_response',
    description:
      'Signal completion of agent mode processing and submit the final response to the user. ' +
      'Call this tool when you have gathered all necessary information, verified your results, ' +
      'and are ready to deliver a comprehensive answer. The response parameter should contain ' +
      'your complete, polished answer. Do not call other tools after calling this one.',
    parameters: zodToOpenAISchema(submitFinalResponseToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateSubmitFinalResponseInput(
  input: unknown
): SubmitFinalResponseToolInput | null {
  const parsed = submitFinalResponseToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
