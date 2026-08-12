/**
 * Create Wardrobe Item Tool Definition
 *
 * `wardrobe_create` makes a new wardrobe item — either a leaf item (a single
 * garment) or a composite item (a bundle of other wardrobe items, like a "Rain
 * Outfit" containing a coat, jeans, and boots) — and optionally equips it.
 *
 * For leaf items: provide `title` and `types` (the slots the item covers).
 * For composite items: provide `title` plus EITHER `component_item_ids` or
 * `component_titles` (or both) — the slots it covers are computed from the
 * union of its components' slots, and the LLM-supplied `types` is ignored
 * if it disagrees. Cycles are rejected by the repository at save time.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Zod schema for the wardrobe create tool's input.
 */
export const wardrobeCreateToolInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .refine((val) => val.trim().length > 0, { message: 'title cannot be empty or whitespace-only' })
      .describe('The name of the wardrobe item.'),
    description: z
      .string()
      .describe('A detailed description of the wardrobe item.')
      .optional(),
    image_prompt: z
      .string()
      .describe(
        'Optional Portrait Cue — a short, literal, plain-text visual phrase fed ' +
        'to the image generator IN PLACE OF the title (e.g. "intricate dense ' +
        'burnished-gold circular rank glyph on the shoulder"). Terse, never ' +
        'Markdown; it is joined into a comma-separated outfit list. Omit to fall ' +
        'back to the title.'
      )
      .optional(),
    types: z
      .array(z.enum(['top', 'bottom', 'footwear', 'accessories']))
      .nonempty()
      .describe(
        'Coverage tags indicating what body area(s) this item covers. ' +
        'Required for leaf items (no components). For composite items the ' +
        'coverage is at least the union of the components\' slots; any slots ' +
        'you list here are ADDED to that union, letting a composite designate ' +
        'slots none of its components fill (e.g. a "Naked" composite that ' +
        'designates every slot but only contains a ring — combined with ' +
        'replace:true this clears the other slots).'
      )
      .optional(),
    appropriateness: z
      .string()
      .describe(
        'Context tags describing when this item is appropriate, such as "casual", "formal", "athletic", etc.'
      )
      .optional(),
    equip_now: z
      .boolean()
      .default(false)
      .describe(
        'If true, wear the item immediately after creation. Defaults to false. ' +
        "Wearing honors the new item's replace flag: off (the default) layers it " +
        'over what is already worn, on replaces those slots. For composites this ' +
        'places the composite (as a single id) into every slot it covers. The ' +
        'response reports the resulting effect (layered vs replaced).'
      )
      .optional(),
    recipient: z
      .string()
      .refine((val) => val.trim().length > 0, { message: 'recipient cannot be empty or whitespace-only' })
      .describe(
        'Name of a character in this chat to give the item to. ' +
        'If omitted, the item is added to your own wardrobe.'
      )
      .optional(),
    component_item_ids: z
      .array(z.string().refine((s) => s.trim().length > 0, { message: 'component_item_ids entries must be non-empty' }))
      .describe(
        'IDs of existing wardrobe items that this new item bundles. ' +
        'Supplying this makes the new item a composite. The slots it covers ' +
        'are computed from the union of the components\' slots. Components may ' +
        'come from the character\'s own wardrobe, the project, or Quilltap General.'
      )
      .optional(),
    component_titles: z
      .array(z.string().refine((s) => s.trim().length > 0, { message: 'component_titles entries must be non-empty' }))
      .describe(
        'Titles of existing wardrobe items that this new item bundles, used ' +
        'as a fallback when component_item_ids are not known. Resolved against ' +
        'the calling character\'s wardrobe (case-insensitive).'
      )
      .optional(),
    replace: z
      .boolean()
      .describe(
        'Composite items only. If false/omitted (the default), equipping this ' +
        'composite is additive — its components layer onto whatever already ' +
        'occupies the slots it designates. If true, equipping it first clears ' +
        'every slot it designates, then places only its own components ' +
        '(full-outfit swaps and "clear everything" composites).'
      )
      .optional(),
  })
  .refine(
    (obj) => {
      const hasComponents =
        (Array.isArray(obj.component_item_ids) && obj.component_item_ids.length > 0) ||
        (Array.isArray(obj.component_titles) && obj.component_titles.length > 0)
      return obj.types !== undefined || hasComponents
    },
    { message: 'either types (for leaf items) or components (for composites) must be supplied' }
  )

/**
 * Input parameters for the create wardrobe item tool
 */
export type WardrobeCreateToolInput = z.infer<typeof wardrobeCreateToolInputSchema>

/**
 * Output from the create wardrobe item tool
 */
export interface WardrobeCreateToolOutput {
  success: boolean;
  item_id: string;
  title: string;
  equipped: boolean;
  /**
   * When `equipped`, what wearing the item did: `layered` (added on top, others
   * kept) or `replaced` (slots cleared and set to this item) — per its `replace`
   * flag.
   */
  effect?: 'layered' | 'replaced';
  /** One-sentence, plain-language description of `effect` for the model. */
  effect_summary?: string;
  /** True if the created item is a composite (has components). */
  is_composite?: boolean;
  /** The item types resolved by the handler — for composites, the computed union. */
  resolved_types?: string[];
  /** Component item IDs the handler actually persisted (post-resolution, deduped). */
  resolved_component_item_ids?: string[];
  /** Name of the character who received the item (when gifted to another) */
  recipient_name?: string;
  /**
   * Equipped slots after the create-and-equip. Each slot holds an array of
   * wardrobe item IDs (multi-item slots support layering).
   */
  current_state?: {
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
  };
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeCreateToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_create',
    description:
      'Create a new wardrobe item and optionally equip it immediately. ' +
      'Use this for two cases: (1) a single garment — supply title and types ' +
      '(e.g. ["top"] for a shirt, ["top","bottom"] for a dress); or (2) a composite ' +
      'outfit that bundles other wardrobe items — supply title and component_item_ids ' +
      '(or component_titles) referring to existing items in the character\'s wardrobe. ' +
      'For composites, the slots covered are computed from the union of the components\' ' +
      'slots, so you do not need to supply types yourself. Optionally set image_prompt ' +
      '(a Portrait Cue) to steer image generation. ' +
      'You can give the item to another character in the chat by specifying a recipient.',
    parameters: zodToOpenAISchema(wardrobeCreateToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeCreateInput(
  input: unknown
): WardrobeCreateToolInput | null {
  const parsed = wardrobeCreateToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** Re-export the slot type for the union-of-types computation in the handler. */
export type CreateWardrobeItemSlotType = WardrobeItemType;
