/**
 * Smart typography — Tier A: the rule engine.
 *
 * Layer 1.6, Part B. Decides what happens when a writer types `-` or `.`:
 * `--` becomes an en dash, `---` an em dash, `...` an ellipsis. Unlike the
 * render-time quote curling of Part A, these substitutions write real
 * characters into the text, because a writer typing `--` unambiguously means a
 * dash — the hyphen is a keyboard workaround for a character with no key, and
 * the dash is genuinely part of what was written.
 *
 * **This file imports nothing.** Not React, not Lexical, not a repo path alias
 * — nothing outside the standard library, which an ESLint `no-restricted-imports`
 * override on `lib/smart-typography/**` enforces. It is copied near-verbatim
 * into quilltap-v5, where the surrounding editor is ProseMirror rather than
 * Lexical and nothing else transfers. Every decision the feature makes lives
 * here; if the Lexical adapter grows an `if` about dashes, that `if` is in the
 * wrong file.
 *
 * The companion fixture corpus (`fixtures/typography-vectors.json`) is the
 * contract between the two apps: v5 copies it byte-for-byte and asserts
 * identical outputs. If a port disagrees with the corpus, fix the port.
 *
 * @module lib/smart-typography/engine
 */

/** U+2013 EN DASH. */
export const EN_DASH = '–';
/** U+2014 EM DASH. */
export const EM_DASH = '—';
/** U+2026 HORIZONTAL ELLIPSIS. */
export const ELLIPSIS = '…';

export interface SmartTypographyOptions {
  /** `--` → en dash, `--` + `-` → em dash. */
  dashes: boolean;
  /** `...` → ellipsis. */
  ellipsis: boolean;
  /**
   * Single characters the active roleplay template claims as delimiters; never
   * substituted. Vanishingly rare for `-` and `.`, but the parameter costs
   * nothing and keeps the engine honest against a template that does something
   * surprising.
   */
  reservedChars?: readonly string[];
}

export interface TypographyInput {
  /**
   * The two characters immediately preceding the insertion point. Fewer than
   * two (start of block, or a short text node) is legal and handled; more than
   * two is also legal — only the last two are consulted, so an adapter may
   * over-supply without caring.
   */
  before: string;
  /** The single character the user just typed. */
  typed: string;
  options: SmartTypographyOptions;
}

export interface TypographyResult {
  /** Characters immediately before the caret to delete. Always 1 or 2. */
  deleteBefore: number;
  /** What to insert in place of the deleted run plus the typed character. */
  insert: string;
  rule: 'en-dash' | 'em-dash' | 'ellipsis';
}

/**
 * Decide whether the keystroke `typed`, landing after `before`, triggers a
 * substitution.
 *
 * Pure. Deterministic. No I/O, no clock, no randomness, no locale-sensitive
 * operations (no `Intl`, no `toLocaleUpperCase`) — the corpus pins all of that.
 * Returns `null` when nothing applies, which is the overwhelmingly common case
 * and must stay cheap: this runs on every keystroke.
 *
 * ### The dash ladder
 *
 * Three hyphens produce, in sequence: `-`, then {@link EN_DASH} (the second
 * consumes the first), then {@link EM_DASH} (the third consumes the en dash).
 * A fourth yields `—-`, which is harmless and doubles as an escape hatch for a
 * writer who wants literal hyphens. This is strictly better than matching `--`
 * or `---` by lookahead, which cannot be evaluated at a keystroke without
 * buffering the writer's input and guessing when they have stopped.
 *
 * First match wins; the table is small enough that the order is the whole
 * specification.
 */
export function smartTypographyStep(input: TypographyInput): TypographyResult | null {
  const { before, typed, options } = input;

  // A reserved delimiter is never rewritten, whatever the flags say.
  if (options.reservedChars && options.reservedChars.indexOf(typed) !== -1) {
    return null;
  }

  if (typed === '-') {
    if (!options.dashes) return null;

    // Only the single character before the caret matters for the dash ladder.
    const prev = before.length > 0 ? before[before.length - 1] : '';

    if (prev === '-') {
      return { deleteBefore: 1, insert: EN_DASH, rule: 'en-dash' };
    }
    if (prev === EN_DASH) {
      return { deleteBefore: 1, insert: EM_DASH, rule: 'em-dash' };
    }
    return null;
  }

  if (typed === '.') {
    if (!options.ellipsis) return null;

    // Needs two real dots behind the caret. Fewer (start of block, or a single
    // dot) is not an ellipsis, and an existing U+2026 followed by `.` is a
    // writer deliberately adding a fourth dot — leave it be.
    if (before.length < 2) return null;
    if (before[before.length - 1] !== '.' || before[before.length - 2] !== '.') {
      return null;
    }
    return { deleteBefore: 2, insert: ELLIPSIS, rule: 'ellipsis' };
  }

  return null;
}
