/**
 * List Wardrobe Tool Definition
 *
 * Provides a tool interface for LLMs to browse a character's wardrobe items.
 * Supports filtering by type and appropriateness, and shows equipped status.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe list tool's input.
 */
export const wardrobeListToolInputSchema = z.object({
  type_filter: z
    .array(z.string())
    .describe(
      'Filter items by slot type. Possible values include "top", "bottom", "footwear", "accessories". ' +
      'Only items matching at least one of the specified types will be returned.'
    )
    .optional(),
  appropriateness_filter: z
    .string()
    .describe(
      'Filter items by appropriateness context, such as "casual", "formal", "athletic", etc. ' +
      'Only items matching the specified context will be returned.'
    )
    .optional(),
  include_equipped: z
    .boolean()
    .describe(
      'Whether to include currently equipped items in the results. Defaults to true.'
    )
    .optional(),
  include_presets: z
    .boolean()
    .describe(
      'Whether to include saved outfit presets in the response. Defaults to true.'
    )
    .optional(),
})

/**
 * Input parameters for the wardrobe_list tool
 */
export type WardrobeListToolInput = z.infer<typeof wardrobeListToolInputSchema>

/**
 * A single wardrobe item in the result list
 */
export interface WardrobeListItemResult {
  item_id: string;
  title: string;
  description: string | null;
  /** Portrait Cue — the visual phrase steering image generation (null = falls back to title). */
  image_prompt: string | null;
  types: string[];
  appropriateness: string | null;
  /** Whether the item belongs to THIS character (true) or is a shared archetype (false). */
  is_own: boolean;
  is_equipped: boolean;
  /**
   * Which slot the item is currently equipped in (the first if multi-slot
   * coverage). With arrays-per-slot this is the simplest single-value
   * back-compat field; consumers that need the full set should consult
   * `equippedOutfit` directly.
   */
  equipped_slot: string | null;
  /** True when this item is a composite (has `componentItemIds`). */
  is_composite?: boolean;
  /** Component item IDs (only populated for composites). */
  component_item_ids?: string[];
  /** Resolved component titles (best-effort; missing components are dropped). */
  component_titles?: string[];
}

/**
 * A preset summary in the result list
 */
export interface WardrobeListPresetResult {
  preset_id: string;
  name: string;
  description: string | null;
  slots: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
}

/**
 * Output from the wardrobe_list tool
 */
export interface WardrobeListToolOutput {
  success: boolean;
  items: WardrobeListItemResult[];
  total_count: number;
  /** Outfit presets available for this character */
  presets?: WardrobeListPresetResult[];
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeListToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_list',
    description:
      'Retrieve wardrobe items available to the current character — from their ' +
      'own wardrobe plus shared items in the project and Quilltap General. ' +
      'Supports optional filtering by item type and appropriateness context. ' +
      'Each item includes its equipped status (which slot[s] it occupies, if any), ' +
      'a composite flag indicating whether it bundles other items, and an is_own ' +
      'flag (shared archetypes can be worn but not edited). ' +
      'Use wardrobe_wear to put on / layer items, wardrobe_take_off to remove them, ' +
      'and wardrobe_read for the full detail (including the Portrait Cue) of one item. ' +
      'Archived items are excluded from results.',
    parameters: zodToOpenAISchema(wardrobeListToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeListInput(input: unknown): WardrobeListToolInput | null {
  const parsed = wardrobeListToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
