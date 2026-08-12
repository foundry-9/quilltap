/**
 * Tests for RNG Pattern Detector Service
 */

import {
  detectRngPatterns,
  convertPatternsToToolCalls,
  detectAndConvertRngPatterns,
} from '@/lib/services/chat-message/rng-pattern-detector.service'

describe('RNG Pattern Detector', () => {
  describe('detectRngPatterns', () => {
    describe('dice rolls', () => {
      it('should detect simple dice notation like d6', () => {
        const patterns = detectRngPatterns('I roll d6')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'dice',
          sides: 6,
          count: 1,
          modifier: 0,
          matchText: 'd6',
        })
      })

      it('should detect dice notation with count like 2d6', () => {
        const patterns = detectRngPatterns('Rolling 2d6 for damage')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'dice',
          sides: 6,
          count: 2,
          modifier: 0,
          matchText: '2d6',
        })
      })

      it('should carry a positive modifier through, e.g. 3d6+2', () => {
        const patterns = detectRngPatterns('Rolling 3d6+2 for damage')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'dice',
          sides: 6,
          count: 3,
          modifier: 2,
          matchText: '3d6+2',
        })
      })

      it('should carry a negative modifier through, e.g. 2d10-1', () => {
        const patterns = detectRngPatterns('Rolling 2d10-1 to hit')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'dice',
          sides: 10,
          count: 2,
          modifier: -1,
          matchText: '2d10-1',
        })
      })

      it('should not swallow a detached number as a modifier', () => {
        // "2d6 - 1 apple" is a 2d6 roll next to unrelated prose, not 2d6-1.
        // Real notation is written closed up, so spacing disambiguates.
        const patterns = detectRngPatterns('Rolling 2d6 - 1 apple remains')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].matchText).toBe('2d6')
        expect(patterns[0].modifier).toBe(0)
      })

      it('should detect d20', () => {
        const patterns = detectRngPatterns('Roll a d20 for initiative')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].sides).toBe(20)
        expect(patterns[0].count).toBe(1)
      })

      it('should detect multiple dice notations in one message', () => {
        const patterns = detectRngPatterns('Roll 2d6 for damage and d20 for attack')
        expect(patterns).toHaveLength(2)
        expect(patterns[0].matchText).toBe('2d6')
        expect(patterns[1].matchText).toBe('d20')
      })

      it('should ignore dice with too few sides', () => {
        const patterns = detectRngPatterns('Roll d1')
        expect(patterns).toHaveLength(0)
      })

      it('should ignore dice with too many sides', () => {
        const patterns = detectRngPatterns('Roll d1001')
        expect(patterns).toHaveLength(0)
      })

      it('should ignore dice with too many rolls', () => {
        const patterns = detectRngPatterns('Roll 101d6')
        expect(patterns).toHaveLength(0)
      })

      it('should be case insensitive', () => {
        const patterns = detectRngPatterns('Roll D20')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].sides).toBe(20)
      })
    })

    describe('coin flips', () => {
      it('should detect "flip a coin"', () => {
        const patterns = detectRngPatterns("Let's flip a coin")
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'flip_coin',
          count: 1,
          matchText: 'flip a coin',
        })
      })

      it('should detect "flipacoin" with no space', () => {
        const patterns = detectRngPatterns('I flipacoin')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].type).toBe('flip_coin')
      })

      it('should not detect "flip the coin" (too many chars between)', () => {
        // " the " is 5 characters, regex only allows 1-3
        const patterns = detectRngPatterns('I flip the coin')
        expect(patterns).toHaveLength(0)
      })

      it('should be case insensitive', () => {
        const patterns = detectRngPatterns('FLIP A COIN')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].type).toBe('flip_coin')
      })

      it('should not match "flip my coin collection"', () => {
        const patterns = detectRngPatterns('I flip my coin collection over')
        expect(patterns).toHaveLength(0)
      })
    })

    describe('spin the bottle', () => {
      it('should detect "spin the bottle"', () => {
        const patterns = detectRngPatterns("Let's spin the bottle")
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toEqual({
          type: 'spin_the_bottle',
          count: 1,
          matchText: 'spin the bottle',
        })
      })

      it('should detect "spin a bottle"', () => {
        const patterns = detectRngPatterns('I spin a bottle')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].type).toBe('spin_the_bottle')
      })

      it('should be case insensitive', () => {
        const patterns = detectRngPatterns('SPIN THE BOTTLE!')
        expect(patterns).toHaveLength(1)
        expect(patterns[0].type).toBe('spin_the_bottle')
      })
    })

    describe('multiple patterns', () => {
      it('should detect dice and coin flip in same message', () => {
        const patterns = detectRngPatterns('Roll d20, and if you fail, flip a coin')
        expect(patterns).toHaveLength(2)
        expect(patterns[0].type).toBe('dice')
        expect(patterns[1].type).toBe('flip_coin')
      })

      it('should detect all three pattern types', () => {
        const patterns = detectRngPatterns('Roll 2d6, flip a coin, and spin the bottle!')
        expect(patterns).toHaveLength(3)
        expect(patterns.map(p => p.type)).toEqual(['dice', 'flip_coin', 'spin_the_bottle'])
      })
    })

    describe('no patterns', () => {
      it('should return empty array for text without patterns', () => {
        const patterns = detectRngPatterns('Hello, how are you?')
        expect(patterns).toHaveLength(0)
      })

      it('should return empty array for empty string', () => {
        const patterns = detectRngPatterns('')
        expect(patterns).toHaveLength(0)
      })
    })
  })

  describe('convertPatternsToToolCalls', () => {
    it('should convert dice pattern to tool call', () => {
      const patterns = [{ type: 'dice' as const, sides: 20, count: 1, matchText: 'd20' }]
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 20,
        rolls: 1,
        modifier: 0,
        matchText: 'd20',
      })
    })

    it('should pass a dice modifier through to the tool call', () => {
      const patterns = [{ type: 'dice' as const, sides: 6, count: 3, modifier: 2, matchText: '3d6+2' }]
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 6,
        rolls: 3,
        modifier: 2,
        matchText: '3d6+2',
      })
    })

    it('should convert coin flip pattern to tool call', () => {
      const patterns = [{ type: 'flip_coin' as const, count: 1, matchText: 'flip a coin' }]
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 'flip_coin',
        rolls: 1,
        matchText: 'flip a coin',
      })
    })

    it('should convert spin the bottle pattern to tool call', () => {
      const patterns = [{ type: 'spin_the_bottle' as const, count: 1, matchText: 'spin the bottle' }]
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 'spin_the_bottle',
        rolls: 1,
        matchText: 'spin the bottle',
      })
    })
  })

  describe('detectAndConvertRngPatterns', () => {
    it('should detect and convert in one call', () => {
      const calls = detectAndConvertRngPatterns('Roll 3d6 for stats')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 6,
        rolls: 3,
        modifier: 0,
        matchText: '3d6',
      })
    })

    it('should detect and convert a modified roll in one call', () => {
      const calls = detectAndConvertRngPatterns('Roll 3d6+2 for stats')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: 6,
        rolls: 3,
        modifier: 2,
        matchText: '3d6+2',
      })
    })

    it('should handle multiple patterns', () => {
      const calls = detectAndConvertRngPatterns('Roll d20 and flip a coin')
      expect(calls).toHaveLength(2)
      expect(calls[0].type).toBe(20)
      expect(calls[1].type).toBe('flip_coin')
    })
  })
})
