/**
 * Take Off Wardrobe Items Tool Definition
 *
 * `wardrobe_take_off` REMOVES worn items or empties slots in a single call. It
 * accepts an ordered array of operations applied in sequence. It is the
 * counterpart to `wardrobe_wear` (which puts items on).
 *
 * Modes (per operation):
 *   - `remove` (default) — take a named item off across every slot it covers;
 *                          other layered items in those slots stay. Requires
 *                          item_id/item_title. Pass a `slot` to restrict the
 *                          removal to that one slot.
 *   - `clear_slot`       — empty one named slot entirely (requires `slot`).
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/** One take-off operation in a `wardrobe_take_off` call. */
const WardrobeTakeOffOperationSchema = z.object({
  item_id: z
    .string()
    .describe(
      'The worn item to take off. Required for mode=remove (with item_title as a ' +
      'fallback). For a composite outfit, this filters the outfit out of every ' +
      'slot it covers. Items from the character\'s own wardrobe, the project, ' +
      'and Quilltap General all resolve.'
    )
    .optional(),
  item_title: z
    .string()
    .describe('Fallback lookup by title (case-insensitive) when item_id is unknown.')
    .optional(),
  mode: z
    .enum(['remove', 'clear_slot'])
    .describe(
      '"remove" (default) — take the named item off across every slot it ' +
      'covers; other layers in those slots stay. Pass a slot to restrict the ' +
      'removal to that one slot. ' +
      '"clear_slot" — empty one named slot entirely (requires slot).'
    )
    .optional(),
  slot: z
    .enum(['top', 'bottom', 'footwear', 'accessories'])
    .describe(
      'Required for clear_slot. Optional for remove (restricts the removal to ' +
      'that single slot instead of every slot the item covers).'
    )
    .optional(),
})

/**
 * Zod schema for the wardrobe_take_off tool's input.
 *
 * Cross-field rules live in a top-level `.superRefine()` (kept off the array
 * elements) so the JSON-Schema derivation stays clean.
 */
export const wardrobeTakeOffToolInputSchema = z
  .object({
    operations: z
      .array(WardrobeTakeOffOperationSchema)
      .min(1)
      .describe(
        'An ordered list of take-off changes applied in sequence. Apply ' +
        'multiple removals in one call rather than calling the tool repeatedly.'
      ),
  })
  .superRefine((val, ctx) => {
    val.operations.forEach((op, i) => {
      const mode = op.mode ?? 'remove'
      if (mode === 'clear_slot' && !op.slot) {
        ctx.addIssue({ code: 'custom', message: 'clear_slot requires a slot', path: ['operations', i, 'slot'] })
      }
      if (mode === 'remove' && !op.item_id && !op.item_title) {
        ctx.addIssue({ code: 'custom', message: 'remove requires item_id or item_title', path: ['operations', i] })
      }
    })
  })

/** Input parameters for wardrobe_take_off */
export type WardrobeTakeOffToolInput = z.infer<typeof wardrobeTakeOffToolInputSchema>

/** Result of a single take-off operation. */
export interface WardrobeTakeOffOpResult {
  mode: 'remove' | 'clear_slot';
  /** `removed` (a named item taken off, other layers kept) or `cleared` (slot emptied). */
  effect: 'removed' | 'cleared';
  /** One-sentence, plain-language description of `effect` for the model. */
  effect_summary: string;
  /** The item taken off, when a specific one was named. */
  item: { item_id: string; title: string } | null;
  /** Slots this operation touched. */
  slots_affected: string[];
  /** Per-op error when this operation failed (the call fails fast at the first error). */
  error?: string;
}

/** Output from wardrobe_take_off */
export interface WardrobeTakeOffToolOutput {
  success: boolean;
  /** Per-operation results, in input order (truncated at the first failure). */
  operations: WardrobeTakeOffOpResult[];
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
export const wardrobeTakeOffToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_take_off',
    description:
      'Take off one or more worn wardrobe items, or empty slots, in a single ' +
      'call. Pass an ordered `operations` array. Per operation: mode=remove ' +
      '(default) takes a named item off across every slot it covers (other ' +
      'layers stay; pass a slot to restrict to one); mode=clear_slot empties a ' +
      'named slot entirely. To put items on, use wardrobe_wear.',
    parameters: zodToOpenAISchema(wardrobeTakeOffToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeTakeOffInput(
  input: unknown
): WardrobeTakeOffToolInput | null {
  const parsed = wardrobeTakeOffToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
