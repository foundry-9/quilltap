/**
 * Tier B recents tests. The list arithmetic is pure; the adapter owns storage,
 * and the profile owns the key.
 *
 * @module lib/char-insert/__tests__/recents.test
 */

import { pushRecent, parseRecents, serializeRecents, RECENTS_LIMIT } from '../recents';
import { EMOJI_PROFILE } from '../profiles/emoji';
import { UNICODE_PROFILE } from '../profiles/unicode';

describe('lib/char-insert/recents', () => {
  describe('pushRecent', () => {
    it('moves a repeat pick to the front instead of duplicating it', () => {
      expect(pushRecent(['😄', '🎉', '🚀'], '🚀')).toEqual(['🚀', '😄', '🎉']);
    });

    it('prepends a new pick', () => {
      expect(pushRecent(['😄'], '🎉')).toEqual(['🎉', '😄']);
    });

    it('caps at RECENTS_LIMIT', () => {
      const full = Array.from({ length: RECENTS_LIMIT }, (_, i) => `e${i}`);
      const result = pushRecent(full, 'new');
      expect(result).toHaveLength(RECENTS_LIMIT);
      expect(result[0]).toBe('new');
      expect(result).not.toContain(`e${RECENTS_LIMIT - 1}`);
    });

    it('does not mutate the input list', () => {
      const original = ['😄', '🎉'];
      pushRecent(original, '🚀');
      expect(original).toEqual(['😄', '🎉']);
    });

    it('ignores an empty character', () => {
      expect(pushRecent(['😄'], '')).toEqual(['😄']);
    });
  });

  describe('parseRecents', () => {
    // localStorage is user-writable and shared across tabs, so anything
    // unrecognised must degrade to an empty list rather than throw.
    it.each([
      ['null', null],
      ['an empty string', ''],
      ['truncated JSON', '{'],
      ['a JSON object', '{"a":1}'],
      ['a JSON string', '"nope"'],
      ['a JSON number', '42'],
    ])('returns [] for %s', (_label, raw) => {
      expect(parseRecents(raw)).toEqual([]);
    });

    it('drops non-string and empty members instead of failing the whole list', () => {
      expect(parseRecents('[1,"😄",null,"",true,"🎉"]')).toEqual(['😄', '🎉']);
    });

    it('dedupes and caps a bloated stored list', () => {
      const bloated = JSON.stringify([
        '😄',
        '😄',
        ...Array.from({ length: RECENTS_LIMIT + 10 }, (_, i) => `e${i}`),
      ]);
      const result = parseRecents(bloated);
      expect(result).toHaveLength(RECENTS_LIMIT);
      expect(new Set(result).size).toBe(result.length);
    });
  });

  it('round-trips through serialize/parse', () => {
    const list = ['😄', '🎉', '🚀'];
    expect(parseRecents(serializeRecents(list))).toEqual(list);
  });

  it('serializes at most RECENTS_LIMIT entries', () => {
    const overlong = Array.from({ length: RECENTS_LIMIT + 5 }, (_, i) => `e${i}`);
    expect(JSON.parse(serializeRecents(overlong))).toHaveLength(RECENTS_LIMIT);
  });

  it('pins the storage keys shared with quilltap-v5', () => {
    // Changing either literal orphans every user's list, in BOTH apps. The two
    // profiles keep SEPARATE lists — a Recents row mixing 😄 with ∮ would be
    // useless to both.
    expect(EMOJI_PROFILE.recentsStorageKey).toBe('quilltap.emoji.recents.v1');
    expect(UNICODE_PROFILE.recentsStorageKey).toBe('quilltap.unicode.recents.v1');
    expect(EMOJI_PROFILE.recentsStorageKey).not.toBe(UNICODE_PROFILE.recentsStorageKey);
  });
});
