/**
 * Unit tests for the equipped-outfit hash helper that gates clothing-summary
 * re-derivation and mid-turn wardrobe-change detection.
 */

import { describe, it, expect } from '@jest/globals'
import { hashEquippedSlots, hasEquippedItems } from '@/lib/wardrobe/outfit-hash'

describe('outfit-hash', () => {
  it('hashes equal equipped states to the same value', () => {
    const a = { top: ['t1'], bottom: ['b1'], footwear: [], accessories: [], hair: [] }
    const b = { top: ['t1'], bottom: ['b1'], footwear: [], accessories: [], hair: [] }
    expect(hashEquippedSlots(a)).toBe(hashEquippedSlots(b))
  })

  it('changes when an item is added or removed', () => {
    const base = { top: ['t1'], bottom: [], footwear: [], accessories: [], hair: [] }
    const added = { top: ['t1', 't2'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(hashEquippedSlots(base)).not.toBe(hashEquippedSlots(added))
  })

  it('is order-sensitive within a slot (layering matters)', () => {
    const ab = { top: ['a', 'b'], bottom: [], footwear: [], accessories: [], hair: [] }
    const ba = { top: ['b', 'a'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(hashEquippedSlots(ab)).not.toBe(hashEquippedSlots(ba))
  })

  it('treats null/empty as a stable sentinel', () => {
    const empty = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(hashEquippedSlots(null)).toBe(hashEquippedSlots(empty))
    expect(hashEquippedSlots(undefined)).toBe(hashEquippedSlots(empty))
  })

  it('hasEquippedItems reflects whether any slot holds an item', () => {
    expect(hasEquippedItems(null)).toBe(false)
    expect(hasEquippedItems({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })).toBe(false)
    expect(hasEquippedItems({ top: [], bottom: [], footwear: ['shoe'], accessories: [], hair: [] })).toBe(true)
  })

  // The hair slot is hashed like any other: a change of hairdo must invalidate
  // the cached clothing summary, and a hair-only outfit must not read as
  // "nothing equipped" (which would short-circuit both hash consumers).
  it('changes the hash when a hair item is equipped', () => {
    const bare = { top: ['t1'], bottom: [], footwear: [], accessories: [], hair: [] }
    const coiffed = { top: ['t1'], bottom: [], footwear: [], accessories: [], hair: ['braid'] }
    expect(hashEquippedSlots(bare)).not.toBe(hashEquippedSlots(coiffed))
  })

  it('counts a hair-only outfit as equipped', () => {
    expect(
      hasEquippedItems({ top: [], bottom: [], footwear: [], accessories: [], hair: ['braid'] }),
    ).toBe(true)
  })
})
