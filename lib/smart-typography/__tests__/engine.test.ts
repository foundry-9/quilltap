/**
 * Smart typography engine — Tier A/B tests.
 *
 * The corpus is the contract with quilltap-v5, so it drives the bulk of this
 * suite table-wise. The hand-written cases below it pin invariants the adapter
 * relies on but that no single fixture row states.
 */

import {
  smartTypographyStep,
  EN_DASH,
  EM_DASH,
  ELLIPSIS,
  type SmartTypographyOptions,
  type TypographyResult,
} from '../engine'
import vectors from '../fixtures/typography-vectors.json'

interface VectorCase {
  name: string
  before: string
  typed: string
  options?: SmartTypographyOptions
  expect: TypographyResult | null
}

describe('smartTypographyStep', () => {
  describe('corpus (lib/smart-typography/fixtures/typography-vectors.json)', () => {
    const defaultOptions = vectors.defaultOptions as SmartTypographyOptions
    const cases = vectors.cases as unknown as VectorCase[]

    it('has a corpus to run', () => {
      // Guards against an empty/mangled JSON import silently passing the
      // it.each below with zero cases.
      expect(cases.length).toBeGreaterThan(10)
    })

    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
      const result = smartTypographyStep({
        before: testCase.before,
        typed: testCase.typed,
        options: testCase.options ?? defaultOptions,
      })
      expect(result).toEqual(testCase.expect)
    })
  })

  describe('invariants the adapter depends on', () => {
    const on: SmartTypographyOptions = { dashes: true, ellipsis: true }

    it('never returns deleteBefore greater than before.length', () => {
      // The adapter slices `deleteBefore` characters off the text node without
      // re-checking. Every reachable input must respect the bound.
      const befores = ['', '-', '.', '..', '0-', 't..', EN_DASH, `t${EN_DASH}`, EM_DASH]
      for (const before of befores) {
        for (const typed of ['-', '.']) {
          const result = smartTypographyStep({ before, typed, options: on })
          if (result) {
            expect(result.deleteBefore).toBeLessThanOrEqual(before.length)
            expect(result.deleteBefore).toBeGreaterThanOrEqual(1)
            expect(result.deleteBefore).toBeLessThanOrEqual(2)
          }
        }
      }
    })

    it('returns null for both triggers when both flags are off', () => {
      const off: SmartTypographyOptions = { dashes: false, ellipsis: false }
      expect(smartTypographyStep({ before: '0-', typed: '-', options: off })).toBeNull()
      expect(smartTypographyStep({ before: `0${EN_DASH}`, typed: '-', options: off })).toBeNull()
      expect(smartTypographyStep({ before: 't..', typed: '.', options: off })).toBeNull()
    })

    it('ignores everything in `before` beyond the last two characters', () => {
      // The adapter may over-supply; the engine must not care.
      const short = smartTypographyStep({ before: '..', typed: '.', options: on })
      const long = smartTypographyStep({
        before: 'a whole paragraph of prose that ends in..',
        typed: '.',
        options: on,
      })
      expect(long).toEqual(short)

      const shortDash = smartTypographyStep({ before: '-', typed: '-', options: on })
      const longDash = smartTypographyStep({ before: 'xyzzy-', typed: '-', options: on })
      expect(longDash).toEqual(shortDash)
    })

    it('walks the full dash ladder and then stops', () => {
      // -, then –, then —, then nothing.
      expect(smartTypographyStep({ before: 'a', typed: '-', options: on })).toBeNull()
      expect(smartTypographyStep({ before: 'a-', typed: '-', options: on })).toEqual({
        deleteBefore: 1,
        insert: EN_DASH,
        rule: 'en-dash',
      })
      expect(smartTypographyStep({ before: `a${EN_DASH}`, typed: '-', options: on })).toEqual({
        deleteBefore: 1,
        insert: EM_DASH,
        rule: 'em-dash',
      })
      expect(smartTypographyStep({ before: `a${EM_DASH}`, typed: '-', options: on })).toBeNull()
    })

    it('inserts the real code points, not lookalikes', () => {
      expect(EN_DASH).toBe('–')
      expect(EM_DASH).toBe('—')
      expect(ELLIPSIS).toBe('…')
    })

    it('is pure — the same input yields the same result every time', () => {
      const input = { before: 't..', typed: '.', options: on }
      const first = smartTypographyStep(input)
      const second = smartTypographyStep(input)
      expect(second).toEqual(first)
      // And the input object is not mutated.
      expect(input).toEqual({ before: 't..', typed: '.', options: on })
    })

    it('suppresses a rule whose typed character is reserved', () => {
      const reserved: SmartTypographyOptions = { dashes: true, ellipsis: true, reservedChars: ['.'] }
      expect(smartTypographyStep({ before: 't..', typed: '.', options: reserved })).toBeNull()
      // ...but leaves the other rule alone.
      expect(smartTypographyStep({ before: 'a-', typed: '-', options: reserved })).toEqual({
        deleteBefore: 1,
        insert: EN_DASH,
        rule: 'en-dash',
      })
    })
  })
})
