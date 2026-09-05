import { describe, expect, it } from '@jest/globals'

import { selectComposedOutfits, selectGarments } from '@/lib/wardrobe/composed-outfits'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

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
    replace: false,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const dress = makeItem('dress', ['top', 'bottom'], [], 'Green Dress')
const boots = makeItem('boots', ['footwear'], [], 'Ankle Boots')
const sunday = makeItem('sunday', ['top', 'bottom', 'footwear'], ['dress', 'boots'], 'Sunday Best')
const jewelry = makeItem('jewelry', ['accessories'], ['earrings'], 'Aunt Dahlia’s Pearls')

describe('selectComposedOutfits', () => {
  it('keeps composites and drops leaves', () => {
    const result = selectComposedOutfits([dress, boots, sunday, jewelry])
    expect(result.map((i) => i.id)).toEqual(['jewelry', 'sunday'])
  })

  it('keeps a single-slot composite — the pull-down is its only way on', () => {
    expect(selectComposedOutfits([jewelry]).map((i) => i.id)).toEqual(['jewelry'])
  })

  it('does not treat a multi-slot leaf as an outfit', () => {
    expect(selectComposedOutfits([dress])).toEqual([])
  })

  it('sorts by title', () => {
    const zebra = makeItem('zebra', ['top'], ['x'], 'Zebra Stripes')
    const alpha = makeItem('alpha', ['top'], ['y'], 'Alpine Tweeds')
    expect(selectComposedOutfits([zebra, alpha]).map((i) => i.title)).toEqual([
      'Alpine Tweeds',
      'Zebra Stripes',
    ])
  })

  it('returns an empty list for a pool with no composites', () => {
    expect(selectComposedOutfits([dress, boots])).toEqual([])
  })
})

describe('selectGarments', () => {
  it('keeps leaves — multi-slot ones included — and drops composites', () => {
    const result = selectGarments([dress, boots, sunday, jewelry])
    expect(result.map((i) => i.id)).toEqual(['dress', 'boots'])
  })

  it('preserves the caller’s order', () => {
    expect(selectGarments([boots, dress]).map((i) => i.id)).toEqual(['boots', 'dress'])
  })
})
