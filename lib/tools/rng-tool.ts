/**
 * RNG (Random Number Generator) Tool Definition
 *
 * Provides a tool interface for LLMs to generate random results:
 * - Dice rolls (any number of sides)
 * - Coin flips
 * - Spin the bottle (random participant selection)
 *
 * Results are permanent chat messages visible to all characters.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';
import {
  MIN_DIE_SIDES,
  MAX_DIE_SIDES,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  MAX_DICE_MODIFIER,
} from '@/lib/pascal/dice-notation';

/**
 * Type of random generation to perform
 * - number: dice roll with that many sides (e.g., 6 for d6, 20 for d20)
 * - 'flip_coin': coin flip returning heads or tails
 * - 'spin_the_bottle': random selection from chat participants
 */
export type RngType = number | 'flip_coin' | 'spin_the_bottle';

/**
 * Zod schema for the RNG tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const rngToolInputSchema = z.object({
  type: z
    .union([
      llmNumber(
        z
          .number()
          .int()
          .min(MIN_DIE_SIDES)
          .max(MAX_DIE_SIDES)
          .describe('Number of sides on the die (e.g., 6 for d6, 20 for d20)')
      ),
      z
        .enum(['flip_coin', 'spin_the_bottle'])
        .describe(
          'Special random type: flip_coin for heads/tails, spin_the_bottle to select a random participant'
        ),
    ])
    .describe(
      'Type of random generation. Use a number for dice (e.g., 6 for d6, 20 for d20), "flip_coin" for heads/tails, or "spin_the_bottle" to randomly select a chat participant.'
    ),
  rolls: llmNumber(
    z
      .number()
      .int()
      .min(MIN_DICE_COUNT)
      .max(MAX_DICE_COUNT)
      .describe(
        'Number of times to roll/flip (default: 1). For dice, this is like rolling multiple dice (e.g., 3 rolls of d6 = 3d6).'
      )
  )
    .default(1)
    .optional(),
  modifier: llmNumber(
    z
      .number()
      .int()
      .min(-MAX_DICE_MODIFIER)
      .max(MAX_DICE_MODIFIER)
      .describe(
        'Flat amount added to the dice total after rolling (default: 0). Use for notation like 3d6+2 (modifier 2) or 2d10-1 (modifier -1). Ignored for flip_coin and spin_the_bottle.'
      )
  )
    .default(0)
    .optional(),
});

/**
 * Input parameters for the RNG tool
 */
export type RngToolInput = z.infer<typeof rngToolInputSchema>;

/**
 * Single result from RNG execution
 * - number: for dice rolls
 * - 'heads' | 'tails': for coin flips
 * - string: participant name for spin the bottle
 */
export type RngResult = number | 'heads' | 'tails' | string;

/**
 * Output from the RNG tool
 */
export interface RngToolOutput {
  success: boolean;
  type: RngType;
  rollCount: number;
  results: RngResult[];
  /** Sum of all results (only for numeric dice rolls) */
  sum?: number;
  /** Flat modifier applied to `sum`; omitted/0 when the roll carried none. */
  modifier?: number;
  /** `sum + modifier` — the number that counts. Only for numeric dice rolls. */
  total?: number;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const rngToolDefinition = {
  type: 'function',
  function: {
    name: 'rng',
    description:
      'Generate random results for games and roleplay. Use for dice rolls, coin flips, or randomly selecting a participant. Results become permanent messages in the chat visible to all characters. Examples: roll a d20, flip a coin, spin the bottle to pick who goes next.',
    parameters: zodToOpenAISchema(rngToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateRngInput(input: unknown): RngToolInput | null {
  const parsed = rngToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
