/**
 * Tier B trigger tests — driven by the shared corpus that quilltap-v5 copies.
 *
 * @module lib/emoji/__tests__/trigger.test
 */

import { findEmojiTrigger, MIN_QUERY_LENGTH, MAX_QUERY_LENGTH } from '../trigger';

import triggerVectors from '../fixtures/emoji-trigger-vectors.json';

describe('lib/emoji/trigger', () => {
  describe('corpus vectors', () => {
    it.each(triggerVectors.cases)('findEmojiTrigger($text) — $invariant', ({ text, expect: expected }) => {
      expect(findEmojiTrigger(text)).toEqual(expected);
    });
  });

  describe('the offsets a caller deletes', () => {
    it('spans the colon through the last query character', () => {
      const text = 'hello :smi';
      const match = findEmojiTrigger(text)!;
      expect(text.slice(match.start, match.end)).toBe(':smi');
    });

    it('excludes the closing colon from `end` so the caller removes it explicitly', () => {
      const text = 'hello :smile:';
      const match = findEmojiTrigger(text)!;
      expect(match.closed).toBe(true);
      expect(text.slice(match.start, match.end)).toBe(':smile');
      expect(text.slice(match.end)).toBe(':');
    });
  });

  describe('word-opening context', () => {
    it.each(['(', '[', '{', '"', "'", '“', '‘', '—', '–', ' ', '\t'])(
      'opens after %j',
      (opener) => {
        expect(findEmojiTrigger(`x${opener}:smi`)).not.toBeNull();
      },
    );

    it.each(['a', '0', '/', '.', '-', ':'])('does not open after %j', (blocker) => {
      expect(findEmojiTrigger(`x${blocker}:smi`)).toBeNull();
    });
  });

  describe('query alphabet', () => {
    it.each(['sm1', 'sm_i', 'sm-i', 'sm+i'])('accepts %j', (query) => {
      expect(findEmojiTrigger(`:${query}`)?.query).toBe(query);
    });

    it.each([':sm i', ':sm.i', ':sm/i', ':sm!i'])(
      'stops at the first disallowed character in %j',
      (text) => {
        // The scan walks back from the cursor, so a disallowed character in the
        // middle severs the query from its colon entirely.
        expect(findEmojiTrigger(text)).toBeNull();
      },
    );
  });

  describe('length bounds', () => {
    it('stays shut below the minimum', () => {
      expect(findEmojiTrigger(`:${'x'.repeat(MIN_QUERY_LENGTH - 1)}`)).toBeNull();
      expect(findEmojiTrigger(`:${'x'.repeat(MIN_QUERY_LENGTH)}`)).not.toBeNull();
    });

    it('abandons the match past the maximum', () => {
      expect(findEmojiTrigger(`:${'x'.repeat(MAX_QUERY_LENGTH)}`)).not.toBeNull();
      expect(findEmojiTrigger(`:${'x'.repeat(MAX_QUERY_LENGTH + 1)}`)).toBeNull();
    });
  });

  it('considers only the nearest colon', () => {
    const text = 'a :first and :second';
    const match = findEmojiTrigger(text)!;
    expect(match.query).toBe('second');
    expect(text.slice(match.start, match.end)).toBe(':second');
  });
});
