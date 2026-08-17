/**
 * `applyOutfitSelections` resolve/commit split.
 *
 * Characters resolve concurrently — the `llm_choose` path is a network round
 * trip apiece, and serially one stalled provider call held up the whole cast.
 * But `chats.setEquippedOutfit` is a read-modify-write of a single JSON column
 * keyed by character, so the *writes* must stay serial or they clobber each
 * other. These cases pin both halves, plus the timeout and the
 * deliberately-unclothed signal.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

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

const mockChooseLLMOutfit = chooseLLMOutfit as jest.MockedFunction<typeof chooseLLMOutfit>
const mockResolve = resolveEquippedOutfitForCharacter as jest.MockedFunction<
  typeof resolveEquippedOutfitForCharacter
>

const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

function item(id: string, overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: null,
    title: id,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

/**
 * A repo fake whose `setEquippedOutfit` accumulates into one shared object the
 * way the real one does (read the whole map, set one key, write it back) — so
 * a concurrent-write bug shows up as a lost entry, not just a call-count blip.
 */
function makeRepos(shared: WardrobeItem[] = [item('house-coat', { isDefault: true })]) {
  const state: Record<string, unknown> = {}
  const writeOrder: string[] = []
  let writesInFlight = 0
  let maxConcurrentWrites = 0

  const setEquippedOutfit = jest.fn(async (_chatId: string, characterId: string, slots: unknown) => {
    writesInFlight += 1
    maxConcurrentWrites = Math.max(maxConcurrentWrites, writesInFlight)
    const snapshot = { ...state }
    await new Promise((r) => setTimeout(r, 1))
    snapshot[characterId] = slots
    for (const k of Object.keys(state)) delete state[k]
    Object.assign(state, snapshot)
    writeOrder.push(characterId)
    writesInFlight -= 1
    return slots
  })

  return {
    state,
    writeOrder,
    setEquippedOutfit,
    concurrentWrites: () => maxConcurrentWrites,
    repos: {
      characters: {
        findById: jest.fn(async (id: string) => ({
          id,
          name: `Char-${id}`,
          description: 'd',
          personality: 'p',
          manifesto: 'm',
        })),
      },
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        findArchetypes: jest.fn().mockResolvedValue(shared),
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

const chose = (slots: Partial<typeof EMPTY>, deliberatelyUnclothed = false) =>
  ({
    success: true,
    result: { slots: { ...EMPTY, ...slots }, deliberatelyUnclothed },
  }) as Awaited<ReturnType<typeof chooseLLMOutfit>>

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockResolvedValue({
    outfitValues: EMPTY,
    leafItemsBySlot: EMPTY,
    itemsById: new Map(),
  } as unknown as Awaited<ReturnType<typeof resolveEquippedOutfitForCharacter>>)
})

describe('applyOutfitSelections — concurrent resolve, serial commit', () => {
  it('resolves all characters concurrently', async () => {
    let inFlight = 0
    let peak = 0
    mockChooseLLMOutfit.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight -= 1
      return chose({ top: ['house-coat'] })
    })

    const { repos } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      ['a', 'b', 'c'].map((characterId) => ({ characterId, mode: 'llm_choose' as const })),
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(peak).toBe(3)
  })

  it('is bounded by the slowest character, not their sum', async () => {
    mockChooseLLMOutfit.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40))
      return chose({ top: ['house-coat'] })
    })

    const { repos } = makeRepos()
    const startedAt = Date.now()
    await applyOutfitSelections(
      'chat-1',
      ['a', 'b', 'c', 'd'].map((characterId) => ({ characterId, mode: 'llm_choose' as const })),
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    // Four 40ms calls: ~40ms concurrent, ~160ms serial. Generous margin for CI.
    expect(Date.now() - startedAt).toBeLessThan(120)
  })

  it('never runs two equipped-outfit writes at once, and loses no character', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({ top: ['house-coat'] }))

    const { repos, state, concurrentWrites } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      ['a', 'b', 'c'].map((characterId) => ({ characterId, mode: 'llm_choose' as const })),
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(concurrentWrites()).toBe(1)
    expect(Object.keys(state).sort()).toEqual(['a', 'b', 'c'])
  })

  it('commits in the caller-supplied order regardless of who resolved first', async () => {
    // 'a' is slow, 'c' is fast — resolution finishes c, b, a.
    const delays: Record<string, number> = { a: 30, b: 15, c: 1 }
    mockChooseLLMOutfit.mockImplementation(async (name: string) => {
      const key = name.replace('Char-', '')
      await new Promise((r) => setTimeout(r, delays[key] ?? 1))
      return chose({ top: ['house-coat'] })
    })

    const { repos, writeOrder } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      ['a', 'b', 'c'].map((characterId) => ({ characterId, mode: 'llm_choose' as const })),
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(writeOrder).toEqual(['a', 'b', 'c'])
  })

  it('one character blowing up does not take the others with it', async () => {
    mockChooseLLMOutfit.mockImplementation(async (name: string) =>
      name === 'Char-b' ? Promise.reject(new Error('provider exploded')) : chose({ top: ['house-coat'] }),
    )

    const { repos, state } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      ['a', 'b', 'c'].map((characterId) => ({ characterId, mode: 'llm_choose' as const })),
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    // a and c wear their pick; b falls back to the shared default (the LLM
    // error is caught inside the llm_choose branch, not swallowed wholesale).
    expect(Object.keys(state).sort()).toEqual(['a', 'b', 'c'])
    expect((state.b as Record<string, string[]>).top).toEqual(['house-coat'])
  })
})

