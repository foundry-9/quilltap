import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

// Project-tier resolution is exercised elsewhere; here it's a deterministic no-op.
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIdsForChat: jest.fn().mockResolvedValue([]),
  resolveProjectMountPointIds: jest.fn().mockResolvedValue([]),
  resolveGroupMountPointIdsForCharacter: jest.fn().mockResolvedValue([]),
}))

// The tool handlers call these primitives to actually mutate `chats.equippedOutfit`.
// Mocking lets us assert directly on which primitive was invoked with which arguments;
// per-test setup of `repos.chats.getEquippedOutfitForCharacter` continues to drive the
// `current_state` returned by the handler (it's read after the mutation).
jest.mock('@/lib/wardrobe/outfit-displacement', () => ({
  equipItem: jest.fn(),
  replaceItem: jest.fn(),
  addToSlot: jest.fn(),
  removeFromSlot: jest.fn(),
}))

// CommonJS require resolves AFTER jest.mock factories have run.
const { getRepositories } = require('@/lib/repositories/factory')
const avatarGen = require('@/lib/wardrobe/avatar-generation')
const { executeWardrobeListTool } = require('@/lib/tools/handlers/wardrobe-list-handler')
const { executeWardrobeReadTool } = require('@/lib/tools/handlers/wardrobe-read-handler')
const { executeWardrobeCreateTool } = require('@/lib/tools/handlers/wardrobe-create-handler')
const { executeWardrobeUpdateTool } = require('@/lib/tools/handlers/wardrobe-update-handler')
const { executeWardrobeArchiveTool } = require('@/lib/tools/handlers/wardrobe-archive-handler')
const { executeWardrobeWearTool } = require('@/lib/tools/handlers/wardrobe-wear-handler')
const { executeWardrobeTakeOffTool } = require('@/lib/tools/handlers/wardrobe-take-off-handler')
const outfitDisplacement = require('@/lib/wardrobe/outfit-displacement')
// Not mocked — the fake repository below uses the real merge rule so the tier
// precedence the handler relies on is the one under test.
const { mergeWearablePool } = require('@/lib/wardrobe/wearable-pool')

const mockGetRepositories = getRepositories as jest.Mock
const mockTriggerAvatar = avatarGen.triggerAvatarGenerationIfEnabled as jest.Mock
const mockEquipItem = outfitDisplacement.equipItem as jest.Mock
const mockReplaceItem = outfitDisplacement.replaceItem as jest.Mock
const mockAddToSlot = outfitDisplacement.addToSlot as jest.Mock
const mockRemoveFromSlot = outfitDisplacement.removeFromSlot as jest.Mock

const now = '2026-04-07T00:00:00.000Z'

const makeWardrobeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  characterId: 'char-1',
  title: 'Evening Dress',
  description: 'A formal velvet dress',
  imagePrompt: null,
  types: ['top', 'bottom'],
  componentItemIds: [],
  appropriateness: 'formal evening',
  isDefault: false,
  replace: false,
  archivedAt: null,
  migratedFromClothingRecordId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const emptySlots = () => ({ top: [], bottom: [], footwear: [], accessories: [] })

