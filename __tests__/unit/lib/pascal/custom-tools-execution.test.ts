/**
 * Custom tools — the execution core: parameter resolution, the transform
 * pipeline, outcome evaluation, and templating.
 *
 * These are the paths where a silent defect would be worst: a roll is a
 * persisted, tamper-evident fact, so a wrong number here is a wrong number in
 * the transcript forever.
 */

import {
  executeCustomTool,
  resolveParams,
  matchesWhen,
  renderTemplate,
  formatValue,
  CustomToolRunError,
} from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema, type QtapCustomTool, type When } from '@/lib/pascal/custom-tool.types'

/** Parse through the real schema so tests can never drift from what loads. */
function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) {
    throw new Error(`fixture is not a valid definition: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

const CATCH_ALL = { when: true as const, message: 'fallback', state: 'info' as const }

describe('resolveParams', () => {
  const tool = define({
    name: 'unlock',
    description: 'Attempt to pick the lock.',
    parameters: {
      bonus: { type: 'number', default: 0, min: 0, max: 10 },
      tries: { type: 'integer', default: 1 },
      label: { type: 'string', default: 'lock' },
      loud: { type: 'boolean', default: false },
    },
    outcomes: [CATCH_ALL],
  })

  it('fills every declared parameter from its default', async () => {
    expect(resolveParams(tool, {})).toEqual({ bonus: 0, tries: 1, label: 'lock', loud: false })
  })

  it('defaults a parameter that was omitted', async () => {
    expect(resolveParams(tool, { bonus: 3 }).tries).toBe(1)
  })

  it('clamps a numeric value up to min', async () => {
    expect(resolveParams(tool, { bonus: -5 }).bonus).toBe(0)
  })

  it('clamps a numeric value down to max', async () => {
    expect(resolveParams(tool, { bonus: 999 }).bonus).toBe(10)
  })

  it('rounds an integer parameter', async () => {
    expect(resolveParams(tool, { tries: 2.6 }).tries).toBe(3)
  })

  it('accepts a numeric string, as models routinely send', async () => {
    expect(resolveParams(tool, { bonus: '4' }).bonus).toBe(4)
  })

  it('rejects an unknown parameter rather than ignoring it', async () => {
    // Silently dropping it would look like the tool ran as asked.
    expect(() => resolveParams(tool, { bonuss: 5 })).toThrow(CustomToolRunError)
    expect(() => resolveParams(tool, { bonuss: 5 })).toThrow(/not a parameter/)
  })

  it('rejects a non-numeric value for a numeric parameter', async () => {
    expect(() => resolveParams(tool, { bonus: 'lots' })).toThrow(/must be a number/)
  })

  it('coerces boolean strings', async () => {
    expect(resolveParams(tool, { loud: 'true' }).loud).toBe(true)
    expect(resolveParams(tool, { loud: 'false' }).loud).toBe(false)
  })

  it('treats null as absent and uses the default', async () => {
    expect(resolveParams(tool, { bonus: null }).bonus).toBe(0)
  })
})

describe('matchesWhen', () => {
  /** Pose a test about the value alone — the subject bare comparators address. */
  const against = (when: When, value: number) => matchesWhen(when, { value, roll: value, params: {} })

  it('always matches the literal true', async () => {
    expect(matchesWhen(true, { value: -999, roll: -999, params: {} })).toBe(true)
  })

  it.each([
    [{ gt: 0.6 }, 0.61, true],
    [{ gt: 0.6 }, 0.6, false],
    [{ gte: 0.6 }, 0.6, true],
    [{ lt: 0.3 }, 0.29, true],
    [{ lt: 0.3 }, 0.3, false],
    [{ lte: 0.3 }, 0.3, true],
    [{ eq: 5 }, 5, true],
    [{ eq: 5 }, 6, false],
    [{ neq: 5 }, 6, true],
    [{ neq: 5 }, 5, false],
  ])('%j against %d is %s', (when, value, expected) => {
    expect(against(when, value)).toBe(expected)
  })

  it('ANDs multiple comparators together', async () => {
    const band = { gte: 0.3, lte: 0.6 }
    expect(against(band, 0.45)).toBe(true)
    expect(against(band, 0.3)).toBe(true)
    expect(against(band, 0.6)).toBe(true)
    expect(against(band, 0.29)).toBe(false)
    expect(against(band, 0.61)).toBe(false)
  })

  it('tests the raw roll separately from the transformed value', async () => {
    // The whole point of the `roll` subject: after a transform, the two
    // subjects disagree, and only one of them is what was actually drawn.
    const when = { gt: 50, roll: { lt: 0.6 } }
    expect(matchesWhen(when, { value: 55, roll: 0.55, params: {} })).toBe(true)
    expect(matchesWhen(when, { value: 55, roll: 0.7, params: {} })).toBe(false)
  })

  it('ANDs a params test with a value test', async () => {
    const when = { gt: 1, params: { scale: { gt: 12 } } }
    expect(matchesWhen(when, { value: 2, roll: 2, params: { scale: 14 } })).toBe(true)
    expect(matchesWhen(when, { value: 2, roll: 2, params: { scale: 12 } })).toBe(false)
    expect(matchesWhen(when, { value: 1, roll: 1, params: { scale: 14 } })).toBe(false)
  })

  it('compares a string parameter with eq/neq', async () => {
    const subjects = { value: 0, roll: 0, params: { material: 'brass' } }
    expect(matchesWhen({ params: { material: { eq: 'brass' } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { material: { eq: 'iron' } } }, subjects)).toBe(false)
    expect(matchesWhen({ params: { material: { neq: 'iron' } } }, subjects)).toBe(true)
  })

  it('compares a boolean parameter with eq', async () => {
    const subjects = { value: 0, roll: 0, params: { loudly: true } }
    expect(matchesWhen({ params: { loudly: { eq: true } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { loudly: { eq: false } } }, subjects)).toBe(false)
  })

  it('resolves a $param operand — the opposed check', async () => {
    const when = { gte: { $param: 'difficulty' } }
    expect(matchesWhen(when, { value: 15, roll: 15, params: { difficulty: 12 } })).toBe(true)
    expect(matchesWhen(when, { value: 15, roll: 15, params: { difficulty: 18 } })).toBe(false)
  })

  it('throws rather than declining to match when an ordering test meets a non-number', async () => {
    // Load-time validation rejects this shape, so reaching it is a regression.
    // Returning false would look like the table simply skipping a row.
    expect(() =>
      matchesWhen({ params: { material: { gt: 1 } } } as When, { value: 0, roll: 0, params: { material: 'brass' } })
    ).toThrow(CustomToolRunError)
  })

  it('searches a string parameter with contains/ncontains', async () => {
    const subjects = { value: 0, roll: 0, params: { material: 'polished brass' } }
    expect(matchesWhen({ params: { material: { contains: 'brass' } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { material: { contains: 'iron' } } }, subjects)).toBe(false)
    expect(matchesWhen({ params: { material: { ncontains: 'iron' } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { material: { ncontains: 'brass' } } }, subjects)).toBe(false)
  })

  it('containment on a parameter is case-sensitive — declared values are exact, like eq', async () => {
    const subjects = { value: 0, roll: 0, params: { material: 'polished brass' } }
    expect(matchesWhen({ params: { material: { contains: 'Brass' } } }, subjects)).toBe(false)
  })

  it('resolves a $param substring — one input sought inside another', async () => {
    const when = { params: { cargo: { contains: { $param: 'sought' } } } } as When
    expect(
      matchesWhen(when, { value: 0, roll: 0, params: { cargo: 'silk, opium, brandy', sought: 'opium' } })
    ).toBe(true)
    expect(matchesWhen(when, { value: 0, roll: 0, params: { cargo: 'silk and brandy', sought: 'opium' } })).toBe(false)
  })

  it('throws rather than declining when a containment test meets a non-string', async () => {
    // Load-time validation rejects contains against a numeric parameter, so
    // reaching it is a regression — same rule as ordering a string above.
    expect(() =>
      matchesWhen({ params: { scale: { contains: '1' } } } as When, { value: 0, roll: 0, params: { scale: 12 } })
    ).toThrow(CustomToolRunError)
  })
})

describe('matchesWhen — the metadata subject', () => {
  const SHEET = {
    hasAnsibleAccess: true,
    clearanceLevel: 3,
    faction: 'Ordo Aurum',
    knownLanguages: ['Trade Cant'],
    dossier: { rank: 'adept' },
    lastSeen: null,
  }

  /** Pose a test about the sheet alone. */
  const against = (when: When, metadata: Record<string, unknown> = SHEET) =>
    matchesWhen(when, { value: 0, roll: 0, params: {}, metadata })

  it.each([
    ['a boolean that holds', { hasAnsibleAccess: { eq: true } }, true],
    ['a boolean that does not', { hasAnsibleAccess: { eq: false } }, false],
    ['neq against a boolean', { hasAnsibleAccess: { neq: false } }, true],
    ['a number ordered', { clearanceLevel: { gte: 3 } }, true],
    ['a number ordered short', { clearanceLevel: { gt: 3 } }, false],
    ['a number banded', { clearanceLevel: { gte: 2, lte: 4 } }, true],
    ['a string matched', { faction: { eq: 'Ordo Aurum' } }, true],
    ['a string mismatched', { faction: { eq: 'Ordo Ferrum' } }, false],
    ['a string searched', { faction: { contains: 'Aurum' } }, true],
    ['a string searched for what it lacks', { faction: { contains: 'Ferrum' } }, false],
    ['ncontains against a string', { faction: { ncontains: 'Ferrum' } }, true],
    ['containment stays case-sensitive here', { faction: { contains: 'aurum' } }, false],
  ])('%s', (_label, metadata, expected) => {
    expect(against({ metadata } as When)).toBe(expected)
  })

  it('ANDs several metadata keys together', async () => {
    expect(against({ metadata: { hasAnsibleAccess: { eq: true }, clearanceLevel: { gte: 3 } } } as When)).toBe(true)
    expect(against({ metadata: { hasAnsibleAccess: { eq: true }, clearanceLevel: { gte: 4 } } } as When)).toBe(false)
  })

  it('ANDs a metadata test with bare, roll, and params subjects', async () => {
    const when = {
      gt: 1,
      roll: { lt: 0.6 },
      params: { scale: { gt: 12 } },
      metadata: { hasAnsibleAccess: { eq: true } },
    } as When
    const subjects = { value: 2, roll: 0.55, params: { scale: 14 }, metadata: SHEET }
    expect(matchesWhen(when, subjects)).toBe(true)
    // Every subject is load-bearing: falsify each in turn.
    expect(matchesWhen(when, { ...subjects, value: 1 })).toBe(false)
    expect(matchesWhen(when, { ...subjects, roll: 0.7 })).toBe(false)
    expect(matchesWhen(when, { ...subjects, params: { scale: 12 } })).toBe(false)
    expect(matchesWhen(when, { ...subjects, metadata: { hasAnsibleAccess: false } })).toBe(false)
  })

  it('resolves a $param operand against a metadata key — the opposed check', async () => {
    const when = { metadata: { clearanceLevel: { gte: { $param: 'required' } } } } as When
    expect(matchesWhen(when, { value: 0, roll: 0, params: { required: 2 }, metadata: SHEET })).toBe(true)
    expect(matchesWhen(when, { value: 0, roll: 0, params: { required: 4 }, metadata: SHEET })).toBe(false)
  })

  /**
   * The fail-soft rule, which is the whole reason `metadata` is not `params`.
   * Every one of these is a fact about a character rather than an authoring
   * mistake — a table branching on a key must still deal to whoever lacks it —
   * so each declines to match and lets the catch-all answer, and none throw.
   */
  describe('declines rather than throwing when the sheet cannot answer', () => {
    it.each([
      ['a key this character has never heard of', { ansibleAccess: { eq: true } }],
      ['an absent key tested with neq — absence is not inequality', { ansibleAccess: { neq: true } }],
      ['a key holding an array', { knownLanguages: { eq: 'Trade Cant' } }],
      ['a key holding an object', { dossier: { eq: 'adept' } }],
      ['a key holding null', { lastSeen: { neq: 'never' } }],
      ['a string ordered against a number', { faction: { gt: 1 } }],
      ['a number compared against a string', { clearanceLevel: { eq: 'three' } }],
      ['an ordering test whose operand is a string', { clearanceLevel: { gte: 'three' } }],
      ['an absent key tested with ncontains — absence is not a miss', { ansibleAccess: { ncontains: 'x' } }],
      ['a number searched for a substring', { clearanceLevel: { contains: '3' } }],
      ['an array searched for a substring', { knownLanguages: { contains: 'Trade' } }],
    ])('%s', (_label, metadata) => {
      expect(() => against({ metadata } as When)).not.toThrow()
      expect(against({ metadata } as When)).toBe(false)
    })

    it('treats a missing metadata sheet as a sheet with nothing on it', async () => {
      // Nobody in particular rolled: the subjects carry no metadata at all.
      const when = { metadata: { hasAnsibleAccess: { eq: true } } } as When
      expect(matchesWhen(when, { value: 0, roll: 0, params: {} })).toBe(false)
      expect(against(when, {})).toBe(false)
    })
  })
})

describe('formatValue', () => {
  it('renders integers without decimals', async () => {
    expect(formatValue(14)).toBe('14')
    expect(formatValue(-3)).toBe('-3')
  })

  it('renders floats to 4 significant digits', async () => {
    expect(formatValue(0.7134567)).toBe('0.7135')
    expect(formatValue(1234.5678)).toBe('1235')
  })
})

describe('renderTemplate', () => {
  const vars = { value: 14, roll: 0.7134567, dice: '3d6+2: [4, 2, 6] + 2 = 14', params: { bonus: 2, who: 'Bertie' } }

  it('substitutes {{value}}, {{roll}}, and {{dice}}', async () => {
    expect(renderTemplate('{{value}} / {{roll}} / {{dice}}', vars)).toBe(
      '14 / 0.7135 / 3d6+2: [4, 2, 6] + 2 = 14'
    )
  })

  it('substitutes {{params.name}} for numbers and strings', async () => {
    expect(renderTemplate('{{params.bonus}} and {{params.who}}', vars)).toBe('2 and Bertie')
  })

  it('leaves an unknown placeholder verbatim', async () => {
    expect(renderTemplate('{{nonsense}} stays', vars)).toBe('{{nonsense}} stays')
  })

  it('leaves an unknown params reference verbatim', async () => {
    expect(renderTemplate('{{params.nope}}', vars)).toBe('{{params.nope}}')
  })

  it('does not interpret user text as a template', async () => {
    // Substituted values are inserted, never re-scanned.
    const sneaky = { ...vars, params: { who: '{{value}}' } }
    expect(renderTemplate('{{params.who}}', sneaky)).toBe('{{value}}')
  })

  it('tolerates whitespace inside the braces', async () => {
    expect(renderTemplate('{{ value }}', vars)).toBe('14')
  })

  describe('the {{metadata.key}} family', () => {
    const sheet = {
      faction: 'Ordo Aurum',
      clearanceLevel: 3,
      trust: 0.7134567,
      hasAnsibleAccess: true,
      knownLanguages: ['Trade Cant'],
      dossier: { rank: 'adept' },
      lastSeen: null,
    }
    const withSheet = { ...vars, metadata: sheet }

    it('substitutes primitives the way {{params.name}} does', async () => {
      expect(renderTemplate('{{metadata.faction}} / {{metadata.hasAnsibleAccess}}', withSheet)).toBe(
        'Ordo Aurum / true'
      )
    })

    it('renders an integer undecorated and a float to 4 significant digits', async () => {
      expect(renderTemplate('{{metadata.clearanceLevel}} at {{metadata.trust}}', withSheet)).toBe('3 at 0.7135')
    })

    it.each([
      ['an absent key', '{{metadata.nope}}'],
      ['a key holding an array', '{{metadata.knownLanguages}}'],
      ['a key holding an object', '{{metadata.dossier}}'],
      ['a key holding null', '{{metadata.lastSeen}}'],
    ])('leaves %s verbatim rather than eating the hole in the sentence', (_label, template) => {
      expect(renderTemplate(template, withSheet)).toBe(template)
    })

    it('leaves every metadata placeholder verbatim when there is no sheet', async () => {
      expect(renderTemplate('{{metadata.faction}}', vars)).toBe('{{metadata.faction}}')
    })

    it('does not re-scan a substituted metadata value as a template', async () => {
      const sneaky = { ...vars, metadata: { motto: '{{value}}' } }
      expect(renderTemplate('{{metadata.motto}}', sneaky)).toBe('{{value}}')
    })
  })
})

describe('executeCustomTool — transform pipeline', () => {
  it('applies multiply, then offset, then round, in that order', async () => {
    // A degenerate range (min === max) pins raw to 0.5 so the arithmetic is
    // deterministic: 0.5 * 10 = 5, + 2 = 7. Rounding first would give 1*10+2=12.
    const tool = define({
      name: 'pipeline',
      description: 'Pin the raw value and watch the transform.',
      roll: { min: 0.5, max: 0.5, multiplier: 10, offset: 2, round: true },
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(tool, {})
    expect(result.raw).toBe(0.5)
    expect(result.value).toBe(7)
  })

  it('rounds last, not before the offset', async () => {
    const tool = define({
      name: 'rounding',
      description: 'Rounding happens after the offset.',
      roll: { min: 0.4, max: 0.4, multiplier: 1, offset: 0.3, round: true },
      outcomes: [CATCH_ALL],
    })
    // 0.4 + 0.3 = 0.7 → 1. Rounding first would be 0 + 0.3 = 0.3 → 0.
    expect((await executeCustomTool(tool, {})).value).toBe(1)
  })

  it('substitutes a $param into the offset', async () => {
    const tool = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      parameters: { bonus: { type: 'number', default: 0, min: 0, max: 10 } },
      roll: { min: 0, max: 0, offset: { $param: 'bonus' } },
      outcomes: [CATCH_ALL],
    })
    expect((await executeCustomTool(tool, { bonus: 4 })).value).toBe(4)
  })

  it('uses the CLAMPED parameter value in the roll, not the raw one', async () => {
    const tool = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      parameters: { bonus: { type: 'number', default: 0, min: 0, max: 10 } },
      roll: { min: 0, max: 0, offset: { $param: 'bonus' } },
      outcomes: [CATCH_ALL],
    })
    expect((await executeCustomTool(tool, { bonus: 999 })).value).toBe(10)
  })

  it('defaults to a 0–1 uniform roll when `roll` is omitted', async () => {
    const tool = define({ name: 'plain', description: 'No roll block.', outcomes: [CATCH_ALL] })
    for (let i = 0; i < 30; i++) {
      const { value } = await executeCustomTool(tool, {})
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('draws within [min, max) across many runs', async () => {
    const tool = define({
      name: 'ranged',
      description: 'A bounded draw.',
      roll: { min: 10, max: 20 },
      outcomes: [CATCH_ALL],
    })
    for (let i = 0; i < 100; i++) {
      const { value } = await executeCustomTool(tool, {})
      expect(value).toBeGreaterThanOrEqual(10)
      expect(value).toBeLessThan(20)
    }
  })

  it('fails rather than fabricating when $param substitution inverts the bounds', async () => {
    const tool = define({
      name: 'inverted',
      description: 'Bounds that can cross.',
      parameters: { hi: { type: 'number', default: 10 } },
      roll: { min: 5, max: { $param: 'hi' } },
      outcomes: [CATCH_ALL],
    })
    await expect(executeCustomTool(tool, { hi: 1 })).rejects.toThrow(CustomToolRunError)
    await expect(executeCustomTool(tool, { hi: 1 })).rejects.toThrow(/low bound .* above its high bound/)
  })
})

describe('executeCustomTool — outcome selection', () => {
  const tool = define({
    name: 'unlock',
    description: 'Attempt to pick the lock.',
    roll: { min: 0.7, max: 0.7 },
    outcomes: [
      { when: { gt: 0.6 }, message: 'The lock clicks open.', state: 'success' },
      { when: { lt: 0.3 }, message: 'Still locked.', state: 'failure' },
      { when: true, message: 'The lock is giving way…', state: 'partial' },
    ],
  })

  it('takes the first matching outcome', async () => {
    const result = await executeCustomTool(tool, {})
    expect(result.outcomeIndex).toBe(0)
    expect(result.state).toBe('success')
    expect(result.message).toBe('The lock clicks open.')
  })

  it('falls through to the catch-all when nothing else matches', async () => {
    const midband = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      roll: { min: 0.45, max: 0.45 },
      outcomes: [
        { when: { gt: 0.6 }, message: 'open', state: 'success' },
        { when: { lt: 0.3 }, message: 'locked', state: 'failure' },
        { when: true, message: 'giving way', state: 'partial' },
      ],
    })
    const result = await executeCustomTool(midband, {})
    expect(result.outcomeIndex).toBe(2)
    expect(result.state).toBe('partial')
  })

  it('prefers the earlier of two matching outcomes', async () => {
    const overlapping = define({
      name: 'overlap',
      description: 'Two outcomes both match.',
      roll: { min: 5, max: 5 },
      outcomes: [
        { when: { gte: 1 }, message: 'first', state: 'success' },
        { when: { gte: 2 }, message: 'second', state: 'info' },
        { when: true, message: 'third', state: 'info' },
      ],
    })
    expect((await executeCustomTool(overlapping, {})).message).toBe('first')
  })

  it('selects on the CLAMPED parameter, as the roll does', async () => {
    // The one value the table tests must be the one the roll used — a test
    // against the caller's unclamped 999 would contradict the number rolled.
    const tool = define({
      name: 'scan',
      description: 'Test a parameter alongside the value.',
      parameters: { scale: { type: 'number', default: 1, min: 0, max: 12 } },
      roll: { min: 5, max: 5 },
      outcomes: [
        { when: { params: { scale: { gt: 12 } } }, message: 'off the scale', state: 'success' },
        { when: true, message: 'within tolerance', state: 'info' },
      ],
    })
    expect((await executeCustomTool(tool, { scale: 999 })).message).toBe('within tolerance')
  })

  it('selects on the raw draw when the outcome tests `roll`', async () => {
    // raw 0.5 → value 50, so the two subjects genuinely disagree here.
    const tool = define({
      name: 'scaled',
      description: 'The raw draw and the value disagree.',
      roll: { min: 0.5, max: 0.5, multiplier: 100 },
      outcomes: [
        { when: { roll: { lt: 0.6 } }, message: 'raw was low', state: 'info' },
        { when: true, message: 'fallback', state: 'info' },
      ],
    })
    const result = await executeCustomTool(tool, {})
    expect(result.value).toBe(50)
    expect(result.message).toBe('raw was low')
  })

  it('ANDs the value, the raw roll, and a parameter in one test', async () => {
    const tool = define({
      name: 'compound',
      description: 'Every subject at once.',
      parameters: { scale: { type: 'integer', default: 1 }, mode: { type: 'string', default: 'passive' } },
      roll: { min: 0.5, max: 0.5, multiplier: 10 },
      outcomes: [
        {
          when: { gt: 1, roll: { gte: 0.5 }, params: { scale: { gt: 12 }, mode: { eq: 'active' } } },
          message: 'all four held',
          state: 'success',
        },
        { when: true, message: 'something did not hold', state: 'info' },
      ],
    })
    expect((await executeCustomTool(tool, { scale: 14, mode: 'active' })).message).toBe('all four held')
    // One conjunct false is enough to fall through.
    expect((await executeCustomTool(tool, { scale: 14, mode: 'passive' })).message).toBe('something did not hold')
    expect((await executeCustomTool(tool, { scale: 12, mode: 'active' })).message).toBe('something did not hold')
  })
})

describe('executeCustomTool — the invoking character\'s metadata', () => {
  /** A gated table: the same roll, dealt differently by who is holding what. */
  const tool = define({
    name: 'ansible',
    description: 'Reach for the ansible.',
    roll: { min: 0.7, max: 0.7 },
    outcomes: [
      {
        when: { gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } },
        message: 'The ansible flickers to life for {{metadata.faction}}.',
        state: 'success',
      },
      { when: true, message: 'The panel stays dark.', state: 'failure' },
    ],
  })

  it('matches the gated outcome for a character carrying the key', async () => {
    const result = await executeCustomTool(tool, {}, {
      metadata: { hasAnsibleAccess: true, faction: 'Ordo Aurum' },
    })
    expect(result.state).toBe('success')
    expect(result.message).toBe('The ansible flickers to life for Ordo Aurum.')
  })

  it('falls to the catch-all for a character who has never heard of an ansible', async () => {
    const result = await executeCustomTool(tool, {}, { metadata: { faction: 'Ordo Ferrum' } })
    expect(result.state).toBe('failure')
    expect(result.message).toBe('The panel stays dark.')
  })

  it('falls to the catch-all when the key is there but false', async () => {
    expect((await executeCustomTool(tool, {}, { metadata: { hasAnsibleAccess: false } })).state).toBe('failure')
  })

  it('falls to the catch-all when nobody in particular rolled', async () => {
    // A characterless manual run passes no sheet at all.
    expect((await executeCustomTool(tool, {})).state).toBe('failure')
    expect((await executeCustomTool(tool, {}, { metadata: {} })).state).toBe('failure')
  })

  describe('metadataTested — what the winning row saw', () => {
    it('records the keys the winning row consulted, at their roll-time values', async () => {
      const result = await executeCustomTool(tool, {}, {
        metadata: { hasAnsibleAccess: true, faction: 'Ordo Aurum', clearanceLevel: 3 },
      })
      // Only what the row tested — not the whole sheet, which is the
      // character's business and may hold things the room should not see.
      expect(result.metadataTested).toEqual({ hasAnsibleAccess: true })
    })

    it('is absent when the winning row consulted no metadata', async () => {
      expect((await executeCustomTool(tool, {}, { metadata: {} })).metadataTested).toBeUndefined()
    })

    it('is absent on a run that never had a sheet', async () => {
      expect((await executeCustomTool(tool, {})).metadataTested).toBeUndefined()
    })

    it('records every key of a multi-key winning row', async () => {
      const gated = define({
        name: 'vault',
        description: 'Open the vault.',
        roll: { min: 0.7, max: 0.7 },
        outcomes: [
          {
            when: { metadata: { clearanceLevel: { gte: 3 }, faction: { eq: 'Ordo Aurum' } } },
            message: 'Open.',
            state: 'success',
          },
          { when: true, message: 'Shut.', state: 'failure' },
        ],
      })
      const result = await executeCustomTool(gated, {}, {
        metadata: { clearanceLevel: 3, faction: 'Ordo Aurum', hasAnsibleAccess: true },
      })
      expect(result.state).toBe('success')
      expect(result.metadataTested).toEqual({ clearanceLevel: 3, faction: 'Ordo Aurum' })
    })
  })
})

describe('executeCustomTool — dice form', () => {
  const tool = define({
    name: 'saving_throw',
    description: 'Roll a d20 saving throw against DC 12.',
    roll: '1d20',
    outcomes: [
      { when: { gte: 12 }, message: 'Saved! ({{dice}})', state: 'success' },
      { when: true, message: 'Failed. ({{dice}})', state: 'failure' },
    ],
  })

  it('reports the dice form and its notation', async () => {
    const result = await executeCustomTool(tool, {})
    expect(result.rollForm).toBe('dice')
    expect(result.notation).toBe('1d20')
    expect(result.diceRolls).toHaveLength(1)
  })

  it('sets raw and value to the dice total', async () => {
    const result = await executeCustomTool(tool, {})
    expect(result.raw).toBe(result.value)
    expect(result.value).toBeGreaterThanOrEqual(1)
    expect(result.value).toBeLessThanOrEqual(20)
  })

  it('renders {{dice}} as a breakdown', async () => {
    const result = await executeCustomTool(tool, {})
    expect(result.message).toMatch(/1d20: \[\d+\] = \d+/)
  })

  it('honours a dice modifier in the total', async () => {
    const modified = define({
      name: 'modified',
      description: 'Dice with a modifier.',
      roll: '3d6+2',
      outcomes: [CATCH_ALL],
    })
    const result = await executeCustomTool(modified, {})
    const facesTotal = result.diceRolls!.reduce((a, b) => a + b, 0)
    expect(result.value).toBe(facesTotal + 2)
  })

  it('leaves {{dice}} empty for a range roll', async () => {
    const ranged = define({
      name: 'ranged',
      description: 'A range roll has no dice.',
      roll: { min: 1, max: 2 },
      outcomes: [{ when: true, message: 'x{{dice}}y', state: 'info' }],
    })
    const result = await executeCustomTool(ranged, {})
    expect(result.diceBreakdown).toBe('')
    expect(result.message).toBe('xy')
  })
})

describe('executeCustomTool — visibility', () => {
  const publicTool = define({ name: 'a', description: 'd', outcomes: [CATCH_ALL] })
  const whisperTool = define({ name: 'b', description: 'd', defaultVisibility: 'whisper', outcomes: [CATCH_ALL] })

  it('defaults to public', async () => {
    expect((await executeCustomTool(publicTool, {})).visibility).toBe('public')
  })

  it("honours the definition's whisper default", async () => {
    expect((await executeCustomTool(whisperTool, {})).visibility).toBe('whisper')
  })

  it('lets an explicit private:true override a public default', async () => {
    expect((await executeCustomTool(publicTool, {}, { private: true })).visibility).toBe('whisper')
  })

  it('lets an explicit private:false override a whisper default', async () => {
    expect((await executeCustomTool(whisperTool, {}, { private: false })).visibility).toBe('public')
  })
})

describe('executeCustomTool — the LLM consult', () => {
  /** A tool that asks an oracle and branches on the answer. */
  const tool = define({
    name: 'augury',
    description: 'Consult the oracle about the roll.',
    parameters: { omen: { type: 'string', default: 'sparrows' } },
    roll: { min: 0.7, max: 0.7 },
    llm: {
      prompt: 'The {{params.omen}} gave {{value}} for {{metadata.faction}}. Answer YES or NO.',
      errorMessage: 'The wire crackles, and no answer comes.',
    },
    outcomes: [
      { when: { llm: { ok: false } }, message: 'Silence: {{llm}}', state: 'failure' },
      { when: { llm: { eq: 'YES' } }, message: 'The oracle assents: {{llm}}', state: 'success' },
      { when: true, message: 'The oracle demurs: {{llm}}', state: 'partial' },
    ],
  })

  /** An invoker scripted to answer, recording the prompt it was posed. */
  const scripted = (output: string) => {
    const calls: string[] = []
    const invoke = async (prompt: string) => {
      calls.push(prompt)
      return { ok: true as const, output, provider: 'test', model: 'scripted' }
    }
    return { calls, invoke }
  }

  it('renders the prompt with params and metadata before asking', async () => {
    const oracle = scripted('YES')
    await executeCustomTool(tool, { omen: 'ravens' }, {
      metadata: { faction: 'Ordo Aurum' },
      llmInvoke: oracle.invoke,
    })
    expect(oracle.calls).toEqual(['The ravens gave 0.7 for Ordo Aurum. Answer YES or NO.'])
  })

  it('lets the answer pick the row and renders {{llm}}', async () => {
    const result = await executeCustomTool(tool, {}, { llmInvoke: scripted('YES').invoke })
    expect(result.state).toBe('success')
    expect(result.message).toBe('The oracle assents: YES')
    expect(result.llm).toMatchObject({ ok: true, output: 'YES', provider: 'test', model: 'scripted' })
  })

  it('matches the answer case-insensitively, trailing period forgiven', async () => {
    expect((await executeCustomTool(tool, {}, { llmInvoke: scripted('yes.').invoke })).state).toBe('success')
  })

  it('falls through when the answer matches nothing gated', async () => {
    const result = await executeCustomTool(tool, {}, { llmInvoke: scripted('PERHAPS').invoke })
    expect(result.state).toBe('partial')
    expect(result.message).toBe('The oracle demurs: PERHAPS')
  })

  it('trims the answer before testing or rendering', async () => {
    const result = await executeCustomTool(tool, {}, { llmInvoke: scripted('  YES\n').invoke })
    expect(result.state).toBe('success')
    expect(result.llm?.output).toBe('YES')
  })

  describe('failure becomes the author’s words, never an error', () => {
    const expectSilence = async (
      invoke: ((p: string) => Promise<{ ok: true; output: string } | { ok: false; reason: string }>) | undefined,
      reason?: RegExp
    ) => {
      const result = await executeCustomTool(tool, {}, invoke ? { llmInvoke: invoke } : {})
      expect(result.state).toBe('failure')
      expect(result.message).toBe('Silence: The wire crackles, and no answer comes.')
      expect(result.llm?.ok).toBe(false)
      expect(result.llm?.output).toBe('The wire crackles, and no answer comes.')
      if (reason) expect(result.llm?.reason).toMatch(reason)
      return result
    }

    it('when the invoker reports failure', async () => {
      await expectSilence(async () => ({ ok: false as const, reason: 'provider went dark' }), /provider went dark/)
    })

    it('when the invoker throws', async () => {
      await expectSilence(async () => { throw new Error('socket hang up') }, /socket hang up/)
    })

    it('when the model answers with nothing but whitespace', async () => {
      await expectSilence(async () => ({ ok: true as const, output: '   \n' }), /empty answer/)
    })

    it('when no invoker was wired at all', async () => {
      await expectSilence(undefined, /no LLM invoker/)
    })
  })

  it('reconciles a numeric answer for ordering and equality', async () => {
    const numeric = define({
      name: 'gauge',
      description: 'Ask for a number.',
      llm: { prompt: 'A number, please.', errorMessage: 'No reading.' },
      outcomes: [
        { when: { llm: { gte: 7 } }, message: 'high', state: 'success' },
        { when: { llm: { eq: 5 } }, message: 'exactly five', state: 'info' },
        { when: true, message: 'low', state: 'failure' },
      ],
    })
    expect((await executeCustomTool(numeric, {}, { llmInvoke: scripted('7.5').invoke })).message).toBe('high')
    expect((await executeCustomTool(numeric, {}, { llmInvoke: scripted('5').invoke })).message).toBe('exactly five')
    expect((await executeCustomTool(numeric, {}, { llmInvoke: scripted('3').invoke })).message).toBe('low')
    // A non-numeric answer declines the ordering rows fail-soft.
    expect((await executeCustomTool(numeric, {}, { llmInvoke: scripted('plenty').invoke })).message).toBe('low')
  })

  it('records the rendered prompt in the run result', async () => {
    const result = await executeCustomTool(tool, {}, { llmInvoke: scripted('YES').invoke })
    expect(result.llm?.prompt).toBe('The sparrows gave 0.7 for {{metadata.faction}}. Answer YES or NO.')
  })

  it('caps a rambling answer at the default output cap', async () => {
    const ramble = 'x'.repeat(10_000)
    const result = await executeCustomTool(tool, {}, { llmInvoke: scripted(ramble).invoke })
    expect(result.llm?.output.length).toBe(8000)
  })

  describe('maxOutput — the author’s own leash', () => {
    const leashed = (maxOutput: number) =>
      define({
        name: 'leashed',
        description: 'A capped oracle.',
        llm: { prompt: 'Speak.', errorMessage: 'A silence considerably longer than ten characters.', maxOutput },
        outcomes: [CATCH_ALL],
      })

    it('truncates the answer to the declared cap', async () => {
      const result = await executeCustomTool(leashed(10), {}, { llmInvoke: scripted('abcdefghijKLMNOP').invoke })
      expect(result.llm?.output).toBe('abcdefghij')
    })

    it('lets a generous cap keep what the default would have cut', async () => {
      const long = 'y'.repeat(20_000)
      const result = await executeCustomTool(leashed(50_000), {}, { llmInvoke: scripted(long).invoke })
      expect(result.llm?.output.length).toBe(20_000)
    })

    it('tells the invoker the cap, so the token budget can follow', async () => {
      const seen: Array<number | undefined> = []
      await executeCustomTool(leashed(50_000), {}, {
        llmInvoke: async (_prompt, options) => {
          seen.push(options?.maxOutputChars)
          return { ok: true, output: 'noted' }
        },
      })
      expect(seen).toEqual([50_000])
    })

    it('never truncates the errorMessage, whatever the cap', async () => {
      const result = await executeCustomTool(leashed(10), {}, {
        llmInvoke: async () => ({ ok: false as const, reason: 'gone' }),
      })
      expect(result.llm?.output).toBe('A silence considerably longer than ten characters.')
    })
  })

  it('runs no consult on a tool without an llm block', async () => {
    const plain = define({ name: 'plain', description: 'No oracle here.', outcomes: [CATCH_ALL] })
    const oracle = scripted('YES')
    const result = await executeCustomTool(plain, {}, { llmInvoke: oracle.invoke })
    expect(oracle.calls).toHaveLength(0)
    expect(result.llm).toBeUndefined()
  })
})

describe('matchesWhen — the llm subject', () => {
  const against = (when: When, llm?: { ok: boolean; output: string }) =>
    matchesWhen(when, { value: 0, roll: 0, params: {}, ...(llm ? { llm } : {}) })

  it('tests ok directly', () => {
    expect(against({ llm: { ok: true } } as When, { ok: true, output: 'YES' })).toBe(true)
    expect(against({ llm: { ok: false } } as When, { ok: true, output: 'YES' })).toBe(false)
    expect(against({ llm: { ok: false } } as When, { ok: false, output: 'gone' })).toBe(true)
  })

  it('ANDs ok with an answer comparator', () => {
    expect(against({ llm: { ok: true, eq: 'YES' } } as When, { ok: true, output: 'yes' })).toBe(true)
    expect(against({ llm: { ok: true, eq: 'YES' } } as When, { ok: true, output: 'no' })).toBe(false)
  })

  it('declines fail-soft when no consult ran', () => {
    expect(against({ llm: { eq: 'YES' } } as When)).toBe(false)
    expect(against({ llm: { ok: false } } as When)).toBe(false)
  })

  it('resolves a $param operand against the answer', () => {
    const when = { llm: { eq: { $param: 'expected' } } } as When
    expect(
      matchesWhen(when, { value: 0, roll: 0, params: { expected: 'brass' }, llm: { ok: true, output: 'Brass' } })
    ).toBe(true)
  })

  it('searches the answer with contains/ncontains, case-insensitively', () => {
    const oracle = { ok: true, output: 'You will find the West Door unbarred.' }
    expect(against({ llm: { contains: 'west door' } } as When, oracle)).toBe(true)
    expect(against({ llm: { contains: 'east door' } } as When, oracle)).toBe(false)
    expect(against({ llm: { ncontains: 'east door' } } as When, oracle)).toBe(true)
    // Case-insensitive in BOTH directions — the operand is folded too.
    expect(against({ llm: { ncontains: 'WEST DOOR' } } as When, oracle)).toBe(false)
  })

  it('trims the substring before searching, as eq trims the answer', () => {
    expect(against({ llm: { contains: ' west door ' } } as When, { ok: true, output: 'the west door' })).toBe(true)
  })

  it('resolves a $param substring against the answer', () => {
    const when = { llm: { contains: { $param: 'sought' } } } as When
    const oracle = { ok: true, output: 'Crates of opium and silk.' }
    expect(matchesWhen(when, { value: 0, roll: 0, params: { sought: 'Opium' }, llm: oracle })).toBe(true)
    expect(matchesWhen(when, { value: 0, roll: 0, params: { sought: 'brandy' }, llm: oracle })).toBe(false)
  })

  it('searches the errorMessage on a failed consult — the answer is the author\'s words', () => {
    expect(against({ llm: { contains: 'wire' } } as When, { ok: false, output: 'The wire went dead.' })).toBe(true)
  })
})

describe('consultMaxTokens', () => {
  // Imported here rather than atop the file: the module is server-only
  // (repositories, providers), but this one export is pure arithmetic.
  const { consultMaxTokens } = jest.requireActual('@/lib/pascal/llm-consult') as {
    consultMaxTokens: (chars: number) => number
  }

  it('floors at the cheap-LLM pipeline minimum', () => {
    expect(consultMaxTokens(10)).toBe(2048)
    expect(consultMaxTokens(6000)).toBe(2048)
  })

  it('scales with the cap at ~3 characters per token', () => {
    expect(consultMaxTokens(30_000)).toBe(10_000)
  })

  it('ceilings so a runaway cap cannot request an absurd budget', () => {
    expect(consultMaxTokens(100_000)).toBe(32_768)
  })
})
