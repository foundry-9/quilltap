/**
 * Archive Wardrobe Item Tool Definition
 *
 * `wardrobe_archive` retires a wardrobe item: it is hidden from listings and can
 * no longer be worn, but it is NOT destroyed — a human can restore it from the
 * Aurora UI later. (There is intentionally no permanent-delete from the model's
 * side.)
 *
 * Only the character's OWN items can be archived: shared archetypes (project /
 * Quilltap General) are read-only and the call is refused.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe_archive tool's input.
 */
export const wardrobeArchiveToolInputSchema = z
  .object({
    item_id: z
      .string()
      .describe('The wardrobe item ID to archive. Preferred lookup.')
      .optional(),
    item_title: z
      .string()
      .describe('Fallback lookup by title (case-insensitive) when item_id is unknown.')
      .optional(),
  })
  .refine((o) => o.item_id !== undefined || o.item_title !== undefined, {
    message: 'item_id or item_title is required',
  })

/** Input parameters for wardrobe_archive */
export type WardrobeArchiveToolInput = z.infer<typeof wardrobeArchiveToolInputSchema>

/** Output from wardrobe_archive */
export interface WardrobeArchiveToolOutput {
  success: boolean;
  item_id: string;
  title: string;
  /** Always 'archived' on success (soft retire; restorable by a human). */
  action: 'archived';
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeArchiveToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_archive',
    description:
      'Retire a wardrobe item: it is hidden from listings and can no longer be ' +
      'worn, but it is NOT permanently deleted — a human can restore it from the ' +
      'Aurora UI later. Use this to tidy a wardrobe or drop an item that is no ' +
      'longer wanted. Only your OWN items can be archived; shared archetypes ' +
      '(project / Quilltap General) are read-only.',
    parameters: zodToOpenAISchema(wardrobeArchiveToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeArchiveInput(
  input: unknown
): WardrobeArchiveToolInput | null {
  const parsed = wardrobeArchiveToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
