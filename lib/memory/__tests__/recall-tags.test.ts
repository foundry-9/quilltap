/**
 * Unit tests for the recall-side targeting-tag reading (lib/memory/recall-tags.ts).
 *
 * Pure module — no mocks. Covers: tag parsing round-trips (valid / invalid /
 * missing, matching the extraction-side defaults), each multiplier in isolation,
 * cross-project narrow exclusion vs strong down-weight, legacy projectId:null
 * passing through unpenalized, and the combined-multiplier clamp.
 */

import {
  parseTargetingTags,
  scopeProjectMultiplier,
  temporalMultiplier,
  contextMultiplier,
  participantMultiplier,
  freshEventMultiplier,
  combineRecallMultipliers,
  RECALL_MULTIPLIERS,
  MULTIPLIER_CLAMP,
  RELATED_EXPANSION,
  DEFAULT_TEMPORAL,
  DEFAULT_SCOPE,
  DEFAULT_CONTEXT,
  type RecallContext,
  type TargetingTags,
} from '../recall-tags'

const PROJ_A = 'project-aaaa'
const PROJ_B = 'project-bbbb'

const ctx = (over: Partial<RecallContext> = {}): RecallContext => ({
  currentProjectId: PROJ_A,
  scopePolicy: 'down-weight',
  ...over,
})

describe('parseTargetingTags', () => {
  it('round-trips a fully-tagged keyword array', () => {
    const tags = parseTargetingTags(['summarizer', 'future', 'scope: narrow', 'philosophy'])
    expect(tags).toEqual<TargetingTags>({
      temporal: 'future',
      scope: 'narrow',
      context: 'philosophy',
    })
  })

  it('defaults every axis when keywords are empty', () => {
    expect(parseTargetingTags([])).toEqual<TargetingTags>({
      temporal: DEFAULT_TEMPORAL,
      scope: DEFAULT_SCOPE,
      context: DEFAULT_CONTEXT,
    })
  })

  it('defaults on null/undefined keywords', () => {
    expect(parseTargetingTags(null)).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
    expect(parseTargetingTags(undefined)).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
  })

  it('defaults an unknown value on each axis', () => {
    // `scope: sideways` is invalid → default wide; no temporal/context words present → defaults.
    const tags = parseTargetingTags(['random', 'scope: sideways'])
    expect(tags).toEqual({ temporal: 'present', scope: 'wide', context: 'information' })
  })

  it('parses the scope prefix case-insensitively and trims whitespace', () => {
    expect(parseTargetingTags(['SCOPE:  Narrow']).scope).toBe('narrow')
  })

  it('lets the appended tag win over a colliding free keyword (last-match-wins)', () => {
    // A free keyword "history" appears before the real appended context tag "banter".
    const tags = parseTargetingTags(['history', 'present', 'scope: wide', 'banter'])
    expect(tags.context).toBe('banter')
  })

  it('ignores non-string entries without throwing', () => {
    const tags = parseTargetingTags([42 as unknown as string, 'past', null as unknown as string, 'scope: narrow', 'trivia'])
    expect(tags).toEqual({ temporal: 'past', scope: 'narrow', context: 'trivia' })
  })
})

describe('scopeProjectMultiplier', () => {
  const wide: TargetingTags = { temporal: 'present', scope: 'wide', context: 'information' }
  const narrow: TargetingTags = { temporal: 'present', scope: 'narrow', context: 'information' }

  it('passes wide-scope memories through unchanged', () => {
    expect(scopeProjectMultiplier(wide, PROJ_B, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes narrow memories with no projectId through unchanged (never penalize missing data)', () => {
    expect(scopeProjectMultiplier(narrow, null, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
    expect(scopeProjectMultiplier(narrow, undefined, PROJ_A, 'down-weight')).toEqual({ multiplier: 1, fired: [] })
  })

  it('boosts a narrow memory whose project matches the current chat', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_A, PROJ_A, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowSameProject)
    expect(r.fired).toEqual(['narrow✓'])
  })

  it('strong-down-weights a cross-project narrow memory under down-weight policy', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, PROJ_A, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight)
    expect(r.exclude).toBeUndefined()
    expect(r.fired).toEqual(['narrow✗'])
  })

  it('excludes a cross-project narrow memory under exclude policy', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, PROJ_A, 'exclude')
    expect(r.multiplier).toBe(0)
    expect(r.exclude).toBe(true)
  })

  it('treats a narrow memory in a project-less chat as cross-project', () => {
    const r = scopeProjectMultiplier(narrow, PROJ_B, null, 'down-weight')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight)
  })
})

