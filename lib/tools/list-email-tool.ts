/**
 * List Email Tool Definition (The Post Office)
 *
 * Lists the letters in the CALLER's own mailbox and spells out exactly how to
 * read, answer, or discard each one. Takes no parameters — it only ever lists
 * the caller's own postbox. The Zod schema (an empty object) is the single
 * source of truth for the derived OpenAI-format `parameters`.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const listEmailToolInputSchema = z.object({});

export type ListEmailToolInput = z.infer<typeof listEmailToolInputSchema>;

export interface ListEmailToolOutput {
  success: boolean;
  /** Human-readable, in-voice listing for the calling LLM. */
  listing: string;
  count: number;
  error?: string;
}

export const listEmailToolDefinition = {
  type: 'function',
  function: {
    name: 'list_email',
    description:
      'List the letters waiting in your own mailbox, newest first, with the exact way to read, answer, or discard each. Takes no arguments — it always lists your postbox and no one else’s.',
    parameters: zodToOpenAISchema(listEmailToolInputSchema),
  },
};

export function validateListEmailInput(input: unknown): ListEmailToolInput | null {
  const parsed = listEmailToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
