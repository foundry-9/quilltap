/**
 * Episodic recall — retrospective turn handling in the recall-tag multiplier
 * loop, plus the §3 inert-path regression guard: absent the new signals, every
 * adjustment must be byte-identical to the pre-overhaul behavior.
 */

import {
  buildRetrospectiveProbes,
  buildTurnRecallContext,
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

describe('buildRetrospectiveProbes (shared multi-probe assembly)', () => {
  const signals = {
    entities: ['Lighthouse', 'Point'],
    paraphrase: 'what happened at the lighthouse',
    timeRange: { from: '2026-07-13T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
  }

  it('emits the entity probe and the date-pinned paraphrase on a retrospective turn', () => {
    expect(buildRetrospectiveProbes(signals, true)).toEqual([
      'Lighthouse Point',
      'what happened at the lighthouse (around 2026-07-13 to 2026-07-20)',
    ])
  })

  it('returns undefined (never []) when the turn is not retrospective or has no signals', () => {
    expect(buildRetrospectiveProbes(signals, false)).toBeUndefined()
    expect(buildRetrospectiveProbes(null, true)).toBeUndefined()
    expect(buildRetrospectiveProbes(undefined, true)).toBeUndefined()
  })

  it('returns undefined when the signals offer nothing to probe', () => {
    expect(buildRetrospectiveProbes({ entities: [' '], paraphrase: 'x', timeRange: null }, true)).toBeUndefined()
    expect(buildRetrospectiveProbes({}, true)).toBeUndefined()
  })

  it('skips the paraphrase probe without a resolved window, and the entity probe without entities', () => {
    expect(buildRetrospectiveProbes({ entities: ['Harbor'], paraphrase: 'x', timeRange: null }, true)).toEqual(['Harbor'])
    expect(buildRetrospectiveProbes({ paraphrase: 'x', timeRange: signals.timeRange }, true)).toEqual([
      'x (around 2026-07-13 to 2026-07-20)',
    ])
  })
})

describe('buildTurnRecallContext (shared per-turn context assembly)', () => {
  const chat = {
    id: 'chat-1',
    projectId: 'proj-1',
    commonplaceRecallHistory: { turns: [['mem-a', 'mem-b'], ['mem-c']] },
  }
  const recallSettings = { scopePolicy: 'exclude' as const, expandRelated: true }

  it('threads every field through, including the whispered-id set and the echo guard', () => {
    const ctx = buildTurnRecallContext({
      chat,
      recallSettings,
      turnContext: 'history',
      turnTemporal: 'past',
      turnRetrospective: true,
      presentAboutCharacterIds: ['char-1', 'char-2'],
      nowMs: 1_700_000_000_000,
    })
    expect(ctx).toEqual({
      currentProjectId: 'proj-1',
      scopePolicy: 'exclude',
      turnContext: 'history',
      turnTemporal: 'past',
      turnRetrospective: true,
      presentAboutCharacterIds: ['char-1', 'char-2'],
      expandRelated: true,
      recentlyWhisperedIds: new Set(['mem-a', 'mem-b', 'mem-c']),
      currentChatId: 'chat-1',
      nowMs: 1_700_000_000_000,
    })
  })

  it('leaves the retrospective flag off entirely when omitted (the replay\'s inert old path)', () => {
    const ctx = buildTurnRecallContext({
      chat: { id: 'chat-1' },
      recallSettings,
      turnContext: null,
      turnTemporal: null,
      nowMs: 0,
    })
    expect(ctx).not.toHaveProperty('turnRetrospective')
    expect(ctx.currentProjectId).toBeNull()
    expect(ctx.recentlyWhisperedIds?.size).toBe(0)
  })
})
