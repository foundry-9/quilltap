/**
 * Read Wardrobe Item Tool Definition
 *
 * `wardrobe_read` returns the full detail of ONE wardrobe item by id (preferred)
 * or title. Unlike `wardrobe_list` (which returns lean summaries), this surfaces
 * everything: the Portrait Cue (`image_prompt`), default-outfit membership,
 * composite/replace behaviour, the full component list, archived status, and the
 * slots it's currently equipped in. Items resolve from the character's own
 * wardrobe, the project, and Quilltap General.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe_read tool's input.
 */
export const wardrobeReadToolInputSchema = z
  .object({
    item_id: z
      .string()
      .describe('The wardrobe item ID to read. Preferred lookup.')
      .optional(),
    item_title: z
      .string()
      .describe('Fallback lookup by title (case-insensitive) when item_id is unknown.')
      .optional(),
  })
  .refine((o) => o.item_id !== undefined || o.item_title !== undefined, {
    message: 'item_id or item_title is required',
  })

/** Input parameters for wardrobe_read */
export type WardrobeReadToolInput = z.infer<typeof wardrobeReadToolInputSchema>

/** Output from wardrobe_read */
export interface WardrobeReadToolOutput {
  success: boolean;
  item_id: string;
  title: string;
  description: string | null;
  /** Portrait Cue — the visual phrase steering image generation (null = falls back to title). */
  image_prompt: string | null;
  types: string[];
  appropriateness: string | null;
  /** Whether this item is part of the character's default outfit. */
  is_default: boolean;
  /** Composite behaviour on equip: false = additive (layer), true = clear-then-set. */
  replace: boolean;
  /** True when this item bundles other items. */
  is_composite: boolean;
  /** Component item IDs (empty for leaf items). */
  component_item_ids: string[];
  /** Resolved component titles (best-effort; missing components are dropped). */
  component_titles: string[];
  /** True when the item has been archived (hidden from listings, cannot be worn). */
  archived: boolean;
  /** Whether the item belongs to THIS character (true) or is a shared archetype (false). */
  is_own: boolean;
  /** True when the item is currently equipped in any slot. */
  is_equipped: boolean;
  /** Every slot the item currently occupies. */
  equipped_slots: string[];
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeReadToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_read',
    description:
      'Read the full detail of ONE wardrobe item by id (preferred) or title. ' +
      'Returns everything wardrobe_list omits: the Portrait Cue (image_prompt), ' +
      'default-outfit membership, composite/replace behaviour, the full ' +
      'component list, archived status, whether you own it, and the slots it is ' +
      'currently equipped in. Items from your own wardrobe, the project, and ' +
      'Quilltap General all resolve.',
    parameters: zodToOpenAISchema(wardrobeReadToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeReadInput(
  input: unknown
): WardrobeReadToolInput | null {
  const parsed = wardrobeReadToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
