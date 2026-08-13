/**
 * Tier B search tests for the EMOJI profile — driven by the shared corpus that
 * quilltap-v5 copies.
 *
 * These vectors are UNEDITED from the day the emoji feature shipped. Layer 2.0u
 * renamed the engine, renamed `shortcodes` to `aliases`, added the
 * `NameAllWords` bucket and the exact-case alias map; if any of that had moved a
 * single emoji result, this file would be red. That is the entire proof that the
 * generalization was safe.
 *
 * @module lib/char-insert/__tests__/search.test
 */

import { buildIndex, searchChars, findByAlias, findByCodePoint, normalizeQuery } from '../search';
import { CharIndexError } from '../types';
import type { CharIndex } from '../types';

import searchVectors from '../fixtures/emoji-search-vectors.json';
import datasetPayload from '../../../public/emoji/emoji-index.v1.json';

describe('lib/char-insert/search — emoji profile', () => {
  let index: CharIndex;

  beforeAll(() => {
    index = buildIndex(datasetPayload);
  });

  describe('the shipped dataset', () => {
    it('matches the corpus datasetVersion', () => {
      expect(index.version).toBe(searchVectors.datasetVersion);
    });

    it('indexes the full base emoji set', () => {
      expect(index.entries.length).toBeGreaterThan(1_800);
      expect(index.entries.length).toBe(index.normalized.length);
    });

    it('is pre-sorted into Unicode presentation order', () => {
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
  });

  describe('corpus vectors', () => {
    it.each(searchVectors.cases)(
      'searchChars($query, $limit) — $invariant',
      ({ query, limit, expect: expected }) => {
        const result = searchChars(index, query, limit).map((entry) => entry.char);
        expect(result.slice(0, expected.length)).toEqual(expected);
        expect(result.length).toBeLessThanOrEqual(limit);
      },
    );
  });

  describe('ranking', () => {
    /**
     * The documented eight-step order. A query built to hit every bucket at once
     * would be contrived; instead assert the pairwise precedence that actually
     * decides results.
     */
    it('puts an exact alias above an alias prefix', () => {
      const result = searchChars(index, 'smile', 8);
      expect(result[0].aliases).toContain('smile');
      // 😃 carries the shortcode `smiley` — a prefix match, so it must follow.
      expect(result[1].aliases.some((code) => code.startsWith('smile'))).toBe(true);
    });

    it('puts a name prefix above a bare keyword match', () => {
      const result = searchChars(index, 'grinning', 8);
      const firstNonPrefix = result.findIndex((entry) => !entry.name.startsWith('grinning'));
      const lastPrefix = result.reduce(
        (acc, entry, i) => (entry.name.startsWith('grinning') ? i : acc),
        -1,
      );
      if (firstNonPrefix !== -1) expect(lastPrefix).toBeLessThan(firstNonPrefix);
    });

    it('is deterministic across repeated calls', () => {
      const once = searchChars(index, 'face', 20).map((entry) => entry.char);
      const twice = searchChars(index, 'face', 20).map((entry) => entry.char);
      expect(once).toEqual(twice);
    });

    it('breaks ties by (group order, entry order), not insertion order', () => {
      // Every result inside a single ranking bucket must be ascending in
      // presentation order. `grinning` is a pure name-prefix query, so the whole
      // prefix run shares a bucket.
      const result = searchChars(index, 'grinning', 5).filter((entry) =>
        entry.name.startsWith('grinning'),
      );
      const orders = result.map((entry) => entry.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('honours the limit', () => {
      expect(searchChars(index, 'face', 3)).toHaveLength(3);
      expect(searchChars(index, 'face', 0)).toHaveLength(0);
      expect(searchChars(index, 'face', -1)).toHaveLength(0);
    });
  });

  /**
   * The Layer 2.0u addition. Its contract is that it is the WORST matching
   * bucket, so it can only add results that previously did not appear at all.
   */
  describe('the NameAllWords bucket', () => {
    it('reaches a name whose query words are not adjacent', () => {
      // "grinning face with big eyes" — `grinning eyes` matches no substring.
      const chars = searchChars(index, 'grinning eyes', 12).map((entry) => entry.char);
      expect(chars.length).toBeGreaterThan(0);
      const names = searchChars(index, 'grinning eyes', 12).map((entry) => entry.name);
      expect(names.every((name) => name.includes('grinning') && name.includes('eye'))).toBe(true);
    });

    it('never outranks a substring match', () => {
      const result = searchChars(index, 'grinning face', 12);
      const firstAllWordsOnly = result.findIndex((entry) => !entry.name.includes('grinning face'));
      const lastSubstring = result.reduce(
        (acc, entry, i) => (entry.name.includes('grinning face') ? i : acc),
        -1,
      );
      if (firstAllWordsOnly !== -1) expect(lastSubstring).toBeLessThan(firstAllWordsOnly);
    });

    it('does nothing at all for a single-token query', () => {
      // A one-token query can only reach buckets 0-6; if it reached
      // NameAllWords, "face" would drag in every name containing a word merely
      // prefixed by it — which is what NameWordStart already does, ranked higher.
      const result = searchChars(index, 'grinning', 40);
      expect(
        result.every(
          (entry) =>
            entry.name.includes('grinning') ||
            entry.aliases.some((alias) => alias.includes('grinning')) ||
            entry.keywords.some((keyword) => keyword.startsWith('grinning')),
        ),
      ).toBe(true);
    });
  });

  describe('normalizeQuery', () => {
    it('folds case, hyphens, underscores and runs of whitespace to one form', () => {
      expect(normalizeQuery('THUMBS_UP')).toBe('thumbs up');
      expect(normalizeQuery('thumbs-up')).toBe('thumbs up');
      expect(normalizeQuery('  thumbs   up  ')).toBe('thumbs up');
      expect(normalizeQuery('thumbs up')).toBe('thumbs up');
    });
  });

  describe('findByAlias', () => {
    it('resolves an exact alias for the closing-colon commit', () => {
      expect(findByAlias(index, 'smile')?.aliases).toContain('smile');
      expect(findByAlias(index, 'SMILE')?.aliases).toContain('smile');
    });

    it('returns null rather than guessing when the query is not an alias', () => {
      expect(findByAlias(index, 'smi')).toBeNull();
      expect(findByAlias(index, 'definitely-not-an-alias')).toBeNull();
    });

    it('falls back to the normalized map when a case-sensitive lookup misses', () => {
      // Emoji shortcodes are lowercase, so the exact-case map answers directly;
      // an uppercased query still resolves through the fallback.
      expect(findByAlias(index, 'smile', { caseSensitive: true })?.aliases).toContain('smile');
      expect(findByAlias(index, 'SMILE', { caseSensitive: true })?.aliases).toContain('smile');
    });
  });

  describe('findByCodePoint', () => {
    it('accepts every spelling of a code point', () => {
      for (const query of ['u2192', 'U2192', 'u+2192', 'U+2192', 'u{2192}']) {
        expect(findByCodePoint(index, query)?.char).toBe('→');
      }
    });

    it('resolves astral code points with no table lookup', () => {
      const entry = findByCodePoint(index, 'u{1D538}');
      expect(entry?.char).toBe('\u{1D538}');
      expect(entry?.name).toBe('u+1D538');
    });

    it('prefers the indexed row when the dataset knows the character', () => {
      // U+1F600 GRINNING FACE is in the emoji index.
      expect(findByCodePoint(index, 'u1F600')?.name).toBe('grinning face');
    });

    it('refuses surrogates, out-of-range values and non-code-point queries', () => {
      expect(findByCodePoint(index, 'uD800')).toBeNull();
      expect(findByCodePoint(index, 'uDFFF')).toBeNull();
      expect(findByCodePoint(index, 'u110000')).toBeNull();
      expect(findByCodePoint(index, 'u21')).toBeNull(); // too few digits
      expect(findByCodePoint(index, 'u1234567')).toBeNull(); // too many
      expect(findByCodePoint(index, 'phi')).toBeNull();
    });

    it('works with no index at all', () => {
      expect(findByCodePoint(null, 'u2192')?.char).toBe('→');
    });
  });

  describe('buildIndex validation', () => {
    const valid = {
      version: 1,
      groups: ['smileys-emotion'],
      emoji: [{ c: '😄', n: 'smiling', s: ['smile'], k: ['happy'], g: 'smileys-emotion', o: 1 }],
    };

    it('builds a usable index from a minimal valid payload', () => {
      const built = buildIndex(valid);
      expect(built.entries).toHaveLength(1);
      expect(built.byAlias.get('smile')?.char).toBe('😄');
      expect(built.byAliasExactCase.get('smile')?.char).toBe('😄');
    });

    it('reads the Unicode profile`s `entries` key as readily as the emoji `emoji` key', () => {
      const built = buildIndex({
        version: 1,
        groups: ['arrows'],
        entries: [{ c: '→', n: 'rightwards arrow', s: ['to'], k: [], g: 'arrows', o: 0x2192 }],
      });
      expect(built.entries[0].char).toBe('→');
    });

    // A half-built index would return wrong results forever; a throw keeps the
    // feature shut instead.
    it.each([
      ['a non-object payload', null],
      ['a payload with no version', { groups: ['g'], emoji: [] }],
      ['a payload with no groups', { version: 1, emoji: [{}] }],
      ['a payload with an empty row array', { version: 1, groups: ['g'], emoji: [] }],
      [
        'an entry with no character',
        { version: 1, groups: ['g'], emoji: [{ n: 'x', s: [], k: [], g: 'g', o: 1 }] },
      ],
      [
        'an entry with a malformed alias list',
        { version: 1, groups: ['g'], emoji: [{ c: '😄', n: 'x', s: 'smile', k: [], g: 'g', o: 1 }] },
      ],
      [
        'an entry in an unknown group',
        { version: 1, groups: ['g'], emoji: [{ c: '😄', n: 'x', s: [], k: [], g: 'nope', o: 1 }] },
      ],
      [
        'an entry with no numeric order',
        { version: 1, groups: ['g'], emoji: [{ c: '😄', n: 'x', s: [], k: [], g: 'g' }] },
      ],
    ])('throws CharIndexError on %s', (_label, payload) => {
      expect(() => buildIndex(payload)).toThrow(CharIndexError);
    });
  });
});
