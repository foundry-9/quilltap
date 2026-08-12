/**
 * Dice module — notation parsing, bounds, rolling, and breakdown formatting.
 *
 * The roller half was extracted verbatim from `lib/tools/handlers/rng-handler.ts`;
 * the parity tests below pin the properties that extraction had to preserve.
 */

import {
  parseDiceNotation,
  scanDiceNotation,
  formatDiceNotation,
  formatDiceBreakdown,
  rollNotation,
  rollDice,
  flipCoin,
  secureRandomInt,
  MAX_DICE_MODIFIER,
} from '@/lib/pascal/dice'

describe('parseDiceNotation', () => {
  it('parses a bare die as a single roll', () => {
    expect(parseDiceNotation('d20')).toEqual({ count: 1, sides: 20, modifier: 0 })
  })

  it('parses count and sides', () => {
    expect(parseDiceNotation('3d6')).toEqual({ count: 3, sides: 6, modifier: 0 })
  })

  it('parses a positive modifier — the case the old prose regex silently dropped', () => {
    expect(parseDiceNotation('3d6+2')).toEqual({ count: 3, sides: 6, modifier: 2 })
  })

  it('parses a negative modifier', () => {
    expect(parseDiceNotation('2d10-1')).toEqual({ count: 2, sides: 10, modifier: -1 })
  })

  it('tolerates surrounding and interior whitespace in the strict form', () => {
    expect(parseDiceNotation('  2d10 - 1 ')).toEqual({ count: 2, sides: 10, modifier: -1 })
  })

  it('is case-insensitive', () => {
    expect(parseDiceNotation('2D6+1')).toEqual({ count: 2, sides: 6, modifier: 1 })
  })

  it('rejects a string that is not purely notation', () => {
    expect(parseDiceNotation('roll 3d6 please')).toBeNull()
  })

  it.each([
    ['d1', 'fewer than 2 sides'],
    ['d1001', 'more than 1000 sides'],
    ['0d6', 'zero dice'],
    ['101d6', 'more than 100 dice'],
    [`1d6+${MAX_DICE_MODIFIER + 1}`, 'modifier beyond bound'],
  ])('rejects %s (%s)', (notation) => {
    expect(parseDiceNotation(notation)).toBeNull()
  })

  it('accepts the exact bounds', () => {
    expect(parseDiceNotation('100d1000')).toEqual({ count: 100, sides: 1000, modifier: 0 })
    expect(parseDiceNotation('1d2')).toEqual({ count: 1, sides: 2, modifier: 0 })
  })
})

describe('scanDiceNotation', () => {
  it('finds notation embedded in prose', () => {
    expect(scanDiceNotation('I roll d6')).toEqual([
      { count: 1, sides: 6, modifier: 0, matchText: 'd6' },
    ])
  })

  it('finds several notations in order', () => {
    const found = scanDiceNotation('Roll 2d6 for damage and d20 for attack')
    expect(found.map((f) => f.matchText)).toEqual(['2d6', 'd20'])
  })

  it('carries a closed-up modifier', () => {
    expect(scanDiceNotation('deal 3d6+2 damage')).toEqual([
      { count: 3, sides: 6, modifier: 2, matchText: '3d6+2' },
    ])
  })

  it('does not treat a spaced-out number as a modifier', () => {
    // Guards the false-positive risk introduced by modifier support: prose like
    // "2d6 - 1 apple" must stay a plain 2d6, as it always has.
    const found = scanDiceNotation('Rolling 2d6 - 1 apple remains')
    expect(found).toEqual([{ count: 2, sides: 6, modifier: 0, matchText: '2d6' }])
  })

  it('skips out-of-bounds notation rather than clamping it', () => {
    expect(scanDiceNotation('a d1 and a 500d6 and a real 2d6')).toEqual([
      { count: 2, sides: 6, modifier: 0, matchText: '2d6' },
    ])
  })

  it('is not corrupted by a previous scan (global regex lastIndex)', () => {
    // The module-level regex carries lastIndex between calls; a missed reset
    // would make the second scan start mid-string and miss the match.
    scanDiceNotation('a very long lead-in with 2d6 near the end')
    expect(scanDiceNotation('d20')).toHaveLength(1)
  })

  it('returns nothing for prose without notation', () => {
    expect(scanDiceNotation('no dice here, just words')).toEqual([])
  })
})

