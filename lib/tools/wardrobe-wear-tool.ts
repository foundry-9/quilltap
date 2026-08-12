/**
 * Wear Wardrobe Items Tool Definition
 *
 * `wardrobe_wear` PUTS ON one or more wardrobe items in a single call. It
 * accepts an ordered array of operations applied in sequence — each builds on
 * the result of the previous one (e.g. force-swap the top, then layer a
 * cardigan over it). It works identically for single garments and composite
 * outfits — the item's own `replace` flag decides layer-vs-swap.
 *
 * Modes (per operation):
 *   - `wear` (default) — put the item on across every slot it covers, honoring
 *                        its `replace` flag (off layers over what's worn; on
 *                        replaces those slots).
 *   - `replace`        — force a swap: clear every slot the item covers, then
 *                        put it on (ignores the flag).
 *   - `add_to_slot`    — layer the item into one named slot (requires `slot`).
 *
 * To TAKE items off or empty a slot, use `wardrobe_take_off` instead.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/** One put-on operation in a `wardrobe_wear` call. */
const WardrobeWearOperationSchema = z.object({
  item_id: z
    .string()
    .describe(
      'The wardrobe item to put on. Required for every mode (with item_title as ' +
      'a fallback). May be a single garment OR a composite outfit — both are ' +
      'handled the same way. Items from the character\'s own wardrobe, the ' +
      'project, and Quilltap General all resolve.'
    )
    .optional(),
  item_title: z
    .string()
    .describe('Fallback lookup by title (case-insensitive) when item_id is unknown.')
    .optional(),
  mode: z
    .enum(['wear', 'replace', 'add_to_slot'])
    .describe(
      '"wear" (default) — put the item on across every slot it covers, honoring ' +
      'its replace flag (off layers over what is worn; on replaces those slots). ' +
      '"replace" — force a swap: clear every slot it covers, then put it on. ' +
      '"add_to_slot" — layer the item into one named slot (requires slot).'
    )
    .optional(),
  slot: z
    .enum(['top', 'bottom', 'footwear', 'accessories'])
    .describe('Target slot. Required for add_to_slot; ignored by wear/replace.')
    .optional(),
})

/**
 * Zod schema for the wardrobe_wear tool's input.
 *
 * Cross-field rules live in a top-level `.superRefine()` (kept off the array
 * elements) so the JSON-Schema derivation stays clean while runtime
 * validation still enforces them.
 */
export const wardrobeWearToolInputSchema = z
  .object({
    operations: z
      .array(WardrobeWearOperationSchema)
      .min(1)
      .describe(
        'An ordered list of put-on changes applied in sequence. Each operation ' +
        'builds on the result of the previous one (e.g. force-swap the top, then ' +
        'layer a cardigan over it). Apply multiple changes in one call rather ' +
        'than calling the tool repeatedly.'
      ),
  })
  .superRefine((val, ctx) => {
    val.operations.forEach((op, i) => {
      const mode = op.mode ?? 'wear'
      if (mode === 'add_to_slot' && !op.slot) {
        ctx.addIssue({ code: 'custom', message: 'add_to_slot requires a slot', path: ['operations', i, 'slot'] })
      }
      if (!op.item_id && !op.item_title) {
        ctx.addIssue({ code: 'custom', message: 'each operation requires item_id or item_title', path: ['operations', i] })
      }
    })
  })

/** Input parameters for wardrobe_wear */
export type WardrobeWearToolInput = z.infer<typeof wardrobeWearToolInputSchema>

/** Result of a single put-on operation. */
export interface WardrobeWearOpResult {
  mode: 'wear' | 'replace' | 'add_to_slot';
  /** `layered` (added on top, others kept) or `replaced` (slots cleared and set to this item). */
  effect: 'layered' | 'replaced';
  /** One-sentence, plain-language description of `effect` for the model. */
  effect_summary: string;
  /** The item acted on. */
  item: { item_id: string; title: string } | null;
  /** Slots this operation touched. */
  slots_affected: string[];
  /** Per-op error when this operation failed (the call fails fast at the first error). */
  error?: string;
}

/** Output from wardrobe_wear */
export interface WardrobeWearToolOutput {
  success: boolean;
  /** Per-operation results, in input order (truncated at the first failure). */
  operations: WardrobeWearOpResult[];
  /** Per-slot arrays of equipped item IDs after all applied operations. */
  current_state: {
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
  };
  coverage_summary: string;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeWearToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_wear',
    description:
      'Put on one or more wardrobe items (single garments and/or composite ' +
      'outfits) in a single call. Pass an ordered `operations` array; each is ' +
      'applied in sequence so you can, e.g., force-swap the top then layer a ' +
      'cardigan over it. Per operation: mode=wear (default) puts it on honoring ' +
      "the item's replace flag (layer vs swap); mode=replace forces a swap " +
      '(clear the slots it covers, then put it on); mode=add_to_slot layers it ' +
      'into one named slot. Items resolve from the character\'s own wardrobe, ' +
      'the project, and Quilltap General. To take items off, use ' +
      'wardrobe_take_off.',
    parameters: zodToOpenAISchema(wardrobeWearToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeWearInput(
  input: unknown
): WardrobeWearToolInput | null {
  const parsed = wardrobeWearToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
