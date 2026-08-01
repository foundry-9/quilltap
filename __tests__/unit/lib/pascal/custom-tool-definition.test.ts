/**
 * Custom tools — the definition format itself: the display title, and the
 * load-time rules that make an authoring mistake a rejection rather than a
 * dead branch nobody notices.
 *
 * Also guards the hand-synced JSON Schema mirror at
 * `public/schemas/qtap-custom-tool.schema.json` against the Zod schema, which
 * is the runtime source of truth. The mirror is what an author's editor
 * consults, so a mirror that has drifted is worse than none: it green-lights a
 * file the loader will refuse, or red-lines one it would have taken.
 */

import Ajv2020 from 'ajv/dist/2020'
import {
  QtapCustomToolSchema,
  displayTitle,
  formatDefinitionIssues,
  parseEffectTarget,
  MAX_TITLE_LENGTH,
  MAX_CHIP_LABEL_LENGTH,
  MAX_EFFECTS,
} from '@/lib/pascal/custom-tool.types'

import mirror from '@/public/schemas/qtap-custom-tool.schema.json'
import rangeSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC.json'
import diceSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC_DICE.json'

/** The narrowest definition the schema will accept. */
const BASE = {
  name: 'probe',
  description: 'A probe.',
  outcomes: [{ when: true, message: '-', state: 'info' }],
}

/** A definition whose first outcome carries `when`, with a trailing catch-all. */
function withWhen(when: unknown, extra: Record<string, unknown> = {}) {
  return {
    ...BASE,
    ...extra,
    outcomes: [
      { when, message: '-', state: 'info' },
      { when: true, message: '-', state: 'info' },
    ],
  }
}

const NUM_PARAM = { parameters: { scale: { type: 'number', default: 1 } } }
const STR_PARAM = { parameters: { material: { type: 'string', default: 'brass' } } }
const LLM_BLOCK = { llm: { prompt: 'Answer YES or NO: is {{value}} auspicious?', errorMessage: 'The wire went dead.' } }

/**
 * The rejection an author would actually read on the load-error badge — the
 * same rendering `loadToolsFromMount` puts there, so these assertions cover
 * the message and not merely the verdict.
 */
function rejection(doc: unknown): string {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (result.success) throw new Error('expected the definition to be rejected, but it parsed')
  return formatDefinitionIssues(result.error)
}

function accepts(doc: unknown): boolean {
  return QtapCustomToolSchema.safeParse(doc).success
}

describe('displayTitle', () => {
  it('prefers the authored title', () => {
    expect(displayTitle({ name: 'scan_hawking_radiation', title: 'Hawking Sweep' })).toBe('Hawking Sweep')
  })

  it('title-cases the name when no title is authored', () => {
    expect(displayTitle({ name: 'scan_hawking_radiation' })).toBe('Scan Hawking Radiation')
  })

  it('treats hyphens as word breaks too', () => {
    expect(displayTitle({ name: 'force-the-lock' })).toBe('Force The Lock')
  })

  it('leaves a single-word name capitalized', () => {
    expect(displayTitle({ name: 'unlock' })).toBe('Unlock')
  })

  it('does not disturb an authored title beyond trimming it', () => {
    // The author's capitalization is theirs — 'vs.' must not become 'Vs.'.
    expect(displayTitle({ name: 'saving_throw', title: '  Save vs. the House  ' })).toBe('Save vs. the House')
  })

  it('falls back to the name when the title is only whitespace', () => {
    expect(displayTitle({ name: 'saving_throw', title: '   ' })).toBe('Saving Throw')
  })
})

describe('title', () => {
  it('is optional', () => {
    expect(accepts(BASE)).toBe(true)
  })

  it('accepts a title within the cap', () => {
    expect(accepts({ ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH) })).toBe(true)
  })

  it('rejects an empty title rather than silently deriving one', () => {
    expect(accepts({ ...BASE, title: '' })).toBe(false)
  })

  it('rejects a title past the cap', () => {
    expect(accepts({ ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })).toBe(false)
  })
})

