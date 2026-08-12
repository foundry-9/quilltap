/**
 * Submit Final Response Tool Handler
 * Agent Mode Feature
 *
 * This handler processes the submit_final_response tool call from an LLM
 * in agent mode, extracting the final response to display to the user.
 */

import { logger } from '@/lib/logger'
import {
  SubmitFinalResponseToolInput,
  SubmitFinalResponseToolOutput,
  validateSubmitFinalResponseInput,
} from '../submit-final-response-tool'

/**
 * Context required for submit final response execution
 */
export interface SubmitFinalResponseToolContext {
  /** Chat ID for logging purposes */
  chatId: string
  /** Current agent turn number */
  turnNumber?: number
}

/**
 * Execute the submit final response tool
 *
 * This tool doesn't have side effects - it simply validates and returns
 * the final response content for the orchestrator to handle.
 *
 * @param input - The tool input parameters
 * @param context - Execution context including chat ID
 * @returns Tool output with the final response content
 */
export async function executeSubmitFinalResponseTool(
  input: unknown,
  context: SubmitFinalResponseToolContext
): Promise<SubmitFinalResponseToolOutput> {
  try {
    // Validate input
    const parsed = validateSubmitFinalResponseInput(input)
    if (!parsed) {
      logger.warn('[SubmitFinalResponse] Invalid input received', {
        context: 'agent-mode',
        chatId: context.chatId,
        input: typeof input === 'object' ? JSON.stringify(input) : String(input),
      })
      return {
        success: false,
        message: 'Invalid input: response parameter is required and must be a non-empty string',
      }
    }

    const validInput = parsed

    logger.info('[SubmitFinalResponse] Agent submitted final response', {
      context: 'agent-mode',
      chatId: context.chatId,
      turnNumber: context.turnNumber,
      responseLength: validInput.response.length,
      hasSummary: !!validInput.summary,
      confidence: validInput.confidence,
    })

    return {
      success: true,
      message: 'Final response submitted successfully',
      finalResponse: validInput.response,
      summary: validInput.summary,
      confidence: validInput.confidence,
    }
  } catch (error) {
    logger.error(
      '[SubmitFinalResponse] Tool execution error',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined
    )
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error submitting final response',
    }
  }
}

/**
 * Format submit final response results for inclusion in conversation context
 *
 * Note: This is typically not used since the tool signals completion,
 * but provided for consistency with other tool handlers.
 *
 * @param result - The tool output to format
 * @returns Formatted string suitable for LLM context
 */
export function formatSubmitFinalResponseResults(
  result: SubmitFinalResponseToolOutput
): string {
  if (!result.success) {
    return `Error: ${result.message}`
  }

  let output = 'Final response submitted.'
  if (result.summary) {
    output += ` Summary: ${result.summary}`
  }
  if (result.confidence !== undefined) {
    output += ` Confidence: ${Math.round(result.confidence * 100)}%`
  }
  return output
}
