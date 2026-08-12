/**
 * Delete Annotation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to remove their own annotation
 * from a specific message in a conversation. Only the calling character's
 * annotation is affected.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the delete-annotation tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const deleteAnnotationToolInputSchema = z.object({
  message_index: llmNumber(
    z
      .number()
      .int()
      .min(0)
      .describe('The 0-based message number to remove your annotation from.')
  ),
});

/**
 * Input parameters for the delete annotation tool
 */
export type DeleteAnnotationToolInput = z.infer<typeof deleteAnnotationToolInputSchema>;

/**
 * Output from the delete annotation tool
 */
export interface DeleteAnnotationToolOutput {
  success: boolean
  message_index: number
  character_name?: string
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const deleteAnnotationToolDefinition = {
  type: 'function',
  function: {
    name: 'delete_annotation',
    description:
      'Remove your annotation from a specific message in this conversation. Only removes your own annotation — other characters\' annotations are not affected.',
    parameters: zodToOpenAISchema(deleteAnnotationToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateDeleteAnnotationInput(
  input: unknown
): DeleteAnnotationToolInput | null {
  const parsed = deleteAnnotationToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
