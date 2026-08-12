/**
 * Request Full Context Tool Handler
 * Context Compression Feature
 *
 * This handler sets a flag on the chat metadata to trigger
 * a full context reload on the next message, bypassing compression.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import {
  RequestFullContextToolOutput,
  validateRequestFullContextInput,
} from '../request-full-context-tool'

/**
 * Context required for request full context execution
 */
export interface RequestFullContextToolContext {
  /** Chat ID to set the flag on */
  chatId: string
}

/**
 * Execute the request full context tool
 *
 * Sets a flag on the chat metadata that will be checked on the next
 * message to bypass context compression and provide full context.
 *
 * @param input - The tool input parameters (none required)
 * @param context - Execution context including chat ID
 * @returns Tool output with confirmation message
 */
export async function executeRequestFullContextTool(
  input: unknown,
  context: RequestFullContextToolContext
): Promise<RequestFullContextToolOutput> {
  try {
    // Validate input (should always pass since no params required)
    const parsed = validateRequestFullContextInput(input)
    if (!parsed) {
      return {
        success: false,
        message: 'Invalid input format',
      }
    }

    const repos = getRepositories()

    // Set the flag on the chat metadata
    await repos.chats.update(context.chatId, {
      requestFullContextOnNextMessage: true,
    })

    logger.info('[RequestFullContext] Full context requested for next message', {
      context: 'context-compression',
      chatId: context.chatId,
    })

    return {
      success: true,
      message:
        'Full context will be provided on your next response. The next message will include the complete, uncompressed conversation history and system prompt.',
    }
  } catch (error) {
    logger.error(
      '[RequestFullContext] Tool execution error',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined
    )
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error requesting full context',
    }
  }
}

/**
 * Format request full context results for inclusion in conversation context
 *
 * @param result - The tool output to format
 * @returns Formatted string suitable for LLM context
 */
export function formatRequestFullContextResults(
  result: RequestFullContextToolOutput
): string {
  return result.message
}