describe('applyOutfitSelections — deliberate nudity', () => {
  it('honours an empty outfit the model flagged as deliberate', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({}, true))

    const { repos, state } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'a', mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(state.a).toEqual(EMPTY)
  })

  // Hair is styling, not clothing: an outfit of nothing but a hairdo is still
  // "chose nothing to wear", so the deliberate flag stays the only thing that
  // separates deliberate nudity from a failure to choose.
  it('honours deliberate nudity even when the model styled the hair', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({ hair: ['braided-crown'] }, true))

    const { repos, state } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'a', mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect((state.a as Record<string, string[]>).hair).toEqual(['braided-crown'])
    expect((state.a as Record<string, string[]>).top).toEqual([])
  })

  it('treats a hair-only pick with no deliberate flag as "chose nothing" and uses defaults', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({ hair: ['braided-crown'] }, false))

    const { repos, state } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'a', mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect((state.a as Record<string, string[]>).top).toEqual(['house-coat'])
  })

  it('still falls back to defaults for an empty outfit with no deliberate flag', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({}, false))

    const { repos, state } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'a', mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect((state.a as Record<string, string[]>).top).toEqual(['house-coat'])
  })

  it('tells the status dialog the character chose to wear nothing', async () => {
    mockChooseLLMOutfit.mockResolvedValue(chose({}, true))

    const progress = {
      status: jest.fn(),
      log: jest.fn(),
      wardrobeStart: jest.fn(),
      wardrobeResult: jest.fn(),
      finish: jest.fn(),
      fail: jest.fn(),
    }

    const { repos } = makeRepos()
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: 'a', mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [], progress: progress as never },
    )

    expect(progress.log).toHaveBeenCalledWith(
      expect.stringContaining('nothing at all'),
      'info',
    )
    // The panel still resolves rather than spinning.
    expect(progress.wardrobeResult).toHaveBeenCalledTimes(1)
  })
})

describe('applyOutfitSelections — LLM timeout', () => {
  it('gives up on a stalled provider and dresses the character in their defaults', async () => {
    jest.useFakeTimers()
    try {
      // Never settles — the real-world case was 2m32s for 19 tokens.
      mockChooseLLMOutfit.mockImplementation(() => new Promise(() => {}))

      const { repos, state } = makeRepos()
      const pending = applyOutfitSelections(
        'chat-1',
        [{ characterId: 'a', mode: 'llm_choose' }],
        repos as never,
        { userId: 'u1', projectMountPointIds: [] },
      )

      await jest.advanceTimersByTimeAsync(61_000)
      await pending

      expect((state.a as Record<string, string[]>).top).toEqual(['house-coat'])
    } finally {
      jest.useRealTimers()
    }
  })
})