describe('wardrobe tool handlers', () => {
  const context = {
    userId: 'user-1',
    chatId: 'chat-1',
    characterId: 'char-1',
  }

  let repos: any

  beforeEach(() => {
    jest.clearAllMocks()

    repos = {
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        findById: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue([]),
        findByIdsForCharacter: jest.fn((_charId: string, ids: string[]) =>
          repos.wardrobe.findByIds(ids)
        ),
        findArchetypes: jest.fn().mockResolvedValue([]),
        // Delegates to the two tier stubs so per-test setups that only override
        // `findByCharacterId` / `findArchetypes` keep working. Note the list
        // handler swallows a throw into `success: false` rather than failing
        // loudly, so a missing method here reads as a bogus assertion.
        findWearablePoolForCharacter: jest.fn(async (charId: string, opts?: unknown) => {
          const shared = await repos.wardrobe.findArchetypes(false, opts)
          const own = await repos.wardrobe.findByCharacterId(charId)
          return mergeWearablePool(shared, own)
        }),
        findArchetypeById: jest.fn().mockResolvedValue(null),
        findByIdForCharacter: jest.fn((_charId: string, id: string) =>
          repos.wardrobe.findById(id)
        ),
        create: jest.fn(),
        update: jest.fn(),
        archive: jest.fn(),
        delete: jest.fn(),
      },
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(emptySlots()),
        setEquippedOutfit: jest
          .fn()
          .mockImplementation(async (_chatId: string, _charId: string, slots: unknown) => slots),
        findById: jest.fn(),
      },
    }

    mockGetRepositories.mockReturnValue(repos as any)

    mockEquipItem.mockResolvedValue(emptySlots())
    mockReplaceItem.mockResolvedValue(emptySlots())
    mockAddToSlot.mockResolvedValue(emptySlots())
    mockRemoveFromSlot.mockResolvedValue(emptySlots())
  })

  // ──────────────────────────────────────────────────────────── wardrobe_list

  describe('executeWardrobeListTool', () => {
    it('merges the character\'s own items with shared archetypes and flags ownership', async () => {
      const own = makeWardrobeItem({ id: 'own-1', title: 'My Coat', characterId: 'char-1', imagePrompt: 'worn brass-buttoned coat' })
      const shared = makeWardrobeItem({ id: 'shared-1', title: 'General Hat', characterId: null, types: ['accessories'] })
      repos.wardrobe.findByCharacterId.mockResolvedValue([own])
      repos.wardrobe.findArchetypes.mockResolvedValue([shared])

      const result = await executeWardrobeListTool({}, context)

      expect(result.success).toBe(true)
      expect(result.total_count).toBe(2)
      const byId = Object.fromEntries(result.items.map((i: any) => [i.item_id, i]))
      expect(byId['own-1'].is_own).toBe(true)
      expect(byId['own-1'].image_prompt).toBe('worn brass-buttoned coat')
      expect(byId['shared-1'].is_own).toBe(false)
      expect(byId['shared-1'].image_prompt).toBeNull()
    })

    it('folds the character\'s group stores into the wearable pool', async () => {
      // The whole point of the group tier: a garment hanging in a group's
      // `Wardrobe/` folder is wearable by every member without any of them
      // owning it. Before this was wired up, the item was invisible here.
      const tieredMountPool = require('@/lib/mount-index/tiered-mount-pool')
      tieredMountPool.resolveGroupMountPointIdsForCharacter.mockResolvedValueOnce(['grp-mount'])
      const livery = makeWardrobeItem({ id: 'grp-1', title: 'House Livery', characterId: null })
      repos.wardrobe.findArchetypes.mockResolvedValue([livery])

      const result = await executeWardrobeListTool({}, context)

      expect(repos.wardrobe.findWearablePoolForCharacter).toHaveBeenCalledWith('char-1', {
        groupMountPointIds: ['grp-mount'],
        projectMountPointIds: [],
      })
      const byId = Object.fromEntries(result.items.map((i: any) => [i.item_id, i]))
      expect(byId['grp-1'].title).toBe('House Livery')
      expect(byId['grp-1'].is_own).toBe(false)
    })

    it('lets a character\'s own item override a shared archetype on id collision', async () => {
      const own = makeWardrobeItem({ id: 'dup', title: 'Mine', characterId: 'char-1' })
      const shared = makeWardrobeItem({ id: 'dup', title: 'Shared', characterId: null })
      repos.wardrobe.findByCharacterId.mockResolvedValue([own])
      repos.wardrobe.findArchetypes.mockResolvedValue([shared])

      const result = await executeWardrobeListTool({}, context)

      expect(result.total_count).toBe(1)
      expect(result.items[0].title).toBe('Mine')
      expect(result.items[0].is_own).toBe(true)
    })

    it('filters by type', async () => {
      repos.wardrobe.findByCharacterId.mockResolvedValue([
        makeWardrobeItem({ id: 'a', types: ['top'] }),
        makeWardrobeItem({ id: 'b', types: ['footwear'] }),
      ])

      const result = await executeWardrobeListTool({ type_filter: ['footwear'] }, context)
      expect(result.total_count).toBe(1)
      expect(result.items[0].item_id).toBe('b')
    })
  })

  // ──────────────────────────────────────────────────────────── wardrobe_read

  describe('executeWardrobeReadTool', () => {
    it('returns full detail including the Portrait Cue and ownership', async () => {
      repos.wardrobe.findById.mockResolvedValue(
        makeWardrobeItem({ id: 'item-1', imagePrompt: 'a literal cue', characterId: 'char-1' })
      )

      const result = await executeWardrobeReadTool({ item_id: 'item-1' }, context)

      expect(result.success).toBe(true)
      expect(result.image_prompt).toBe('a literal cue')
      expect(result.is_own).toBe(true)
      expect(result.is_composite).toBe(false)
    })

    it('fails when the item is not found', async () => {
      const result = await executeWardrobeReadTool({ item_id: 'nope' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // ────────────────────────────────────────────────────────── wardrobe_create

  describe('executeWardrobeCreateTool', () => {
    it('persists imagePrompt from image_prompt input', async () => {
      repos.wardrobe.create.mockResolvedValue(makeWardrobeItem({ id: 'new-1', title: 'Scarf' }))

      const result = await executeWardrobeCreateTool(
        { title: 'Scarf', types: ['accessories'], image_prompt: 'crimson silk scarf' },
        context
      )

      expect(result.success).toBe(true)
      expect(repos.wardrobe.create).toHaveBeenCalledWith(
        expect.objectContaining({ imagePrompt: 'crimson silk scarf', title: 'Scarf' })
      )
    })

    it('null imagePrompt when image_prompt omitted', async () => {
      repos.wardrobe.create.mockResolvedValue(makeWardrobeItem({ id: 'new-2' }))
      await executeWardrobeCreateTool({ title: 'Plain', types: ['top'] }, context)
      expect(repos.wardrobe.create).toHaveBeenCalledWith(
        expect.objectContaining({ imagePrompt: null })
      )
    })

    it('equips immediately when equip_now is set', async () => {
      const created = makeWardrobeItem({ id: 'new-3', replace: false })
      repos.wardrobe.create.mockResolvedValue(created)
      repos.chats.findById.mockResolvedValue({ equippedOutfit: {} })

      const result = await executeWardrobeCreateTool(
        { title: 'Boots', types: ['footwear'], equip_now: true },
        context
      )

      expect(result.equipped).toBe(true)
      expect(mockEquipItem).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────── wardrobe_update

  describe('executeWardrobeUpdateTool', () => {
    it('updates an owned item and maps image_prompt → imagePrompt', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', characterId: 'char-1' }))
      repos.wardrobe.update.mockResolvedValue(
        makeWardrobeItem({ id: 'item-1', characterId: 'char-1', imagePrompt: 'new cue' })
      )

      const result = await executeWardrobeUpdateTool(
        { item_id: 'item-1', image_prompt: 'new cue', appropriateness: 'casual' },
        context
      )

      expect(result.success).toBe(true)
      expect(repos.wardrobe.update).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ imagePrompt: 'new cue', appropriateness: 'casual' }),
        'char-1'
      )
      expect(result.image_prompt).toBe('new cue')
    })

    it('refuses to edit a shared archetype and never calls the repo', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'shared-1', characterId: null }))

      const result = await executeWardrobeUpdateTool({ item_id: 'shared-1', title: 'Hijack' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/shared wardrobe item/i)
      expect(repos.wardrobe.update).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────── wardrobe_archive

  describe('executeWardrobeArchiveTool', () => {
    it('archives an owned item via archive() and never delete()', async () => {
      const item = makeWardrobeItem({ id: 'item-1', characterId: 'char-1', title: 'Old Cloak' })
      repos.wardrobe.findById.mockResolvedValue(item)
      repos.wardrobe.archive.mockResolvedValue({ ...item, archivedAt: now })

      const result = await executeWardrobeArchiveTool({ item_id: 'item-1' }, context)

      expect(result.success).toBe(true)
      expect(result.action).toBe('archived')
      expect(repos.wardrobe.archive).toHaveBeenCalledWith('item-1', 'char-1')
      expect(repos.wardrobe.delete).not.toHaveBeenCalled()
    })

    it('refuses to archive a shared archetype', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'shared-1', characterId: null }))

      const result = await executeWardrobeArchiveTool({ item_id: 'shared-1' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/shared wardrobe item/i)
      expect(repos.wardrobe.archive).not.toHaveBeenCalled()
    })
  })

  // ──────────────────────────────────────────────────────────── wardrobe_wear

  describe('executeWardrobeWearTool', () => {
    it('wears a single garment (layered) via equipItem', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', replace: false }))

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'wear' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('layered')
      expect(mockEquipItem).toHaveBeenCalledTimes(1)
    })

    it('replace mode calls replaceItem and reports replaced', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1' }))

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'replace' }] },
        context
      )

      expect(result.operations[0].effect).toBe('replaced')
      expect(mockReplaceItem).toHaveBeenCalledTimes(1)
    })

    it('add_to_slot calls addToSlot for a valid slot', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', types: ['top'] }))

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'add_to_slot', slot: 'top' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(mockAddToSlot).toHaveBeenCalledTimes(1)
    })

    it('applies a multi-op array and fires avatar generation exactly once', async () => {
      repos.wardrobe.findById.mockImplementation(async (id: string) =>
        makeWardrobeItem({ id, types: id === 'b' ? ['bottom'] : ['top'] })
      )

      const result = await executeWardrobeWearTool(
        {
          operations: [
            { item_id: 'a', mode: 'wear' },
            { item_id: 'b', mode: 'wear' },
          ],
        },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations).toHaveLength(2)
      expect(mockEquipItem).toHaveBeenCalledTimes(2)
      expect(mockTriggerAvatar).toHaveBeenCalledTimes(1)
    })

    it('fails fast on an unresolved item and does not apply later ops', async () => {
      repos.wardrobe.findById.mockImplementation(async (id: string) =>
        id === 'good' ? makeWardrobeItem({ id: 'good' }) : null
      )

      const result = await executeWardrobeWearTool(
        {
          operations: [
            { item_id: 'good', mode: 'wear' },
            { item_id: 'missing', mode: 'wear' },
            { item_id: 'good', mode: 'wear' },
          ],
        },
        context
      )

      expect(result.success).toBe(false)
      // good applied, missing recorded as the failing op, third never reached.
      expect(result.operations).toHaveLength(2)
      expect(result.operations[1].error).toMatch(/not found/i)
      expect(mockEquipItem).toHaveBeenCalledTimes(1)
    })

    it('rejects an archived item', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', archivedAt: now }))

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'wear' }] },
        context
      )

      expect(result.success).toBe(false)
      expect(result.operations[0].error).toMatch(/archived/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────── wardrobe_take_off

  describe('executeWardrobeTakeOffTool', () => {
    it('removes a worn item across every slot it covers', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', types: ['top', 'bottom'] }))

      const result = await executeWardrobeTakeOffTool(
        { operations: [{ item_id: 'item-1', mode: 'remove' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('removed')
      // removeFromSlot once per covered slot
      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(2)
    })

    it('clears a slot entirely (no item id passed to removeFromSlot)', async () => {
      const result = await executeWardrobeTakeOffTool(
        { operations: [{ mode: 'clear_slot', slot: 'top' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('cleared')
      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(1)
      // removeFromSlot(repos, chatId, characterId, slot, itemId?) — itemId (arg 5)
      // is undefined for a clear, and the slot (arg 4) is the target.
      const call = mockRemoveFromSlot.mock.calls[0]
      expect(call[3]).toBe('top')
      expect(call[4]).toBeUndefined()
    })

    it('restricts removal to one slot when a slot is given', async () => {
      repos.wardrobe.findById.mockResolvedValue(makeWardrobeItem({ id: 'item-1', types: ['top', 'bottom'] }))

      await executeWardrobeTakeOffTool(
        { operations: [{ item_id: 'item-1', mode: 'remove', slot: 'top' }] },
        context
      )

      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(1)
    })
  })
})
