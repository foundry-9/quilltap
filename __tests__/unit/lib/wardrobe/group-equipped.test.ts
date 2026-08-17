import { describe, expect, it } from '@jest/globals'

import { groupEquippedSlots } from '@/lib/wardrobe/group-equipped'
import {
  EMPTY_EQUIPPED_SLOTS,
  type EquippedSlots,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(
  id: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
  title?: string,
): WardrobeItem {
  return {
    id,
    characterId: 'char-1',
    title: title ?? id,
    types,
    componentItemIds,
    isDefault: false,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('groupEquippedSlots', () => {
  it('returns no bundles and empty remainders for empty slots', () => {
    const result = groupEquippedSlots(EMPTY_EQUIPPED_SLOTS, [])
    expect(result.bundles).toEqual([])
    expect(result.slotRemainders).toEqual(EMPTY_EQUIPPED_SLOTS)
  })

  it('does not promote a single-slot composite into a bundle', () => {
    const composite = makeItem('jewelry', ['accessories'], ['earrings', 'necklace'])
    const slots: EquippedSlots = {
      top: [],
      bottom: [],
      footwear: [],
      accessories: ['jewelry'],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [composite])
    expect(result.bundles).toEqual([])
    expect(result.slotRemainders.accessories).toEqual(['jewelry'])
  })

  it('promotes a multi-slot composite and clears the slots it covers', () => {
    const composite = makeItem('rain-outfit', ['top', 'bottom'], ['raincoat', 'jeans'])
    const slots: EquippedSlots = {
      top: ['rain-outfit'],
      bottom: ['rain-outfit'],
      footwear: [],
      accessories: [],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [composite])
    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]).toEqual({
      compositeId: 'rain-outfit',
      occupiedSlots: ['top', 'bottom'],
      allOccupied: true,
    })
    expect(result.slotRemainders).toEqual(EMPTY_EQUIPPED_SLOTS)
  })

  it('keeps a layered leaf alongside a bundled composite in the same slot', () => {
    const composite = makeItem('outfit', ['top', 'bottom'], ['shirt', 'jeans'])
    const layered = makeItem('scarf', ['top'])
    const slots: EquippedSlots = {
      top: ['outfit', 'scarf'],
      bottom: ['outfit'],
      footwear: [],
      accessories: [],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [composite, layered])
    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0].compositeId).toBe('outfit')
    expect(result.slotRemainders.top).toEqual(['scarf'])
    expect(result.slotRemainders.bottom).toEqual([])
  })

  it('handles a composite that covers all four slots', () => {
    const all = makeItem(
      'fullkit',
      ['top', 'bottom', 'footwear', 'accessories'],
      ['shirt', 'pants', 'boots', 'belt'],
    )
    const slots: EquippedSlots = {
      top: ['fullkit'],
      bottom: ['fullkit'],
      footwear: ['fullkit'],
      accessories: ['fullkit'],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [all])
    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0].occupiedSlots).toEqual([
      'top',
      'bottom',
      'footwear',
      'accessories',
    ])
    expect(result.bundles[0].allOccupied).toBe(true)
    expect(result.slotRemainders).toEqual(EMPTY_EQUIPPED_SLOTS)
  })

  it('produces two bundles when two composites occupy disjoint slot sets', () => {
    const upper = makeItem('upper', ['top', 'accessories'], ['shirt', 'tie'])
    const lower = makeItem('lower', ['bottom', 'footwear'], ['pants', 'shoes'])
    const slots: EquippedSlots = {
      top: ['upper'],
      bottom: ['lower'],
      footwear: ['lower'],
      accessories: ['upper'],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [upper, lower])
    expect(result.bundles).toHaveLength(2)
    const ids = result.bundles.map((b) => b.compositeId).sort()
    expect(ids).toEqual(['lower', 'upper'])
    expect(result.slotRemainders).toEqual(EMPTY_EQUIPPED_SLOTS)
  })

  it('marks allOccupied false when the bundle is only partially worn', () => {
    const composite = makeItem('outfit', ['top', 'bottom'], ['shirt', 'jeans'])
    const slots: EquippedSlots = {
      top: ['outfit'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [composite])
    // Only one slot occupied → not a bundle (needs ≥ 2).
    expect(result.bundles).toEqual([])
    expect(result.slotRemainders.top).toEqual(['outfit'])
  })

  it('preserves orphan ids (items not in the items list) in slot remainders', () => {
    const slots: EquippedSlots = {
      top: ['ghost-item'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [])
    expect(result.bundles).toEqual([])
    expect(result.slotRemainders.top).toEqual(['ghost-item'])
  })

  it('treats leaf items in multiple slots without bundling them', () => {
    // A leaf with types=[top,bottom] (a dress) is not a composite, so it never
    // becomes a bundle even when it occupies multiple slots.
    const dress = makeItem('dress', ['top', 'bottom'])
    const slots: EquippedSlots = {
      top: ['dress'],
      bottom: ['dress'],
      footwear: [],
      accessories: [],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [dress])
    expect(result.bundles).toEqual([])
    expect(result.slotRemainders.top).toEqual(['dress'])
    expect(result.slotRemainders.bottom).toEqual(['dress'])
  })

  it('sorts bundles by their first occupied slot in canonical order', () => {
    const accessoryBundle = makeItem('a-bundle', ['accessories', 'footwear'], ['x', 'y'])
    const topBundle = makeItem('t-bundle', ['top', 'bottom'], ['m', 'n'])
    const slots: EquippedSlots = {
      top: ['t-bundle'],
      bottom: ['t-bundle'],
      footwear: ['a-bundle'],
      accessories: ['a-bundle'],
      hair: [],
    }
    const result = groupEquippedSlots(slots, [accessoryBundle, topBundle])
    expect(result.bundles.map((b) => b.compositeId)).toEqual(['t-bundle', 'a-bundle'])
  })
})
