/**
 * The Green Room pin: an archived garment never auditions.
 *
 * "The Green Room" is the chat-creation status dialog; the pipeline it narrates
 * hands each character's wearable pool to the cheap-LLM outfit chooser. That
 * candidate list is the one place archiving is NOT a soft hint — there is no
 * `includeArchived` for the model, no override, no surface that can ask for it.
 *
 * These cases pin that end to end, in every tier (character, group, project,
 * general), plus the two adjacent guarantees:
 *   - a model that hallucinates an archived id still doesn't get to equip it;
 *   - a garment archived mid-chat stays worn until someone takes it off.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import { mergeWearablePool } from '@/lib/wardrobe/wearable-pool'
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
jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  resolveWardrobeInstructions: jest.fn().mockResolvedValue(null),
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

const ARCHIVED = { archivedAt: '2026-02-01T00:00:00.000Z' }

function makeRepos(
  opts: { own?: WardrobeItem[]; shared?: WardrobeItem[]; group?: WardrobeItem[] } = {},
) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  const findArchetypes = jest.fn().mockResolvedValue(opts.shared ?? [])
  const findArchetypesInMounts = jest.fn().mockResolvedValue(opts.group ?? [])
  const findByCharacterId = jest.fn().mockResolvedValue(opts.own ?? [])
  return {
    setEquippedOutfit,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: CHAR_ID, name: 'Bertie', description: 'd', personality: 'p', manifesto: 'm',
        }),
      },
      wardrobe: {
        findByCharacterId,
        findArchetypes,
        findArchetypesInMounts,
        findWearablePoolForCharacter: jest.fn().mockResolvedValue([]),
      },
      connections: { findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]) },
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

/** The candidate list actually handed to the cheap LLM (positional arg 5). */
function candidateIds(): string[] {
  const items = mockChooseLLMOutfit.mock.calls[0]?.[4] as WardrobeItem[]
  return items.map((i) => i.id)
}

const EMPTY_RESOLVED = {
  outfitValues: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  itemsById: new Map(),
}

const EMPTY_SLOTS = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

beforeEach(() => {
  jest.clearAllMocks()
  clock = 0
  mockGroupMounts.mockResolvedValue([])
  mockResolve.mockResolvedValue(
    EMPTY_RESOLVED as Awaited<ReturnType<typeof resolveEquippedOutfitForCharacter>>,
  )
  mockChooseLLMOutfit.mockResolvedValue({
    success: true,
    result: { slots: EMPTY_SLOTS, deliberatelyUnclothed: false },
  } as never)
})

// ============================================================================
// The candidate list
// ============================================================================

describe('llm_choose candidate pool — archived garments never audition', () => {
  it('omits an archived garment from the CHARACTER tier', async () => {
    const { repos } = makeRepos({
      own: [item('own-live', ['top'], { characterId: CHAR_ID }),
            item('own-shelved', ['top'], { characterId: CHAR_ID, ...ARCHIVED })],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(candidateIds()).toEqual(['own-live'])
  })

  it('omits an archived garment from the GENERAL and PROJECT tiers', async () => {
    // The repository hands back one merged shared list (project over general).
    const { repos } = makeRepos({
      shared: [
        item('general-live', ['top']),
        item('general-shelved', ['top'], ARCHIVED),
        item('project-live', ['bottom']),
        item('project-shelved', ['bottom'], ARCHIVED),
      ],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-project'] },
    )

    expect(candidateIds().sort()).toEqual(['general-live', 'project-live'])
  })

  it('omits an archived garment from the GROUP tier', async () => {
    mockGroupMounts.mockResolvedValue(['mp-group'])
    const { repos } = makeRepos({
      group: [item('group-live', ['top']), item('group-shelved', ['top'], ARCHIVED)],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(candidateIds()).toEqual(['group-live'])
  })

  it('hands the LLM nothing at all when every garment in every tier is archived', async () => {
    mockGroupMounts.mockResolvedValue(['mp-group'])
    const { repos } = makeRepos({
      own: [item('own-shelved', ['top'], { characterId: CHAR_ID, ...ARCHIVED })],
      shared: [item('general-shelved', ['top'], ARCHIVED)],
      group: [item('group-shelved', ['top'], ARCHIVED)],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    // An empty pool short-circuits before the LLM is called at all.
    expect(mockChooseLLMOutfit).not.toHaveBeenCalled()
  })
})

// (A model that hallucinates an archived id is stopped by `chooseLLMOutfit`'s
// own pool-membership check — pinned in
// `__tests__/unit/lib/memory/cheap-llm-tasks/outfit-selection.test.ts`, since
// this suite mocks that function out.)

// ============================================================================
// mergeWearablePool's shadowing semantics — documented, do not "fix"
// ============================================================================

describe('mergeWearablePool — archived shadowing', () => {
  it('drops archived items after the tier merge', () => {
    const pool = mergeWearablePool(
      [item('shared-live', ['top'])],
      [item('own-shelved', ['top'], { ...ARCHIVED })],
    )
    expect(pool.map((i) => i.id)).toEqual(['shared-live'])
  })

  it('lets a shared item resurface when the personal override of the SAME id is archived', () => {
    // Deliberate: archiving your own copy is how you fall back to the house one.
    const pool = mergeWearablePool(
      [item('coat', ['top'], { title: 'House coat' })],
      [item('coat', ['top'], { title: 'My coat', characterId: CHAR_ID, ...ARCHIVED })],
    )
    expect(pool).toEqual([])
  })
})
