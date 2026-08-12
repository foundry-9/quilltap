/**
 * Whisper Tool Handler
 *
 * Resolves target character by name/alias, validates the whisper,
 * and saves the whisper message with targetParticipantIds set.
 */

import {
  WhisperToolInput,
  WhisperToolOutput,
  validateWhisperInput,
} from '../whisper-tool';
import { stripTextBlockMarkers } from '../legacy/text-block-parser';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { canReceiveWhisper } from '@/lib/schemas/chat.types';
import type { Character } from '@/lib/schemas/types';

/**
 * Sanitize whisper message content.
 *
 * LLMs sometimes double-encode tool calls — e.g., calling the native whisper
 * tool but placing [[WHISPER to="X"]]content[[/WHISPER]] markers inside the
 * message argument. This strips those markers so the saved content is clean.
 */
function sanitizeWhisperMessage(message: string): string {
  let cleaned = stripTextBlockMarkers(message)

  // If stripping left us with nothing (the entire message was a marker),
  // try extracting just the content from inside the markers
  if (!cleaned.trim() && message.trim()) {
    const contentMatch = message.match(/\[\[\w+[^\]]*\]\]([\s\S]*?)\[\[\/\w+\]\]/i)
    if (contentMatch) {
      cleaned = contentMatch[1].trim()
    }
  }

  return cleaned.trim() || message.trim()
}

/**
 * Context required for whisper tool execution
 */
export interface WhisperToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID where the whisper occurs */
  chatId: string;
  /** Participant ID of the character calling the whisper tool */
  callingParticipantId: string;
}

/**
 * Error thrown during whisper execution
 */
export class WhisperError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'TARGET_NOT_FOUND' | 'SELF_WHISPER' | 'AMBIGUOUS_TARGET' | 'SAVE_ERROR'
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

/**
 * Execute the whisper tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and calling participant
 * @returns Tool output with whisper result
 */
export async function executeWhisperTool(
  input: unknown,
  context: WhisperToolContext
): Promise<WhisperToolOutput> {
  try {
    const parsed = validateWhisperInput(input);
    if (!parsed) {
      logger.warn('Whisper validation failed', { userId: context.userId, input });
      return {
        success: false,
        error: 'Invalid input: both "target" (character name) and "message" (text content) are required.',
      };
    }

    const { target, message } = parsed;
    const repos = getRepositories();

    // Load chat and participants
    const chat = await repos.chats.findById(context.chatId);
    if (!chat || chat.userId !== context.userId) {
      return { success: false, error: 'Chat not found' };
    }

    // Resolve target to participant
    const activeParticipants = chat.participants.filter(p => canReceiveWhisper(p.status));
    const targetLower = target.toLowerCase();

    // Resolve each active participant's character once, then derive both the
    // match set and the (fallback) available-names list from it — no second
    // per-character query.
    const resolved: Array<{ participantId: string; character: Character }> = [];
    for (const participant of activeParticipants) {
      if (!participant.characterId) continue;
      const character = await repos.characters.findById(participant.characterId);
      if (!character) continue;
      resolved.push({ participantId: participant.id, character });
    }

    // Try matching by character name first, then aliases
    const matches: Array<{ participantId: string; characterName: string }> = [];

    for (const { participantId, character } of resolved) {
      // Exact name match (case-insensitive)
      if (character.name.toLowerCase() === targetLower) {
        matches.push({ participantId, characterName: character.name });
        continue;
      }

      // Alias match (case-insensitive)
      if (character.aliases && Array.isArray(character.aliases)) {
        for (const alias of character.aliases) {
          if (typeof alias === 'string' && alias.toLowerCase() === targetLower) {
            matches.push({ participantId, characterName: character.name });
            break;
          }
        }
      }
    }

    if (matches.length === 0) {
      const availableNames = resolved.map(r => r.character.name);
      return {
        success: false,
        error: `No character found matching "${target}". Available characters: ${availableNames.join(', ')}`,
      };
    }

    if (matches.length > 1) {
      return {
        success: false,
        error: `Ambiguous target "${target}" matches multiple characters: ${matches.map(m => m.characterName).join(', ')}. Please be more specific.`,
      };
    }

    const resolvedTarget = matches[0];

    // Can't whisper to self
    if (resolvedTarget.participantId === context.callingParticipantId) {
      return {
        success: false,
        error: 'You cannot whisper to yourself.',
      };
    }

    // Sanitize message content — LLMs sometimes double-encode tool calls
    const cleanMessage = sanitizeWhisperMessage(message);

    // Save the whisper as a new ASSISTANT message with targetParticipantIds
    const whisperMessageId = crypto.randomUUID();
    const now = new Date().toISOString();

    await repos.chats.addMessage(context.chatId, {
      type: 'message',
      id: whisperMessageId,
      role: 'ASSISTANT',
      content: cleanMessage,
      participantId: context.callingParticipantId,
      targetParticipantIds: [resolvedTarget.participantId],
      createdAt: now,
      attachments: [],
    });

    logger.info('Whisper sent successfully', {
      context: 'whisper-handler',
      chatId: context.chatId,
      fromParticipantId: context.callingParticipantId,
      toParticipantId: resolvedTarget.participantId,
      toCharacterName: resolvedTarget.characterName,
    });

    return {
      success: true,
      targetName: resolvedTarget.characterName,
      targetParticipantId: resolvedTarget.participantId,
    };
  } catch (error) {
    logger.error('Whisper tool execution failed', {
      userId: context.userId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during whisper execution',
    };
  }
}

/**
 * Format whisper results for inclusion in conversation context
 *
 * @param output - Whisper tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWhisperResults(output: WhisperToolOutput): string {
  if (!output.success) {
    return `Whisper Error: ${output.error || 'Unknown error'}`;
  }
  return `Whispered to ${output.targetName}: Message sent privately.`;
}