/** A definition carrying one effect (with a trailing catch-all outcome). */
function withEffects(effects: unknown, extra: Record<string, unknown> = {}) {
  return { ...BASE, ...extra, effects }
}

describe('chipLabel', () => {
  it('is optional', () => {
    expect(accepts(BASE)).toBe(true)
  })

  it('accepts a templated label within the cap', () => {
    expect(accepts({ ...BASE, chipLabel: 'Agent lambda — {{params.label}}' })).toBe(true)
  })

  it('rejects an empty chipLabel', () => {
    expect(accepts({ ...BASE, chipLabel: '' })).toBe(false)
  })

  it('rejects a chipLabel past the cap', () => {
    expect(accepts({ ...BASE, chipLabel: 'x'.repeat(MAX_CHIP_LABEL_LENGTH + 1) })).toBe(false)
  })

  it('tolerates an unknown placeholder — the renderTemplate doctrine, no load-time reference rule', () => {
    expect(accepts({ ...BASE, chipLabel: '{{params.never_declared}}' })).toBe(true)
  })
})

describe('parseEffectTarget', () => {
  it('parses a state target into a path', () => {
    const result = parseEffectTarget('state.encounter.count')
    expect(result.ok && result.target).toEqual({
      kind: 'state',
      path: ['encounter', 'count'],
      raw: 'state.encounter.count',
    })
  })

  it('takes a metadata key WHOLE — dots inside the key are part of it', () => {
    const result = parseEffectTarget('metadata.ansible.tool')
    expect(result.ok && result.target).toEqual({ kind: 'metadata', key: 'ansible.tool', raw: 'metadata.ansible.tool' })
  })

  it('rejects a target with neither prefix', () => {
    const result = parseEffectTarget('encounter.count')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('must start with')
  })

  it('rejects an empty state path', () => {
    expect(parseEffectTarget('state.').ok).toBe(false)
  })

  it('rejects an empty metadata key', () => {
    expect(parseEffectTarget('metadata.').ok).toBe(false)
  })

  it('rejects a state path whose first segment starts with an underscore — user-only keys', () => {
    const result = parseEffectTarget('state._secrets.combo')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('user-only')
  })

  it('allows an underscore deeper in the path — the guard is on the first segment', () => {
    expect(parseEffectTarget('state.encounter._notes').ok).toBe(true)
  })
})

