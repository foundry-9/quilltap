/**
 * Pascal's Workbench — draft model round-trips.
 *
 * The §6.2 invariant: load any valid definition into form mode, change
 * nothing, save — the only permissible diffs are key order, whitespace, and
 * default-elision; semantics identical (deep-equal after safeParse). Plus the
 * `when` chip ⇄ JSON bijection across every subject and comparator, and the
 * unknown-key passthrough that keeps v2 files intact.
 */

import {
  conditionsFromWhen,
  definitionFromDraft,
  draftFromDefinition,
  findParameterReferences,
  newDraft,
  renameParameterEverywhere,
  serializeDraft,
  slugFromTitle,
  validateDraft,
  whenFromConditions,
  type DraftCondition,
} from '@/lib/pascal/tool-draft'
import { QtapCustomToolSchema, type WhenObject } from '@/lib/pascal/custom-tool.types'

/**
 * Collapse the permissible diffs — `$schema` handling and default-elision — so
 * the remaining comparison is pure semantics. Deletes any optional key whose
 * value equals its documented default, at both the top level and inside a
 * range-form `roll`.
 */
function normalize(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed }
  delete out.$schema
  if (out.disabled === false) delete out.disabled
  if (out.revealOdds === true) delete out.revealOdds
  if (out.defaultVisibility === 'public') delete out.defaultVisibility
  if (out.parameters && Object.keys(out.parameters as object).length === 0) delete out.parameters
  if (typeof out.roll === 'object' && out.roll !== null) {
    const roll: Record<string, unknown> = { ...(out.roll as Record<string, unknown>) }
    if (roll.min === 0) delete roll.min
    if (roll.max === 1) delete roll.max
    if (roll.multiplier === 1) delete roll.multiplier
    if (roll.offset === 0) delete roll.offset
    if (roll.round === false) delete roll.round
    if (Object.keys(roll).length === 0) delete out.roll
    else out.roll = roll
  }
  return out
}

/** Load → serialize → parse both sides and demand identical semantics. */
function expectRoundTrip(document: Record<string, unknown>) {
  const draft = draftFromDefinition(document)
  expect(draft).not.toBeNull()

  const emitted = definitionFromDraft(draft!)

  const before = QtapCustomToolSchema.safeParse(document)
  const after = QtapCustomToolSchema.safeParse(emitted)
  expect(before.success).toBe(true)
  expect(after.success).toBe(true)
  expect(normalize(after.data as unknown as Record<string, unknown>)).toEqual(
    normalize(before.data as unknown as Record<string, unknown>)
  )
  return emitted
}

