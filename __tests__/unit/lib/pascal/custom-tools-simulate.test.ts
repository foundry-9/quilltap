/**
 * Custom tools — the Workbench audit simulator.
 *
 * The audit's whole job is honest hit counts, so these tests pin the
 * distribution behaviour: a certain row hits 100%, a metadata-gated row hits
 * 0% under an empty fact sheet and its full share once the key is supplied,
 * and the value statistics describe what was actually drawn.
 */

import { simulateOutcomes, CustomToolRunError } from '@/lib/pascal/custom-tools'
import type { QtapCustomTool } from '@/lib/pascal/custom-tool.types'

/** A definition with a fixed-point roll, so every draw is the same number. */
function fixedRollTool(overrides: Partial<QtapCustomTool> = {}): QtapCustomTool {
  return {
    name: 'fixed',
    description: 'Always rolls exactly 2.',
    roll: { min: 2, max: 2 },
    outcomes: [
      { when: { gte: 2 }, message: 'hit', state: 'success' },
      { when: true, message: 'miss', state: 'failure' },
    ],
    ...overrides,
  } as QtapCustomTool
}

describe('simulateOutcomes', () => {
  it('gives a certain row 100% of the hits', () => {
    const result = simulateOutcomes(fixedRollTool(), undefined, 500)

    expect(result.runs).toBe(500)
    expect(result.outcomes).toEqual([
      { index: 0, hits: 500, share: 1 },
      { index: 1, hits: 0, share: 0 },
    ])
  })

  it('reports value statistics for what was drawn', () => {
    const result = simulateOutcomes(fixedRollTool(), undefined, 100)

    expect(result.valueMin).toBe(2)
    expect(result.valueMax).toBe(2)
    expect(result.valueMean).toBe(2)
  })

  it('hits a certain dice row 100% of the time', () => {
    const definition = fixedRollTool({
      name: 'dicey',
      // 1d2+1 totals 2 or 3 — gte 2 always holds.
      roll: '1d2+1',
    })

    const result = simulateOutcomes(definition, undefined, 300)

    expect(result.outcomes[0]).toEqual({ index: 0, hits: 300, share: 1 })
    expect(result.valueMin).toBeGreaterThanOrEqual(2)
    expect(result.valueMax).toBeLessThanOrEqual(3)
  })

  it('spreads hits across a genuine band roughly by width', () => {
    const definition = fixedRollTool({
      name: 'banded',
      roll: {},
      outcomes: [
        { when: { lt: 0.5 }, message: 'low', state: 'failure' },
        { when: true, message: 'high', state: 'success' },
      ],
    })

    const result = simulateOutcomes(definition, undefined, 10_000)

    // A fair coin at N=10,000 stays within ±5 points of 50% with overwhelming
    // probability; a band failure lands far outside this.
    expect(result.outcomes[0].share).toBeGreaterThan(0.45)
    expect(result.outcomes[0].share).toBeLessThan(0.55)
    expect(result.outcomes[0].hits + result.outcomes[1].hits).toBe(10_000)
  })

  it('gives a metadata-gated row 0% under an empty fact sheet', () => {
    const definition = fixedRollTool({
      name: 'gated',
      outcomes: [
        { when: { metadata: { hasKey: { eq: true } } }, message: 'in', state: 'success' },
        { when: true, message: 'out', state: 'failure' },
      ],
    })

    const dry = simulateOutcomes(definition, undefined, 200)
    expect(dry.outcomes[0]).toEqual({ index: 0, hits: 0, share: 0 })
    expect(dry.outcomes[1].hits).toBe(200)
  })

  it('gives a metadata-gated row its full share once the key is supplied', () => {
    const definition = fixedRollTool({
      name: 'gated',
      outcomes: [
        { when: { metadata: { hasKey: { eq: true } } }, message: 'in', state: 'success' },
        { when: true, message: 'out', state: 'failure' },
      ],
    })

    const supplied = simulateOutcomes(definition, undefined, 200, { hasKey: true })
    expect(supplied.outcomes[0]).toEqual({ index: 0, hits: 200, share: 1 })
  })

  it('resolves $param roll bounds from supplied parameters', () => {
    const definition = fixedRollTool({
      name: 'parameterized',
      parameters: {
        floor: { type: 'number', default: 5 },
      },
      roll: { min: { $param: 'floor' }, max: { $param: 'floor' } },
      outcomes: [
        { when: { gte: 9 }, message: 'high', state: 'success' },
        { when: true, message: 'low', state: 'failure' },
      ],
    })

    const atDefault = simulateOutcomes(definition, undefined, 50)
    expect(atDefault.outcomes[0].hits).toBe(0)

    const raised = simulateOutcomes(definition, { floor: 9 }, 50)
    expect(raised.outcomes[0].hits).toBe(50)
  })

  it('refuses an inverted range rather than inventing numbers', () => {
    const definition = fixedRollTool({
      name: 'inverted',
      parameters: { top: { type: 'number', default: -1 } },
      roll: { min: 2, max: { $param: 'top' } },
    })

    expect(() => simulateOutcomes(definition, undefined, 10)).toThrow(CustomToolRunError)
  })
})

describe('simulateOutcomes — the fixed consult', () => {
  /** An oracle-gated table: the answer decides everything. */
  const gated = fixedRollTool({
    name: 'augured',
    llm: { prompt: 'YES or NO?', errorMessage: 'No answer.' },
    outcomes: [
      { when: { llm: { ok: false } }, message: 'silence', state: 'failure' },
      { when: { llm: { eq: 'YES' } }, message: 'assent', state: 'success' },
      { when: true, message: 'demurral', state: 'info' },
    ],
  })

  it('gives an answer-gated row every hit when the scripted answer matches', () => {
    const result = simulateOutcomes(gated, undefined, 200, undefined, { ok: true, output: 'YES' })
    expect(result.outcomes[1]).toEqual({ index: 1, hits: 200, share: 1 })
  })

  it('routes every hit to the silence row under a scripted failure', () => {
    const result = simulateOutcomes(gated, undefined, 200, undefined, { ok: false, output: 'No answer.' })
    expect(result.outcomes[0]).toEqual({ index: 0, hits: 200, share: 1 })
  })

  it('routes to the catch-all when no consult is supplied at all', () => {
    // Every llm test declines fail-soft, like a metadata key nobody carries.
    const result = simulateOutcomes(gated, undefined, 200)
    expect(result.outcomes[2]).toEqual({ index: 2, hits: 200, share: 1 })
  })
})
