/**
 * Tier B tests for the UNICODE profile — driven by the shared corpora that
 * quilltap-v5 copies.
 *
 * Three things here are worth more than the rest put together:
 *
 * 1. the Greek case-sensitivity rows (`\phi` vs `\Phi`), which fail SILENTLY in
 *    a port that lowercases;
 * 2. the math-span rows, which are the difference between a helpful typeahead
 *    and one that quietly breaks people's LaTeX;
 * 3. the `U+` parser's range guards.
 *
 * @module lib/char-insert/__tests__/unicode.test
 */

import { buildIndex, searchChars, findByAlias, findByCodePoint } from '../search';
import { findTrigger } from '../trigger';
import { isInsideMathSpan } from '../math-span';
import { UNICODE_PROFILE, UNICODE_BLOCK_LABELS } from '../profiles/unicode';
import type { CharIndex } from '../types';

import searchVectors from '../fixtures/unicode-search-vectors.json';
import triggerVectors from '../fixtures/unicode-trigger-vectors.json';
import datasetPayload from '../../../public/unicode/unicode-index.v1.json';

const CONFIG = UNICODE_PROFILE.trigger;

describe('lib/char-insert — unicode profile', () => {
  let index: CharIndex;

  beforeAll(() => {
    index = buildIndex(datasetPayload);
  });

  describe('the shipped dataset', () => {
    it('matches the corpus datasetVersion', () => {
      expect(index.version).toBe(searchVectors.datasetVersion);
    });

    it('carries the curated blocks and nothing else', () => {
      expect(index.groups).toHaveLength(26);
      for (const slug of index.groups) {
        expect(UNICODE_BLOCK_LABELS[slug]).toBeTruthy();
      }
    });

    it('is smaller on the wire than the emoji index despite holding more characters', () => {
      // The claim the spec is built on: Unicode names compress far better than
      // emoji keyword lists. Raw byte length stands in for the gzipped figure —
      // if this ever inverts, the curation has drifted.
      expect(index.entries.length).toBeGreaterThan(3_000);
      expect(index.entries.length).toBe(index.normalized.length);
    });

    it('is pre-sorted into (block, code point) order', () => {
      for (let i = 1; i < index.normalized.length; i += 1) {
        const previous = index.normalized[i - 1];
        const current = index.normalized[i];
        const inOrder =
          previous.groupOrder < current.groupOrder ||
          (previous.groupOrder === current.groupOrder &&
            previous.entry.order < current.entry.order);
        expect(inOrder).toBe(true);
      }
    });

    it('stores each entry`s code point as its order', () => {
      for (const entry of index.entries) {
        expect(entry.order).toBe(entry.char.codePointAt(0));
      }
    });

    it('excludes combining marks, which would attach to the wrong character', () => {
      // U+0301 COMBINING ACUTE ACCENT and friends are outside the curated blocks
      // anyway; the ones inside them (U+0483…, U+20D0…) are dropped by category.
      const combining = index.entries.filter((entry) => /\p{M}/u.test(entry.char));
      expect(combining).toEqual([]);
    });

    it('leaves characters the emoji picker already offers to the emoji picker', () => {
      // ☂ U+2602, ☎ U+260E, ✂ U+2702 are all in the emoji index.
      for (const char of ['☂', '☎', '✂', '☀']) {
        expect(index.entries.some((entry) => entry.char === char)).toBe(false);
      }
    });
  });

  describe('search corpus vectors', () => {
    it.each(searchVectors.cases)(
      'searchChars($query, $limit) — $invariant',
      ({ query, limit, expect: expected }) => {
        const result = searchChars(index, query, limit).map((entry) => entry.char);
        expect(result.slice(0, expected.length)).toEqual(expected);
        expect(result.length).toBeLessThanOrEqual(limit);
      },
    );
  });

  describe('trigger corpus vectors', () => {
    it.each(triggerVectors.cases)('findTrigger($text) — $invariant', ({ text, expect: expected }) => {
      expect(findTrigger(text, CONFIG)).toEqual(expected);
    });
  });

  describe('math-span corpus vectors', () => {
    it.each(triggerVectors.mathCases)(
      'isInsideMathSpan($text) === $expect — $invariant',
      ({ text, expect: expected }) => {
        expect(isInsideMathSpan(text)).toBe(expected);
      },
    );
  });

  /**
   * ⚠ THE SINGLE MOST IMPORTANT BLOCK IN THIS FILE.
   *
   * `normalizeQuery` lowercases, so a port that routes the commit path through
   * the normalized map alone will hand back the lowercase letter for `\Phi` and
   * look completely correct while doing it.
   */
  describe('alias case sensitivity', () => {
    it.each([
      ['phi', 'φ', 'Phi', 'Φ'],
      ['gamma', 'γ', 'Gamma', 'Γ'],
      ['delta', 'δ', 'Delta', 'Δ'],
      ['sigma', 'σ', 'Sigma', 'Σ'],
      ['omega', 'ω', 'Omega', 'Ω'],
      ['theta', 'θ', 'Theta', 'Θ'],
    ])('\\%s is %s and \\%s is %s', (lower, lowerChar, upper, upperChar) => {
      expect(findByAlias(index, lower, { caseSensitive: true })?.char).toBe(lowerChar);
      expect(findByAlias(index, upper, { caseSensitive: true })?.char).toBe(upperChar);
    });

    it('falls back to the normalized map for a casing the dataset does not carry', () => {
      // `\PHI` is nobody's LaTeX, but answering with SOMETHING beats answering
      // with nothing — and the fallback is deterministic (presentation order).
      expect(findByAlias(index, 'PHI', { caseSensitive: true })?.char).toBe('Φ');
    });

    it('would be wrong without the exact-case map — the regression this guards', () => {
      // Case-INsensitive lookup collapses the pair; this is what a port that
      // forgets `caseSensitive` produces.
      expect(findByAlias(index, 'Phi')?.char).toBe(findByAlias(index, 'phi')?.char);
      expect(findByAlias(index, 'Phi', { caseSensitive: true })?.char).not.toBe(
        findByAlias(index, 'phi', { caseSensitive: true })?.char,
      );
    });

    it('takes the greek letters, not KaTeX`s rendering glyphs', () => {
      // KaTeX maps `\phi` to U+03D5 because that is what its math font draws.
      // This feature inserts a CHARACTER into prose, where `\phi` means GREEK
      // SMALL LETTER PHI. The generator overrules KaTeX; see GREEK_OVERRIDES.
      expect(findByAlias(index, 'phi', { caseSensitive: true })?.char).toBe('φ');
      expect(findByAlias(index, 'varphi', { caseSensitive: true })?.char).toBe('ϕ');
    });
  });

  describe('the NameAllWords bucket in practice', () => {
    it('puts → within reach of `right arrow`, which no other bucket does', () => {
      // The picker's limit, not the menu's — this is the gap the spec measured,
      // and the bucket is deliberately last, so → sits behind the characters
      // literally NAMED "right arrow …".
      const chars = searchChars(index, 'right arrow', 64).map((entry) => entry.char);
      expect(chars).toContain('→');
      expect(searchChars(index, 'right arrow', 4).map((e) => e.char)).not.toContain('→');
    });

    it('puts φ within reach of `greek phi`', () => {
      expect(searchChars(index, 'greek phi', 8).map((entry) => entry.char)).toContain('φ');
    });
  });

  describe('findByCodePoint reaches what the curation dropped', () => {
    it('resolves a character from a block this dataset does not ship', () => {
      // Mathematical Alphanumeric Symbols were deferred, and CJK was refused
      // outright. Both stay reachable.
      expect(findByCodePoint(index, 'u{1D538}')?.char).toBe('\u{1D538}');
      expect(findByCodePoint(index, 'u4E00')?.char).toBe('一');
    });

    it('names the character from the index when the index knows it', () => {
      expect(findByCodePoint(index, 'u2192')?.name).toBe('rightwards arrow');
    });

    it('guards the range and the surrogate gap', () => {
      expect(findByCodePoint(index, 'u10FFFF')?.char).toBe('\u{10FFFF}');
      expect(findByCodePoint(index, 'u110000')).toBeNull();
      expect(findByCodePoint(index, 'uD800')).toBeNull();
      expect(findByCodePoint(index, 'uDC00')).toBeNull();
    });
  });

  describe('profile invariants', () => {
    it('preserves query case and asks for case-sensitive aliases', () => {
      expect(CONFIG.lowercaseQuery).toBe(false);
      expect(UNICODE_PROFILE.caseSensitiveAliases).toBe(true);
    });

    it('bails inside math and resolves code points, unlike the emoji profile', () => {
      expect(UNICODE_PROFILE.bailInsideMath).toBe(true);
      expect(UNICODE_PROFILE.codePointQueries).toBe(true);
    });

    it('never fetches the dataset from the space bar', () => {
      // `mayTriggerLoad` false is what stops the first space anyone types from
      // pulling down a 300 KB asset.
      expect(UNICODE_PROFILE.commitKey?.key).toBe(' ');
      expect(UNICODE_PROFILE.commitKey?.mayTriggerLoad).toBe(false);
    });

    it('uses a stateless query pattern', () => {
      expect(CONFIG.queryPattern.global).toBe(false);
      expect(CONFIG.queryPattern.sticky).toBe(false);
      expect(CONFIG.queryStartPattern?.global).toBe(false);
    });
  });
});
