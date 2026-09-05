/**
 * Focused coverage for the chat-creation status-dialog emissions from
 * `applyOutfitSelections`: only the `llm_choose` mode narrates the wardrobe
 * consultation; `default`/`manual` stay silent.
 */

import { applyOutfitSelections } from '../apply-outfit-selections'
import type { CreationProgressEmitter } from '@/lib/chat/creation-progress'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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

function makeProgress(): jest.Mocked<CreationProgressEmitter> {
  return {
    status: jest.fn(),
    log: jest.fn(),
    wardrobeStart: jest.fn(),
    wardrobeResult: jest.fn(),
    finish: jest.fn(),
    fail: jest.fn(),
  }
}

function makeRepos(overrides: Record<string, unknown> = {}) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  return {
    setEquippedOutfit,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: 'c1',
          name: 'Bertie',
          description: 'd',
          personality: 'p',
          manifesto: 'm',
        }),
      },
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue([{ id: 'w1', title: 'Jacket' }]),
        // The shared tiers (Quilltap General + project stores). Empty here —
        // these cases only care about the narration, not the merge.
        findArchetypes: jest.fn().mockResolvedValue([]),
        findWearablePoolForCharacter: jest
          .fn()
          .mockResolvedValue([{ id: 'w1', title: 'Jacket' }]),
      },
      connections: {
        findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]),
      },
      chats: {
        setEquippedOutfit,
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('applyOutfitSelections — status-dialog emissions', () => {
  it('llm_choose announces the consult and publishes the decided four-slot outfit', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['w1'], bottom: [], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)
    mockResolve.mockResolvedValue({
      outfitValues: { top: ['Jacket'], bottom: [], footwear: [], accessories: [], hair: [] },
      leafItemsBySlot: {
        top: [{ id: 'w1', title: 'Jacket', componentItemIds: [] }],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      },
      itemsById: new Map(),
    } as unknown as Awaited<ReturnType<typeof resolveEquippedOutfitForCharacter>>)

    const progress = makeProgress()
    const { repos, setEquippedOutfit } = makeRepos()

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'c1', mode: 'llm_choose' }],
      repos as any,
      { userId: 'u1', projectMountPointIds: [], progress },
    )

    expect(progress.wardrobeStart).toHaveBeenCalledWith('c1', 'Bertie')
    expect(progress.wardrobeResult).toHaveBeenCalledWith('c1', 'Bertie', {
      top: [{ id: 'w1', title: 'Jacket', isComposite: false }],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
    expect(setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'c1', {
      top: ['w1'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it('llm_choose that fails still resolves the panel from the default fallback', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: false,
      error: 'model said no',
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)
    mockResolve.mockResolvedValue({
      outfitValues: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
      leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
      itemsById: new Map(),
    } as Awaited<ReturnType<typeof resolveEquippedOutfitForCharacter>>)

    const progress = makeProgress()
    const { repos } = makeRepos()

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'c1', mode: 'llm_choose' }],
      repos as any,
      { userId: 'u1', projectMountPointIds: [], progress },
    )

    expect(progress.wardrobeStart).toHaveBeenCalledWith('c1', 'Bertie')
    // Panel resolves (doesn't spin forever) and a note is logged.
    expect(progress.wardrobeResult).toHaveBeenCalledTimes(1)
    expect(progress.log).toHaveBeenCalled()
  })

  it('default mode never announces a wardrobe consultation', async () => {
    const progress = makeProgress()
    const { repos, setEquippedOutfit } = makeRepos()

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'c1', mode: 'default' }],
      repos as any,
      { userId: 'u1', projectMountPointIds: [], progress },
    )

    expect(progress.wardrobeStart).not.toHaveBeenCalled()
    expect(progress.wardrobeResult).not.toHaveBeenCalled()
    expect(setEquippedOutfit).toHaveBeenCalled()
    expect(mockChooseLLMOutfit).not.toHaveBeenCalled()
  })

  it('manual mode never announces a wardrobe consultation', async () => {
    const progress = makeProgress()
    const { repos } = makeRepos()

    await applyOutfitSelections(
      'chat-1',
      [
        {
          characterId: 'c1',
          mode: 'manual',
          slots: { top: ['w1'], bottom: [], footwear: [], accessories: [], hair: [] },
        },
      ],
      repos as any,
      { userId: 'u1', projectMountPointIds: [], progress },
    )

    expect(progress.wardrobeStart).not.toHaveBeenCalled()
    expect(progress.wardrobeResult).not.toHaveBeenCalled()
  })
})
