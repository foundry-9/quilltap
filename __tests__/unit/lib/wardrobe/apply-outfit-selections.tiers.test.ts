/**
 * Multi-tier coverage for `applyOutfitSelections`.
 *
 * The server used to dress characters from their own vault alone, so a
 * character whose wardrobe lives entirely in a shared tier (Quilltap General, a
 * project store, or one of their groups) opened a chat wearing nothing and
 * never reached the `llm_choose` LLM at all. These cases pin the merged
 * behaviour: merge every tier first, filter `isDefault` last, character shadows
 * shared on id.
 *
 * The group tier is read per character rather than with the batch, because it
 * follows each character's own memberships.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountPointIdsForCharacter: jest.fn(),
  resolveProjectMountPointIds: jest.fn().mockResolvedValue([]),
  resolveProjectMountPointIdsForChat: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/lib/memory/cheap-llm-tasks/outfit-selection', () => ({
  chooseLLMOutfit: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(() => ({ profileId: 'cheap' })),
  DEFAULT_CHEAP_LLM_CONFIG: {},
}))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))

const mockChooseLLMOutfit = chooseLLMOutfit as jest.MockedFunction<typeof chooseLLMOutfit>
const mockResolve = resolveEquippedOutfitForCharacter as jest.MockedFunction<
  typeof resolveEquippedOutfitForCharacter
>
const mockGroupMounts = resolveGroupMountPointIdsForCharacter as jest.MockedFunction<
  typeof resolveGroupMountPointIdsForCharacter
>

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

let clock = 0

function item(
  id: string,
  types: WardrobeItemType[],
  overrides: Partial<WardrobeItem> = {},
): WardrobeItem {
  clock += 1
  return {
    id,
    characterId: null,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: `2026-01-01T00:00:${String(clock).padStart(2, '0')}.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

function makeRepos(
  opts: { own?: WardrobeItem[]; shared?: WardrobeItem[]; group?: WardrobeItem[] } = {},
) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  const findArchetypes = jest.fn().mockResolvedValue(opts.shared ?? [])
  const findArchetypesInMounts = jest.fn().mockResolvedValue(opts.group ?? [])
  const findByCharacterId = jest.fn().mockResolvedValue(opts.own ?? [])
  return {
    setEquippedOutfit,
    findArchetypes,
    findArchetypesInMounts,
    findByCharacterId,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: CHAR_ID,
          name: 'Bertie',
          description: 'd',
          personality: 'p',
          manifesto: 'm',
        }),
      },
      wardrobe: {
        findByCharacterId,
        findArchetypes,
        findArchetypesInMounts,
        findWearablePoolForCharacter: jest.fn().mockResolvedValue([]),
      },
      connections: {
        findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]),
      },
      chats: {
        setEquippedOutfit,
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
    },
  }
}

function equippedFor(setEquippedOutfit: jest.Mock, characterId = CHAR_ID) {
  const call = setEquippedOutfit.mock.calls.find((c) => c[1] === characterId)
  return call?.[2] as Record<string, string[]> | undefined
}

const EMPTY_RESOLVED = {
  outfitValues: { top: [], bottom: [], footwear: [], accessories: [] },
  leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [] },
  itemsById: new Map(),
}

beforeEach(() => {
  jest.clearAllMocks()
  clock = 0
  mockGroupMounts.mockResolvedValue([])
  mockResolve.mockResolvedValue(
    EMPTY_RESOLVED as Awaited<ReturnType<typeof resolveEquippedOutfitForCharacter>>,
  )
})

describe('applyOutfitSelections — shared wardrobe tiers', () => {
  it('equips a Quilltap General default when the character vault is empty', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      shared: [item('general-coat', ['top'], { isDefault: true })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)).toEqual({
      top: ['general-coat'],
      bottom: [],
      footwear: [],
      accessories: [],
    })
  })

  it('layers personal, project and General defaults in createdAt order', async () => {
    // Created oldest-first: general, then project, then personal.
    const general = item('general-shirt', ['top'], { isDefault: true })
    const project = item('project-waistcoat', ['top'], { isDefault: true })
    const personal = item('own-jacket', ['top'], { isDefault: true, characterId: CHAR_ID })

    const { repos, setEquippedOutfit } = makeRepos({
      own: [personal],
      // The repository hands back one merged shared list (project over general).
      shared: [general, project],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-project'] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual([
      'general-shirt',
      'project-waistcoat',
      'own-jacket',
    ])
  })

  it('does not equip a shared default the character shadows with isDefault:false', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      shared: [item('livery', ['top'], { isDefault: true })],
      own: [item('livery', ['top'], { isDefault: false, characterId: CHAR_ID })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)).toEqual({
      top: [],
      bottom: [],
      footwear: [],
      accessories: [],
    })
  })

  it('equips an item the character marks default even when the shared copy does not', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      shared: [item('livery', ['top'], { isDefault: false })],
      own: [item('livery', ['top'], { isDefault: true, characterId: CHAR_ID })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['livery'])
  })

  it('excludes an archived shared default', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      shared: [
        item('archived-cloak', ['top'], {
          isDefault: true,
          archivedAt: '2026-02-02T00:00:00.000Z',
        }),
        item('live-cloak', ['top'], { isDefault: true }),
      ],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['live-cloak'])
  })

  it('hands the merged pool to chooseLLMOutfit for a character with an empty vault', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['general-coat'], bottom: [], footwear: [], accessories: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      shared: [item('general-coat', ['top'])],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(mockChooseLLMOutfit).toHaveBeenCalledTimes(1)
    const passedItems = mockChooseLLMOutfit.mock.calls[0][4] as WardrobeItem[]
    expect(passedItems.map((i) => i.id)).toEqual(['general-coat'])
    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['general-coat'])
  })

  it('falls back to defaults when the LLM picks nothing usable', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: [], bottom: [], footwear: [], accessories: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      shared: [item('general-coat', ['top'], { isDefault: true })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['general-coat'])
  })

  it('equips a group default when the character vault and the batch tiers are empty', async () => {
    mockGroupMounts.mockResolvedValue(['grp-mount'])
    const { repos, setEquippedOutfit, findArchetypesInMounts } = makeRepos({
      own: [],
      shared: [],
      group: [item('house-livery', ['top'], { isDefault: true })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(findArchetypesInMounts).toHaveBeenCalledWith(['grp-mount'], false)
    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['house-livery'])
  })

  it('lets a group item shadow the project/general copy of the same id', async () => {
    mockGroupMounts.mockResolvedValue(['grp-mount'])
    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      shared: [item('livery', ['top'], { isDefault: true, title: 'shared livery' })],
      group: [item('livery', ['top'], { isDefault: true, title: 'group livery' })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a'] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['livery'])
  })

  it('skips the group read entirely for a character with no memberships', async () => {
    const { repos, findArchetypesInMounts } = makeRepos({
      own: [],
      shared: [item('general-coat', ['top'], { isDefault: true })],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(findArchetypesInMounts).not.toHaveBeenCalled()
  })

  it('threads both shared tiers into the pool fetch and the preview resolve', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['project-coat'], bottom: [], footwear: [], accessories: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const progress = {
      status: jest.fn(),
      log: jest.fn(),
      wardrobeStart: jest.fn(),
      wardrobeResult: jest.fn(),
      finish: jest.fn(),
      fail: jest.fn(),
    }

    const { repos, findArchetypes } = makeRepos({
      own: [],
      shared: [item('project-coat', ['top'])],
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a', 'mp-b'], progress: progress as never },
    )

    expect(findArchetypes).toHaveBeenCalledWith(false, {
      projectMountPointIds: ['mp-a', 'mp-b'],
    })
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      CHAR_ID,
      expect.anything(),
      { groupMountPointIds: [], projectMountPointIds: ['mp-a', 'mp-b'] },
    )
  })

  it('reads the shared tiers once for a batch of selections', async () => {
    const other = 'c1c1c1c1-0000-0000-0000-000000000002'
    const { repos, findArchetypes, findByCharacterId } = makeRepos({
      own: [],
      shared: [item('general-coat', ['top'], { isDefault: true })],
    })

    await applyOutfitSelections(
      'chat-1',
      [
        { characterId: CHAR_ID, mode: 'default' },
        { characterId: other, mode: 'default' },
      ],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(findArchetypes).toHaveBeenCalledTimes(1)
    // Each character's own vault is still read once apiece.
    expect(findByCharacterId).toHaveBeenCalledTimes(2)
  })
})
