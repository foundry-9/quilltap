/**
 * Dice — the single source of truth for random rolls and `NdS±M` notation.
 *
 * Pascal's table deals in two kinds of chance: the free-form numeric ranges of
 * a custom tool's `roll` object, and honest dice. Both land here, as does the
 * `rng` tool and the prose scanner that spots "2d6" in a message. One parser,
 * one roller, one source of randomness.
 *
 * Randomness is `crypto.randomBytes`-derived with rejection sampling, never
 * `Math.random` — a roll is a persisted, tamper-evident fact, so it is worth
 * the few extra bytes.
 *
 * The notation grammar lives in `./dice-notation`, which is pure (no `crypto`)
 * so the Zod schema that validates notation can enter a client bundle. This
 * module re-exports it in full, so importing dice things from here keeps
 * working everywhere on the server; only client modules need reach for
 * `./dice-notation` directly.
 */

import { randomBytes } from 'crypto';
import type { DiceNotation, DiceRollResult } from './dice-notation';

export * from './dice-notation';

/**
 * Generate a cryptographically secure random integer in range [1, max].
 * Uses rejection sampling to avoid modulo bias.
 */
export function secureRandomInt(max: number): number {
  if (max < 1) return 1;

  // Calculate how many bytes we need
  const bytesNeeded = Math.ceil(Math.log2(max + 1) / 8) || 1;
  const maxValue = 256 ** bytesNeeded;
  const limit = maxValue - (maxValue % max);

  let value: number;
  do {
    const bytes = randomBytes(bytesNeeded);
    value = bytes.reduce((acc, byte, i) => acc + byte * (256 ** i), 0);
  } while (value >= limit);

  return (value % max) + 1;
}

/**
 * Execute a dice roll.
 */
export function rollDice(sides: number, count: number): { results: number[]; sum: number } {
  const results: number[] = [];
  let sum = 0;

  for (let i = 0; i < count; i++) {
    const roll = secureRandomInt(sides);
    results.push(roll);
    sum += roll;
  }

  return { results, sum };
}

/**
 * Execute a coin flip, returning 'heads'/'tails' per flip.
 */
export function flipCoin(count: number): Array<'heads' | 'tails'> {
  const results: Array<'heads' | 'tails'> = [];

  for (let i = 0; i < count; i++) {
    const flip = secureRandomInt(2);
    results.push(flip === 1 ? 'heads' : 'tails');
  }

  return results;
}

/**
 * Roll a parsed notation, applying its modifier to the total.
 */
export function rollNotation(notation: DiceNotation): DiceRollResult {
  const { results, sum } = rollDice(notation.sides, notation.count);
  return {
    ...notation,
    results,
    subtotal: sum,
    total: sum + notation.modifier,
  };
}