describe('effects — load-time validation', () => {
  it('accepts a literal-number effect with no condition', () => {
    expect(accepts(withEffects([{ target: 'state.encounter.count', value: 3 }]))).toBe(true)
  })

  it('accepts a boolean literal and a quoted-string expression', () => {
    expect(
      accepts(
        withEffects([
          { target: 'metadata.lockBroken', value: true },
          { target: 'metadata.lockpick', value: "'broken pick'" },
        ])
      )
    ).toBe(true)
  })

  it('accepts an expression over the run subjects', () => {
    expect(
      accepts(withEffects([{ target: 'state.tally', value: '{{state.tally}} + {{params.scale}}' }], NUM_PARAM))
    ).toBe(true)
  })

  it('accepts an outcome-state condition', () => {
    expect(
      accepts(withEffects([{ when: { outcome: { eq: 'success' } }, target: 'state.wins', value: 1 }]))
    ).toBe(true)
  })

  it('accepts a metadata condition on an effect', () => {
    expect(
      accepts(withEffects([{ when: { metadata: { hasKey: { eq: true } } }, target: 'state.opened', value: true }]))
    ).toBe(true)
  })

  it('rejects the bare-prose value — the quoting trap fails loudly', () => {
    expect(rejection(withEffects([{ target: 'metadata.lockpick', value: 'broken pick' }]))).toMatch(
      /not a valid expression/
    )
  })

  it('rejects a target that is neither state. nor metadata.', () => {
    expect(rejection(withEffects([{ target: 'somewhere.else', value: 1 }]))).toMatch(/must start with/)
  })

  it('rejects an underscore-guarded state target', () => {
    expect(rejection(withEffects([{ target: 'state._secrets.combo', value: 1 }]))).toMatch(/user-only/)
  })

  it('rejects an expression referencing an undeclared parameter', () => {
    expect(rejection(withEffects([{ target: 'state.x', value: '{{params.ghost}} + 1' }]))).toMatch(
      /undeclared parameter "ghost"/
    )
  })

  it('rejects an {{llm}} reference on a tool with no llm block', () => {
    expect(rejection(withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }]))).toMatch(
      /declares no `llm` block/
    )
  })

  it('accepts an {{llm}} reference when the tool consults', () => {
    expect(accepts(withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }], LLM_BLOCK))).toBe(true)
  })

  it('rejects an llm when-subject on a tool with no llm block', () => {
    expect(rejection(withEffects([{ when: { llm: { ok: true } }, target: 'state.x', value: 1 }]))).toMatch(
      /declares no `llm` block/
    )
  })

  it("rejects a when testing an undeclared parameter — the outcome rows' walk, shared", () => {
    expect(rejection(withEffects([{ when: { params: { ghost: { gt: 1 } } }, target: 'state.x', value: 1 }]))).toMatch(
      /tests undeclared parameter "ghost"/
    )
  })

  it('renders effect issues at effects.N paths', () => {
    const result = QtapCustomToolSchema.safeParse(withEffects([{ target: 'nowhere', value: 1 }]))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(formatDefinitionIssues(result.error)).toMatch(/effects\.0\.target/)
  })

  it('rejects more effects than the cap', () => {
    const many = Array.from({ length: MAX_EFFECTS + 1 }, (_, i) => ({ target: `state.k${i}`, value: 1 }))
    expect(accepts(withEffects(many))).toBe(false)
  })

  it('rejects an empty outcome condition', () => {
    expect(accepts(withEffects([{ when: { outcome: {} }, target: 'state.x', value: 1 }]))).toBe(false)
  })

  it('rejects a when that tests nothing', () => {
    expect(rejection(withEffects([{ when: {}, target: 'state.x', value: 1 }]))).toMatch(/must test something/)
  })
})

describe('when — subjects', () => {
  it('still accepts a bare comparator, which tests the value', () => {
    // Every definition written before `roll`/`params` existed must still load.
    expect(accepts(withWhen({ gte: 0.3, lte: 0.6 }))).toBe(true)
  })

  it('accepts a roll subject', () => {
    expect(accepts(withWhen({ roll: { gte: 15 } }))).toBe(true)
  })

  it('accepts a params subject ANDed with a value test', () => {
    expect(accepts(withWhen({ gt: 1, params: { scale: { gt: 12 } } }, NUM_PARAM))).toBe(true)
  })

  it('accepts eq against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { eq: 'brass' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts a $param operand', () => {
    expect(accepts(withWhen({ gte: { $param: 'scale' } }, NUM_PARAM))).toBe(true)
  })

  it('rejects a test that tests nothing', () => {
    expect(rejection(withWhen({}))).toMatch(/must test something/)
  })

  it('rejects an empty params object', () => {
    expect(rejection(withWhen({ params: {} }))).toMatch(/must test something/)
  })

  it('rejects an empty comparator on roll', () => {
    expect(rejection(withWhen({ roll: {} }))).toMatch(/at least one comparator/)
  })

  it('accepts a metadata subject ANDed with a value test', () => {
    expect(accepts(withWhen({ gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } }))).toBe(true)
  })

  it('accepts a metadata subject as the only test', () => {
    expect(accepts(withWhen({ metadata: { clearanceLevel: { gte: 3 } } }))).toBe(true)
  })

  it('rejects an empty metadata object', () => {
    expect(rejection(withWhen({ metadata: {} }))).toMatch(/must test something/)
  })

  it('rejects an empty comparator on a metadata key', () => {
    expect(rejection(withWhen({ metadata: { faction: {} } }))).toMatch(/at least one comparator/)
  })
})