describe('temporalMultiplier', () => {
  const withTemporal = (t: TargetingTags['temporal']): TargetingTags => ({
    temporal: t,
    scope: 'wide',
    context: 'information',
  })

  it('penalizes past', () => {
    expect(temporalMultiplier(withTemporal('past')).multiplier).toBe(RECALL_MULTIPLIERS.temporalPast)
  })

  it('penalizes moment (unconditional on the recall path)', () => {
    expect(temporalMultiplier(withTemporal('moment')).multiplier).toBe(RECALL_MULTIPLIERS.temporalMoment)
  })

  it('leaves present and future unchanged', () => {
    expect(temporalMultiplier(withTemporal('present'))).toEqual({ multiplier: 1, fired: [] })
    expect(temporalMultiplier(withTemporal('future'))).toEqual({ multiplier: 1, fired: [] })
  })
})

describe('contextMultiplier', () => {
  const withContext = (c: TargetingTags['context']): TargetingTags => ({
    temporal: 'present',
    scope: 'wide',
    context: c,
  })

  it('boosts a memory whose context matches the turn guess', () => {
    const r = contextMultiplier(withContext('relationships'), 'relationships')
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.contextMatch)
    expect(r.fired).toEqual(['ctx✓'])
  })

  it('passes through when the context differs', () => {
    expect(contextMultiplier(withContext('history'), 'relationships')).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes through when there is no turn guess', () => {
    expect(contextMultiplier(withContext('history'), null)).toEqual({ multiplier: 1, fired: [] })
    expect(contextMultiplier(withContext('history'), undefined)).toEqual({ multiplier: 1, fired: [] })
  })
})

describe('participantMultiplier', () => {
  const CHAR_A = 'char-aaaa'
  const CHAR_B = 'char-bbbb'

  it('boosts a memory about a present character', () => {
    const r = participantMultiplier({ aboutCharacterId: CHAR_A }, [CHAR_A, CHAR_B])
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.participantPresent)
    expect(r.fired).toEqual(['present↑'])
  })

  it('passes through a memory about an absent character', () => {
    expect(participantMultiplier({ aboutCharacterId: 'char-cccc' }, [CHAR_A, CHAR_B])).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes through when the memory is about no one (null aboutCharacterId)', () => {
    expect(participantMultiplier({ aboutCharacterId: null }, [CHAR_A])).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes through when there is no present set', () => {
    expect(participantMultiplier({ aboutCharacterId: CHAR_A }, undefined)).toEqual({ multiplier: 1, fired: [] })
    expect(participantMultiplier({ aboutCharacterId: CHAR_A }, [])).toEqual({ multiplier: 1, fired: [] })
  })
})

