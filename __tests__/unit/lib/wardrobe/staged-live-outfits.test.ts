/**
 * Bug 61 regression coverage — the Wardrobe dialog's Live tab staging helpers.
 *
 * Two halves of the same silent loss: a gesture made before the worn snapshot
 * arrives must survive the first seed *and* land on the real slots, and the
 * Done flush must not read "we never learned what clean was" as "nothing
 * changed".
 */

import {
  classifyStagedOutfits,
  equippedSlotsEqual,
  rebaseStagedSlots,
} from '@/lib/wardrobe/staged-live-outfits'
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { wearItemIntoSlots } from '@/lib/wardrobe/outfit-displacement'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const slots = (partial: Partial<EquippedSlots>): EquippedSlots => ({
  ...EMPTY_EQUIPPED_SLOTS,
  ...partial,
})

const item = (id: string, types: WardrobeItem['types'], replace = false): WardrobeItem =>
  ({
    id,
    title: id,
    types,
    replace,
    componentItemIds: [],
  }) as unknown as WardrobeItem

describe('equippedSlotsEqual', () => {
  it('compares each slot array element-wise, in order', () => {
    expect(equippedSlotsEqual(slots({ top: ['a', 'b'] }), slots({ top: ['a', 'b'] }))).toBe(true)
    expect(equippedSlotsEqual(slots({ top: ['a', 'b'] }), slots({ top: ['b', 'a'] }))).toBe(false)
    expect(equippedSlotsEqual(slots({ top: ['a'] }), slots({ top: ['a', 'b'] }))).toBe(false)
    expect(equippedSlotsEqual(slots({ top: ['a'] }), slots({ bottom: ['a'] }))).toBe(false)
  })
})

describe('rebaseStagedSlots', () => {
  it('returns the worn snapshot untouched when nothing was staged early', () => {
    const worn = slots({ top: ['shirt'], bottom: ['trousers'] })
    const seeded = rebaseStagedSlots(worn, [])
    expect(seeded).toEqual(worn)
    expect(seeded).not.toBe(worn)
    expect(seeded.top).not.toBe(worn.top)
  })

  it('replays an early Wear onto the real slots instead of onto empty', () => {
    // The click that lost the race: staged while the snapshot was still in
    // flight, so it had been layered onto EMPTY_EQUIPPED_SLOTS for the paint.
    const worn = slots({ top: ['shirt'], bottom: ['trousers'] })
    const wearHat = (prev: EquippedSlots): EquippedSlots =>
      wearItemIntoSlots(prev, item('hat', ['accessories']))

    expect(rebaseStagedSlots(worn, [wearHat])).toEqual(
      slots({ top: ['shirt'], bottom: ['trousers'], accessories: ['hat'] }),
    )
  })

  it('replays several early gestures in the order they were made', () => {
    const worn = slots({ top: ['shirt'] })
    const wearCoat = (prev: EquippedSlots): EquippedSlots =>
      wearItemIntoSlots(prev, item('coat', ['top']))
    const takeOffShirt = (prev: EquippedSlots): EquippedSlots => ({
      ...prev,
      top: prev.top.filter((id) => id !== 'shirt'),
    })

    expect(rebaseStagedSlots(worn, [wearCoat, takeOffShirt])).toEqual(slots({ top: ['coat'] }))
    expect(rebaseStagedSlots(worn, [takeOffShirt, wearCoat])).toEqual(slots({ top: ['coat'] }))
  })

  it('does not mutate the worn snapshot it rebases onto', () => {
    const worn = slots({ top: ['shirt'] })
    rebaseStagedSlots(worn, [(prev) => ({ ...prev, top: [...prev.top, 'coat'] })])
    expect(worn).toEqual(slots({ top: ['shirt'] }))
  })
})

describe('classifyStagedOutfits', () => {
  it('reports a character whose staged slots differ from their baseline as dirty', () => {
    const staged = { alice: slots({ top: ['coat'] }) }
    const baselines = { alice: slots({ top: ['shirt'] }) }

    expect(classifyStagedOutfits(staged, baselines)).toEqual({
      dirty: [{ characterId: 'alice', slots: staged.alice }],
      unresolved: [],
    })
  })

  it('reports a character whose staged slots match their baseline as neither', () => {
    const staged = { alice: slots({ top: ['shirt'] }) }
    const baselines = { alice: slots({ top: ['shirt'] }) }

    expect(classifyStagedOutfits(staged, baselines)).toEqual({ dirty: [], unresolved: [] })
  })

  it('separates "no baseline" from "nothing changed" (Bug 61)', () => {
    // Before the fix both fell out of the loop as clean, so Done closed
    // reporting success having sent nothing.
    const staged = { alice: slots({ accessories: ['hat'] }) }

    expect(classifyStagedOutfits(staged, {})).toEqual({ dirty: [], unresolved: ['alice'] })
  })

  it('keys both verdicts per character', () => {
    const staged = {
      alice: slots({ top: ['coat'] }),
      bob: slots({ top: ['shirt'] }),
      carol: slots({ accessories: ['hat'] }),
    }
    const baselines = {
      alice: slots({ top: ['shirt'] }),
      bob: slots({ top: ['shirt'] }),
    }

    const { dirty, unresolved } = classifyStagedOutfits(staged, baselines)
    expect(dirty).toEqual([{ characterId: 'alice', slots: staged.alice }])
    expect(unresolved).toEqual(['carol'])
  })

  it('finds nothing to do when nothing was staged', () => {
    expect(classifyStagedOutfits({}, { alice: slots({ top: ['shirt'] }) })).toEqual({
      dirty: [],
      unresolved: [],
    })
  })
})