describe('when — the metadata subject', () => {
  it('takes keys in the USER\'s vocabulary, not our identifier grammar', () => {
    // metadata.json is hand-authored: camelCase, capitals, and spaces are all
    // perfectly ordinary keys there, and none would pass the `params` pattern.
    expect(accepts(withWhen({ metadata: { hasAnsibleAccess: { eq: true } } }))).toBe(true)
    expect(accepts(withWhen({ metadata: { 'Clearance Level': { gte: 3 } } }))).toBe(true)
    expect(accepts(withWhen({ metadata: { HOUSE: { eq: 'Aurum' } } }))).toBe(true)
  })

  it('rejects an empty-string key', () => {
    expect(accepts(withWhen({ metadata: { '': { eq: 1 } } }))).toBe(false)
  })

  it('rejects a misspelled comparator inside a metadata test', () => {
    // Strict, like every other nested object: tolerating `gt3` would silently
    // drop the test and leave the row looking like a dead branch.
    expect(accepts(withWhen({ metadata: { faction: { eq: 'Aurum', nonsense: 1 } } }))).toBe(false)
  })

  it('accepts a $param operand against a metadata key — the opposed check', () => {
    expect(
      accepts(withWhen({ metadata: { clearanceLevel: { gte: { $param: 'scale' } } } }, NUM_PARAM))
    ).toBe(true)
  })

  it('still rejects a $param operand naming an undeclared parameter', () => {
    // The one thing a metadata test CAN be checked on at load: its operands.
    expect(rejection(withWhen({ metadata: { clearanceLevel: { gte: { $param: 'nope' } } } }, NUM_PARAM))).toMatch(
      /references undeclared parameter "nope"/
    )
  })

  /**
   * The deliberate gap. A metadata key names something on a character the file
   * has never met, so neither its existence nor its type is knowable here —
   * `matchesWhen` closes this fail-soft at run time instead.
   */
  it('accepts a test of a key no character may ever have', () => {
    expect(accepts(withWhen({ metadata: { utterlyMadeUp: { eq: true } } }))).toBe(true)
  })

  it('accepts an ordering test that only a numeric key could satisfy', () => {
    // Unlike the params equivalent, which is a load-time rejection: we cannot
    // know that `faction` holds a string until a character turns up holding one.
    expect(accepts(withWhen({ metadata: { faction: { gt: 1 } } }))).toBe(true)
  })
})

describe('when — contains and ncontains', () => {
  const BOTH_PARAMS = { parameters: { ...STR_PARAM.parameters, ...NUM_PARAM.parameters } }

  it('accepts contains against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { contains: 'ras' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts ncontains against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { ncontains: 'iron' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts a $param substring — one input sought inside another', () => {
    const params = {
      parameters: {
        cargo: { type: 'string', default: 'silk' },
        sought: { type: 'string', default: 'opium' },
      },
    }
    expect(accepts(withWhen({ params: { cargo: { contains: { $param: 'sought' } } } }, params))).toBe(true)
  })

  it('accepts contains on a metadata key', () => {
    expect(accepts(withWhen({ metadata: { faction: { contains: 'Aurum' } } }))).toBe(true)
  })

  it('accepts contains on the llm answer', () => {
    expect(accepts(withWhen({ llm: { contains: 'west door' } }, LLM_BLOCK))).toBe(true)
  })

  it('rejects contains against a numeric parameter — a number holds no substrings', () => {
    expect(rejection(withWhen({ params: { scale: { contains: '1' } } }, NUM_PARAM))).toMatch(
      /only a string can contain a substring/
    )
  })

  it('rejects contains on the bare value', () => {
    expect(accepts(withWhen({ contains: 'x' }))).toBe(false)
  })

  it('rejects contains on the raw roll', () => {
    expect(accepts(withWhen({ roll: { contains: 'x' } }))).toBe(false)
  })

  it('rejects an empty substring — everything contains ""', () => {
    expect(accepts(withWhen({ params: { material: { contains: '' } } }, STR_PARAM))).toBe(false)
  })

  it('rejects a number literal as the substring', () => {
    expect(accepts(withWhen({ params: { material: { contains: 42 } } }, STR_PARAM))).toBe(false)
  })

  it('rejects a $param substring referencing a numeric parameter', () => {
    expect(
      rejection(withWhen({ params: { material: { contains: { $param: 'scale' } } } }, BOTH_PARAMS))
    ).toMatch(/a substring must be a string/)
  })

  it('rejects a $param substring naming an undeclared parameter', () => {
    expect(rejection(withWhen({ params: { material: { contains: { $param: 'ghost' } } } }, STR_PARAM))).toMatch(
      /references undeclared parameter "ghost"/
    )
  })
})

