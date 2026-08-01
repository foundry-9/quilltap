/**
 * Custom tools — the execution core's side of chip labels and effects:
 * `chipLabel` rendered once after outcome selection, `matchesEffectWhen`
 * adding the winning-outcome subject to the shared comparator chain, and
 * effects resolved pure (fail-soft on every run-time miss) onto
 * `CustomToolRunResult` without a single write.
 */

import {
  executeCustomTool,
  matchesEffectWhen,
  isApplicableEffect,
  type DiscoveredCustomTool,
  type EffectSubjects,
  type ResolvedEffect,
} from '@/lib/pascal/custom-tools'
import { buildRunCustomDescription } from '@/lib/tools/run-custom-tool'
import { QtapCustomToolSchema, type QtapCustomTool, type EffectWhen } from '@/lib/pascal/custom-tool.types'

/** Parse through the real schema so tests can never drift from what loads. */
function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) {
    throw new Error(`fixture is not a valid definition: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

const CATCH_ALL = { when: true as const, message: 'fallback', state: 'info' as const }

/** A fixed roll so outcomes and effects are deterministic. */
const FIXED_ROLL = { min: 5, max: 5 }

function subjects(overrides: Partial<EffectSubjects> = {}): EffectSubjects {
  return {
    value: 5,
    roll: 5,
    params: {},
    metadata: {},
    state: {},
    dice: '',
    outcome: { state: 'success', index: 0 },
    ...overrides,
  }
}

/** The applicable resolutions, keyed by raw target — asserting shape and value at once. */
function applied(effects: ResolvedEffect[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const effect of effects ?? []) {
    if (isApplicableEffect(effect)) out[effect.target.raw] = effect.value
  }
  return out
}

describe('chipLabel rendering', () => {
  it('renders the chip label with the same subjects as the message', async () => {
    const tool = define({
      name: 'agent_lambda',
      description: 'Dispatch.',
      chipLabel: 'Agent lambda — {{params.label}} ({{value}})',
      parameters: { label: { type: 'string', default: 'nobody' } },
      roll: FIXED_ROLL,
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, { label: 'Jackie' })
    expect(result.chipLabel).toBe('Agent lambda — Jackie (5)')
  })

  it('is absent when the definition declares none', async () => {
    const tool = define({ name: 'plain', description: 'x', roll: FIXED_ROLL, outcomes: [CATCH_ALL] })
    const result = await executeCustomTool(tool, null)
    expect(result.chipLabel).toBeUndefined()
  })

  it('leaves an unknown placeholder verbatim — the renderTemplate doctrine', async () => {
    const tool = define({
      name: 'odd',
      description: 'x',
      chipLabel: 'Run {{mystery}}',
      roll: FIXED_ROLL,
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, null)
    expect(result.chipLabel).toBe('Run {{mystery}}')
  })
})

describe('matchesEffectWhen', () => {
  it('matches everything when the condition is omitted', () => {
    expect(matchesEffectWhen(undefined, subjects())).toBe(true)
  })

  it('tests the winning outcome state with eq and neq', () => {
    expect(matchesEffectWhen({ outcome: { eq: 'success' } } as EffectWhen, subjects())).toBe(true)
    expect(matchesEffectWhen({ outcome: { eq: 'failure' } } as EffectWhen, subjects())).toBe(false)
    expect(matchesEffectWhen({ outcome: { neq: 'failure' } } as EffectWhen, subjects())).toBe(true)
    expect(matchesEffectWhen({ outcome: { neq: 'success' } } as EffectWhen, subjects())).toBe(false)
  })

  it('ANDs the outcome subject with the shared comparator chain', () => {
    const when = { gte: 4, outcome: { eq: 'success' } } as EffectWhen
    expect(matchesEffectWhen(when, subjects())).toBe(true)
    expect(matchesEffectWhen(when, subjects({ value: 3 }))).toBe(false)
  })

  it('still takes the shared subjects — metadata included, fail-soft', () => {
    const when = { metadata: { hasKey: { eq: true } } } as EffectWhen
    expect(matchesEffectWhen(when, subjects({ metadata: { hasKey: true } }))).toBe(true)
    expect(matchesEffectWhen(when, subjects())).toBe(false)
  })
})

describe('effects resolution in executeCustomTool', () => {
  it('resolves literals and expressions, and reads the run subjects', async () => {
    const tool = define({
      name: 'tally',
      description: 'x',
      parameters: { by: { type: 'number', default: 2 } },
      roll: FIXED_ROLL,
      effects: [
        { target: 'state.encounter.count', value: '{{state.encounter.count}} + {{params.by}}' },
        { target: 'metadata.lastRoll', value: '{{value}}' },
        { target: 'metadata.lockBroken', value: true },
        { target: 'metadata.note', value: "'rolled ' + {{value}}" },
      ],
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, null, { state: { encounter: { count: 1 } } })
    expect(applied(result.effects)).toEqual({
      'state.encounter.count': 3,
      'metadata.lastRoll': 5,
      'metadata.lockBroken': true,
      'metadata.note': 'rolled 5',
    })
  })

  it('fires only the effects whose outcome condition matches the winning row', async () => {
    const tool = define({
      name: 'gate',
      description: 'x',
      roll: FIXED_ROLL,
      effects: [
        { when: { outcome: { eq: 'success' } }, target: 'state.wins', value: 1 },
        { when: { outcome: { eq: 'failure' } }, target: 'state.losses', value: 1 },
      ],
      outcomes: [
        { when: { gte: 5 }, message: 'won', state: 'success' },
        CATCH_ALL,
      ],
    })
    const result = await executeCustomTool(tool, null)
    expect(result.effects).toHaveLength(2)
    expect(applied(result.effects)).toEqual({ 'state.wins': 1 })
    expect(result.effects?.[1]).toEqual({ index: 1, skipped: 'condition did not hold' })
  })

  it('skips fail-soft on an expression that does not evaluate, without sinking the roll', async () => {
    const tool = define({
      name: 'fragile',
      description: 'x',
      roll: FIXED_ROLL,
      effects: [
        { target: 'state.broken', value: '{{metadata.absent}} + 1' },
        { target: 'state.zero', value: '1 / 0' },
        { target: 'state.fine', value: 7 },
      ],
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, null)
    expect(result.state).toBe('info')
    expect(applied(result.effects)).toEqual({ 'state.fine': 7 })
    const skips = (result.effects ?? []).filter((e) => !isApplicableEffect(e))
    expect(skips).toHaveLength(2)
  })

  it('never numerically coerces {{llm}} — the expression skips instead', async () => {
    const tool = define({
      name: 'oracle',
      description: 'x',
      roll: FIXED_ROLL,
      llm: { prompt: 'Say a number.', errorMessage: 'Silence.' },
      effects: [
        { target: 'state.coerced', value: '{{llm}} * 2' },
        { target: 'state.quoted', value: "'said ' + {{llm}}" },
      ],
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, null, {
      llmInvoke: async () => ({ ok: true, output: '21' }),
    })
    expect(applied(result.effects)).toEqual({ 'state.quoted': 'said 21' })
  })

  it('is absent when the definition declares no effects', async () => {
    const tool = define({ name: 'plain', description: 'x', roll: FIXED_ROLL, outcomes: [CATCH_ALL] })
    const result = await executeCustomTool(tool, null)
    expect(result.effects).toBeUndefined()
  })
})

describe('the roster description and effects', () => {
  function entry(definition: QtapCustomTool): DiscoveredCustomTool {
    return { definition, tier: 'global', mountPointId: 'm1', mountName: 'General', definitionPath: 'Tools/x.tool.json' }
  }

  const WITH_EFFECTS = {
    name: 'unlock',
    description: 'Pick the lock.',
    effects: [
      { when: { outcome: { eq: 'failure' } }, target: 'state.encounter.count', value: 1 },
      { target: 'metadata.ansibleTool', value: "'worn'" },
    ],
    outcomes: [CATCH_ALL],
  }

  it('lists effect targets only — vocabulary, never values or conditions', () => {
    const text = buildRunCustomDescription([entry(define(WITH_EFFECTS))])
    // The whole line is targets and nothing else — no values, no conditions.
    expect(text).toMatch(/^\s*Side effects: writes state\.encounter\.count, metadata\.ansibleTool$/m)
    expect(text).not.toContain("'worn'")
  })

  it('hides the side-effects line entirely under revealOdds: false', () => {
    const text = buildRunCustomDescription([entry(define({ ...WITH_EFFECTS, revealOdds: false }))])
    expect(text).not.toContain('Side effects')
    // The preamble sentence — the one thing every roster says about effects —
    // is still there.
    expect(text).toContain('Some tools record side effects')
  })
})
