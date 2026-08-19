import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const { resolveEquippedOutfitForCharacter } =
  require('@/lib/wardrobe/resolve-equipped') as typeof import('@/lib/wardrobe/resolve-equipped')

import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'
const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

function makeItem(
  id: string,
  title: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title,
    types,
    componentItemIds,
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeRepos(items: WardrobeItem[]) {
  return {
    wardrobe: {
      findByCharacterId: jest.fn(async () => items),
      findByIdsForCharacter: jest.fn(async (_characterId: string, ids: string[]) =>
        items.filter((i) => ids.includes(i.id)),
      ),
    },
  } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]
}

const emptySlots = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })

describe('resolveEquippedOutfitForCharacter', () => {
  it('returns empty results when nothing is equipped', async () => {
    const repos = makeRepos([])
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, emptySlots())
    expect(resolved.outfitValues).toEqual({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })
    expect(resolved.leafItemsBySlot.top).toEqual([])
    expect(resolved.leafItemsBySlot.bottom).toEqual([])
  })

  it('routes a single-slot atomic item to its declared slot', async () => {
    const shirt = makeItem('shirt-id', 'Linen shirt', ['top'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['shirt-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([shirt]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Linen shirt'])
    expect(resolved.outfitValues.bottom).toEqual([])
  })

  it('spreads an atomic multi-slot item into all slots its types declare, even when only equipped to one', async () => {
    // A dress that covers both top and bottom, but the equipped state only
    // lists it under slots.top. The renderer must still know the wearer
    // isn't bottomless.
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([dress]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.outfitValues.footwear).toEqual([])
  })

  it('does not double-count a multi-slot item already populated in multiple input slots', async () => {
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id'], bottom: ['dress-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([dress]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.leafItemsBySlot.top).toHaveLength(1)
    expect(resolved.leafItemsBySlot.bottom).toHaveLength(1)
  })

  it('routes composite components to each component\'s own slot, not the composite\'s equipped slot', async () => {
    // A "casual outfit" composite equipped only to slots.top, but its
    // components should distribute across top/bottom/footwear by their own types.
    const blouse = makeItem('blouse-id', 'White blouse', ['top'])
    const slacks = makeItem('slacks-id', 'Gray slacks', ['bottom'])
    const loafers = makeItem('loafers-id', 'Brown loafers', ['footwear'])
    const outfit = makeItem('outfit-id', 'Casual office outfit', ['top'], [
      'blouse-id',
      'slacks-id',
      'loafers-id',
    ])
    const slots: EquippedSlots = { ...emptySlots(), top: ['outfit-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(
      makeRepos([blouse, slacks, loafers, outfit]),
      CHAR_ID,
      slots,
    )
    expect(resolved.outfitValues.top).toEqual(['White blouse'])
    expect(resolved.outfitValues.bottom).toEqual(['Gray slacks'])
    expect(resolved.outfitValues.footwear).toEqual(['Brown loafers'])
    expect(resolved.outfitValues.accessories).toEqual([])
  })

  it('layers a separately-equipped item on top of distributed coverage', async () => {
    // Dress in slots.top covers top+bottom. A separate apron is also worn
    // (also covers top). The rendered top should list dress then apron.
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const apron = makeItem('apron-id', 'Linen apron', ['top'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id', 'apron-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(
      makeRepos([dress, apron]),
      CHAR_ID,
      slots,
    )
    expect(resolved.outfitValues.top).toEqual(['Sundress', 'Linen apron'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
  })

  it('falls back to findByIdsForCharacter for items missing from the character wardrobe', async () => {
    const archetype = makeItem('arch-id', 'Borrowed jacket', ['top'])
    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIdsForCharacter: jest.fn(async (_characterId: string, ids: string[]) =>
          ids.includes('arch-id') ? [archetype] : [],
        ),
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]
    const slots: EquippedSlots = { ...emptySlots(), top: ['arch-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Borrowed jacket'])
  })

  it('forwards projectMountPointIds to the findByIdsForCharacter fallback (tri-tier)', async () => {
    // A garment that lives in a project store — absent from the character's own
    // wardrobe, resolved only when the project tier is supplied.
    const projectItem = makeItem('proj-item', 'Project livery coat', ['top'])
    const findByIdsForCharacter = jest.fn(
      async (_characterId: string, ids: string[], opts?: { projectMountPointIds?: string[] }) =>
        ids.includes('proj-item') && opts?.projectMountPointIds?.includes('proj-mount')
          ? [projectItem]
          : [],
    )
    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIdsForCharacter,
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]
    const slots: EquippedSlots = { ...emptySlots(), top: ['proj-item'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots, {
      projectMountPointIds: ['proj-mount'],
    })
    expect(resolved.outfitValues.top).toEqual(['Project livery coat'])
    expect(findByIdsForCharacter).toHaveBeenCalledWith(
      CHAR_ID,
      ['proj-item'],
      { projectMountPointIds: ['proj-mount'] },
    )
  })

  it('hydrates a shared composite whose components are neither equipped nor owned', async () => {
    // The canonical project-wardrobe default: a "House Livery" bundling three
    // General items. Nothing but the composite is equipped, and the character
    // owns none of it — so the components have to be fetched on their own, or
    // the whole outfit resolves to nothing.
    const coat = makeItem('coat-id', 'Livery coat', ['top'])
    const waistcoat = makeItem('waistcoat-id', 'Livery waistcoat', ['top'])
    const boots = makeItem('boots-id', 'Livery boots', ['footwear'])
    const livery = makeItem('livery-id', 'House livery', ['top'], [
      'coat-id',
      'waistcoat-id',
      'boots-id',
    ])
    const shared = [coat, waistcoat, boots, livery]

    const findByIdsForCharacter = jest.fn(async (_characterId: string, ids: string[]) =>
      shared.filter((i) => ids.includes(i.id)),
    )
    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIdsForCharacter,
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]

    const slots: EquippedSlots = { ...emptySlots(), top: ['livery-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots)

    expect(resolved.outfitValues.top).toEqual(['Livery coat', 'Livery waistcoat'])
    expect(resolved.outfitValues.footwear).toEqual(['Livery boots'])
    // One query for the equipped id, one for its component level — not one per component.
    expect(findByIdsForCharacter).toHaveBeenCalledTimes(2)
  })

  it('hydrates nested composite components level by level', async () => {
    const cufflinks = makeItem('cufflinks-id', 'Cufflinks', ['accessories'])
    const jewelry = makeItem('jewelry-id', 'Formal jewelry', ['accessories'], ['cufflinks-id'])
    const shirt = makeItem('shirt-id', 'Dress shirt', ['top'])
    const formal = makeItem('formal-id', 'Formal set', ['top'], ['shirt-id', 'jewelry-id'])
    const shared = [cufflinks, jewelry, shirt, formal]

    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIdsForCharacter: jest.fn(async (_characterId: string, ids: string[]) =>
          shared.filter((i) => ids.includes(i.id)),
        ),
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]

    const slots: EquippedSlots = { ...emptySlots(), top: ['formal-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots)

    expect(resolved.outfitValues.top).toEqual(['Dress shirt'])
    expect(resolved.outfitValues.accessories).toEqual(['Cufflinks'])
  })

  it('stops hydrating when a component cannot be found anywhere', async () => {
    const orphanParent = makeItem('parent-id', 'Mystery bundle', ['top'], ['ghost-id'])
    const findByIdsForCharacter = jest.fn(async (_characterId: string, ids: string[]) =>
      ids.includes('parent-id') ? [orphanParent] : [],
    )
    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIdsForCharacter,
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]

    const slots: EquippedSlots = { ...emptySlots(), top: ['parent-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots)

    expect(resolved.outfitValues.top).toEqual([])
    // Equipped id, then one attempt at the missing component — no retry loop.
    expect(findByIdsForCharacter).toHaveBeenCalledTimes(2)
  })

  // Bug 78: `equippedOutfit` is unconstrained JSON, so a chat row written
  // before a slot existed simply has no key for it. The loop must read the
  // absent key as an empty slot, not hand `undefined` to `expandComposites`.
  it('resolves a legacy slot bag written before the hair slot existed', async () => {
    const shirt = makeItem('shirt-id', 'Linen shirt', ['top'])
    const legacySlots = {
      top: ['shirt-id'],
      bottom: [],
      footwear: [],
      accessories: [],
    } as unknown as EquippedSlots

    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([shirt]), CHAR_ID, legacySlots)

    expect(resolved.outfitValues.top).toEqual(['Linen shirt'])
    expect(resolved.outfitValues.hair).toEqual([])
    expect(resolved.leafItemsBySlot.hair).toEqual([])
  })
})
