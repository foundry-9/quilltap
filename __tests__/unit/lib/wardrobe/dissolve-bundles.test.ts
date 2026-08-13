import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const {
  dissolveBundleToLeaves,
  dissolveBundlesInSlots,
  isBundle,
  layLeavesIntoSlots,
} = require('@/lib/wardrobe/dissolve-bundles')
const {
  addItemToSlot,
  equipItem,
  replaceItemIntoSlots,
  wearItemIntoSlots,
} = require('@/lib/wardrobe/outfit-displacement')

import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(
  id: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
  extra: Partial<WardrobeItem> = {},
): WardrobeItem {
  return {
    id,
    characterId: 'c1c1c1c1-0000-0000-0000-000000000001',
    title: id,
    types,
    componentItemIds,
    isDefault: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as WardrobeItem
}

function buildMap(items: WardrobeItem[]): Map<string, WardrobeItem> {
  return new Map(items.map((i) => [i.id, i]))
}

const empty = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [] })

// "Man in Black": a four-slot bundle over four single-slot garments.
const shirt = makeItem('shirt', ['top'])
const trousers = makeItem('trousers', ['bottom'])
const boots = makeItem('boots', ['footwear'])
const gloves = makeItem('gloves', ['accessories'])
const manInBlack = makeItem(
  'man-in-black',
  ['top', 'bottom', 'footwear', 'accessories'],
  ['shirt', 'trousers', 'boots', 'gloves'],
)
const WARDROBE = buildMap([shirt, trousers, boots, gloves, manInBlack])

describe('isBundle', () => {
  it('is true only when the item has components', () => {
    expect(isBundle(manInBlack)).toBe(true)
    expect(isBundle(shirt)).toBe(false)
    expect(isBundle({ id: 'x', types: ['top'] })).toBe(false)
  })
})

describe('dissolveBundleToLeaves', () => {
  it('expands a bundle into its parts with the slots each covers', () => {
    expect(dissolveBundleToLeaves(manInBlack, WARDROBE)).toEqual([
      { id: 'shirt', slots: ['top'] },
      { id: 'trousers', slots: ['bottom'] },
      { id: 'boots', slots: ['footwear'] },
      { id: 'gloves', slots: ['accessories'] },
    ])
  })

  it('walks all the way to leaves, so a nested bundle dissolves too', () => {
    const jewelry = makeItem('jewelry', ['accessories'], ['locket', 'ring'])
    const locket = makeItem('locket', ['accessories'])
    const ring = makeItem('ring', ['accessories'])
    const gala = makeItem('gala', ['top', 'accessories'], ['gown', 'jewelry'])
    const gown = makeItem('gown', ['top', 'bottom'])
    const map = buildMap([jewelry, locket, ring, gala, gown])

    expect(dissolveBundleToLeaves(gala, map)).toEqual([
      { id: 'gown', slots: ['top', 'bottom'] },
      { id: 'locket', slots: ['accessories'] },
      { id: 'ring', slots: ['accessories'] },
    ])
  })

  it('returns null for a plain garment', () => {
    expect(dissolveBundleToLeaves(shirt, WARDROBE)).toBeNull()
  })

  it('returns null when no lookup is supplied', () => {
    expect(dissolveBundleToLeaves(manInBlack, undefined)).toBeNull()
  })

  it('returns null when not one component resolves, so the bundle is worn whole', () => {
    const orphan = makeItem('orphan', ['top'], ['nowhere-1', 'nowhere-2'])
    expect(dissolveBundleToLeaves(orphan, buildMap([orphan]))).toBeNull()
  })

  it('drops a component that points back at its own bundle', () => {
    const selfish = makeItem('selfish', ['top'], ['selfish', 'shirt'])
    const map = buildMap([selfish, shirt])
    expect(dissolveBundleToLeaves(selfish, map)).toEqual([{ id: 'shirt', slots: ['top'] }])
  })

  it('skips parts that cover no recognized slot', () => {
    const junk = makeItem('junk', ['hat' as WardrobeItemType])
    const bundle = makeItem('bundle', ['top'], ['shirt', 'junk'])
    const map = buildMap([shirt, junk, bundle])
    expect(dissolveBundleToLeaves(bundle, map)).toEqual([{ id: 'shirt', slots: ['top'] }])
  })
})

