/**
 * RNG tool — tolerance for LLM-quoted numbers.
 *
 * Models frequently send `{"type": "6"}` instead of `{"type": 6}`. A bare
 * z.number() rejected that outright, so the roll never happened and the
 * character was told their request was invalid. These tests pin both halves of
 * the fix: the quoted forms are accepted, and the genuinely-bad inputs are
 * still refused rather than coerced into a plausible-looking wrong number.
 */

import { rngToolInputSchema, validateRngInput, rngToolDefinition } from '@/lib/tools/rng-tool'
import { executeRngTool } from '@/lib/tools/handlers/rng-handler'

describe('rng input — quoted numbers are accepted', () => {
  it.each([
    ['sides as a string', { type: '6' }, { type: 6, rolls: 1, modifier: 0 }],
    ['rolls as a string', { type: 6, rolls: '3' }, { type: 6, rolls: 3, modifier: 0 }],
    ['both as strings', { type: '20', rolls: '2' }, { type: 20, rolls: 2, modifier: 0 }],
    ['modifier as a string', { type: 6, rolls: 3, modifier: '2' }, { type: 6, rolls: 3, modifier: 2 }],
    ['negative modifier as a string', { type: 10, modifier: '-1' }, { type: 10, rolls: 1, modifier: -1 }],
    ['whitespace around the number', { type: ' 6 ' }, { type: 6, rolls: 1, modifier: 0 }],
  ])('%s', (_label, input, expected) => {
    const result = rngToolInputSchema.safeParse(input)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(expected)
    // The validator returns the parsed data itself — the handler reads the
    // coerced values, not the raw strings.
    expect(validateRngInput(input)).toEqual(expected)
  })

  it('still accepts genuine numbers unchanged', () => {
    expect(rngToolInputSchema.safeParse({ type: 6, rolls: 3, modifier: 2 }).data).toEqual({
      type: 6,
      rolls: 3,
      modifier: 2,
    })
  })
})

describe('rng input — the string enums still work', () => {
  it.each([
    ['flip_coin', { type: 'flip_coin' }],
    ['spin_the_bottle', { type: 'spin_the_bottle' }],
    ['flip_coin with quoted rolls', { type: 'flip_coin', rolls: '2' }],
  ])('%s survives the numeric leniency', (_label, input) => {
    // The union tries the numeric branch first; a non-numeric string must fall
    // through to the enum rather than becoming NaN and failing outright.
    expect(validateRngInput(input)).not.toBeNull()
  })
})

describe('rng input — bad values are still refused', () => {
  it.each([
    ['a word', { type: 'nonsense' }],
    ['a quoted non-integer', { type: '6.5' }],
    ['a quoted value below the sides bound', { type: '1' }],
    ['a quoted value above the sides bound', { type: '1001' }],
    ['a quoted rolls below its bound', { type: 6, rolls: '0' }],
    ['a non-numeric rolls', { type: 6, rolls: 'many' }],
    ['an empty string', { type: '' }],
    ['whitespace only', { type: '   ' }],
  ])('rejects %s', (_label, input) => {
    expect(validateRngInput(input)).toBeNull()
  })

  it.each([
    ['true', { type: 6, rolls: true }],
    ['null', { type: 6, rolls: null }],
    ['an array', { type: 6, rolls: [] }],
    ['an object', { type: 6, rolls: {} }],
  ])('rejects %s for rolls rather than coercing it', (_label, input) => {
    // z.coerce.number() would turn true into 1 and null/[] into 0 — trading a
    // rejected call for a wrong one. Only strings are converted.
    expect(validateRngInput(input)).toBeNull()
  })

  it.each([
    ['true', { type: true }],
    ['null', { type: null }],
    ['an array', { type: [] }],
  ])('rejects %s for type', (_label, input) => {
    expect(validateRngInput(input)).toBeNull()
  })
})

describe('rng execution — the coerced values reach the handler', () => {
  // The validator returning parsed data (rather than a bare boolean) is what
  // makes the leniency real: before that, {"type":"6"} passed validation but
  // the handler read the raw string, matched neither the numeric arm nor the
  // enums, and answered "Unknown RNG type" without consuming a single random
  // byte. And {"modifier":"2"} concatenated: 4 + "2" = "42".
  const context = { userId: 'user-1', chatId: 'chat-1' }

  it('rolls a d6 for a quoted type', async () => {
    const result = await executeRngTool({ type: '6' }, context)
    expect(result.success).toBe(true)
    expect(result.type).toBe(6)
    expect(result.rollCount).toBe(1)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toBeGreaterThanOrEqual(1)
    expect(result.results[0]).toBeLessThanOrEqual(6)
  })

  it('adds a quoted modifier numerically, never as string concatenation', async () => {
    const result = await executeRngTool({ type: 6, modifier: '2' }, context)
    expect(result.success).toBe(true)
    expect(typeof result.total).toBe('number')
    expect(result.total).toBe((result.sum as number) + 2)
  })

  it('reports a quoted rolls count as a number', async () => {
    const result = await executeRngTool({ type: 6, rolls: '3' }, context)
    expect(result.success).toBe(true)
    expect(result.rollCount).toBe(3)
    expect(result.results).toHaveLength(3)
  })
})

describe('rng tool definition', () => {
  it('still tells the model to send an integer', () => {
    // The leniency is a runtime kindness, not a change to the contract: the
    // published schema must keep asking for integers.
    const params = rngToolDefinition.function.parameters as Record<string, any>
    expect(params.properties.rolls.type).toBe('integer')
    expect(params.properties.modifier.type).toBe('integer')
    const numericBranch = params.properties.type.anyOf.find((b: any) => b.type === 'integer')
    expect(numericBranch).toBeDefined()
    expect(numericBranch.minimum).toBe(2)
    expect(numericBranch.maximum).toBe(1000)
  })
})
