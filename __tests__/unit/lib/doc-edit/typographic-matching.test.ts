/**
 * Bug 109 — a file's curly punctuation must not defeat an edit whose find text
 * spells the same passage in ASCII.
 *
 * Two properties carry the fix and are pinned here separately:
 *
 *   1. **The fold rescues a total miss.** A needle differing from the file only
 *      in punctuation is found, and its reported index/length address the
 *      ORIGINAL bytes — so splicing over them replaces exactly the passage the
 *      caller named, curly characters and all.
 *   2. **The fold never outranks an exact reading.** A file carrying both
 *      spellings has one right answer, and it is the one the caller typed.
 *
 * @jest-environment node
 */

import { describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

import { findAllMatches, findUniqueMatch } from '@/lib/doc-edit/diacritics'
import {
  foldTypography,
  hasTypographicVariants,
  TYPOGRAPHIC_FOLDINGS,
} from '@/lib/doc-edit/typographic-folding'

/** Apply a match the way handleStrReplace does, so the span is verified end to end. */
function splice(haystack: string, match: { index: number; length: number }, replacement: string): string {
  return haystack.substring(0, match.index) + replacement + haystack.substring(match.index + match.length)
}

describe('foldTypography', () => {
  it('folds the quote family onto ASCII', () => {
    expect(foldTypography('‘a’ “b”')).toBe(`'a' "b"`)
  })

  it('folds the dash family onto a hyphen', () => {
    expect(foldTypography('a–b—c−d')).toBe('a-b-c-d')
  })

  it('expands an ellipsis to three periods', () => {
    expect(foldTypography('wait… now')).toBe('wait... now')
  })

  it('folds non-breaking and wide spaces onto U+0020', () => {
    expect(foldTypography('a\u00A0b\u202Fc\u2003d')).toBe('a b c d')
  })

  it('leaves guillemets and zero-width characters alone', () => {
    const untouched = '«mot»\u200B\u00AD' // guillemets, zero-width space, soft hyphen
    expect(foldTypography(untouched)).toBe(untouched)
  })

  it('hasTypographicVariants agrees with the table', () => {
    expect(hasTypographicVariants("plain ascii's fine")).toBe(false)
    expect(hasTypographicVariants('curly’s not')).toBe(true)
    expect(Object.keys(TYPOGRAPHIC_FOLDINGS).every((k) => hasTypographicVariants(k))).toBe(true)
  })
})

describe('findUniqueMatch — typographic tolerance', () => {
  // The real passage from the instance where this was found: the file was
  // written with a curly apostrophe by the model that authored it, and a later
  // turn retyped the sentence with a straight one.
  const file = 'Cometary reservoir: a few short-period comets dipping inside Veyra-5’s orbit.\n'
  const needle = 'dipping inside Veyra-5\'s orbit.'

  it('does not match by default — byte-exact stays the default everywhere else', () => {
    expect(findUniqueMatch(file, needle)).toEqual({ found: false, count: 0, tier: 'exact' })
  })

  it('matches with foldTypography and reports the typographic tier', () => {
    const result = findUniqueMatch(file, needle, { foldTypography: true })
    expect(result).toMatchObject({ found: true, tier: 'typographic' })
  })

  it('addresses the original span, so the replacement lands on the curly bytes', () => {
    const result = findUniqueMatch(file, needle, { foldTypography: true })
    if (!result.found) throw new Error('expected a match')
    expect(file.substring(result.index, result.index + result.length)).toBe(
      'dipping inside Veyra-5’s orbit.'
    )
    expect(splice(file, result, 'dipping outside its orbit.')).toBe(
      'Cometary reservoir: a few short-period comets dipping outside its orbit.\n'
    )
  })

  it('matches an em dash by its hyphen, and reports the exact tier when the bytes agree', () => {
    const dashed = 'the rail is a notary — not a warden'
    expect(findUniqueMatch(dashed, 'notary - not', { foldTypography: true })).toMatchObject({
      found: true,
      tier: 'typographic',
    })
    expect(findUniqueMatch(dashed, 'notary — not', { foldTypography: true })).toMatchObject({
      found: true,
      tier: 'exact',
    })
  })

  it('maps a match back across an ellipsis, whose fold is one character to three', () => {
    const source = 'she paused… then spoke'
    const result = findUniqueMatch(source, 'paused... then', { foldTypography: true })
    if (!result.found) throw new Error('expected a match')
    expect(source.substring(result.index, result.index + result.length)).toBe('paused… then')
    expect(splice(source, result, 'paused, then')).toBe('she paused, then spoke')
  })

  it('matches across a no-break space', () => {
    const source = 'Chapter\u00A014 begins here'
    const result = findUniqueMatch(source, 'Chapter 14', { foldTypography: true })
    expect(result).toMatchObject({ found: true, tier: 'typographic' })
  })

  it('prefers the exact reading when the file carries both spellings', () => {
    const both = "first Veyra-5's orbit, then Veyra-5’s orbit"
    const result = findUniqueMatch(both, "Veyra-5's orbit", { foldTypography: true })
    if (!result.found) throw new Error('expected a match')
    expect(result.tier).toBe('exact')
    expect(result.index).toBe(both.indexOf("Veyra-5's orbit"))
  })

  it('reports ambiguity, not a match, when only the folded reading is ambiguous', () => {
    const both = "hers’ and hers’ again" // neither spelled as the needle spells it
    expect(findUniqueMatch(both, "hers' a", { foldTypography: true })).toEqual({
      found: false,
      count: 2,
      tier: 'typographic',
    })
  })

  it('reports multiple exact matches as exact, without consulting the fold', () => {
    const twice = 'alpha beta alpha'
    expect(findUniqueMatch(twice, 'alpha', { foldTypography: true })).toEqual({
      found: false,
      count: 2,
      tier: 'exact',
    })
  })

  it('composes with the diacritics fold', () => {
    const source = 'Nimuë’s letter'
    const result = findUniqueMatch(source, "Nimue's letter", { foldTypography: true })
    if (!result.found) throw new Error('expected a match')
    expect(source.substring(result.index, result.index + result.length)).toBe('Nimuë’s letter')
  })

  it('still honours normalizeDiacritics: false alongside the fold', () => {
    const source = 'Nimuë’s letter'
    expect(
      findUniqueMatch(source, "Nimue's letter", { foldTypography: true, normalizeDiacritics: false })
    ).toEqual({ found: false, count: 0, tier: 'typographic' })
  })
})

describe('findAllMatches — foldTypography', () => {
  it('is off by default', () => {
    expect(findAllMatches('a’b', "a'b")).toEqual([])
  })

  it('finds every typographic spelling at once when asked (the doc_grep case)', () => {
    const corpus = "one Veyra-5's, two Veyra-5’s, three Veyra-5’s"
    const matches = findAllMatches(corpus, "Veyra-5's", { foldTypography: true })
    expect(matches).toHaveLength(3)
    for (const m of matches) {
      expect(corpus.substring(m.index, m.index + m.length)).toMatch(/Veyra-5['’]s/)
    }
  })

  it('is case-insensitive independently of the fold', () => {
    const matches = findAllMatches('A’B', "a'b", { foldTypography: true, caseSensitive: false })
    expect(matches).toEqual([{ index: 0, length: 3 }])
  })
})
