import { describe, expect, it } from '@jest/globals'

import { buildDefaultOutfit } from '@/lib/wardrobe/default-outfit'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(
  id: string,
  types: WardrobeItemType[],
  isDefault: boolean,
  archivedAt?: string | null,
): WardrobeItem {
  return {
    id,
    characterId: 'c1c1c1c1-0000-0000-0000-000000000001',
    title: id,
    types,
    componentItemIds: [],
    isDefault,
    archivedAt: archivedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('buildDefaultOutfit', () => {
  it('returns empty slots for an empty item list', () => {
    expect(buildDefaultOutfit([])).toEqual({
      top: [],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it('includes only isDefault items', () => {
    const items: WardrobeItem[] = [
      makeItem('11111111-0000-0000-0000-000000000001', ['top'], true),
      makeItem('11111111-0000-0000-0000-000000000002', ['bottom'], false),
    ]
    const result = buildDefaultOutfit(items)
    expect(result.top).toContain('11111111-0000-0000-0000-000000000001')
    expect(result.bottom).toEqual([])
  })

  it('excludes archived items even if isDefault is true', () => {
    const items: WardrobeItem[] = [
      makeItem('11111111-0000-0000-0000-000000000001', ['top'], true, NOW),
    ]
    const result = buildDefaultOutfit(items)
    expect(result.top).toEqual([])
  })

  it('places a multi-slot item in each of its slots', () => {
    const items: WardrobeItem[] = [
      makeItem('11111111-0000-0000-0000-000000000001', ['top', 'bottom'], true),
    ]
    const result = buildDefaultOutfit(items)
    expect(result.top).toContain('11111111-0000-0000-0000-000000000001')
    expect(result.bottom).toContain('11111111-0000-0000-0000-000000000001')
    expect(result.footwear).toEqual([])
    expect(result.accessories).toEqual([])
  })

  it('accumulates multiple default items in the same slot', () => {
    const items: WardrobeItem[] = [
      makeItem('11111111-0000-0000-0000-000000000001', ['accessories'], true),
      makeItem('11111111-0000-0000-0000-000000000002', ['accessories'], true),
    ]
    const result = buildDefaultOutfit(items)
    expect(result.accessories).toHaveLength(2)
    expect(result.accessories).toContain('11111111-0000-0000-0000-000000000001')
    expect(result.accessories).toContain('11111111-0000-0000-0000-000000000002')
  })

  it('handles all four slots simultaneously', () => {
    const items: WardrobeItem[] = [
      makeItem('11111111-0000-0000-0000-000000000001', ['top'], true),
      makeItem('11111111-0000-0000-0000-000000000002', ['bottom'], true),
      makeItem('11111111-0000-0000-0000-000000000003', ['footwear'], true),
      makeItem('11111111-0000-0000-0000-000000000004', ['accessories'], true),
    ]
    const result = buildDefaultOutfit(items)
    expect(result.top).toContain('11111111-0000-0000-0000-000000000001')
    expect(result.bottom).toContain('11111111-0000-0000-0000-000000000002')
    expect(result.footwear).toContain('11111111-0000-0000-0000-000000000003')
    expect(result.accessories).toContain('11111111-0000-0000-0000-000000000004')
  })

  it('dissolves a default bundle into its parts', () => {
    const shirt = makeItem('11111111-0000-0000-0000-0000000000a1', ['top'], false)
    const trousers = makeItem('11111111-0000-0000-0000-0000000000a2', ['bottom'], false)
    const bundle: WardrobeItem = {
      ...makeItem('11111111-0000-0000-0000-0000000000b1', ['top', 'bottom'], true),
      componentItemIds: [shirt.id, trousers.id],
    }

    const result = buildDefaultOutfit([shirt, trousers, bundle])

    expect(result.top).toEqual([shirt.id])
    expect(result.bottom).toEqual([trousers.id])
    expect(JSON.stringify(result)).not.toContain(bundle.id)
  })

  it('returns all four slot arrays in output regardless of whether they are populated', () => {
    const result = buildDefaultOutfit([])
    expect(result).toHaveProperty('top')
    expect(result).toHaveProperty('bottom')
    expect(result).toHaveProperty('footwear')
    expect(result).toHaveProperty('accessories')
  })
})