describe('draft round-trip (§6.2 invariant)', () => {
  it('round-trips a minimal definition', () => {
    const emitted = expectRoundTrip({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      outcomes: [{ when: true, message: 'The lock resists.', state: 'info' }],
    })

    // Canonical emission: $schema first, no bloat added.
    expect(Object.keys(emitted)).toEqual(['$schema', 'name', 'description', 'outcomes'])
  })

  it('round-trips the full surface: params, transforms, every subject', () => {
    expectRoundTrip({
      $schema: '/schemas/qtap-custom-tool.schema.json',
      name: 'measure',
      title: 'Measure the Field',
      description: 'Take a reading.',
      disabled: true,
      revealOdds: false,
      defaultVisibility: 'whisper',
      parameters: {
        baseline: { type: 'number', default: 0, description: 'Floor.', min: -10, max: 10 },
        scale: { type: 'integer', default: 2 },
        material: { type: 'string', default: 'brass' },
        blessed: { type: 'boolean', default: false },
      },
      roll: {
        min: { $param: 'baseline' },
        max: 100,
        multiplier: 2,
        offset: { $param: 'scale' },
        round: true,
      },
      outcomes: [
        {
          when: {
            gte: 10,
            lte: 90,
            roll: { lt: 0.9 },
            params: { material: { eq: 'brass', ncontains: 'iron' }, scale: { gt: { $param: 'baseline' } } },
            metadata: {
              'has ansible access': { eq: true },
              clearanceLevel: { gte: { $param: 'scale' } },
            },
          },
          message: 'Reading: {{value}} ({{params.material}})',
          state: 'success',
        },
        { when: { neq: 0 }, message: 'Odd reading {{roll}}.', state: 'partial' },
        { when: true, message: 'Nothing.', state: 'failure' },
      ],
    })
  })

  it('round-trips a dice definition', () => {
    expectRoundTrip({
      name: 'saving_throw',
      description: 'Roll a d20 saving throw.',
      roll: '1d20',
      outcomes: [
        { when: { gte: 12 }, message: 'Saved! ({{dice}})', state: 'success' },
        { when: true, message: 'Failed. ({{dice}})', state: 'failure' },
      ],
    })
  })

  it('elides defaults a hand-written file left implicit', () => {
    const emitted = expectRoundTrip({
      name: 'plain',
      description: 'A plain tool.',
      disabled: false,
      revealOdds: true,
      defaultVisibility: 'public',
      roll: { min: 0, max: 1, multiplier: 1, offset: 0, round: false },
      outcomes: [{ when: true, message: 'Done.', state: 'info' }],
    })

    expect(emitted.disabled).toBeUndefined()
    expect(emitted.revealOdds).toBeUndefined()
    expect(emitted.defaultVisibility).toBeUndefined()
    expect(emitted.roll).toBeUndefined()
  })

  it('passes unknown top-level keys through untouched, after known keys', () => {
    const emitted = expectRoundTrip({
      name: 'ratchet',
      persist: { baseline: '{{value}}' },
      futureKey: [1, 2, 3],
      description: 'A v2 file.',
      outcomes: [{ when: true, message: 'Done.', state: 'info' }],
    })

    expect(emitted.persist).toEqual({ baseline: '{{value}}' })
    expect(emitted.futureKey).toEqual([1, 2, 3])
    const keys = Object.keys(emitted)
    expect(keys.indexOf('persist')).toBeGreaterThan(keys.indexOf('outcomes'))
    // Original relative order of unknown keys is preserved.
    expect(keys.indexOf('persist')).toBeLessThan(keys.indexOf('futureKey'))
  })

  it('preserves a non-default $schema value and inserts one when absent', () => {
    const custom = expectRoundTrip({
      $schema: 'https://example.com/custom.schema.json',
      name: 'remote',
      description: 'Points elsewhere.',
      outcomes: [{ when: true, message: 'Done.', state: 'info' }],
    })
    expect(custom.$schema).toBe('https://example.com/custom.schema.json')

    const inserted = expectRoundTrip({
      name: 'bare',
      description: 'No $schema.',
      outcomes: [{ when: true, message: 'Done.', state: 'info' }],
    })
    expect(inserted.$schema).toBe('/schemas/qtap-custom-tool.schema.json')
  })

  it('emits 2-space indent with a trailing newline', () => {
    const draft = draftFromDefinition({
      name: 'plain',
      description: 'A plain tool.',
      outcomes: [{ when: true, message: 'Done.', state: 'info' }],
    })
    const text = serializeDraft(draft!)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "name": "plain"')
  })

  it('refuses an invalid document', () => {
    expect(draftFromDefinition({ name: 'broken' })).toBeNull()
    expect(draftFromDefinition('not even an object')).toBeNull()
  })
})

