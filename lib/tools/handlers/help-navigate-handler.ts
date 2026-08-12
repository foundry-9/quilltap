/**
 * Help Navigate Tool Handler
 *
 * Processes navigation requests from LLMs, validating the target URL
 * and returning it for the frontend to execute the actual navigation.
 */

import { logger } from '@/lib/logger'
import {
  HelpNavigateToolInput,
  HelpNavigateToolOutput,
  validateHelpNavigateInput,
} from '../help-navigate-tool'

const logger_ = logger.child({ module: 'help-navigate-handler' })

/**
 * Context required for help navigate execution
 */
export interface HelpNavigateToolContext {
  /** User ID for logging */
  userId: string
}

/**
 * Execute a help navigate tool call
 *
 * Validates the URL and returns it for frontend navigation.
 * The actual browser navigation happens on the client side when
 * the tool result is received via SSE.
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID
 * @returns Tool output with validated URL
 */
export async function executeHelpNavigateTool(
  input: unknown,
  context: HelpNavigateToolContext
): Promise<HelpNavigateToolOutput> {
  try {
    const parsed = validateHelpNavigateInput(input)
    if (!parsed) {
      logger_.warn('Help navigate validation failed', {
        userId: context.userId,
        input,
      })
      return {
        success: false,
        url: '',
        error: 'Invalid input: url is required and must be a valid internal Quilltap path starting with /',
      }
    }

    const { url } = parsed

    logger_.info('Help navigate tool executed', {
      userId: context.userId,
      url,
    })

    return {
      success: true,
      url,
    }
  } catch (error) {
    logger_.error('Help navigate tool execution failed', {
      userId: context.userId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      url: typeof input === 'object' && input !== null && 'url' in input
        ? String((input as Record<string, unknown>).url)
        : '',
      error: error instanceof Error ? error.message : 'Unknown error during navigation',
    }
  }
}

/**
 * Format help navigate results for inclusion in conversation context
 *
 * @param output - The tool output
 * @returns Formatted string suitable for LLM context
 */
export function formatHelpNavigateResults(output: HelpNavigateToolOutput): string {
  if (!output.success) {
    return output.error || 'Failed to navigate.'
  }

  return `Navigation initiated to: ${output.url}`
}
