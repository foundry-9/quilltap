/**
 * Tier B search tests — driven by the shared corpus that quilltap-v5 copies.
 *
 * @module lib/emoji/__tests__/search.test
 */

import { buildIndex, searchEmoji, findByShortcode, normalizeQuery } from '../search';
import { EmojiIndexError } from '../types';
import type { EmojiIndex } from '../types';

import searchVectors from '../fixtures/emoji-search-vectors.json';
import datasetPayload from '../../../public/emoji/emoji-index.v1.json';

describe('lib/emoji/search', () => {
  let index: EmojiIndex;

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
      'searchEmoji($query, $limit) — $invariant',
      ({ query, limit, expect: expected }) => {
        const result = searchEmoji(index, query, limit).map((entry) => entry.char);
        expect(result.slice(0, expected.length)).toEqual(expected);
        expect(result.length).toBeLessThanOrEqual(limit);
      },
    );
  });

  describe('ranking', () => {
    /**
     * The documented seven-step order. A query built to hit every bucket at once
     * would be contrived; instead assert the pairwise precedence that actually
     * decides results.
     */
    it('puts an exact shortcode above a shortcode prefix', () => {
      const result = searchEmoji(index, 'smile', 8);
      expect(result[0].shortcodes).toContain('smile');
      // 😃 carries the shortcode `smiley` — a prefix match, so it must follow.
      expect(result[1].shortcodes.some((code) => code.startsWith('smile'))).toBe(true);
    });

    it('puts a name prefix above a bare keyword match', () => {
      const result = searchEmoji(index, 'grinning', 8);
      const firstNonPrefix = result.findIndex((entry) => !entry.name.startsWith('grinning'));
      const lastPrefix = result.reduce(
        (acc, entry, i) => (entry.name.startsWith('grinning') ? i : acc),
        -1,
      );
      if (firstNonPrefix !== -1) expect(lastPrefix).toBeLessThan(firstNonPrefix);
    });

    it('is deterministic across repeated calls', () => {
      const once = searchEmoji(index, 'face', 20).map((entry) => entry.char);
      const twice = searchEmoji(index, 'face', 20).map((entry) => entry.char);
      expect(once).toEqual(twice);
    });

    it('breaks ties by (group order, entry order), not insertion order', () => {
      // Every result inside a single ranking bucket must be ascending in
      // presentation order. `grinning` is a pure name-prefix query, so the whole
      // prefix run shares a bucket.
      const result = searchEmoji(index, 'grinning', 5).filter((entry) =>
        entry.name.startsWith('grinning'),
      );
      const orders = result.map((entry) => entry.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('honours the limit', () => {
      expect(searchEmoji(index, 'face', 3)).toHaveLength(3);
      expect(searchEmoji(index, 'face', 0)).toHaveLength(0);
      expect(searchEmoji(index, 'face', -1)).toHaveLength(0);
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

  describe('findByShortcode', () => {
    it('resolves an exact shortcode for the closing-colon commit', () => {
      expect(findByShortcode(index, 'smile')?.shortcodes).toContain('smile');
      expect(findByShortcode(index, 'SMILE')?.shortcodes).toContain('smile');
    });

    it('returns null rather than guessing when the query is not a shortcode', () => {
      expect(findByShortcode(index, 'smi')).toBeNull();
      expect(findByShortcode(index, 'definitely-not-a-shortcode')).toBeNull();
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
      expect(built.byShortcode.get('smile')?.char).toBe('😄');
    });

    // A half-built index would return wrong results forever; a throw keeps the
    // feature shut instead.
    it.each([
      ['a non-object payload', null],
      ['a payload with no version', { groups: ['g'], emoji: [] }],
      ['a payload with no groups', { version: 1, emoji: [{}] }],
      ['a payload with an empty emoji array', { version: 1, groups: ['g'], emoji: [] }],
      [
        'an entry with no character',
        { version: 1, groups: ['g'], emoji: [{ n: 'x', s: [], k: [], g: 'g', o: 1 }] },
      ],
      [
        'an entry with a malformed shortcode list',
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
    ])('throws EmojiIndexError on %s', (_label, payload) => {
      expect(() => buildIndex(payload)).toThrow(EmojiIndexError);
    });
  });
});
