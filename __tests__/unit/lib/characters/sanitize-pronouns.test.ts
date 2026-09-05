/**
 * Pronoun sanitization for LLM-generated character data.
 *
 * Summon From Lore and the AI Wizard both ask a model for a
 * `{ subject, object, possessive }` object, and a model that doesn't know
 * answers "unknown" or "N/A" rather than declining. `PronounsSchema` then
 * refuses the whole character at create time, so the placeholder has to die
 * here or the generation is lost.
 *
 * The stakes are higher than the field looks: the image pipelines derive a
 * character's sex from these pronouns (`lib/characters/pronoun-gender.ts`), so
 * a stored "n/a" is not a cosmetic blemish — it is a wrong anchor in every
 * avatar and story background thereafter.
 */

import { sanitizePronouns } from '@/lib/characters/sanitize-pronouns'

describe('sanitizePronouns — accepted', () => {
  it('takes a well-formed trio', () => {
    expect(sanitizePronouns({ subject: 'she', object: 'her', possessive: 'hers' })).toEqual({
      subject: 'she',
      object: 'her',
      possessive: 'hers',
    })
  })

  it('trims each field', () => {
    expect(sanitizePronouns({ subject: ' they ', object: '\tthem', possessive: 'theirs\n' })).toEqual(
      { subject: 'they', object: 'them', possessive: 'theirs' }
    )
  })

  it('ignores extra keys the model volunteered', () => {
    expect(
      sanitizePronouns({ subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself' })
    ).toEqual({ subject: 'he', object: 'him', possessive: 'his' })
  })

  it('accepts a neopronoun set', () => {
    expect(sanitizePronouns({ subject: 'xe', object: 'xem', possessive: 'xyrs' })).toEqual({
      subject: 'xe',
      object: 'xem',
      possessive: 'xyrs',
    })
  })

  it('accepts a field of exactly twenty characters', () => {
    const twenty = 'a'.repeat(20)
    expect(sanitizePronouns({ subject: twenty, object: 'them', possessive: 'theirs' })).toEqual({
      subject: twenty,
      object: 'them',
      possessive: 'theirs',
    })
  })
})

describe('sanitizePronouns — rejected', () => {
  it('rejects a non-object', () => {
    expect(sanitizePronouns(undefined)).toBeUndefined()
    expect(sanitizePronouns(null)).toBeUndefined()
    expect(sanitizePronouns('she/her')).toBeUndefined()
    expect(sanitizePronouns(7)).toBeUndefined()
  })

  it('rejects a missing field', () => {
    expect(sanitizePronouns({ subject: 'she', object: 'her' })).toBeUndefined()
  })

  it('rejects a non-string field', () => {
    expect(sanitizePronouns({ subject: 'she', object: 'her', possessive: null })).toBeUndefined()
    expect(sanitizePronouns({ subject: 'she', object: 'her', possessive: 42 })).toBeUndefined()
  })

  it('rejects a blank or whitespace-only field', () => {
    expect(sanitizePronouns({ subject: '', object: 'her', possessive: 'hers' })).toBeUndefined()
    expect(sanitizePronouns({ subject: '  ', object: 'her', possessive: 'hers' })).toBeUndefined()
  })

  it('rejects a field longer than PronounsSchema allows', () => {
    expect(
      sanitizePronouns({ subject: 'a'.repeat(21), object: 'her', possessive: 'hers' })
    ).toBeUndefined()
  })

  it.each([
    'unknown',
    'n/a',
    'na',
    'none',
    'null',
    'undefined',
    'not specified',
    'not given',
    'tbd',
  ])('rejects the placeholder %p', placeholder => {
    expect(
      sanitizePronouns({ subject: placeholder, object: 'them', possessive: 'theirs' })
    ).toBeUndefined()
  })

  it('rejects a placeholder whatever its case or padding', () => {
    expect(sanitizePronouns({ subject: ' Unknown ', object: 'them', possessive: 'theirs' })).toBeUndefined()
    expect(sanitizePronouns({ subject: 'they', object: 'N/A', possessive: 'theirs' })).toBeUndefined()
    expect(sanitizePronouns({ subject: 'they', object: 'them', possessive: 'TBD' })).toBeUndefined()
  })

  it('rejects the whole trio when only one field is a placeholder', () => {
    expect(sanitizePronouns({ subject: 'she', object: 'her', possessive: 'none' })).toBeUndefined()
  })
})
