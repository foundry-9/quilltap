/**
 * Delete Annotation Tool Handler
 * Project Scriptorium
 *
 * Executes the delete_annotation tool by removing a character's annotation
 * from a specific message in a conversation. Only the calling character's
 * annotation is affected.
 */

import {
  DeleteAnnotationToolInput,
  DeleteAnnotationToolOutput,
  validateDeleteAnnotationInput,
} from '../delete-annotation-tool';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';

const logger = createServiceLogger('DeleteAnnotationHandler');

/**
 * Context required for delete annotation tool execution
 */
export interface DeleteAnnotationToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID the annotation belongs to */
  chatId: string;
  /** Character name resolved from the calling participant */
  characterName: string;
}

/**
 * Execute the delete annotation tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character name
 * @returns Tool output with deletion result
 */
export async function executeDeleteAnnotationTool(
  input: unknown,
  context: DeleteAnnotationToolContext
): Promise<DeleteAnnotationToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    const parsed = validateDeleteAnnotationInput(input);
    if (!parsed) {
      logger.warn('Delete annotation tool validation failed', {
        context: 'delete-annotation-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterName: context.characterName,
        input,
      });
      return {
        success: false,
        message_index: typeof input === 'object' && input !== null
          ? Number((input as Record<string, unknown>).message_index) || 0
          : 0,
        error: 'Invalid input: message_index (integer >= 0) is required.',
      };
    }

    const { message_index } = parsed;

    // Attempt to delete the annotation
    const deleted = await repos.conversationAnnotations.deleteAnnotation(
      context.chatId,
      message_index,
      context.characterName
    );

    if (!deleted) {
      return {
        success: false,
        message_index,
        character_name: context.characterName,
        error: 'No annotation found for this message.',
      };
    }

    logger.info('Delete annotation tool completed', {
      context: 'delete-annotation-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterName: context.characterName,
      messageIndex: message_index,
    });

    return {
      success: true,
      message_index,
      character_name: context.characterName,
    };
  } catch (error) {
    logger.error('Delete annotation tool execution failed', {
      context: 'delete-annotation-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterName: context.characterName,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      message_index: typeof input === 'object' && input !== null
        ? Number((input as Record<string, unknown>).message_index) || 0
        : 0,
      error: error instanceof Error ? error.message : 'Unknown error deleting annotation.',
    };
  }
}

/**
 * Format delete annotation results for inclusion in conversation context
 *
 * @param output - Delete annotation tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatDeleteAnnotationResults(output: DeleteAnnotationToolOutput): string {
  if (!output.success) {
    return output.error || 'Unknown error deleting annotation.';
  }

  return `Annotation removed from Message ${output.message_index}.`;
}
