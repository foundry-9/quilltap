// Use global `jest` so module mocks are hoisted before route import.

let mockCtx: any

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'copy-uuid-1'),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => {
    return async (req: any) => handler(req, mockCtx)
  },
}))

jest.mock('@/lib/mount-index/ensure-project-store', () => ({
  ensureProjectOfficialStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/ensure-group-store', () => ({
  ensureGroupOfficialStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/project-wardrobe', () => ({
  ensureProjectWardrobeFolder: jest.fn(),
  readProjectWardrobe: jest.fn(),
}))

jest.mock('@/lib/mount-index/group-wardrobe', () => ({
  ensureGroupWardrobeFolder: jest.fn(),
  readGroupWardrobe: jest.fn(),
}))

jest.mock('@/lib/mount-index/general-wardrobe', () => ({
  readGeneralWardrobe: jest.fn(),
}))

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  createProjectWardrobeItem: jest.fn(),
  deleteProjectWardrobeItem: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/wardrobe/transfers/route'
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store'
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store'
import { ensureProjectWardrobeFolder, readProjectWardrobe } from '@/lib/mount-index/project-wardrobe'
import { ensureGroupWardrobeFolder, readGroupWardrobe } from '@/lib/mount-index/group-wardrobe'
import { readGeneralWardrobe } from '@/lib/mount-index/general-wardrobe'
import { ensureFolderPath } from '@/lib/mount-index/folder-paths'
import { createProjectWardrobeItem, deleteProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes'

describe('wardrobe transfer route', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockCtx = {
      user: { id: 'user-1' },
      repos: {
        projects: {
          findAll: jest.fn().mockResolvedValue([]),
          findById: jest.fn().mockResolvedValue(null),
        },
        groups: {
          findAll: jest.fn().mockResolvedValue([]),
          findById: jest.fn().mockResolvedValue(null),
        },
        characters: {
          findByUserId: jest.fn().mockResolvedValue([]),
          findById: jest.fn().mockResolvedValue(null),
        },
        wardrobe: {
          findByCharacterId: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          delete: jest.fn().mockResolvedValue(true),
        },
      },
    }

    ;(ensureProjectOfficialStore as jest.Mock).mockResolvedValue({ mountPointId: 'project-mount-1' })
    ;(ensureGroupOfficialStore as jest.Mock).mockResolvedValue({ mountPointId: 'group-mount-1' })
    ;(ensureProjectWardrobeFolder as jest.Mock).mockResolvedValue({ folderId: 'folder-1' })
    ;(readProjectWardrobe as jest.Mock).mockResolvedValue([])
    ;(ensureGroupWardrobeFolder as jest.Mock).mockResolvedValue({ folderId: 'folder-1' })
    ;(readGroupWardrobe as jest.Mock).mockResolvedValue([])
    ;(readGeneralWardrobe as jest.Mock).mockResolvedValue([])
    ;(ensureFolderPath as jest.Mock).mockResolvedValue('folder-1')
    ;(createProjectWardrobeItem as jest.Mock).mockImplementation(async (_mount: string, item: any) => item)
    ;(deleteProjectWardrobeItem as jest.Mock).mockResolvedValue(true)
  })

  function req(body: unknown): any {
    return {
      method: 'POST',
      url: 'http://localhost:3000/api/v1/wardrobe/transfers',
      json: async () => body,
    }
  }

  it('GET returns destination buckets for General, projects, groups, and users', async () => {
    mockCtx.repos.projects.findAll.mockResolvedValue([
      { id: 'project-2', name: 'Beta Project' },
      { id: 'project-1', name: 'Alpha Project' },
    ])
    mockCtx.repos.groups.findAll.mockResolvedValue([
      { id: 'group-1', name: 'Main Cast' },
    ])
    mockCtx.repos.characters.findByUserId.mockResolvedValue([
      { id: 'char-2', name: 'Zara' },
      { id: 'char-1', name: 'Ada' },
    ])

    const res = await GET({ method: 'GET', url: 'http://localhost:3000/api/v1/wardrobe/transfers' } as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.destinations.general).toEqual({ available: true, label: 'Quilltap General' })
    expect(body.destinations.projects).toEqual([
      { id: 'project-1', name: 'Alpha Project' },
      { id: 'project-2', name: 'Beta Project' },
    ])
    expect(body.destinations.groups).toEqual([{ id: 'group-1', name: 'Main Cast' }])
    expect(body.destinations.users).toEqual([
      { id: 'char-1', name: 'Ada' },
      { id: 'char-2', name: 'Zara' },
    ])
  })

  it('POST copy regenerates UUID for destination item', async () => {
    const sourceItem = {
      id: 'item-1',
      characterId: 'char-src',
      title: 'Evening coat',
      description: 'black wool coat',
      imagePrompt: null,
      types: ['top'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      replace: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    mockCtx.repos.characters.findById.mockImplementation(async (id: string) => {
      if (id === 'char-src' || id === 'char-dst') return { id, userId: 'user-1' }
      return null
    })
    mockCtx.repos.wardrobe.findByCharacterId.mockImplementation(async (id: string) => {
      if (id === 'char-src') return [sourceItem]
      return []
    })
    mockCtx.repos.wardrobe.create.mockImplementation(async (data: any, options: any) => ({
      ...sourceItem,
      ...data,
      id: options.id,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
      characterId: data.characterId,
    }))

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'character', id: 'char-dst' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(body.wardrobeItem.id).toBe('copy-uuid-1')
    expect(body.wardrobeItem.characterId).toBe('char-dst')
    expect(mockCtx.repos.wardrobe.delete).not.toHaveBeenCalled()
  })

  it('POST move removes source item after successful destination write', async () => {
    const sourceItem = {
      id: 'item-1',
      characterId: 'char-src',
      title: 'Travel boots',
      description: null,
      imagePrompt: null,
      types: ['footwear'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      replace: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    mockCtx.repos.characters.findById.mockImplementation(async (id: string) => {
      if (id === 'char-src') return { id, userId: 'user-1' }
      return null
    })
    mockCtx.repos.wardrobe.findByCharacterId.mockResolvedValue([sourceItem])
    mockCtx.repos.wardrobe.create.mockImplementation(async (data: any, options: any) => ({
      ...sourceItem,
      ...data,
      id: options.id,
      characterId: data.characterId,
    }))

    const res = await POST(req({
      action: 'move',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('move')
    expect(body.wardrobeItem.id).toBe('item-1')
    expect(mockCtx.repos.wardrobe.delete).toHaveBeenCalledWith('item-1', 'char-src')
  })

  it('POST accepts project destination when project has no userId field', async () => {
    const sourceItem = {
      id: 'item-1',
      characterId: 'char-src',
      title: 'Travel cloak',
      description: null,
      imagePrompt: null,
      types: ['top'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      replace: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    mockCtx.repos.characters.findById.mockResolvedValue({ id: 'char-src', userId: 'user-1' })
    mockCtx.repos.wardrobe.findByCharacterId.mockResolvedValue([sourceItem])
    // Project rows in this codebase don't include userId.
    mockCtx.repos.projects.findById.mockResolvedValue({ id: 'project-1', name: 'Campaign' })

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'project', id: 'project-1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(createProjectWardrobeItem).toHaveBeenCalledWith(
      'project-mount-1',
      expect.objectContaining({ id: 'copy-uuid-1' }),
    )
  })

  it('POST resolves an explicit group source without any character probing', async () => {
    const groupItem = {
      id: 'item-g1',
      characterId: null,
      title: 'Regimental sash',
      description: null,
      imagePrompt: null,
      types: ['accessories'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      replace: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    mockCtx.repos.groups.findById.mockResolvedValue({ id: 'group-1', name: 'Main Cast' })
    mockCtx.repos.characters.findById.mockResolvedValue({ id: 'char-dst', userId: 'user-1' })
    ;(readGroupWardrobe as jest.Mock).mockResolvedValue([groupItem])
    mockCtx.repos.wardrobe.create.mockImplementation(async (data: any, options: any) => ({
      ...groupItem,
      ...data,
      id: options.id,
      characterId: data.characterId,
    }))

    const res = await POST(req({
      action: 'move',
      itemId: 'item-g1',
      source: { scope: 'group', id: 'group-1' },
      destination: { scope: 'character', id: 'char-dst' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('move')
    expect(body.wardrobeItem.characterId).toBe('char-dst')
    // The item was resolved straight from the named group's mount.
    expect(readGroupWardrobe).toHaveBeenCalledWith('group-mount-1', true)
    // The move deletes from the group's mount folder.
    expect(deleteProjectWardrobeItem).toHaveBeenCalledWith('group-mount-1', 'item-g1')
  })

  it('POST resolves an explicit general source and copies into a project', async () => {
    const generalItem = {
      id: 'item-gen',
      characterId: null,
      title: 'House cloak',
      description: null,
      imagePrompt: null,
      types: ['top'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      replace: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    ;(readGeneralWardrobe as jest.Mock).mockResolvedValue([generalItem])
    mockCtx.repos.projects.findById.mockResolvedValue({ id: 'project-1', name: 'Campaign' })

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-gen',
      source: { scope: 'general' },
      destination: { scope: 'project', id: 'project-1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(createProjectWardrobeItem).toHaveBeenCalledWith(
      'project-mount-1',
      expect.objectContaining({ id: 'copy-uuid-1', characterId: null }),
    )
    // Copy leaves the general original in place.
    expect(mockCtx.repos.wardrobe.delete).not.toHaveBeenCalled()
  })

  it('POST rejects a body naming neither sourceCharacterId nor source', async () => {
    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      destination: { scope: 'general' },
    }))

    expect(res.status).toBe(400)
  })
})
