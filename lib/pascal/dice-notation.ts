/**
 * Dice notation — the pure half of the dice module: the `NdS±M` grammar, its
 * parser and formatters, and the bounds they enforce.
 *
 * Deliberately free of `node:crypto` (and of imports altogether) so that
 * `custom-tool.types.ts` — which validates dice notation inside the Zod schema —
 * can travel into a client bundle. Pascal's Workbench validates a draft in the
 * browser with the very same code the roster loader runs on the server; this
 * split is what makes that possible. The roller half stays in `./dice`, which
 * re-exports everything here so existing import sites keep working.
 */

/** Smallest legal die. A one-sided die is not a die. */
export const MIN_DIE_SIDES = 2;
/** Largest legal die. Mirrors the `rng` tool's long-standing bound. */
export const MAX_DIE_SIDES = 1000;
/** Fewest dice in a roll. */
export const MIN_DICE_COUNT = 1;
/** Most dice in a roll. Mirrors the `rng` tool's long-standing bound. */
export const MAX_DICE_COUNT = 100;
/** Bound on the flat modifier, kept symmetric and well clear of precision trouble. */
export const MAX_DICE_MODIFIER = 1000;

/**
 * A parsed `NdS±M` roll specification.
 */
export interface DiceNotation {
  /** How many dice. `d20` implies 1. */
  count: number;
  /** Sides per die. */
  sides: number;
  /** Flat modifier applied to the total. 0 when the notation carried none. */
  modifier: number;
}

/**
 * The outcome of rolling a {@link DiceNotation}.
 */
export interface DiceRollResult extends DiceNotation {
  /** Each die's face, in roll order. */
  results: number[];
  /** Sum of the faces, before the modifier. */
  subtotal: number;
  /** `subtotal + modifier` — the number that counts. */
  total: number;
}

/**
 * Dice notation as it appears loose in prose: "d20", "2d6", "3d6+2", "2d10-1".
 *
 * Whitespace around the sign is deliberately NOT allowed. "2d6 - 1 apple"
 * should read as a 2d6 roll near an unrelated subtraction, not as 2d6-1; real
 * dice notation is written closed up. This keeps the scanner's false-positive
 * rate where it has always been while letting the closed-up form carry its
 * modifier through.
 *
 * Global flag — callers must reset `lastIndex` before use (see
 * {@link scanDiceNotation}, which owns that chore).
 */
const DICE_NOTATION_SCAN = /\b(\d+)?d(\d+)(?:([+-])(\d+))?\b/gi;

/** Anchored form for parsing a string that must be notation and nothing else. */
const DICE_NOTATION_STRICT = /^\s*(\d+)?d(\d+)(?:\s*([+-])\s*(\d+))?\s*$/i;

/**
 * True when `count`/`sides`/`modifier` are all within bounds.
 */
function withinBounds(count: number, sides: number, modifier: number): boolean {
  return (
    Number.isInteger(count) &&
    Number.isInteger(sides) &&
    Number.isInteger(modifier) &&
    count >= MIN_DICE_COUNT &&
    count <= MAX_DICE_COUNT &&
    sides >= MIN_DIE_SIDES &&
    sides <= MAX_DIE_SIDES &&
    Math.abs(modifier) <= MAX_DICE_MODIFIER
  );
}

/**
 * Build a {@link DiceNotation} from regex captures, or null when out of bounds.
 */
function fromCaptures(
  rawCount: string | undefined,
  rawSides: string,
  sign: string | undefined,
  rawModifier: string | undefined
): DiceNotation | null {
  const count = rawCount ? parseInt(rawCount, 10) : 1;
  const sides = parseInt(rawSides, 10);
  const magnitude = rawModifier ? parseInt(rawModifier, 10) : 0;
  const modifier = sign === '-' ? -magnitude : magnitude;

  if (!withinBounds(count, sides, modifier)) return null;
  return { count, sides, modifier };
}

/**
 * Parse a complete dice-notation string ("3d6+2"). Returns null when the string
 * is not notation, or when its numbers fall outside the supported bounds.
 *
 * Strict: the whole string must be the notation. Use {@link scanDiceNotation}
 * to find notation embedded in prose.
 */
export function parseDiceNotation(notation: string): DiceNotation | null {
  const match = DICE_NOTATION_STRICT.exec(notation);
  if (!match) return null;
  return fromCaptures(match[1], match[2], match[3], match[4]);
}

/** One hit from {@link scanDiceNotation}. */
export interface ScannedDiceNotation extends DiceNotation {
  /** The exact substring that matched, for echoing back to the user. */
  matchText: string;
}

/**
 * Find every dice notation embedded in a block of prose, in order.
 *
 * Out-of-bounds matches (d1, 500d6) are skipped rather than clamped — the same
 * behaviour the prose scanner has always had.
 */
export function scanDiceNotation(content: string): ScannedDiceNotation[] {
  const found: ScannedDiceNotation[] = [];

  // Module-level global regex: reset before each scan, or the previous call's
  // lastIndex silently eats the front of this one.
  DICE_NOTATION_SCAN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = DICE_NOTATION_SCAN.exec(content)) !== null) {
    const parsed = fromCaptures(match[1], match[2], match[3], match[4]);
    if (parsed) found.push({ ...parsed, matchText: match[0] });
  }

  return found;
}

/**
 * Render a notation back to its canonical string ("3d6+2").
 */
export function formatDiceNotation({ count, sides, modifier }: DiceNotation): string {
  const base = `${count}d${sides}`;
  if (modifier === 0) return base;
  return `${base}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`;
}

/**
 * Human-readable breakdown of a roll, e.g. `3d6+2: [4, 2, 6] + 2 = 14`.
 *
 * This is what `{{dice}}` renders to in a custom tool's outcome message.
 */
export function formatDiceBreakdown(result: DiceRollResult): string {
  const notation = formatDiceNotation(result);
  const faces = `[${result.results.join(', ')}]`;
  if (result.modifier === 0) {
    return `${notation}: ${faces} = ${result.total}`;
  }
  const sign = result.modifier > 0 ? '+' : '-';
  return `${notation}: ${faces} ${sign} ${Math.abs(result.modifier)} = ${result.total}`;
}
