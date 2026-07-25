/**
 * Custom tools — the vocabulary summary the run dialog shows.
 *
 * Two rules under test. First, every field is an *occurrence*: a placeholder
 * the definition actually writes, a metadata key some `when` actually tests, a
 * `$state` reference it actually carries. Availability is not enough — a tool
 * that rolls dice but never says `{{dice}}` does not quote it.
 *
 * Second, a boundary: what a definition quotes is collected, and nothing it
 * *decides with* is — no thresholds, no outcome ordering, no roll spec. See the
 * module header for why that line sits where it does.
 */

import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'
import { collectToolVocabulary, isEmptyVocabulary } from '@/lib/pascal/tool-vocabulary'

/** Parse through the real schema, so no test can assert on an invalid tool. */
function define(partial: Record<string, unknown>) {
  return QtapCustomToolSchema.parse({
    name: 'probe',
    description: 'A probe.',
    outcomes: [{ when: true, message: '-', state: 'info' }],
    ...partial,
  })
}

describe('collectToolVocabulary', () => {
  it('reports empty lists for a definition that quotes nothing', () => {
    expect(collectToolVocabulary(define({}))).toEqual({
      value: false,
      roll: false,
      dice: false,
      llm: false,
      params: [],
      metadata: [],
      state: [],
    })
  })

  it('collects metadata keys from when.metadata tests', () => {
    const tool = define({
      outcomes: [
        { when: { metadata: { hasAnsibleAccess: { eq: true } } }, message: 'Yes.', state: 'success' },
        { when: true, message: 'No.', state: 'failure' },
      ],
    })

    expect(collectToolVocabulary(tool).metadata).toEqual(['hasAnsibleAccess'])
  })

  it('collects metadata keys from placeholders, including in the catch-all message', () => {
    const tool = define({
      outcomes: [{ when: true, message: 'The {{metadata.rank}} of {{metadata.homeworld}}.', state: 'info' }],
    })

    expect(collectToolVocabulary(tool).metadata).toEqual(['homeworld', 'rank'])
  })

  it('unions and de-duplicates a key that is both tested and quoted', () => {
    const tool = define({
      outcomes: [
        { when: { metadata: { rank: { eq: 'captain' } } }, message: 'Aye, {{metadata.rank}}.', state: 'success' },
        { when: true, message: '-', state: 'info' },
      ],
    })

    expect(collectToolVocabulary(tool).metadata).toEqual(['rank'])
  })

  it('collects $state references from a parameter default and a roll field', () => {
    const tool = define({
      parameters: {
        bonus: { type: 'number', default: { $state: 'player.luck', fallback: 0 } },
      },
      roll: { min: 1, max: { $state: 'world.ceiling', fallback: 20 } },
    })

    expect(collectToolVocabulary(tool).state).toEqual(['player.luck', 'world.ceiling'])
  })

  it('collects $state references buried in a comparator operand', () => {
    const tool = define({
      outcomes: [
        { when: { gte: { $state: 'difficulty.current', fallback: 10 } }, message: 'Clear.', state: 'success' },
        { when: true, message: '-', state: 'info' },
      ],
    })

    expect(collectToolVocabulary(tool).state).toEqual(['difficulty.current'])
  })

  it('collects state paths from {{state.path}} placeholders', () => {
    const tool = define({
      outcomes: [{ when: true, message: 'Health stands at {{state.player.health}}.', state: 'info' }],
    })

    expect(collectToolVocabulary(tool).state).toEqual(['player.health'])
  })

  it('reads the oracle prompt for placeholders as well as the messages', () => {
    const tool = define({
      roll: '3d6+2',
      llm: {
        prompt: 'Given {{metadata.station}} and {{state.weather}}, one word: YES or NO?',
        errorMessage: 'The wire crackles.',
      },
      outcomes: [{ when: { llm: { ok: true } }, message: '{{llm}}', state: 'success' }, { when: true, message: '-', state: 'info' }],
    })

    const vocabulary = collectToolVocabulary(tool)
    expect(vocabulary.llm).toBe(true)
    expect(vocabulary.metadata).toEqual(['station'])
    expect(vocabulary.state).toEqual(['weather'])
  })

  it('reports the four bare placeholders only where they are actually written', () => {
    const quoted = define({
      roll: '1d20',
      outcomes: [{ when: true, message: 'A {{roll}} on {{dice}}.', state: 'info' }],
    })

    expect(collectToolVocabulary(quoted)).toMatchObject({
      value: false,
      roll: true,
      dice: true,
      llm: false,
    })
  })

  it('does not offer {{dice}} to a dice roll that never quotes it', () => {
    const tool = define({
      roll: '3d6+2',
      outcomes: [{ when: true, message: 'It comes to {{value}}.', state: 'info' }],
    })

    expect(collectToolVocabulary(tool)).toMatchObject({ dice: false, value: true })
  })

  it('lists only the parameters a message or prompt quotes back', () => {
    const tool = define({
      parameters: {
        bonus: { type: 'number', default: 0 },
        colour: { type: 'string', default: 'brass' },
      },
      outcomes: [{ when: true, message: 'The {{params.colour}} lock.', state: 'info' }],
    })

    expect(collectToolVocabulary(tool).params).toEqual(['colour'])
  })

  it('ignores a {{params.*}} placeholder naming no declared parameter', () => {
    const tool = define({
      parameters: { bonus: { type: 'number', default: 0 } },
      outcomes: [{ when: true, message: '{{params.ghost}}', state: 'info' }],
    })

    expect(collectToolVocabulary(tool).params).toEqual([])
  })

  it('ignores placeholders it does not recognise', () => {
    const tool = define({
      outcomes: [{ when: true, message: '{{nonsense}} {{}}', state: 'info' }],
    })

    expect(collectToolVocabulary(tool)).toEqual({
      value: false,
      roll: false,
      dice: false,
      llm: false,
      params: [],
      metadata: [],
      state: [],
    })
  })

  it('collects the metadata keys an availability gate reads', () => {
    // A gate reads the same fact sheet, and naming its keys stays on the right
    // side of the odds line: which key, never which value opens the door.
    expect(
      collectToolVocabulary(define({ availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } } }))
        .metadata
    ).toEqual(['toolAbilities'])

    expect(
      collectToolVocabulary(define({ withheldWhen: { metadata: { novice: { eq: true } } } })).metadata
    ).toEqual(['novice'])
  })

  it('merges gate keys with the ones the table tests, without duplicating', () => {
    const vocabulary = collectToolVocabulary(
      define({
        availableWhen: { metadata: { rank: { gte: 3 } } },
        outcomes: [
          { when: { metadata: { rank: { gte: 5 }, luck: { eq: true } } }, message: 'a', state: 'success' },
          { when: true, message: 'b', state: 'info' },
        ],
      })
    )
    expect(vocabulary.metadata).toEqual(['luck', 'rank'])
  })
})

describe('isEmptyVocabulary', () => {
  it('is true only when nothing at all is quoted', () => {
    const bare = define({})
    expect(isEmptyVocabulary(collectToolVocabulary(bare))).toBe(true)

    const speaks = define({ outcomes: [{ when: true, message: 'A {{value}}.', state: 'info' }] })
    expect(isEmptyVocabulary(collectToolVocabulary(speaks))).toBe(false)
  })
})