describe('when chips ⇄ JSON bijection', () => {
  function expectWhenRoundTrip(when: WhenObject) {
    const chips = conditionsFromWhen(when)
    expect(whenFromConditions(chips)).toEqual(when)
    return chips
  }

  it('covers every comparator on the value subject', () => {
    const chips = expectWhenRoundTrip({ gt: 1, gte: 2, lt: 9, lte: 8, eq: 5, neq: 4 })
    expect(chips).toHaveLength(6)
    expect(chips.map((c) => c.comparator)).toEqual(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'])
    expect(chips.every((c) => c.subject.kind === 'value')).toBe(true)
  })

  it('covers the raw-roll subject and $param operands', () => {
    const chips = expectWhenRoundTrip({ roll: { lte: { $param: 'fumble_under' }, gt: 0 } })
    const paramOperand = chips.find((c) => c.operand.kind === 'param')
    expect(paramOperand?.subject).toEqual({ kind: 'roll' })
    expect(paramOperand?.operand).toEqual({ kind: 'param', name: 'fumble_under' })
  })

  it('covers param subjects with string, boolean, and number literals', () => {
    expectWhenRoundTrip({
      params: {
        material: { eq: 'brass', neq: 'iron' },
        blessed: { eq: true },
        scale: { gte: 3 },
      },
    })
  })

  it('covers metadata subjects with exotic keys and every operand shape', () => {
    expectWhenRoundTrip({
      metadata: {
        'keys with spaces': { eq: 'yes' },
        'dotted.key.name': { neq: false },
        'ünïcode✓': { gte: { $param: 'threshold' } },
        plain: { lt: 12 },
      },
    })
  })

  it('covers containment on param, metadata, and llm subjects', () => {
    const chips = expectWhenRoundTrip({
      params: { material: { contains: 'ras', ncontains: 'iron' } },
      metadata: { faction: { contains: 'Aurum' } },
      llm: { ncontains: { $param: 'forbidden' } },
    } as WhenObject)
    expect(chips.map((c) => c.comparator)).toEqual(['contains', 'ncontains', 'contains', 'ncontains'])
    expect(chips[3].operand).toEqual({ kind: 'param', name: 'forbidden' })
  })

  it('merges a band on one subject into one comparator object', () => {
    const chips: DraftCondition[] = [
      { id: 'a', subject: { kind: 'value' }, comparator: 'gte', operand: { kind: 'number', text: '0.3' } },
      { id: 'b', subject: { kind: 'value' }, comparator: 'lte', operand: { kind: 'number', text: '0.6' } },
    ]
    expect(whenFromConditions(chips)).toEqual({ gte: 0.3, lte: 0.6 })
  })

  it('keeps metadata identity per key: two keys with the same comparator coexist', () => {
    const when: WhenObject = {
      metadata: { strength: { gte: 10 }, cunning: { gte: 4 } },
    } as WhenObject
    const chips = conditionsFromWhen(when)
    expect(chips).toHaveLength(2)
    expect(whenFromConditions(chips)).toEqual(when)
  })
})

describe('validateDraft', () => {
  it('accepts a well-formed loaded draft', () => {
    const draft = draftFromDefinition({
      name: 'fine',
      description: 'A fine tool.',
      outcomes: [
        { when: { gte: 0.5 }, message: 'High.', state: 'success' },
        { when: true, message: 'Low.', state: 'failure' },
      ],
    })
    expect(validateDraft(draft!).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('starts a new draft with the empty row in error state', () => {
    const issues = validateDraft(newDraft())
    expect(issues.some((i) => i.message.includes('must test something'))).toBe(true)
    expect(issues.some((i) => i.where.section === 'identity')).toBe(true)
  })

  it('blocks duplicate subject+comparator pairs but not distinct metadata keys', () => {
    const draft = newDraft()
    draft.name = 'dup'
    draft.description = 'x'
    draft.outcomes[0].message = 'm'
    draft.outcomes[0].conditions = [
      { id: 'a', subject: { kind: 'metadata', key: 'strength' }, comparator: 'gte', operand: { kind: 'number', text: '1' } },
      { id: 'b', subject: { kind: 'metadata', key: 'cunning' }, comparator: 'gte', operand: { kind: 'number', text: '1' } },
    ]
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])

    draft.outcomes[0].conditions.push({
      id: 'c',
      subject: { kind: 'metadata', key: 'strength' },
      comparator: 'gte',
      operand: { kind: 'number', text: '5' },
    })
    const issues = validateDraft(draft)
    expect(issues.some((i) => i.message.includes('only once'))).toBe(true)
  })

  it('warns on {{dice}} in range form without blocking', () => {
    const draft = draftFromDefinition({
      name: 'ranged',
      description: 'x',
      outcomes: [{ when: true, message: 'Rolled {{dice}}.', state: 'info' }],
    })
    const issues = validateDraft(draft!)
    const diceIssue = issues.find((i) => i.message.includes('{{dice}}'))
    expect(diceIssue?.severity).toBe('warning')
  })

  it('never flags {{metadata.*}} placeholders as unknown', () => {
    const draft = draftFromDefinition({
      name: 'meta',
      description: 'x',
      outcomes: [{ when: true, message: 'Sheet says {{metadata.some key nobody declared}}.', state: 'info' }],
    })
    expect(validateDraft(draft!)).toEqual([])
  })

  it('warns on a typo placeholder but does not block', () => {
    const draft = draftFromDefinition({
      name: 'typo',
      description: 'x',
      parameters: { bonus: { type: 'number', default: 0 } },
      outcomes: [{ when: true, message: '{{params.bonsu}} and {{vlaue}}.', state: 'info' }],
    })
    const issues = validateDraft(draft!)
    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  it('audits containment chips: text subjects, text operands, nothing empty', () => {
    const draft = newDraft()
    draft.name = 'contain'
    draft.description = 'x'
    draft.parameters = [
      { id: 'p1', name: 'scale', type: 'number', defaultValue: '1', description: '', min: '', max: '' },
      { id: 'p2', name: 'material', type: 'string', defaultValue: 'brass', description: '', min: '', max: '' },
    ]
    draft.outcomes[0].message = 'm'

    const chip = (partial: Partial<DraftCondition>): DraftCondition[] => [
      {
        id: 'a',
        subject: { kind: 'param', name: 'material' },
        comparator: 'contains',
        operand: { kind: 'string', text: 'ras' },
        ...partial,
      },
    ]

    draft.outcomes[0].conditions = chip({})
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])

    draft.outcomes[0].conditions = chip({ subject: { kind: 'param', name: 'scale' } })
    expect(validateDraft(draft).some((i) => i.message.includes('only text can contain text'))).toBe(true)

    draft.outcomes[0].conditions = chip({ operand: { kind: 'param', name: 'scale' } })
    expect(validateDraft(draft).some((i) => i.message.includes('needs text to look for'))).toBe(true)

    draft.outcomes[0].conditions = chip({ operand: { kind: 'string', text: '' } })
    expect(validateDraft(draft).some((i) => i.message.includes('must not be empty'))).toBe(true)

    draft.outcomes[0].conditions = chip({ operand: { kind: 'number', text: '5' } })
    expect(validateDraft(draft).some((i) => i.message.includes('needs text to look for'))).toBe(true)
  })

  it('rejects containment on whether the consult succeeded', () => {
    const draft = newDraft()
    draft.name = 'okc'
    draft.description = 'x'
    draft.llmEnabled = true
    draft.llmPrompt = 'Speak.'
    draft.llmErrorMessage = 'Silence.'
    draft.outcomes[0].message = 'm'
    draft.outcomes[0].conditions = [
      { id: 'a', subject: { kind: 'llm-ok' }, comparator: 'contains', operand: { kind: 'string', text: 'x' } },
    ]
    expect(validateDraft(draft).some((i) => i.message.includes('= or ≠'))).toBe(true)
  })

  it('flags a literal min above a literal max, but not a $param bound', () => {
    const draft = newDraft()
    draft.name = 'bounds'
    draft.description = 'x'
    draft.outcomes[0].conditions = [
      { id: 'a', subject: { kind: 'value' }, comparator: 'gte', operand: { kind: 'number', text: '0' } },
    ]
    draft.outcomes[0].message = 'm'

    draft.rollRange.min = { kind: 'literal', text: '5' }
    draft.rollRange.max = { kind: 'literal', text: '2' }
    expect(validateDraft(draft).some((i) => i.message.includes('low bound'))).toBe(true)

    draft.parameters = [
      { id: 'p1', name: 'top', type: 'number', defaultValue: '9', description: '', min: '', max: '' },
    ]
    draft.rollRange.max = { kind: 'param', name: 'top' }
    expect(validateDraft(draft).some((i) => i.message.includes('low bound'))).toBe(false)
  })
})

describe('parameter rename and reference finding', () => {
  const document = {
    name: 'opposed',
    description: 'x',
    parameters: { difficulty: { type: 'number' as const, default: 10 } },
    roll: { offset: { $param: 'difficulty' } },
    outcomes: [
      {
        when: { gte: { $param: 'difficulty' }, params: { difficulty: { gt: 0 } } },
        message: 'Beat {{params.difficulty}}.',
        state: 'success' as const,
      },
      { when: true, message: 'Failed.', state: 'failure' as const },
    ],
  }

  it('finds every reference site for the deletion confirm', () => {
    const draft = draftFromDefinition(document)!
    const sites = findParameterReferences(draft, 'difficulty')
    expect(sites.sort()).toEqual(
      [
        'roll offset',
        'outcome 1: a condition tests it',
        'outcome 1: a condition compares against it',
        'outcome 1: the message renders it',
      ].sort()
    )
  })

  it('renames everywhere atomically and stays valid', () => {
    const draft = draftFromDefinition(document)!
    const renamed = renameParameterEverywhere(draft, 'difficulty', 'target')

    const emitted = definitionFromDraft(renamed)
    const parsed = QtapCustomToolSchema.safeParse(emitted)
    expect(parsed.success).toBe(true)
    expect(JSON.stringify(emitted)).not.toContain('difficulty')
    expect((emitted.roll as { offset: unknown }).offset).toEqual({ $param: 'target' })
    expect((emitted.outcomes as Array<{ message: string }>)[0].message).toBe('Beat {{params.target}}.')
  })
})

describe('slugFromTitle', () => {
  it.each([
    ['Force the Lock', 'force_the_lock'],
    ["The Baron's Gambit", 'the_barons_gambit'],
    ['  3 Wishes!  ', 'wishes'],
    ['Scan — Hawking Radiation', 'scan_hawking_radiation'],
  ])('%s → %s', (title, expected) => {
    expect(slugFromTitle(title)).toBe(expected)
  })
})

describe('the llm block in the draft', () => {
  const ORACLE_TOOL = {
    name: 'augury',
    description: 'Consult the oracle.',
    llm: { prompt: 'YES or NO about {{value}}?', errorMessage: 'The wire went dead.' },
    outcomes: [
      { when: { llm: { ok: false } }, message: 'Silence: {{llm}}', state: 'failure' },
      { when: { llm: { eq: 'YES', ok: true } }, message: 'Assent.', state: 'success' },
      { when: true, message: 'Demurral: {{llm}}', state: 'info' },
    ],
  }

  it('round-trips a definition with an llm block and llm tests', () => {
    const emitted = expectRoundTrip(ORACLE_TOOL)
    expect(Object.keys(emitted)).toEqual(['$schema', 'name', 'description', 'llm', 'outcomes'])
  })

  it('loads the block into the draft fields', () => {
    const draft = draftFromDefinition(ORACLE_TOOL)!
    expect(draft.llmEnabled).toBe(true)
    expect(draft.llmPrompt).toBe('YES or NO about {{value}}?')
    expect(draft.llmErrorMessage).toBe('The wire went dead.')
  })

  it('emits no llm key while the consult is disabled', () => {
    const draft = newDraft()
    draft.llmPrompt = 'kept but dormant'
    expect(definitionFromDraft(draft).llm).toBeUndefined()
  })

  it('round-trips maxOutput, and omits it while blank', () => {
    const capped = { ...ORACLE_TOOL, llm: { ...ORACLE_TOOL.llm, maxOutput: 50000 } }
    expectRoundTrip(capped)

    const draft = draftFromDefinition(capped)!
    expect(draft.llmMaxOutput).toBe('50000')

    draft.llmMaxOutput = ''
    expect((definitionFromDraft(draft).llm as { maxOutput?: number }).maxOutput).toBeUndefined()
  })

  it('rejects a nonsense answer cap while enabled', () => {
    const draft = draftFromDefinition(ORACLE_TOOL)!
    draft.llmMaxOutput = '0'
    let messages = validateDraft(draft).filter((i) => i.severity === 'error').map((i) => i.message)
    expect(messages.some((m) => m.includes('whole number'))).toBe(true)

    draft.llmMaxOutput = '999999'
    messages = validateDraft(draft).filter((i) => i.severity === 'error').map((i) => i.message)
    expect(messages.some((m) => m.includes('tops out'))).toBe(true)
  })

  it('bijects ok and answer comparators through chips', () => {
    const when = { llm: { gte: 5, eq: 'YES', ok: false } } as WhenObject
    const chips = conditionsFromWhen(when)
    // ok rides its own chip kind; the rest are ordinary comparator chips.
    expect(chips.map((c) => c.subject.kind)).toEqual(['llm-ok', 'llm', 'llm'])
    expect(whenFromConditions(chips)).toEqual(when)
  })

  it('serializes a "succeeded ≠ true" chip as ok: false', () => {
    const chips: DraftCondition[] = [
      { id: 'a', subject: { kind: 'llm-ok' }, comparator: 'neq', operand: { kind: 'boolean', value: true } },
    ]
    expect(whenFromConditions(chips)).toEqual({ llm: { ok: false } })
  })

  describe('validation', () => {
    it('requires a prompt and an error message while enabled', () => {
      const draft = draftFromDefinition(ORACLE_TOOL)!
      draft.llmPrompt = '  '
      draft.llmErrorMessage = ''
      const messages = validateDraft(draft).filter((i) => i.severity === 'error').map((i) => i.message)
      expect(messages).toEqual(
        expect.arrayContaining([expect.stringContaining('needs a prompt'), expect.stringContaining('error message')])
      )
    })

    it('flags llm chips when the consult is disabled', () => {
      const draft = draftFromDefinition(ORACLE_TOOL)!
      draft.llmEnabled = false
      const messages = validateDraft(draft).filter((i) => i.severity === 'error').map((i) => i.message)
      expect(messages.some((m) => m.includes('consult is not enabled'))).toBe(true)
    })

    it('warns on {{llm}} inside the prompt itself', () => {
      const draft = draftFromDefinition(ORACLE_TOOL)!
      draft.llmPrompt = 'Echo {{llm}} back?'
      const warnings = validateDraft(draft).filter((i) => i.severity === 'warning').map((i) => i.message)
      expect(warnings.some((m) => m.includes('cannot quote its own answer'))).toBe(true)
    })

    it('warns on {{llm}} in a message while the consult is off', () => {
      const draft = newDraft()
      draft.name = 'plain'
      draft.description = 'd'
      draft.outcomes = [draft.outcomes[1]]
      draft.outcomes[0].message = 'Says {{llm}}.'
      const warnings = validateDraft(draft).filter((i) => i.severity === 'warning').map((i) => i.message)
      expect(warnings.some((m) => m.includes('unless the LLM consult is enabled'))).toBe(true)
    })
  })

  it('renames a parameter inside the consult prompt, and finds it as a reference', () => {
    const withParam = draftFromDefinition({
      ...ORACLE_TOOL,
      parameters: { omen: { type: 'string', default: 'sparrows' } },
      llm: { prompt: 'What of the {{params.omen}}?', errorMessage: 'Silence.' },
    })!
    expect(findParameterReferences(withParam, 'omen')).toEqual(['the consult prompt renders it'])
    const renamed = renameParameterEverywhere(withParam, 'omen', 'portent')
    expect(renamed.llmPrompt).toBe('What of the {{params.portent}}?')
  })
})

describe('the availability gate in the draft', () => {
  const GATED_TOOL = {
    name: 'reprogram',
    description: 'Rewrite the thing’s instructions.',
    availableWhen: {
      metadata: {
        toolAbilities: { contains: 'programmable' },
        rank: { gte: 3 },
        cleared: { eq: true },
      },
    },
    outcomes: [{ when: true, message: 'It obliges.', state: 'success' }],
  }

  it('round-trips an availableWhen gate', () => {
    expectRoundTrip(GATED_TOOL)
  })

  it('round-trips a withheldWhen gate', () => {
    const { availableWhen, ...rest } = GATED_TOOL
    expectRoundTrip({ ...rest, withheldWhen: availableWhen })
  })

  it('loads the clause into the mode, and the tests into chips', () => {
    const draft = draftFromDefinition(GATED_TOOL)!
    expect(draft.gateMode).toBe('available')
    expect(draft.gateConditions.map((c) => [c.key, c.comparator, c.operand])).toEqual([
      ['toolAbilities', 'contains', { kind: 'string', text: 'programmable' }],
      ['rank', 'gte', { kind: 'number', text: '3' }],
      ['cleared', 'eq', { kind: 'boolean', value: true }],
    ])
  })

  it('emits neither key while the mode is none, whatever chips linger', () => {
    const draft = draftFromDefinition(GATED_TOOL)!
    draft.gateMode = 'none'
    const emitted = definitionFromDraft(draft)
    expect(emitted.availableWhen).toBeUndefined()
    expect(emitted.withheldWhen).toBeUndefined()
    // The chips survive the flip, so switching back costs nothing.
    expect(draft.gateConditions).toHaveLength(3)
  })

  it('flips the clause without disturbing the tests', () => {
    const draft = draftFromDefinition(GATED_TOOL)!
    draft.gateMode = 'withheld'
    const emitted = definitionFromDraft(draft)
    expect(emitted.availableWhen).toBeUndefined()
    expect(emitted.withheldWhen).toEqual(GATED_TOOL.availableWhen)
  })

  it('emits an ungated tool with no gate keys at all', () => {
    const emitted = definitionFromDraft(draftFromDefinition({ ...GATED_TOOL, availableWhen: undefined })!)
    expect('availableWhen' in emitted).toBe(false)
    expect('withheldWhen' in emitted).toBe(false)
  })

  it('refuses a definition carrying both clauses — the form models one', () => {
    expect(
      draftFromDefinition({
        ...GATED_TOOL,
        withheldWhen: { metadata: { novice: { eq: true } } },
      })
    ).toBeNull()
  })

  describe('validateDraft', () => {
    const gated = (): ReturnType<typeof newDraft> => {
      const draft = newDraft()
      draft.name = 'reprogram'
      draft.description = 'd'
      draft.outcomes = [draft.outcomes[1]]
      draft.gateMode = 'available'
      return draft
    }

    const gateErrors = (draft: ReturnType<typeof newDraft>): string[] =>
      validateDraft(draft)
        .filter((i) => i.severity === 'error' && i.where.section === 'gate')
        .map((i) => i.message)

    it('blocks a gate that tests nothing', () => {
      expect(gateErrors(gated()).some((m) => m.includes('must test something'))).toBe(true)
    })

    it('blocks a condition with no metadata key', () => {
      const draft = gated()
      draft.gateConditions = [{ id: 'g1', key: '  ', comparator: 'eq', operand: { kind: 'boolean', value: true } }]
      expect(gateErrors(draft).some((m) => m.includes('needs a metadata key'))).toBe(true)
    })

    it('blocks ordering against text, and containment against a number', () => {
      const draft = gated()
      draft.gateConditions = [
        { id: 'g1', key: 'rank', comparator: 'gte', operand: { kind: 'string', text: 'senior' } },
        { id: 'g2', key: 'abilities', comparator: 'contains', operand: { kind: 'number', text: '7' } },
      ]
      const errors = gateErrors(draft)
      expect(errors.some((m) => m.includes('can only order numbers'))).toBe(true)
      expect(errors.some((m) => m.includes('needs text to look for'))).toBe(true)
    })

    it('blocks an empty substring and an unparseable number', () => {
      const draft = gated()
      draft.gateConditions = [
        { id: 'g1', key: 'abilities', comparator: 'contains', operand: { kind: 'string', text: '' } },
        { id: 'g2', key: 'rank', comparator: 'eq', operand: { kind: 'number', text: '' } },
      ]
      const errors = gateErrors(draft)
      expect(errors.some((m) => m.includes('must not be empty'))).toBe(true)
      expect(errors.some((m) => m.includes('needs a number'))).toBe(true)
    })

    it('blocks the same key tested twice with the same comparator', () => {
      const draft = gated()
      draft.gateConditions = [
        { id: 'g1', key: 'rank', comparator: 'gte', operand: { kind: 'number', text: '3' } },
        { id: 'g2', key: 'rank', comparator: 'gte', operand: { kind: 'number', text: '5' } },
      ]
      expect(gateErrors(draft).some((m) => m.includes('only once'))).toBe(true)
    })

    it('says nothing about a gate the author has switched off', () => {
      const draft = gated()
      draft.gateMode = 'none'
      draft.gateConditions = [{ id: 'g1', key: '', comparator: 'eq', operand: { kind: 'boolean', value: true } }]
      expect(gateErrors(draft)).toEqual([])
    })

    it('passes a complete gate', () => {
      const draft = gated()
      draft.gateConditions = [
        { id: 'g1', key: 'toolAbilities', comparator: 'contains', operand: { kind: 'string', text: 'programmable' } },
      ]
      expect(gateErrors(draft)).toEqual([])
      expect(QtapCustomToolSchema.safeParse(definitionFromDraft(draft)).success).toBe(true)
    })
  })
})

describe('the chip label in the draft', () => {
  const BASE = {
    name: 'agent_lambda',
    description: 'Dispatch.',
    outcomes: [{ when: true, message: '-', state: 'info' }],
  }

  it('round-trips a chipLabel', () => {
    expectRoundTrip({ ...BASE, chipLabel: 'Agent lambda — {{params.label}}', parameters: { label: { type: 'string', default: '' } } })
  })

  it('emits no chipLabel key while blank', () => {
    const draft = newDraft()
    draft.name = 'probe'
    draft.description = 'x'
    expect('chipLabel' in definitionFromDraft(draft)).toBe(false)
  })

  it('errors on an over-long chip label', () => {
    const draft = newDraft()
    draft.chipLabel = 'x'.repeat(161)
    expect(
      validateDraft(draft).some(
        (i) => i.severity === 'error' && i.where.section === 'identity' && i.where.field === 'chipLabel',
      ),
    ).toBe(true)
  })

  it('warns — never errors — on {{llm}} without the oracle, and accepts it with one', () => {
    const draft = newDraft()
    draft.chipLabel = 'Consulted: {{llm}}'
    const withoutOracle = validateDraft(draft).filter(
      (i) => i.where.section === 'identity' && i.where.field === 'chipLabel',
    )
    expect(withoutOracle).toHaveLength(1)
    expect(withoutOracle[0].severity).toBe('warning')

    draft.llmEnabled = true
    draft.llmPrompt = 'Speak.'
    draft.llmErrorMessage = 'Silence.'
    expect(
      validateDraft(draft).filter((i) => i.where.section === 'identity' && i.where.field === 'chipLabel'),
    ).toEqual([])
  })

  it('warns on a placeholder naming no declared parameter', () => {
    const draft = newDraft()
    draft.chipLabel = '{{params.ghost}}'
    const issues = validateDraft(draft).filter(
      (i) => i.where.section === 'identity' && i.where.field === 'chipLabel',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
  })
})

describe('effects in the draft', () => {
  const BASE = {
    name: 'unlock',
    description: 'Pick the lock.',
    outcomes: [{ when: true, message: '-', state: 'info' }],
  }

  /** Issues anchored to any effect row. */
  function effectIssues(draft: ReturnType<typeof newDraft>) {
    return validateDraft(draft).filter((i) => i.where.section === 'effect')
  }

  it('round-trips a literal, an expression, and every when shape', () => {
    expectRoundTrip({
      ...BASE,
      parameters: { by: { type: 'number', default: 1 } },
      effects: [
        { target: 'state.tally', value: 3 },
        { target: 'metadata.lockBroken', value: true },
        { when: { outcome: { eq: 'failure' } }, target: 'metadata.lockpick', value: "'broken pick'" },
        { when: { gte: 0.5, metadata: { hasKey: { eq: true } } }, target: 'state.opened', value: '{{value}} + {{params.by}}' },
      ],
    })
  })

  it('maps the when shapes onto their form kinds', () => {
    const draft = draftFromDefinition({
      ...BASE,
      effects: [
        { target: 'state.a', value: 1 },
        { when: { outcome: { eq: 'success' } }, target: 'state.b', value: 1 },
        { when: { outcome: { neq: 'failure' } }, target: 'state.c', value: 1 },
        { when: { gt: 0.5 }, target: 'state.d', value: 1 },
      ],
    })!
    expect(draft.effects.map((e) => e.when.kind)).toEqual(['always', 'outcome-state', 'verbatim', 'verbatim'])
  })

  it('emits no effects key while the list is empty', () => {
    const draft = newDraft()
    draft.name = 'probe'
    draft.description = 'x'
    expect('effects' in definitionFromDraft(draft)).toBe(false)
  })

  it('errors on a target with the wrong prefix, an underscore-guarded path, and a blank', () => {
    const draft = newDraft()
    draft.effects = [
      { id: 'e1', when: { kind: 'always' }, target: 'nowhere.x', valueKind: 'literal-number', value: '1' },
      { id: 'e2', when: { kind: 'always' }, target: 'state._secret', valueKind: 'literal-number', value: '1' },
      { id: 'e3', when: { kind: 'always' }, target: '', valueKind: 'literal-number', value: '1' },
    ]
    expect(effectIssues(draft).filter((i) => i.severity === 'error')).toHaveLength(3)
  })

  it('errors on the bare-prose quoting trap', () => {
    const draft = newDraft()
    draft.effects = [
      { id: 'e1', when: { kind: 'always' }, target: 'metadata.lockpick', valueKind: 'expression', value: 'broken pick' },
    ]
    const issues = effectIssues(draft)
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('does not parse'))).toBe(true)
  })

  it('errors on an expression naming an undeclared parameter', () => {
    const draft = newDraft()
    draft.effects = [
      { id: 'e1', when: { kind: 'always' }, target: 'state.x', valueKind: 'expression', value: '{{params.ghost}} + 1' },
    ]
    expect(effectIssues(draft).some((i) => i.message.includes('ghost'))).toBe(true)
  })

  it('errors on {{llm}} (and a verbatim llm condition) without the oracle enabled', () => {
    const draft = newDraft()
    draft.effects = [
      { id: 'e1', when: { kind: 'always' }, target: 'state.x', valueKind: 'expression', value: '{{llm}}' },
      { id: 'e2', when: { kind: 'verbatim', when: { llm: { ok: true } } }, target: 'state.y', valueKind: 'literal-number', value: '1' },
    ]
    expect(effectIssues(draft).filter((i) => i.severity === 'error')).toHaveLength(2)

    draft.llmEnabled = true
    draft.llmPrompt = 'Speak.'
    draft.llmErrorMessage = 'Silence.'
    expect(effectIssues(draft)).toEqual([])
  })

  it('errors past the effects cap', () => {
    const draft = newDraft()
    draft.effects = Array.from({ length: 17 }, (_, i) => ({
      id: `e${i}`,
      when: { kind: 'always' as const },
      target: `state.k${i}`,
      valueKind: 'literal-number' as const,
      value: '1',
    }))
    expect(validateDraft(draft).some((i) => i.message.includes('at most 16 effects'))).toBe(true)
  })
})
