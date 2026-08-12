/**
 * Upsert Annotation Tool Handler
 * Project Scriptorium
 *
 * Executes the upsert_annotation tool by creating or updating an annotation
 * on a specific message in a conversation. The calling character's name is
 * resolved outside this handler and passed via context.
 */

import {
  UpsertAnnotationToolInput,
  UpsertAnnotationToolOutput,
  validateUpsertAnnotationInput,
} from '../upsert-annotation-tool';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';

const logger = createServiceLogger('UpsertAnnotationHandler');

/**
 * Context required for upsert annotation tool execution
 */
export interface UpsertAnnotationToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID the annotation belongs to */
  chatId: string;
  /** Character name resolved from the calling participant */
  characterName: string;
}

/**
 * Execute the upsert annotation tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character name
 * @returns Tool output with action taken
 */
export async function executeUpsertAnnotationTool(
  input: unknown,
  context: UpsertAnnotationToolContext
): Promise<UpsertAnnotationToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    const parsed = validateUpsertAnnotationInput(input);
    if (!parsed) {
      logger.warn('Upsert annotation tool validation failed', {
        context: 'upsert-annotation-handler',
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
        error: 'Invalid input: message_index (integer >= 0) and content (string, 1-2000 chars) are required.',
      };
    }

    const { message_index, content } = parsed;

    // Load chat and verify rendered markdown exists
    const chat = await repos.chats.findById(context.chatId);
    if (!chat) {
      logger.warn('Upsert annotation tool: chat not found', {
        context: 'upsert-annotation-handler',
        chatId: context.chatId,
        userId: context.userId,
      });
      return {
        success: false,
        message_index,
        error: 'Chat not found.',
      };
    }

    if (!chat.renderedMarkdown) {
      return {
        success: false,
        message_index,
        error: 'Conversation has not been rendered yet.',
      };
    }

    // Validate message_index is within range
    const messageMatches = chat.renderedMarkdown.match(/^### Message \d+/gm);
    const messageCount = messageMatches ? messageMatches.length : 0;

    if (message_index >= messageCount) {
      logger.warn('Upsert annotation tool: message_index out of range', {
        context: 'upsert-annotation-handler',
        chatId: context.chatId,
        messageIndex: message_index,
        messageCount,
      });
      return {
        success: false,
        message_index,
        error: `Message index ${message_index} is out of range. The conversation has ${messageCount} messages (0-${messageCount - 1}).`,
      };
    }

    // Check if annotation already exists to determine action
    const existing = await repos.conversationAnnotations.findByMessageIndex(
      context.chatId,
      message_index,
      context.characterName
    );
    const action: 'created' | 'updated' = existing ? 'updated' : 'created';

    // Upsert the annotation
    await repos.conversationAnnotations.upsert({
      chatId: context.chatId,
      messageIndex: message_index,
      characterName: context.characterName,
      content,
    });

    logger.info('Upsert annotation tool completed', {
      context: 'upsert-annotation-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterName: context.characterName,
      messageIndex: message_index,
      action,
      contentLength: content.length,
    });

    return {
      success: true,
      message_index,
      character_name: context.characterName,
      action,
    };
  } catch (error) {
    logger.error('Upsert annotation tool execution failed', {
      context: 'upsert-annotation-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterName: context.characterName,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      message_index: typeof input === 'object' && input !== null
        ? Number((input as Record<string, unknown>).message_index) || 0
        : 0,
      error: error instanceof Error ? error.message : 'Unknown error upserting annotation.',
    };
  }
}

/**
 * Format upsert annotation results for inclusion in conversation context
 *
 * @param output - Upsert annotation tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatUpsertAnnotationResults(output: UpsertAnnotationToolOutput): string {
  if (!output.success) {
    return output.error || 'Unknown error upserting annotation.';
  }

  return `Annotation ${output.action} on Message ${output.message_index} by ${output.character_name}.`;
}