describe('formatDiceNotation', () => {
  it.each([
    [{ count: 3, sides: 6, modifier: 0 }, '3d6'],
    [{ count: 3, sides: 6, modifier: 2 }, '3d6+2'],
    [{ count: 2, sides: 10, modifier: -1 }, '2d10-1'],
  ])('renders %j as %s', (notation, expected) => {
    expect(formatDiceNotation(notation)).toBe(expected)
  })

  it('round-trips through the parser', () => {
    for (const s of ['3d6', '3d6+2', '2d10-1', '1d20']) {
      const parsed = parseDiceNotation(s)!
      expect(formatDiceNotation(parsed)).toBe(
        // "d20" normalises to "1d20"; the rest are already canonical.
        s === '1d20' ? '1d20' : s
      )
    }
  })
})

describe('formatDiceBreakdown', () => {
  it('renders the spec\'s example shape', () => {
    const breakdown = formatDiceBreakdown({
      count: 3,
      sides: 6,
      modifier: 2,
      results: [4, 2, 6],
      subtotal: 12,
      total: 14,
    })
    expect(breakdown).toBe('3d6+2: [4, 2, 6] + 2 = 14')
  })

  it('omits the arithmetic tail when there is no modifier', () => {
    const breakdown = formatDiceBreakdown({
      count: 2,
      sides: 6,
      modifier: 0,
      results: [4, 2],
      subtotal: 6,
      total: 6,
    })
    expect(breakdown).toBe('2d6: [4, 2] = 6')
  })

  it('renders a negative modifier as subtraction', () => {
    const breakdown = formatDiceBreakdown({
      count: 2,
      sides: 10,
      modifier: -1,
      results: [7, 3],
      subtotal: 10,
      total: 9,
    })
    expect(breakdown).toBe('2d10-1: [7, 3] - 1 = 9')
  })
})

describe('rollNotation', () => {
  it('applies the modifier to the total, not to each die', () => {
    const result = rollNotation({ count: 3, sides: 6, modifier: 2 })
    expect(result.results).toHaveLength(3)
    expect(result.subtotal).toBe(result.results.reduce((a, b) => a + b, 0))
    expect(result.total).toBe(result.subtotal + 2)
  })

  it('keeps every die within [1, sides]', () => {
    for (let i = 0; i < 50; i++) {
      const { results } = rollNotation({ count: 5, sides: 6, modifier: 0 })
      for (const face of results) {
        expect(face).toBeGreaterThanOrEqual(1)
        expect(face).toBeLessThanOrEqual(6)
      }
    }
  })

  it('can produce a negative total when the modifier outweighs the dice', () => {
    const result = rollNotation({ count: 1, sides: 2, modifier: -10 })
    expect(result.total).toBeLessThan(0)
  })
})

// --- Parity with the roller as it behaved inside rng-handler ---------------

describe('rollDice (extracted from rng-handler)', () => {
  it('returns one result per die and a matching sum', () => {
    const { results, sum } = rollDice(6, 3)
    expect(results).toHaveLength(3)
    expect(sum).toBe(results.reduce((a, b) => a + b, 0))
  })

  it('stays within [1, sides] across many rolls', () => {
    const { results } = rollDice(20, 100)
    expect(Math.min(...results)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...results)).toBeLessThanOrEqual(20)
  })
})

describe('flipCoin (extracted from rng-handler)', () => {
  it('returns only heads or tails, one per flip', () => {
    const results = flipCoin(20)
    expect(results).toHaveLength(20)
    for (const r of results) {
      expect(['heads', 'tails']).toContain(r)
    }
  })
})

describe('secureRandomInt (extracted from rng-handler)', () => {
  it('returns values in [1, max]', () => {
    for (let i = 0; i < 200; i++) {
      const v = secureRandomInt(6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('returns 1 for a degenerate max, as it always has', () => {
    expect(secureRandomInt(0)).toBe(1)
    expect(secureRandomInt(-5)).toBe(1)
  })

  it('eventually covers the whole range (no stuck bits)', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(secureRandomInt(6))
    expect(seen.size).toBe(6)
  })
})
