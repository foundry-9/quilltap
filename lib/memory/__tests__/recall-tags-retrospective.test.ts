/**
 * Episodic recall — retrospective turn handling in the recall-tag multiplier
 * loop, plus the §3 inert-path regression guard: absent the new signals, every
 * adjustment must be byte-identical to the pre-overhaul behavior.
 */

import {
  combineRecallMultipliers,
  temporalMultiplier,
  recentlyWhisperedMultiplier,
  occurredWithinMultiplier,
  parseTargetingTags,
  RECALL_MULTIPLIERS,
  type RecallContext,
} from '../recall-tags'

const baseCtx: RecallContext = {
  currentProjectId: null,
  scopePolicy: 'down-weight',
}

const pastMemory = {
  id: 'mem-1',
  projectId: null,
  keywords: ['harbor', 'past', 'scope: wide', 'history'],
  aboutCharacterId: null,
  occurredAt: '2026-07-14T00:00:00.000Z',
  createdAt: '2026-07-14T01:00:00.000Z',
}

describe('retrospective temporal flip', () => {
  const tags = parseTargetingTags(pastMemory.keywords)

  it('penalizes past memories on ordinary turns (historical behavior)', () => {
    const result = temporalMultiplier(tags)
    expect(result.multiplier).toBe(RECALL_MULTIPLIERS.temporalPast)
    expect(result.fired).toEqual(['past↓'])
  })

  it('boosts past memories on retrospective turns', () => {
    const result = temporalMultiplier(tags, true)
    expect(result.multiplier).toBe(RECALL_MULTIPLIERS.temporalPastRetrospective)
    expect(result.fired).toEqual(['past↑retro'])
  })

  it('stops penalizing moment memories on retrospective turns', () => {
    const momentTags = parseTargetingTags(['moment', 'scope: wide', 'information'])
    expect(temporalMultiplier(momentTags).multiplier).toBe(RECALL_MULTIPLIERS.temporalMoment)
    expect(temporalMultiplier(momentTags, true).multiplier).toBe(
      RECALL_MULTIPLIERS.temporalMomentRetrospective,
    )
  })
})

describe('anti-repetition suspension (the re-ask case)', () => {
  const whispered = new Set(['mem-1'])

  it('penalizes a recently whispered memory on ordinary turns', () => {
    const result = recentlyWhisperedMultiplier(pastMemory, whispered)
    expect(result.multiplier).toBe(RECALL_MULTIPLIERS.recentlyWhispered)
  })

  it('suspends the penalty on retrospective turns — an immediate re-ask must not bury the memory', () => {
    const result = recentlyWhisperedMultiplier(pastMemory, whispered, true)
    expect(result.multiplier).toBe(1)
    expect(result.fired).toEqual([])
  })
})

describe('occurredWithin window boost', () => {
  const window = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' }

  it('boosts a memory whose event time falls inside the window', () => {
    const result = occurredWithinMultiplier(pastMemory, window)
    expect(result.multiplier).toBe(RECALL_MULTIPLIERS.occurredWithinWindow)
    expect(result.fired).toEqual(['window↑'])
  })

  it('falls back to createdAt when occurredAt is absent', () => {
    const noEventTime = { ...pastMemory, occurredAt: null }
    expect(occurredWithinMultiplier(noEventTime, window).multiplier).toBe(
      RECALL_MULTIPLIERS.occurredWithinWindow,
    )
  })

  it('passes through outside the window or with no window', () => {
    const outside = { ...pastMemory, occurredAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
    expect(occurredWithinMultiplier(outside, window).multiplier).toBe(1)
    expect(occurredWithinMultiplier(pastMemory, null).multiplier).toBe(1)
    expect(occurredWithinMultiplier(pastMemory, undefined).multiplier).toBe(1)
  })
})

describe('combineRecallMultipliers with retrospective context', () => {
  it('applies flip + suspension + window in the one clamped loop', () => {
    const ctx: RecallContext = {
      ...baseCtx,
      turnRetrospective: true,
      recentlyWhisperedIds: new Set(['mem-1']),
      occurredWithin: { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' },
    }
    const result = combineRecallMultipliers(pastMemory, ctx)
    // past↑retro (1.15) × window↑ (1.3); repeat↓ suspended.
    expect(result.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.temporalPastRetrospective * RECALL_MULTIPLIERS.occurredWithinWindow,
      10,
    )
    expect(result.fired).toContain('past↑retro')
    expect(result.fired).toContain('window↑')
    expect(result.fired).not.toContain('repeat↓')
  })

  it('INERT-PATH REGRESSION GUARD: a context without the new signals behaves exactly as before', () => {
    const ctx: RecallContext = {
      ...baseCtx,
      recentlyWhisperedIds: new Set(['mem-1']),
    }
    const result = combineRecallMultipliers(pastMemory, ctx)
    // Historical: past↓ (0.85) × repeat↓ (0.6); no window term.
    expect(result.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.temporalPast * RECALL_MULTIPLIERS.recentlyWhispered,
      10,
    )
    expect(result.fired).toEqual(['past↓', 'repeat↓'])
  })
})
