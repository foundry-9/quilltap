/**
 * Read Conversation Tool Handler
 * Project Scriptorium
 *
 * Executes the read_conversation tool by loading the rendered Markdown
 * for a chat, optionally merging or stripping annotations, and returning
 * the result with message/interchange counts.
 */

import {
  ReadConversationToolInput,
  ReadConversationToolOutput,
  validateReadConversationInput,
} from '../read-conversation-tool';
import { mergeAnnotations, stripAnnotations } from '@/lib/scriptorium';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';

const logger = createServiceLogger('ReadConversationHandler');

/**
 * Context required for read conversation tool execution
 */
export interface ReadConversationToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID to read the conversation from */
  chatId: string;
  /** Character ID of the calling character (for cross-conversation access control) */
  characterId?: string;
}

/**
 * Execute the read conversation tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID and chat ID
 * @returns Tool output with rendered markdown and counts
 */
export async function executeReadConversationTool(
  input: unknown,
  context: ReadConversationToolContext
): Promise<ReadConversationToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    const parsed = validateReadConversationInput(input);
    if (!parsed) {
      logger.warn('Read conversation tool validation failed', {
        context: 'read-conversation-handler',
        userId: context.userId,
        chatId: context.chatId,
        input,
      });
      return {
        success: false,
        error: 'Invalid input: exclude_annotations must be a boolean if provided.',
      };
    }

    const { conversationId, exclude_annotations, interchange_start, interchange_end } = parsed;
    const targetChatId = conversationId || context.chatId;

    // Load chat
    const chat = await repos.chats.findById(targetChatId);
    if (!chat) {
      logger.warn('Read conversation tool: chat not found', {
        context: 'read-conversation-handler',
        chatId: targetChatId,
        userId: context.userId,
        requestedConversationId: conversationId,
      });
      return {
        success: false,
        error: 'Conversation not found.',
      };
    }

    // When reading a different conversation, verify the calling character participates
    if (conversationId && conversationId !== context.chatId && context.characterId) {
      const participatesInChat = chat.participants.some(
        p => p.characterId === context.characterId
      );
      if (!participatesInChat) {
        logger.warn('Read conversation tool: character does not participate in target chat', {
          context: 'read-conversation-handler',
          chatId: targetChatId,
          characterId: context.characterId,
        });
        return {
          success: false,
          error: 'Conversation not found.',
        };
      }
    }

    if (!chat.renderedMarkdown) {
      return {
        success: false,
        error: 'Conversation has not been rendered yet.',
      };
    }

    let markdown = chat.renderedMarkdown;

    if (exclude_annotations) {
      // Strip any inline annotations that may have been stored
      markdown = stripAnnotations(markdown);
    } else {
      // Load and merge annotations
      const annotations = await repos.conversationAnnotations.findByChatId(targetChatId);
      if (annotations.length > 0) {
        markdown = mergeAnnotations(markdown, annotations);
      }
    }

    // Interchange-range slicing: a character drilling into a very long chat
    // can pull just the relevant slice instead of the whole transcript.
    const totalInterchanges = (markdown.match(/^## Interchange \d+/gm) ?? []).length;
    if (interchange_start !== undefined || interchange_end !== undefined) {
      const start = interchange_start ?? 1;
      const end = interchange_end ?? Number.POSITIVE_INFINITY;
      if (end < start) {
        return {
          success: false,
          error: 'interchange_end must be >= interchange_start.',
        };
      }
      const sections = markdown.split(/^(?=## Interchange \d+)/m);
      const preamble = /^## Interchange \d+/.test(sections[0] ?? '') ? '' : (sections.shift() ?? '');
      const kept = sections.filter(section => {
        const m = section.match(/^## Interchange (\d+)/);
        if (!m) return false;
        const n = parseInt(m[1], 10);
        return n >= start && n <= end;
      });
      if (kept.length === 0) {
        return {
          success: false,
          error: `No interchanges in range ${start}–${interchange_end ?? totalInterchanges} (conversation has ${totalInterchanges}).`,
        };
      }
      const lastShown = Math.min(end, totalInterchanges);
      markdown = `${preamble}${kept.join('')}`.trimEnd() +
        `\n\n_Showing interchanges ${start}–${lastShown} of ${totalInterchanges}._\n`;
    }

    // Count messages and interchanges from the (possibly sliced) markdown
    const messageMatches = markdown.match(/^### Message \d+/gm);
    const interchangeMatches = markdown.match(/^## Interchange \d+/gm);
    const messageCount = messageMatches ? messageMatches.length : 0;
    const interchangeCount = interchangeMatches ? interchangeMatches.length : 0;

    logger.info('Read conversation tool completed', {
      context: 'read-conversation-handler',
      userId: context.userId,
      chatId: targetChatId,
      messageCount,
      interchangeCount,
      markdownLength: markdown.length,
      excludeAnnotations: !!exclude_annotations,
    });

    return {
      success: true,
      markdown,
      messageCount,
      interchangeCount,
    };
  } catch (error) {
    logger.error('Read conversation tool execution failed', {
      context: 'read-conversation-handler',
      userId: context.userId,
      chatId: context.chatId,
      requestedConversationId: (input as Record<string, unknown>)?.conversationId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error reading conversation.',
    };
  }
}

/**
 * Format read conversation results for inclusion in conversation context
 *
 * @param output - Read conversation tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatReadConversationResults(output: ReadConversationToolOutput): string {
  if (!output.success) {
    return output.error || 'Unknown error reading conversation.';
  }

  if (!output.markdown) {
    return 'No conversation content available.';
  }

  return output.markdown;
}
