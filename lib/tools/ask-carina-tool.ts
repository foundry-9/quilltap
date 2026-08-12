/**
 * Ask Carina Tool Definition
 *
 * Provides a tool interface for LLMs to pose a quick, isolated question to
 * another character via Carina. A Carina line opens when EITHER side is a
 * `canBeCarina` answerer: any answerer can be asked, and a caller who is itself
 * an answerer may ask anyone. The recipient runs its own minimal LLM call — no
 * shared history — and posts the reply as a `systemSender: 'carina'` message.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the ask_carina tool's input. The single source of truth for
 * both runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const askCarinaToolInputSchema = z.object({
  character: z
    .string()
    .min(1)
    .describe(
      'The name of the character to ask. Any character with Carina answerer capability can be asked; ' +
      'additionally, if you are yourself a Carina answerer, you may ask any character (a Carina line ' +
      'opens when either side is an answerer).'
    ),
  question: z
    .string()
    .min(1)
    .describe('The question to ask.'),
  whisper: z
    .boolean()
    .default(false)
    .describe(
      'If true, the answer is whispered back to the caller only. If false, the answer appears in the chat publicly.'
    ),
});

/**
 * Input parameters for the ask_carina tool
 */
export type AskCarinaToolInput = z.infer<typeof askCarinaToolInputSchema>;

/**
 * Output from the ask_carina tool
 */
export interface AskCarinaToolOutput {
  success: boolean;
  answer: string;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const askCarinaToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_carina',
    description:
      'Ask another character a quick standalone question via Carina. They respond from their own identity and available tools without joining the conversation or seeing the chat history. You can ask any Carina answerer; if you are yourself a Carina answerer, you can ask any character (a Carina line opens when either side is an answerer).',
    parameters: zodToOpenAISchema(askCarinaToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateAskCarinaInput(
  input: unknown
): AskCarinaToolInput | null {
  const parsed = askCarinaToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