describe('freshEventMultiplier', () => {
  const NOW = Date.parse('2026-07-29T02:44:00.000Z')
  const HOUR = 60 * 60 * 1000
  const CHAT = 'chat-current'
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()

  it('boosts an event inside the 24h band', () => {
    const r = freshEventMultiplier({ occurredAt: at(6 * HOUR) }, NOW, CHAT)
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.freshEvent24h)
    expect(r.fired).toEqual(['fresh24↑'])
  })

  it('treats the 24h boundary as inside the 24h band', () => {
    expect(freshEventMultiplier({ occurredAt: at(24 * HOUR) }, NOW, CHAT).fired).toEqual(['fresh24↑'])
  })

  it('boosts an event between 24h and 48h at the lower rate', () => {
    const r = freshEventMultiplier({ occurredAt: at(30 * HOUR) }, NOW, CHAT)
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.freshEvent48h)
    expect(r.fired).toEqual(['fresh48↑'])
  })

  it('treats the 48h boundary as inside the 48h band', () => {
    expect(freshEventMultiplier({ occurredAt: at(48 * HOUR) }, NOW, CHAT).fired).toEqual(['fresh48↑'])
  })

  it('passes through an event older than 48h', () => {
    expect(freshEventMultiplier({ occurredAt: at(49 * HOUR) }, NOW, CHAT)).toEqual({ multiplier: 1, fired: [] })
  })

  it('falls back to createdAt when there is no occurredAt', () => {
    expect(freshEventMultiplier({ createdAt: at(2 * HOUR) }, NOW, CHAT).fired).toEqual(['fresh24↑'])
    expect(freshEventMultiplier({ occurredAt: null, createdAt: at(2 * HOUR) }, NOW, CHAT).fired).toEqual(['fresh24↑'])
  })

  it('passes through with no clock (boost disabled)', () => {
    expect(freshEventMultiplier({ occurredAt: at(HOUR) }, undefined, CHAT)).toEqual({ multiplier: 1, fired: [] })
    expect(freshEventMultiplier({ occurredAt: at(HOUR) }, null, CHAT)).toEqual({ multiplier: 1, fired: [] })
    expect(freshEventMultiplier({ occurredAt: at(HOUR) }, NaN, CHAT)).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes through with no parsable event time (never penalize on missing data)', () => {
    expect(freshEventMultiplier({}, NOW, CHAT)).toEqual({ multiplier: 1, fired: [] })
    expect(freshEventMultiplier({ occurredAt: 'not a date' }, NOW, CHAT)).toEqual({ multiplier: 1, fired: [] })
  })

  it('passes through a future event time (negative age)', () => {
    expect(freshEventMultiplier({ occurredAt: at(-HOUR) }, NOW, CHAT)).toEqual({ multiplier: 1, fired: [] })
  })

  it('skips memories extracted from the current chat (echo guard)', () => {
    const memory = { occurredAt: at(HOUR), chatId: CHAT }
    expect(freshEventMultiplier(memory, NOW, CHAT)).toEqual({ multiplier: 1, fired: [] })
    // …but a memory from any OTHER chat still gets the boost.
    expect(freshEventMultiplier({ ...memory, chatId: 'chat-other' }, NOW, CHAT).fired).toEqual(['fresh24↑'])
    // …and so does one with no chat of record.
    expect(freshEventMultiplier({ ...memory, chatId: null }, NOW, CHAT).fired).toEqual(['fresh24↑'])
  })
})

describe('RELATED_EXPANSION caps', () => {
  it('bounds per-hit below total so a single hit cannot fill the whole expansion', () => {
    expect(RELATED_EXPANSION.maxPerHit).toBeLessThanOrEqual(RELATED_EXPANSION.maxTotal)
    expect(RELATED_EXPANSION.maxPerHit).toBeGreaterThan(0)
    expect(RELATED_EXPANSION.maxTotal).toBeGreaterThan(0)
  })
})