describe('layLeavesIntoSlots', () => {
  const leaves = [
    { id: 'shirt', slots: ['top'] as WardrobeItemType[] },
    { id: 'boots', slots: ['footwear'] as WardrobeItemType[] },
  ]

  it('layers parts over what is already worn when not replacing', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: ['sandals'], accessories: [] }
    expect(
      layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: false }),
    ).toEqual({
      top: ['vest', 'shirt'],
      bottom: [],
      footwear: ['sandals', 'boots'],
      accessories: [],
    })
  })

  it('clears the slots it lands in when replacing', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: ['skirt'], footwear: ['sandals'], accessories: ['hat'] }
    expect(
      layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: true }),
    ).toEqual({ top: ['shirt'], bottom: [], footwear: ['boots'], accessories: [] })
  })

  it('replacing also clears slots the bundle itself does not claim', () => {
    // The bundle nominally covers top only, but brings boots along. The boots
    // should swap the sandals rather than layer over them.
    const topOnly = makeItem('top-only', ['top'], ['shirt', 'boots'])
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: ['sandals'], accessories: [] }
    expect(
      layLeavesIntoSlots(worn, topOnly, leaves, { clearCoveredSlots: true }),
    ).toEqual({ top: ['shirt'], bottom: [], footwear: ['boots'], accessories: [] })
  })

  it('does not duplicate a part already worn', () => {
    const worn: EquippedSlots = { top: ['shirt'], bottom: [], footwear: [], accessories: [] }
    const result = layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: false })
    expect(result.top).toEqual(['shirt'])
  })
})

describe('wearItemIntoSlots with a bundle', () => {
  it('stores the parts, never the bundle id', () => {
    const result = wearItemIntoSlots(empty(), manInBlack, WARDROBE)
    expect(result).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
    })
    expect(JSON.stringify(result)).not.toContain('man-in-black')
  })

  it('layers the parts over what is worn by default', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: [], accessories: [] }
    expect(wearItemIntoSlots(worn, manInBlack, WARDROBE).top).toEqual(['vest', 'shirt'])
  })

  it('honours the replace flag — the parts swap what was there', () => {
    const replacing = makeItem(
      'man-in-black',
      ['top', 'bottom', 'footwear', 'accessories'],
      ['shirt', 'trousers', 'boots', 'gloves'],
      { replace: true } as Partial<WardrobeItem>,
    )
    const worn: EquippedSlots = { top: ['vest'], bottom: ['skirt'], footwear: ['sandals'], accessories: ['hat'] }
    expect(wearItemIntoSlots(worn, replacing, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
    })
  })

  it('falls back to storing the bundle whole without a lookup', () => {
    expect(wearItemIntoSlots(empty(), manInBlack)).toEqual({
      top: ['man-in-black'],
      bottom: ['man-in-black'],
      footwear: ['man-in-black'],
      accessories: ['man-in-black'],
    })
  })

  it('leaves plain garments alone', () => {
    expect(wearItemIntoSlots(empty(), shirt, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: [],
    })
  })
})

describe('replaceItemIntoSlots with a bundle', () => {
  it('clears the slots and stores the parts', () => {
    const worn: EquippedSlots = { top: ['vest', 'coat'], bottom: ['skirt'], footwear: [], accessories: [] }
    expect(replaceItemIntoSlots(worn, manInBlack, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
    })
  })
})

