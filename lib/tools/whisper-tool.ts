/**
 * Whisper Tool Definition
 *
 * Allows LLM characters to send private messages to specific characters
 * in multi-character chats. Only the sender and target can see whispers.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the whisper tool's input.
 */
export const whisperToolInputSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe('The name or alias of the character you want to whisper to.'),
  message: z
    .string()
    .min(1)
    .describe('The private message content to send.'),
})

export type WhisperToolInput = z.infer<typeof whisperToolInputSchema>

export interface WhisperToolOutput {
  success: boolean;
  /** Name of the character the whisper was sent to */
  targetName?: string;
  /** Participant ID of the target */
  targetParticipantId?: string;
  error?: string;
}

export const whisperToolDefinition = {
  type: 'function',
  function: {
    name: 'whisper',
    description:
      'Send a private whisper to a specific character. Only you and the target can see this message. Other characters in the chat will not see it. Use this for secrets, private asides, or confidential communication.',
    parameters: zodToOpenAISchema(whisperToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWhisperInput(input: unknown): WhisperToolInput | null {
  const parsed = whisperToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