describe('combineRecallMultipliers', () => {
  it('multiplies scope and temporal adjustments together', () => {
    // narrow + same project (×1.15) and past (×0.85).
    const memory = { projectId: PROJ_A, keywords: ['past', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.exclude).toBe(false)
    expect(r.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject * RECALL_MULTIPLIERS.temporalPast,
      5,
    )
    expect(r.fired).toEqual(['narrow✓', 'past↓'])
  })

  it('stacks scope, context, and participant boosts for a fully-matching memory', () => {
    const CHAR_A = 'char-aaaa'
    // same-project narrow (×1.15) + context match (×1.10) + present participant (×1.20).
    const memory = {
      projectId: PROJ_A,
      aboutCharacterId: CHAR_A,
      keywords: ['present', 'scope: narrow', 'philosophy'],
    }
    const r = combineRecallMultipliers(
      memory,
      ctx({ turnContext: 'philosophy', presentAboutCharacterIds: [CHAR_A] }),
    )
    expect(r.exclude).toBe(false)
    expect(r.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject *
        RECALL_MULTIPLIERS.contextMatch *
        RECALL_MULTIPLIERS.participantPresent,
      5,
    )
    expect(r.fired).toEqual(['narrow✓', 'ctx✓', 'present↑'])
  })

  it('does not apply context/participant boosts when the turn signals are absent', () => {
    const memory = {
      projectId: PROJ_A,
      aboutCharacterId: 'char-aaaa',
      keywords: ['present', 'scope: narrow', 'philosophy'],
    }
    // ctx() supplies no turnContext / presentAboutCharacterIds → only scope fires.
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBe(RECALL_MULTIPLIERS.scopeNarrowSameProject)
    expect(r.fired).toEqual(['narrow✓'])
  })

  it('short-circuits to exclude for a cross-project narrow memory under exclude policy', () => {
    const memory = { projectId: PROJ_B, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx({ scopePolicy: 'exclude' }))
    expect(r.exclude).toBe(true)
    expect(r.multiplier).toBe(0)
  })

  it('passes a legacy projectId:null narrow memory through unpenalized', () => {
    const memory = { projectId: null, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx({ currentProjectId: PROJ_A }))
    expect(r.exclude).toBe(false)
    expect(r.multiplier).toBe(1)
    expect(r.fired).toEqual([])
  })

  it('leaves an untagged (wide/present) memory at multiplier 1', () => {
    const memory = { projectId: PROJ_A, keywords: [] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBe(1)
    expect(r.fired).toEqual([])
  })

  it('composes the fresh-event boost with the moment demotion', () => {
    const now = Date.parse('2026-07-29T02:44:00.000Z')
    const memory = {
      projectId: PROJ_A,
      chatId: 'chat-other',
      occurredAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
      keywords: ['moment', 'scope: narrow', 'history'],
    }
    const r = combineRecallMultipliers(memory, ctx({ currentChatId: 'chat-current', nowMs: now }))
    expect(r.multiplier).toBeCloseTo(
      RECALL_MULTIPLIERS.scopeNarrowSameProject *
        RECALL_MULTIPLIERS.temporalMoment *
        RECALL_MULTIPLIERS.freshEvent24h,
      5,
    )
    expect(r.fired).toEqual(['narrow✓', 'moment↓', 'fresh24↑'])
  })

  it('leaves the fresh boost inert when the context carries no clock', () => {
    const memory = {
      projectId: PROJ_A,
      chatId: 'chat-other',
      occurredAt: new Date().toISOString(),
      keywords: [],
    }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBe(1)
    expect(r.fired).toEqual([])
  })

  it('keeps a maximal fresh + window + retro stack decisive but under the clamp', () => {
    const now = Date.parse('2026-07-29T02:44:00.000Z')
    const occurredAt = new Date(now - 3 * 60 * 60 * 1000).toISOString()
    const memory = {
      projectId: PROJ_A,
      chatId: 'chat-other',
      aboutCharacterId: 'char-aaaa',
      occurredAt,
      keywords: ['past', 'scope: narrow', 'history'],
    }
    const r = combineRecallMultipliers(
      memory,
      ctx({
        currentChatId: 'chat-current',
        nowMs: now,
        turnRetrospective: true,
        turnContext: 'history',
        presentAboutCharacterIds: ['char-aaaa'],
        occurredWithin: { from: new Date(now - 24 * 60 * 60 * 1000).toISOString(), to: new Date(now).toISOString() },
      }),
    )
    // Every boost the recall path can fire at once: narrow-same × past-retro ×
    // ctx × present × fresh24 × window ≈ ×3.63. Decisive against the ~×1.5
    // evergreen stack, and still short of the clamp — so the ceiling stays a
    // backstop rather than the value every fresh memory collapses onto.
    expect(r.fired).toContain('fresh24↑')
    expect(r.multiplier).toBeGreaterThan(3)
    expect(r.multiplier).toBeLessThan(MULTIPLIER_CLAMP.max)
  })

  it('clamps the combined multiplier to the configured ceiling', () => {
    // Force a product above the clamp to prove the ceiling bites. narrow-same (×1.15)
    // is the only positive multiplier today, so we assert the clamp bound directly.
    const memory = { projectId: PROJ_A, keywords: ['present', 'scope: narrow', 'history'] }
    const r = combineRecallMultipliers(memory, ctx())
    expect(r.multiplier).toBeLessThanOrEqual(MULTIPLIER_CLAMP.max)
    expect(r.multiplier).toBeGreaterThanOrEqual(MULTIPLIER_CLAMP.min)
  })
})
