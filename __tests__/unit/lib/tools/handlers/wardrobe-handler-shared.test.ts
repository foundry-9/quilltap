import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn(),
}))

const { logger } = require('@/lib/logger')
const { enqueueWardrobeOutfitAnnouncement } = require('@/lib/background-jobs/queue-service')
const {
  buildWardrobeCoverageSummaryFromState,
  emptyEquippedState,
  loadCurrentWardrobeState,
  scheduleWardrobeAnnouncement,
  recordPendingWardrobeAnnouncement,
  flushPendingWardrobeAnnouncements,
} = require('@/lib/tools/handlers/wardrobe-handler-shared')

describe('wardrobe-handler-shared', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty equipped state when no outfit is stored', async () => {
    const repos = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
      wardrobe: {
        findByIds: jest.fn().mockResolvedValue([]),
      },
    }

    const state = await loadCurrentWardrobeState(repos as any, 'chat-1', 'char-1')
    expect(state).toEqual(emptyEquippedState())
  })

  it('builds coverage summary using expanded composite leaves loaded via findByCharacterId', async () => {
    // Production reality: equipped state stores only the composite ID, so
    // findByIds([composite_id]) wouldn't return the children. Components must
    // come back via findByCharacterId so the resolver can expand the composite.
    const allItems = [
      { id: 'rain-outfit', characterId: 'char-1', title: 'Rain Outfit', types: ['top', 'bottom', 'footwear'], componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'] },
      { id: 'raincoat-1', characterId: 'char-1', title: 'Raincoat', types: ['top'], componentItemIds: [] },
      { id: 'jeans-1', characterId: 'char-1', title: 'Blue Jeans', types: ['bottom'], componentItemIds: [] },
      { id: 'wellies-1', characterId: 'char-1', title: 'Wellies', types: ['footwear'], componentItemIds: [] },
    ]
    const repos = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn(),
      },
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue(allItems),
        findByIds: jest.fn().mockResolvedValue([]),
      },
    }

    const summary = await buildWardrobeCoverageSummaryFromState(repos as any, 'char-1', {
      top: ['rain-outfit'],
      bottom: ['rain-outfit'],
      footwear: ['rain-outfit'],
      accessories: [],
      hair: [],
    })

    expect(summary).toContain('Raincoat')
    expect(summary).toContain('Blue Jeans')
    expect(summary).toContain('Wellies')
    expect(summary).not.toContain('Rain Outfit')
    expect(summary).not.toContain('completely naked')
  })

  it('renders a composite equipped to all four slots with components loaded from the wardrobe (Friday regression)', async () => {
    // This mirrors what Friday hit: wardrobe_wear puts a composite ID
    // in all four equipped slots, and the prior implementation only fetched
    // by equipped IDs, so child items vanished and the summary read
    // "completely naked and unadorned".
    const allItems = [
      {
        id: 'working-outfit',
        characterId: 'char-1',
        title: 'Working Outfit — Composed',
        types: ['top', 'bottom', 'footwear', 'accessories'],
        componentItemIds: ['sweater-1', 'jeans-1', 'boots-1', 'ring-1'],
      },
      { id: 'sweater-1', characterId: 'char-1', title: 'Navy Sweater', types: ['top'], componentItemIds: [] },
      { id: 'jeans-1', characterId: 'char-1', title: 'Dark Jeans', types: ['bottom'], componentItemIds: [] },
      { id: 'boots-1', characterId: 'char-1', title: 'Brown Boots', types: ['footwear'], componentItemIds: [] },
      { id: 'ring-1', characterId: 'char-1', title: 'Wedding Ring', types: ['accessories'], componentItemIds: [] },
    ]
    const repos = {
      chats: { getEquippedOutfitForCharacter: jest.fn() },
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue(allItems),
        findByIds: jest.fn().mockResolvedValue([]),
      },
    }

    const summary = await buildWardrobeCoverageSummaryFromState(repos as any, 'char-1', {
      top: ['working-outfit'],
      bottom: ['working-outfit'],
      footwear: ['working-outfit'],
      accessories: ['working-outfit'],
      hair: [],
    })

    expect(summary).toContain('Navy Sweater')
    expect(summary).toContain('Dark Jeans')
    expect(summary).toContain('Brown Boots')
    expect(summary).toContain('Wedding Ring')
    expect(summary).not.toContain('completely naked')
    expect(summary).not.toContain('Working Outfit — Composed')
  })

  it('logs a warning when announcement enqueue fails', async () => {
    enqueueWardrobeOutfitAnnouncement.mockRejectedValueOnce(new Error('queue unavailable'))

    await scheduleWardrobeAnnouncement('wardrobe-test', {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      extraLogFields: { slot: 'top' },
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to schedule wardrobe outfit announcement',
      expect.objectContaining({
        context: 'wardrobe-test',
        chatId: 'chat-1',
        characterId: 'char-1',
        slot: 'top',
      }),
    )
  })

  describe('recordPendingWardrobeAnnouncement', () => {
    it('adds to the per-turn Set without enqueuing immediately when one is present', async () => {
      const pending = new Set<string>()
      await recordPendingWardrobeAnnouncement(
        { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending },
        { sourceContext: 'wardrobe-test', characterId: 'char-1' },
      )
      expect(pending.has('char-1')).toBe(true)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('falls back to immediate enqueue when no per-turn Set is present', async () => {
      await recordPendingWardrobeAnnouncement(
        { userId: 'user-1', chatId: 'chat-1' },
        { sourceContext: 'wardrobe-test', characterId: 'char-1' },
      )
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
    })

    it('coalesces multiple records for the same character into a single Set entry', async () => {
      const pending = new Set<string>()
      const ctx = { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending }
      for (let i = 0; i < 6; i++) {
        await recordPendingWardrobeAnnouncement(ctx, {
          sourceContext: 'wardrobe-test',
          characterId: 'char-1',
        })
      }
      expect(pending.size).toBe(1)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('keeps separate entries for different characters', async () => {
      const pending = new Set<string>()
      const ctx = { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending }
      await recordPendingWardrobeAnnouncement(ctx, { sourceContext: 's', characterId: 'char-1' })
      await recordPendingWardrobeAnnouncement(ctx, { sourceContext: 's', characterId: 'char-2' })
      expect(pending.size).toBe(2)
    })
  })

  describe('flushPendingWardrobeAnnouncements', () => {
    it('enqueues one announcement per character and clears the Set', async () => {
      const pending = new Set<string>(['char-1', 'char-2'])
      await flushPendingWardrobeAnnouncements({
        userId: 'user-1',
        chatId: 'chat-1',
        pendingWardrobeAnnouncements: pending,
      })
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(2)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-2',
      })
      expect(pending.size).toBe(0)
    })

    it('is a no-op when the Set is missing', async () => {
      await flushPendingWardrobeAnnouncements({ userId: 'user-1', chatId: 'chat-1' })
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('is idempotent across repeated calls', async () => {
      const pending = new Set<string>(['char-1'])
      const ctx = { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending }
      await flushPendingWardrobeAnnouncements(ctx)
      await flushPendingWardrobeAnnouncements(ctx)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(1)
    })
  })
})
