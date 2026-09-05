/**
 * Match Normalization — diacritics and typographic spelling
 *
 * Provides Unicode normalization for text matching operations.
 * Allows base characters to match their accented variants,
 * essential for fiction vaults with character names containing
 * diacritical marks (e.g., "Nimue" matches "Nimuë"), and — behind an
 * opt-in flag — lets a straight quote match the curly one a model wrote
 * into the file (see {@link module:lib/doc-edit/typographic-folding}).
 *
 * Both are the same kind of concession and share one mechanism: a
 * **per-character** rewrite, plus a map from positions in the rewritten string
 * back to positions in the original, so a match found in normalized space can
 * be applied to the original bytes. Every normalization here must therefore be
 * expressible one source character at a time; a rule that needed to see two
 * characters at once could not be mapped back and does not belong in this file.
 *
 * @module doc-edit/diacritics
 */

import { createServiceLogger } from '@/lib/logging/create-logger';

import { foldTypographicChar } from './typographic-folding';

const logger = createServiceLogger('DocEdit:Diacritics');

/**
 * Combining marks stripped after NFD decomposition.
 *
 * Ranges: \u0300-\u036f (Combining Diacritical Marks)
 *         \u1AB0-\u1AFF (Combining Diacritical Marks Extended)
 *         \u1DC0-\u1DFF (Combining Diacritical Marks Supplement)
 *         \u20D0-\u20FF (Combining Diacritical Marks for Symbols)
 *         \uFE20-\uFE2F (Combining Half Marks)
 */
const COMBINING_MARKS = /[\u0300-\u036f\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

/**
 * Strip combining marks from NFD-decomposed text.
 * "Nimuë" → NFD → "Nimue\u0308" → strip → "Nimue"
 */
export function normalizeDiacritics(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * Options for normalization-aware text matching
 */
export interface DiacriticsMatchOptions {
  /** Whether to normalize diacritics for matching (default: true) */
  normalizeDiacritics?: boolean;
  /** Whether the match is case-sensitive (default: true) */
  caseSensitive?: boolean;
  /**
   * Whether to treat a curly quote, a dash-family character, `…` or a
   * non-breaking space as equal to its ASCII spelling (default: **false**).
   *
   * Off by default so every existing caller keeps byte-exact semantics. Note
   * that {@link findAllMatches} and {@link findUniqueMatch} read this flag
   * differently, and deliberately: `findAllMatches` folds and reports whatever
   * that finds, while `findUniqueMatch` — which owes its caller a *unique*
   * answer — tries the exact reading first and only folds when the exact one
   * found nothing at all.
   */
  foldTypography?: boolean;
}

/** The per-character rewrites in force for one match. */
interface NormalizationFlags {
  diacritics: boolean;
  typography: boolean;
}

/**
 * Rewrite one source character.
 *
 * The typographic fold runs *before* the diacritics strip because it is
 * defined over composed characters (`’`, `—`, `…`), and its output is plain
 * ASCII that NFD leaves alone. May return more than one character (`…` →
 * `...`) or, in principle, none — both are handled by the position map.
 */
function normalizeChar(char: string, flags: NormalizationFlags): string {
  let out = char;
  if (flags.typography) out = foldTypographicChar(out);
  if (flags.diacritics) out = out.normalize('NFD').replace(COMBINING_MARKS, '');
  return out;
}

/**
 * Rewrite a whole string, character by character.
 *
 * Built from {@link normalizeChar} rather than from whole-string operations so
 * that it cannot drift from {@link buildNormalizationMap}: the string being
 * searched and the map used to translate the hit back must be produced by the
 * same rule, or an index found in one is meaningless in the other.
 */
function normalizeForMatching(text: string, flags: NormalizationFlags): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += normalizeChar(text[i], flags);
  }
  return out;
}

/**
 * Build a mapping from normalized string positions back to original string positions.
 * Used to convert match positions in the normalized string to positions in the original.
 *
 * @param original The original string
 * @param flags Which per-character rewrites are in force
 * @returns Array where index[i] = position in original string of character at position i in normalized
 */
function buildNormalizationMap(original: string, flags: NormalizationFlags): number[] {
  const map: number[] = [];

  let normalizedPos = 0;
  for (let originalPos = 0; originalPos < original.length; originalPos++) {
    const rewritten = normalizeChar(original[originalPos], flags);

    // Map each resulting normalized character back to this original position
    for (let i = 0; i < rewritten.length; i++) {
      map[normalizedPos] = originalPos;
      normalizedPos++;
    }
  }

  return map;
}

/**
 * Find ALL occurrences of needle in haystack with optional normalization.
 * Returns array of { index, length } for each match in the ORIGINAL haystack.
 *
 * The tricky part: when normalization is on, the indices in the normalized
 * string don't correspond 1:1 to the original string. We build a
 * character-level mapping from normalized positions back to original positions.
 */
