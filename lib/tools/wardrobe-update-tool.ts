/**
 * Update Wardrobe Item Tool Definition
 *
 * `wardrobe_update` edits the stored fields of an existing wardrobe item — its
 * title, description, Portrait Cue (`image_prompt`), appropriateness, coverage
 * slots, default-outfit membership, composite behaviour (`replace`), and
 * component list. Only the fields you supply are changed; everything else is
 * left as-is.
 *
 * It does NOT put the item on — use `wardrobe_wear` for that. Only the
 * character's OWN items can be edited: shared archetypes (project / Quilltap
 * General) are read-only and the call is refused.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { WardrobeReadToolOutput } from './wardrobe-read-tool'

/**
 * Zod schema for the wardrobe_update tool's input.
 */
export const wardrobeUpdateToolInputSchema = z
  .object({
    item_id: z
      .string()
      .describe('The wardrobe item ID to edit. Preferred lookup.')
      .optional(),
    item_title: z
      .string()
      .describe('Fallback lookup by title (case-insensitive) when item_id is unknown.')
      .optional(),
    title: z
      .string()
      .min(1)
      .describe('New name. Omit to leave unchanged.')
      .optional(),
    description: z
      .string()
      .describe('New description. Omit to leave unchanged.')
      .optional(),
    image_prompt: z
      .string()
      .describe(
        'New Portrait Cue — a short, literal, plain-text visual phrase fed to ' +
        'the image generator in place of the title. Terse, never Markdown. Omit ' +
        'to leave unchanged.'
      )
      .optional(),
    appropriateness: z
      .string()
      .describe('New context tags (e.g. "casual", "formal"). Omit to leave unchanged.')
      .optional(),
    types: z
      .array(z.enum(['top', 'bottom', 'footwear', 'accessories']))
      .nonempty()
      .describe('Replace the coverage slots. Omit to leave unchanged.')
      .optional(),
    is_default: z
      .boolean()
      .describe('Whether this item is part of the default outfit. Omit to leave unchanged.')
      .optional(),
    replace: z
      .boolean()
      .describe(
        'Composite behaviour on equip: false = additive (layer), true = ' +
        'clear-then-set. Omit to leave unchanged.'
      )
      .optional(),
    component_item_ids: z
      .array(z.string())
      .describe(
        'Replace the composite component list. An empty array makes the item a ' +
        'leaf. Omit to leave unchanged.'
      )
      .optional(),
  })
  .refine((o) => o.item_id !== undefined || o.item_title !== undefined, {
    message: 'item_id or item_title is required',
  })

/** Input parameters for wardrobe_update */
export type WardrobeUpdateToolInput = z.infer<typeof wardrobeUpdateToolInputSchema>

/** Output from wardrobe_update — a read-shaped echo of the updated item. */
export type WardrobeUpdateToolOutput = WardrobeReadToolOutput

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeUpdateToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_update',
    description:
      'Edit the stored fields of an existing wardrobe item: title, description, ' +
      'image_prompt (Portrait Cue), appropriateness, coverage types, default-' +
      'outfit membership, composite replace behaviour, and component list. Only ' +
      'the fields you supply change. This does NOT put the item on — use ' +
      'wardrobe_wear for that. Only your OWN items can be edited; shared ' +
      'archetypes (project / Quilltap General) are read-only.',
    parameters: zodToOpenAISchema(wardrobeUpdateToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeUpdateInput(
  input: unknown
): WardrobeUpdateToolInput | null {
  const parsed = wardrobeUpdateToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
