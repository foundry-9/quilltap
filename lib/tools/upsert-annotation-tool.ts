/**
 * Upsert Annotation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to add or update annotations
 * on specific messages in a conversation. Each character can have
 * one annotation per message.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the upsert-annotation tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const upsertAnnotationToolInputSchema = z.object({
  message_index: llmNumber(
    z
      .number()
      .int()
      .min(0)
      .describe('The 0-based message number to annotate (as shown in the rendered conversation, e.g., Message 0, Message 1).')
  ),
  content: z
    .string()
    .min(1)
    .max(2000)
    .describe('Your annotation text. This is your personal commentary on the message.'),
});

/**
 * Input parameters for the upsert annotation tool
 */
export type UpsertAnnotationToolInput = z.infer<typeof upsertAnnotationToolInputSchema>;

/**
 * Output from the upsert annotation tool
 */
export interface UpsertAnnotationToolOutput {
  success: boolean
  message_index: number
  character_name?: string
  action?: 'created' | 'updated'
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const upsertAnnotationToolDefinition = {
  type: 'function',
  function: {
    name: 'upsert_annotation',
    description:
      'Add or update your annotation on a specific message in this conversation. Annotations are personal commentary that persist across the conversation. Each character can have one annotation per message. Use this to mark important moments, add context, record observations, or note emotional reactions.',
    parameters: zodToOpenAISchema(upsertAnnotationToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateUpsertAnnotationInput(
  input: unknown
): UpsertAnnotationToolInput | null {
  const parsed = upsertAnnotationToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