describe('addItemToSlot with a bundle', () => {
  it('adds only the parts covering the named slot', () => {
    expect(addItemToSlot(empty(), 'top', manInBlack, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: [],
    })
  })

  it('falls back to the bundle id when no part covers the slot', () => {
    const topOnly = makeItem('top-only', ['top', 'bottom'], ['shirt'])
    const map = buildMap([shirt, topOnly])
    expect(addItemToSlot(empty(), 'bottom', topOnly, map).bottom).toEqual(['top-only'])
  })
})

describe('equipItem (persisted)', () => {
  const CHAT = 'chat-1'
  const CHAR = 'c1c1c1c1-0000-0000-0000-000000000001'

  function makeRepos(pool: WardrobeItem[], opts: { withWardrobe?: boolean } = {}) {
    let stored: EquippedSlots = empty()
    const byId = buildMap(pool)
    const findByIdsForCharacter = jest.fn(
      async (_characterId: string, ids: string[]) =>
        ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[],
    )
    const repos: Record<string, unknown> = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn(async () => stored),
        setEquippedOutfit: jest.fn(async (_c: string, _ch: string, slots: EquippedSlots) => {
          stored = slots
          return slots
        }),
      },
    }
    if (opts.withWardrobe !== false) repos.wardrobe = { findByIdsForCharacter }
    return { repos, findByIdsForCharacter, read: () => stored }
  }

  it('fetches the bundle components and stores the parts', async () => {
    const { repos, findByIdsForCharacter, read } = makeRepos([shirt, trousers, boots, gloves])

    const result = await equipItem(repos, CHAT, CHAR, manInBlack, {
      projectMountPointIds: ['mp-1'],
    })

    expect(findByIdsForCharacter).toHaveBeenCalledWith(
      CHAR,
      ['shirt', 'trousers', 'boots', 'gloves'],
      { projectMountPointIds: ['mp-1'] },
    )
    expect(result).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
    })
    expect(read()).toEqual(result)
  })

  it('fires no component query for a plain garment', async () => {
    const { repos, findByIdsForCharacter } = makeRepos([shirt])
    await equipItem(repos, CHAT, CHAR, shirt)
    expect(findByIdsForCharacter).not.toHaveBeenCalled()
  })

  it('stores the bundle whole when the repos cannot resolve components', async () => {
    const { repos } = makeRepos([], { withWardrobe: false })
    const result = await equipItem(repos, CHAT, CHAR, manInBlack)
    expect(result.top).toEqual(['man-in-black'])
  })
})

describe('dissolveBundlesInSlots', () => {
  it('substitutes a bundle in place, preserving layering order', () => {
    const worn: EquippedSlots = {
      top: ['undershirt', 'man-in-black', 'scarf'],
      bottom: ['man-in-black'],
      footwear: ['man-in-black'],
      accessories: ['man-in-black'],
    }
    expect(dissolveBundlesInSlots(worn, WARDROBE)).toEqual({
      top: ['undershirt', 'shirt', 'scarf'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
    })
  })

  it('routes a part into a slot the bundle never occupied', () => {
    const hat = makeItem('hat', ['accessories'])
    const kit = makeItem('kit', ['top'], ['shirt', 'hat'])
    const map = buildMap([shirt, hat, kit])
    const worn: EquippedSlots = { top: ['kit'], bottom: [], footwear: [], accessories: [] }
    expect(dissolveBundlesInSlots(worn, map)).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: ['hat'],
    })
  })

  it('returns the snapshot untouched when nothing is a bundle', () => {
    const worn: EquippedSlots = { top: ['shirt'], bottom: ['trousers'], footwear: [], accessories: [] }
    expect(dissolveBundlesInSlots(worn, WARDROBE)).toBe(worn)
  })

  it('leaves an unresolvable bundle in place', () => {
    const orphan = makeItem('orphan', ['top'], ['nowhere'])
    const worn: EquippedSlots = { top: ['orphan'], bottom: [], footwear: [], accessories: [] }
    expect(dissolveBundlesInSlots(worn, buildMap([orphan])).top).toEqual(['orphan'])
  })
})