export function findAllMatches(
  haystack: string,
  needle: string,
  options: DiacriticsMatchOptions = {}
): Array<{ index: number; length: number }> {
  const {
    normalizeDiacritics: shouldNormalize = true,
    caseSensitive = true,
    foldTypography: shouldFold = false,
  } = options;

  if (!needle) {
    return [];
  }

  // Handle simple case: no rewriting needed
  if (!shouldNormalize && !shouldFold && caseSensitive) {
    const matches: Array<{ index: number; length: number }> = [];
    let searchIndex = 0;
    while ((searchIndex = haystack.indexOf(needle, searchIndex)) !== -1) {
      matches.push({ index: searchIndex, length: needle.length });
      searchIndex += 1;
    }
    return matches;
  }

  const flags: NormalizationFlags = { diacritics: shouldNormalize, typography: shouldFold };
  const rewriting = shouldNormalize || shouldFold;

  // Build normalized versions
  let normalizedHaystack = haystack;
  let normalizedNeedle = needle;
  let haystackMap: number[] | null = null;

  if (rewriting) {
    normalizedHaystack = normalizeForMatching(haystack, flags);
    normalizedNeedle = normalizeForMatching(needle, flags);
    haystackMap = buildNormalizationMap(haystack, flags);
  }

  if (!caseSensitive) {
    normalizedHaystack = normalizedHaystack.toLowerCase();
    normalizedNeedle = normalizedNeedle.toLowerCase();
  }

  const matches: Array<{ index: number; length: number }> = [];

  if (!normalizedNeedle) {
    return matches;
  }

  // Find all matches in the normalized string
  let searchIndex = 0;
  while ((searchIndex = normalizedHaystack.indexOf(normalizedNeedle, searchIndex)) !== -1) {
    let originalIndex: number;
    let originalLength: number;

    if (haystackMap) {
      // Map normalized positions back to original string
      originalIndex = haystackMap[searchIndex];

      // Find the original length by mapping the end position
      // The match extends from searchIndex to searchIndex + normalizedNeedle.length - 1
      const normalizedEndPos = searchIndex + normalizedNeedle.length - 1;
      const originalEndPos = haystackMap[normalizedEndPos];

      // Original length is from start to end, inclusive
      originalLength = originalEndPos - originalIndex + 1;
    } else {
      originalIndex = searchIndex;
      originalLength = normalizedNeedle.length;
    }

    matches.push({ index: originalIndex, length: originalLength });
    searchIndex += 1;
  }
  return matches;
}

/**
 * Which reading of the text produced the answer.
 *
 * `exact` means the needle was found as written (modulo the diacritics and case
 * options the caller had already asked for); `typographic` means it was found
 * only once curly quotes, dashes, `…` and non-breaking spaces were folded onto
 * their ASCII spellings.
 */
export type MatchTier = 'exact' | 'typographic';

export type UniqueMatchResult =
  | { found: true; index: number; length: number; tier: MatchTier }
  | { found: false; count: number; tier: MatchTier };

/**
 * Find a UNIQUE match of needle in haystack.
 * Returns the match if exactly one exists, or an error descriptor.
 * This is the core matching function for str_replace's uniqueness constraint.
 *
 * With `foldTypography` on, this runs **exact first and folded only on a total
 * miss**. The order is the whole design: a file holding both `Veyra-5's` and
 * `Veyra-5’s` has one exact answer and two folded ones, and the caller asked
 * for the text it typed — so folding unconditionally would turn a good edit
 * into an ambiguity error. Folding is a rescue, not a policy.
 *
 * On failure, `tier` says which reading produced `count`, so a caller can tell
 * "three exact matches, be more specific" from "nothing matched even when the
 * punctuation was ignored".
 */
export function findUniqueMatch(
  haystack: string,
  needle: string,
  options: DiacriticsMatchOptions = {}
): UniqueMatchResult {
  const exact = findAllMatches(haystack, needle, { ...options, foldTypography: false });

  if (exact.length === 1) {
    return { found: true, ...exact[0], tier: 'exact' };
  }
  // More than one exact match is an answer, not a miss: folding could only add
  // candidates to an ambiguity the caller must resolve anyway.
  if (exact.length > 1 || !options.foldTypography) {
    return { found: false, count: exact.length, tier: 'exact' };
  }

  const folded = findAllMatches(haystack, needle, { ...options, foldTypography: true });

  if (folded.length === 1) {
    logger.debug('Match found only after folding typographic variants', {
      needleLength: needle.length,
      haystackLength: haystack.length,
    });
    return { found: true, ...folded[0], tier: 'typographic' };
  }

  return { found: false, count: folded.length, tier: 'typographic' };
}
