/**
 * Episodic gate date guard: same activity, different occasion must yield two
 * rows (§3 acceptance: "Two visits to the same place, months apart → both rows
 * exist"). `occasionsAreDistinct` is the pure core; the runMemoryGate
 * integration is asserted through the decision it produces.
 */

import { occasionsAreDistinct, DATE_GUARD_DAYS } from '../memory-gate'
import { appendRecallTurn, appendRetroSignature, parseRetroSignatures } from '../recall-history'

describe('occasionsAreDistinct', () => {
  it('is true when occurredAt differ by more than the guard window', () => {
    expect(
      occasionsAreDistinct('2026-03-10T00:00:00.000Z', '2026-07-14T00:00:00.000Z'),
    ).toBe(true)
  })

  it('is false within the guard window (same occasion retold days later)', () => {
    expect(
      occasionsAreDistinct('2026-07-14T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
    ).toBe(false)
  })

  it(`treats exactly ${DATE_GUARD_DAYS} days as the same occasion (strictly-greater guard)`, () => {
    const a = '2026-07-07T00:00:00.000Z'
    const b = `2026-07-${7 + DATE_GUARD_DAYS}T00:00:00.000Z`
    expect(occasionsAreDistinct(a, b)).toBe(false)
  })

  it('never fires when either side lacks an event time', () => {
    expect(occasionsAreDistinct(null, '2026-07-14T00:00:00.000Z')).toBe(false)
    expect(occasionsAreDistinct('2026-07-14T00:00:00.000Z', undefined)).toBe(false)
    expect(occasionsAreDistinct('garbage', '2026-07-14T00:00:00.000Z')).toBe(false)
  })
})

describe('retro-signature spam guard (recall-history)', () => {
  it('round-trips signatures through the ring buffer, capped', () => {
    let history = appendRecallTurn(null, ['m1'])
    history = appendRetroSignature(history, 'sig-a')
    history = appendRetroSignature(history, 'sig-b')
    history = appendRetroSignature(history, 'sig-c')
    history = appendRetroSignature(history, 'sig-d')
    expect(history.retroSignatures).toEqual(['sig-b', 'sig-c', 'sig-d'])
    // Persist → re-read (the JSON column round trip).
    expect(parseRetroSignatures(JSON.parse(JSON.stringify(history)))).toEqual([
      'sig-b',
      'sig-c',
      'sig-d',
    ])
  })

  it('carries signatures forward through appendRecallTurn', () => {
    let history = appendRetroSignature(appendRecallTurn(null, ['m1']), 'sig-a')
    history = appendRecallTurn(history, ['m2'])
    expect(history.retroSignatures).toEqual(['sig-a'])
    expect(history.turns).toEqual([['m1'], ['m2']])
  })

  it('parses garbage to an empty list', () => {
    expect(parseRetroSignatures(null)).toEqual([])
    expect(parseRetroSignatures({ retroSignatures: 'nope' })).toEqual([])
    expect(parseRetroSignatures({ retroSignatures: [1, '', 'ok'] })).toEqual(['ok'])
  })
})