describe('when — the llm subject', () => {
  it('accepts an answer test on a tool with an llm block', () => {
    expect(accepts(withWhen({ llm: { eq: 'YES' } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts an ok test as the only test', () => {
    expect(accepts(withWhen({ llm: { ok: false } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts ok ANDed with an answer comparator', () => {
    expect(accepts(withWhen({ llm: { ok: true, eq: 'YES' } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts an ordering test — the answer may well be a number', () => {
    expect(accepts(withWhen({ llm: { gte: 5 } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts a $param operand against the answer — the opposed check', () => {
    expect(accepts(withWhen({ llm: { eq: { $param: 'scale' } } }, { ...NUM_PARAM, ...LLM_BLOCK }))).toBe(true)
  })

  it('rejects an llm test on a tool with no llm block', () => {
    expect(rejection(withWhen({ llm: { eq: 'YES' } }))).toContain('declares no `llm` block')
  })

  it('rejects an empty llm comparator', () => {
    expect(accepts(withWhen({ llm: {} }, LLM_BLOCK))).toBe(false)
  })

  it('rejects a $param operand naming an undeclared parameter', () => {
    expect(rejection(withWhen({ llm: { eq: { $param: 'ghost' } } }, LLM_BLOCK))).toContain('undeclared parameter "ghost"')
  })

  it('rejects a misspelled comparator inside an llm test', () => {
    expect(accepts(withWhen({ llm: { eq: 'a', gt3: 1 } }, LLM_BLOCK))).toBe(false)
  })
})

describe('the llm block', () => {
  it('accepts a prompt and an errorMessage', () => {
    expect(accepts({ ...BASE, ...LLM_BLOCK })).toBe(true)
  })

  it('rejects a block missing its errorMessage — failure must have the author\'s words', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.' } })).toBe(false)
  })

  it('rejects an empty prompt', () => {
    expect(accepts({ ...BASE, llm: { prompt: '', errorMessage: 'Silence.' } })).toBe(false)
  })

  it('rejects an unknown key inside the block', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', model: 'gpt' } })).toBe(false)
  })

  it('accepts a maxOutput within bounds', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', maxOutput: 50_000 } })).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 12.5],
    ['past the ceiling', 100_001],
  ])('rejects a maxOutput that is %s', (_label, maxOutput) => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', maxOutput } })).toBe(false)
  })
})

describe('when — reference and type rules', () => {
  it('rejects a test of an undeclared parameter', () => {
    expect(rejection(withWhen({ params: { scael: { gt: 12 } } }, NUM_PARAM))).toMatch(
      /tests undeclared parameter "scael"/
    )
  })

  it('rejects a $param operand naming an undeclared parameter', () => {
    expect(rejection(withWhen({ gte: { $param: 'nope' } }, NUM_PARAM))).toMatch(
      /references undeclared parameter "nope"/
    )
  })

  it('rejects ordering a string parameter', () => {
    expect(rejection(withWhen({ params: { material: { gt: 1 } } }, STR_PARAM))).toMatch(/only numbers can be ordered/)
  })

  it('rejects comparing the value with a string', () => {
    // The value is always a number, so this could never hold at run time. The
    // type layer catches it before the cross-field rules ever run.
    expect(rejection(withWhen({ eq: 'brass' }))).toMatch(/expected number/)
  })

  it('rejects a parameter compared against the wrong type', () => {
    expect(rejection(withWhen({ params: { material: { eq: 5 } } }, STR_PARAM))).toMatch(/can never hold/)
  })

  it('points the issue at the offending outcome', () => {
    const result = QtapCustomToolSchema.safeParse(withWhen({ params: { nope: { gt: 1 } } }, NUM_PARAM))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].path).toEqual(['outcomes', 0, 'when', 'params', 'nope'])
  })

  it('still rejects a roll field referencing a non-numeric parameter', () => {
    expect(
      rejection({ ...BASE, ...STR_PARAM, roll: { offset: { $param: 'material' } } })
    ).toMatch(/rather than numeric/)
  })
})

describe('reference specimens', () => {
  it.each([
    ['CUSTOM_TOOL_SPEC.json', rangeSpecimen],
    ['CUSTOM_TOOL_SPEC_DICE.json', diceSpecimen],
  ])('%s is a valid definition', (_name, specimen) => {
    // Asserting on the reason, not the boolean: a specimen that stops parsing
    // should say why in the failure output rather than just 'false'.
    const result = QtapCustomToolSchema.safeParse(specimen)
    expect(result.success ? '' : formatDefinitionIssues(result.error)).toBe('')
  })
})

describe('the JSON Schema mirror agrees with Zod', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  const validate = ajv.compile(mirror)

  /**
   * Each case is checked against BOTH schemas and the verdicts compared. What
   * matters is agreement, not the verdict itself — so the table needs no
   * expected column, and a new rule added to one schema and not the other
   * shows up here rather than in an author's editor.
   */
  const corpus: Array<[string, unknown]> = [
    ['the range specimen', rangeSpecimen],
    ['the dice specimen', diceSpecimen],
    ['a bare minimum definition', BASE],
    ['an authored title', { ...BASE, title: 'Probe the Thing' }],
    ['an empty title', { ...BASE, title: '' }],
    ['an over-long title', { ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }],
    ['a legacy value comparator', withWhen({ gte: 0.3, lte: 0.6 })],
    ['a roll subject', withWhen({ roll: { gte: 15 } })],
    ['a params subject', withWhen({ gt: 1, params: { scale: { gt: 12 } } }, NUM_PARAM)],
    ['eq against a string parameter', withWhen({ params: { material: { eq: 'brass' } } }, STR_PARAM)],
    ['a $param operand', withWhen({ gte: { $param: 'scale' } }, NUM_PARAM)],
    ['a metadata subject', withWhen({ gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } })],
    ['a metadata key outside the identifier grammar', withWhen({ metadata: { 'Clearance Level': { gte: 3 } } })],
    ['an empty-string metadata key', withWhen({ metadata: { '': { eq: 1 } } })],
    ['an empty metadata object', withWhen({ metadata: {} })],
    ['an empty comparator on a metadata key', withWhen({ metadata: { faction: {} } })],
    ['an unknown key inside a metadata comparator', withWhen({ metadata: { faction: { eq: 'a', gt3: 1 } } })],
    ['a $param operand on a metadata key', withWhen({ metadata: { level: { gte: { $param: 'scale' } } } }, NUM_PARAM)],
    ['a test that tests nothing', withWhen({})],
    ['an empty params object', withWhen({ params: {} })],
    ['an empty roll comparator', withWhen({ roll: {} })],
    ['an unknown key inside when', withWhen({ nonsense: 1 })],
    ['an unknown key beside a real comparator', withWhen({ gt: 1, gt3: 2 })],
    ['an unknown key inside an outcome', { ...BASE, outcomes: [{ when: true, message: '-', state: 'info', x: 1 }] }],
    ['an unknown key inside a roll range', { ...BASE, roll: { min: 0, max: 1, bogus: 3 }, outcomes: BASE.outcomes }],
    ['a malformed $param ref', withWhen({ gte: { $param: 'Not An Identifier' } }, NUM_PARAM)],
    ['a string compared with the value', withWhen({ eq: 'brass' })],
    ['an unknown outcome state', { ...BASE, outcomes: [{ when: true, message: '-', state: 'triumph' }] }],
    ['an llm block', { ...BASE, ...LLM_BLOCK }],
    ['an llm block missing its errorMessage', { ...BASE, llm: { prompt: 'Speak.' } }],
    ['an llm block with an empty prompt', { ...BASE, llm: { prompt: '', errorMessage: 'Silence.' } }],
    ['an unknown key inside the llm block', { ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', model: 'x' } }],
    ['an llm answer test', withWhen({ llm: { eq: 'YES' } }, LLM_BLOCK)],
    ['an llm ok test', withWhen({ llm: { ok: false } }, LLM_BLOCK)],
    ['ok ANDed with an answer comparator', withWhen({ llm: { ok: true, eq: 'YES' } }, LLM_BLOCK)],
    ['an ordering test of the llm answer', withWhen({ llm: { gte: 5 } }, LLM_BLOCK)],
    ['an empty llm comparator', withWhen({ llm: {} }, LLM_BLOCK)],
    ['an unknown key inside an llm comparator', withWhen({ llm: { eq: 'a', gt3: 1 } }, LLM_BLOCK)],
    ['a $param operand against the llm answer', withWhen({ llm: { eq: { $param: 'scale' } } }, { ...NUM_PARAM, ...LLM_BLOCK })],
    ['contains against a string parameter', withWhen({ params: { material: { contains: 'ras' } } }, STR_PARAM)],
    ['ncontains against a string parameter', withWhen({ params: { material: { ncontains: 'iron' } } }, STR_PARAM)],
    ['a $param substring operand', withWhen({ llm: { contains: { $param: 'material' } } }, { ...STR_PARAM, ...LLM_BLOCK })],
    ['contains on a metadata key', withWhen({ metadata: { faction: { contains: 'Aurum' } } })],
    ['contains on the llm answer', withWhen({ llm: { contains: 'west door' } }, LLM_BLOCK)],
    ['contains on the bare value', withWhen({ contains: 'x' })],
    ['contains on the raw roll', withWhen({ roll: { contains: 'x' } })],
    ['an empty substring', withWhen({ params: { material: { contains: '' } } }, STR_PARAM)],
    ['a number literal as the substring', withWhen({ params: { material: { contains: 42 } } }, STR_PARAM)],
    ['an llm maxOutput within bounds', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 50_000 } }],
    ['an llm maxOutput of zero', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 0 } }],
    ['a fractional llm maxOutput', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 12.5 } }],
    ['an llm maxOutput past the ceiling', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 100_001 } }],
    ['a templated chipLabel', { ...BASE, chipLabel: 'Agent lambda — {{params.label}}' }],
    ['an empty chipLabel', { ...BASE, chipLabel: '' }],
    ['an over-long chipLabel', { ...BASE, chipLabel: 'x'.repeat(MAX_CHIP_LABEL_LENGTH + 1) }],
    ['a literal-number effect', withEffects([{ target: 'state.encounter.count', value: 3 }])],
    ['a boolean-literal effect', withEffects([{ target: 'metadata.lockBroken', value: true }])],
    ['a quoted-string-expression effect', withEffects([{ target: 'metadata.lockpick', value: "'broken pick'" }])],
    ['an effect conditioned on the winning outcome', withEffects([{ when: { outcome: { eq: 'success' } }, target: 'state.wins', value: 1 }])],
    ['an effect conditioned on metadata', withEffects([{ when: { metadata: { hasKey: { eq: true } } }, target: 'state.opened', value: true }])],
    ['an effect with an empty value string', withEffects([{ target: 'state.x', value: '' }])],
    ['an effect with an over-long value string', withEffects([{ target: 'state.x', value: `'${'x'.repeat(500)}'` }])],
    ['an effect with an empty target', withEffects([{ target: '', value: 1 }])],
    ['an unknown key inside an effect', withEffects([{ target: 'state.x', value: 1, bogus: true }])],
    ['an empty outcome condition on an effect', withEffects([{ when: { outcome: {} }, target: 'state.x', value: 1 }])],
    ['an unknown outcome state in an effect condition', withEffects([{ when: { outcome: { eq: 'triumph' } }, target: 'state.x', value: 1 }])],
    ['an outcome subject inside an effect condition ANDed with a value test', withEffects([{ when: { gt: 0.5, outcome: { neq: 'failure' } }, target: 'state.x', value: 1 }])],
    ['more effects than the cap', withEffects(Array.from({ length: MAX_EFFECTS + 1 }, (_, i) => ({ target: `state.k${i}`, value: 1 })))],
  ]

  it.each(corpus)('on %s', (_label, doc) => {
    expect(validate(doc)).toBe(accepts(doc))
  })

  /**
   * The known, accepted divergence. JSON Schema can say what every outcome
   * looks like but not what the LAST one must be, so the cross-item rules —
   * the mandatory trailing catch-all, and every `$param` reference resolving —
   * are the loader's alone. The mirror is a superset: what it rejects, Zod
   * rejects; what it accepts, Zod may still refuse. Authors are told so in the
   * `outcomes` description, and the badge explains it when it happens.
   */
  it('is deliberately weaker than Zod on cross-item rules', () => {
    const noCatchAll = { ...BASE, outcomes: [{ when: { gt: 1 }, message: '-', state: 'info' }] }
    expect(validate(noCatchAll)).toBe(true)
    expect(accepts(noCatchAll)).toBe(false)
  })

  it('is deliberately weaker than Zod on an llm test with no llm block', () => {
    // Same class of divergence: whether the tool declares an `llm` block is a
    // cross-item fact the mirror cannot see from inside a `when`.
    const orphanLlmTest = withWhen({ llm: { eq: 'YES' } })
    expect(validate(orphanLlmTest)).toBe(true)
    expect(accepts(orphanLlmTest)).toBe(false)
  })

  it('is deliberately weaker than Zod on containment against a numeric parameter', () => {
    // Same class again: which type the named parameter declares is a
    // cross-item fact, so the mirror cannot know a number is being searched.
    const numericHaystack = withWhen({ params: { scale: { contains: '1' } } }, NUM_PARAM)
    expect(validate(numericHaystack)).toBe(true)
    expect(accepts(numericHaystack)).toBe(false)
  })

  it('is deliberately weaker than Zod on the effect expression grammar', () => {
    // The grammar lives in the loader's parser; the mirror can only say
    // "non-empty string ≤ 500" and describe the language in prose. So the
    // bare-prose quoting trap is caught by Zod alone.
    const bareProse = withEffects([{ target: 'metadata.lockpick', value: 'broken pick' }])
    expect(validate(bareProse)).toBe(true)
    expect(accepts(bareProse)).toBe(false)
  })

  it('is deliberately weaker than Zod on effect target syntax', () => {
    // The prefix rule and the underscore guard are the loader's parser too.
    const badPrefix = withEffects([{ target: 'somewhere.else', value: 1 }])
    const userOnly = withEffects([{ target: 'state._secrets.combo', value: 1 }])
    expect(validate(badPrefix)).toBe(true)
    expect(accepts(badPrefix)).toBe(false)
    expect(validate(userOnly)).toBe(true)
    expect(accepts(userOnly)).toBe(false)
  })

  it('is deliberately weaker than Zod on effect cross-item rules', () => {
    // Undeclared params and a missing llm block are cross-item facts the
    // mirror cannot see from inside an effect.
    const ghostParam = withEffects([{ target: 'state.x', value: '{{params.ghost}} + 1' }])
    const orphanLlm = withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }])
    expect(validate(ghostParam)).toBe(true)
    expect(accepts(ghostParam)).toBe(false)
    expect(validate(orphanLlm)).toBe(true)
    expect(accepts(orphanLlm)).toBe(false)
  })
})
