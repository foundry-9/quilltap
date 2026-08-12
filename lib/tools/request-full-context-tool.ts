/**
 * Request Full Context Tool Definition
 * Context Compression Feature
 *
 * Provides a tool interface for LLMs to request a full context reload
 * when the compressed context is missing important details or when
 * a complex question requires the complete conversation history.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the request full context tool's input.
 */
export const requestFullContextToolInputSchema = z.object({})

/**
 * Input parameters for the request full context tool
 * This tool takes no parameters - it simply signals intent
 */
export type RequestFullContextToolInput = z.infer<typeof requestFullContextToolInputSchema>

/**
 * Output from the request full context tool
 */
export interface RequestFullContextToolOutput {
  success: boolean
  message: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const requestFullContextToolDefinition = {
  type: 'function',
  function: {
    name: 'request_full_context',
    description:
      'Request a full, uncompressed context reload for the next message. Use this when you realize the compressed context is missing important details, when the conversation has shifted significantly and you need the complete picture, or when handling a complex question that requires full historical understanding. This tool takes no parameters - it simply signals that the next message should bypass compression and provide complete context.',
    parameters: zodToOpenAISchema(requestFullContextToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 * Since this tool takes no parameters, any object is valid
 */
export function validateRequestFullContextInput(
  input: unknown
): RequestFullContextToolInput | null {
  const parsed = requestFullContextToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
