/**
 * Custom tools — `$state` reference support: schema acceptance/rejection at
 * load time, and run-time resolution against merged persistent state through
 * roll fields, parameter defaults, comparator operands, and `{{state.path}}`
 * templates (plus the simulate threading).
 *
 * Every `$state` reference carries a required fallback, so no run can ever fail
 * on one — these tests pin that guarantee down at each entrance.
 */

import {
  executeCustomTool,
  resolveParams,
  renderTemplate,
  simulateOutcomes,
} from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema, type QtapCustomTool } from '@/lib/pascal/custom-tool.types'

function parse(doc: unknown) {
  return QtapCustomToolSchema.safeParse(doc)
}

function define(doc: unknown): QtapCustomTool {
  const result = parse(doc)
  if (!result.success) {
    throw new Error(`fixture invalid: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

const CATCH_ALL = { when: true as const, message: 'fallback', state: 'info' as const }

describe('$state schema — acceptance', () => {
  it('accepts a $state roll field with a numeric fallback', () => {
    expect(
      parse({
        name: 'draw',
        description: 'x',
        roll: { min: { $state: 'game.low', fallback: 0 }, max: { $state: 'game.high', fallback: 6 } },
        outcomes: [CATCH_ALL],
      }).success,
    ).toBe(true)
  })

  it('accepts a $state comparator operand and a $state parameter default', () => {
    expect(
      parse({
        name: 'draw',
        description: 'x',
        parameters: { threshold: { type: 'number', default: { $state: 'game.threshold', fallback: 5 } } },
        outcomes: [
          { when: { gte: { $state: 'game.difficulty', fallback: 3 } }, message: 'hard', state: 'success' },
          CATCH_ALL,
        ],
      }).success,
    ).toBe(true)
  })
})

describe('$state schema — rejection', () => {
  it('rejects a $state reference missing its fallback', () => {
    expect(
      parse({
        name: 'draw',
        description: 'x',
        roll: { min: { $state: 'game.low' } },
        outcomes: [CATCH_ALL],
      }).success,
    ).toBe(false)
  })

  it('rejects a $state roll field whose fallback is not a number', () => {
    expect(
      parse({
        name: 'draw',
        description: 'x',
        roll: { min: { $state: 'game.low', fallback: 'nope' } },
        outcomes: [CATCH_ALL],
      }).success,
    ).toBe(false)
  })

  it('rejects a $state parameter default whose fallback mismatches the declared type', () => {
    expect(
      parse({
        name: 'draw',
        description: 'x',
        parameters: { count: { type: 'integer', default: { $state: 'game.count', fallback: 'x' } } },
        outcomes: [CATCH_ALL],
      }).success,
    ).toBe(false)
  })
})

describe('$state resolution — parameter defaults', () => {
  const tool = define({
    name: 'draw',
    description: 'x',
    parameters: { bonus: { type: 'number', default: { $state: 'player.bonus', fallback: 1 } } },
    outcomes: [CATCH_ALL],
  })

  it('reads the value at the path when present and correctly typed', () => {
    expect(resolveParams(tool, {}, { player: { bonus: 7 } }).bonus).toBe(7)
  })

  it('falls back when the path is absent', () => {
    expect(resolveParams(tool, {}, {}).bonus).toBe(1)
  })

  it('falls back when the value at the path is the wrong type', () => {
    expect(resolveParams(tool, {}, { player: { bonus: 'huge' } }).bonus).toBe(1)
  })
})

describe('$state resolution — roll fields and operands', () => {
  it('a $state roll bound engages the value, falling back when absent', async () => {
    const tool = define({
      name: 'fixed',
      description: 'x',
      // min == max forces a deterministic draw equal to the bound.
      roll: { min: { $state: 'game.n', fallback: 2 }, max: { $state: 'game.n', fallback: 2 } },
      outcomes: [CATCH_ALL],
    })
    const present = await executeCustomTool(tool, {}, { state: { game: { n: 9 } } })
    expect(present.value).toBe(9)
    const absent = await executeCustomTool(tool, {}, { state: {} })
    expect(absent.value).toBe(2)
  })

  it('a $state operand decides which outcome wins', async () => {
    const tool = define({
      name: 'gate',
      description: 'x',
      roll: { min: 5, max: 5 }, // value is always 5
      outcomes: [
        { when: { gte: { $state: 'game.difficulty', fallback: 10 } }, message: 'passed', state: 'success' },
        CATCH_ALL,
      ],
    })
    // difficulty 3 → 5 >= 3 → passes
    const pass = await executeCustomTool(tool, {}, { state: { game: { difficulty: 3 } } })
    expect(pass.message).toBe('passed')
    // absent → fallback 10 → 5 >= 10 is false → catch-all
    const fail = await executeCustomTool(tool, {}, { state: {} })
    expect(fail.message).toBe('fallback')
  })
})

describe('{{state.path}} template rendering', () => {
  it('renders a primitive at the path and leaves the placeholder when absent/non-primitive', () => {
    const vars = { value: 1, roll: 1, dice: '', params: {}, state: { weather: 'foggy', crew: [1, 2] } }
    expect(renderTemplate('It is {{state.weather}}.', vars)).toBe('It is foggy.')
    expect(renderTemplate('Missing {{state.nope}}.', vars)).toBe('Missing {{state.nope}}.')
    expect(renderTemplate('List {{state.crew}}.', vars)).toBe('List {{state.crew}}.')
  })
})

describe('simulateOutcomes threading', () => {
  it('threads mock state into the audit so $state operands steer hit rates', () => {
    const tool = define({
      name: 'gate',
      description: 'x',
      roll: { min: 5, max: 5 },
      outcomes: [
        { when: { gte: { $state: 'game.difficulty', fallback: 10 } }, message: 'passed', state: 'success' },
        CATCH_ALL,
      ],
    })
    // With difficulty 1, every one of the fixed 5-draws clears it.
    const audit = simulateOutcomes(tool, {}, 50, {}, undefined, { game: { difficulty: 1 } })
    expect(audit.outcomes[0].hits).toBe(50)
    // Default {} → fallback 10 → none pass.
    const auditFallback = simulateOutcomes(tool, {}, 50, {})
    expect(auditFallback.outcomes[0].hits).toBe(0)
  })
})
