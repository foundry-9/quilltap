/**
 * Tests for the group wardrobe routes — the group tier's own CRUD endpoints
 * (before these existed, group items could only be created via a transfer).
 *
 * Pins that:
 *  - GET ensures the group's official store + `Wardrobe/` folder and lists it.
 *  - POST creates a shared (characterId: null) item in the group's mount.
 *  - PUT/DELETE on the item route target the group's mount, and DELETE first
 *    scrubs equipped references.
 *  - An unknown group 404s everywhere.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'new-item-uuid'),
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
}))

jest.mock('@/lib/api/responses', () => ({
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  created: (data: any) => ({ body: data, status: 201 }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

jest.mock('@/lib/mount-index/ensure-group-store', () => ({
  ensureGroupOfficialStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/group-wardrobe', () => ({
  ensureGroupWardrobeFolder: jest.fn(),
  readGroupWardrobe: jest.fn(),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  createProjectWardrobeItem: jest.fn(),
  updateProjectWardrobeItem: jest.fn(),
  deleteProjectWardrobeItem: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/groups/[id]/wardrobe/route'
import { GET as GET_ITEM, PUT, DELETE } from '@/app/api/v1/groups/[id]/wardrobe/[itemId]/route'
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store'
import { ensureGroupWardrobeFolder, readGroupWardrobe } from '@/lib/mount-index/group-wardrobe'
import {
  createProjectWardrobeItem,
  updateProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'

const GROUP_ID = 'group-1'
const MOUNT_ID = 'group-mount-1'
const ITEM_ID = 'item-1'

const storedItem = {
  id: ITEM_ID,
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

function routeCtx(params: Record<string, string>): any {
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      groups: {
        findById: jest.fn().mockResolvedValue({ id: GROUP_ID, name: 'Main Cast' }),
      },
      chats: {
        removeEquippedItemFromAllChats: jest.fn().mockResolvedValue(undefined),
      },
    },
  }

  ;(ensureGroupOfficialStore as jest.Mock).mockResolvedValue({ mountPointId: MOUNT_ID, created: false })
  ;(ensureGroupWardrobeFolder as jest.Mock).mockResolvedValue({ folderId: 'folder-1' })
  ;(readGroupWardrobe as jest.Mock).mockResolvedValue([storedItem])
  ;(createProjectWardrobeItem as jest.Mock).mockImplementation(async (_mount: string, item: any) => item)
  ;(updateProjectWardrobeItem as jest.Mock).mockResolvedValue({ ...storedItem, title: 'Renamed sash' })
  ;(deleteProjectWardrobeItem as jest.Mock).mockResolvedValue(true)
})

it('GET lists the group mount wardrobe after ensuring store and folder', async () => {
  const res: any = await GET({} as any, routeCtx({ id: GROUP_ID }))

  expect(res.status).toBe(200)
  expect(res.body.mountPointId).toBe(MOUNT_ID)
  expect(res.body.wardrobeItems).toEqual([storedItem])
  expect(ensureGroupOfficialStore).toHaveBeenCalledWith(GROUP_ID, 'Main Cast')
  expect(ensureGroupWardrobeFolder).toHaveBeenCalledWith(MOUNT_ID)
})

it('GET 404s for an unknown group', async () => {
  mockCtx.repos.groups.findById.mockResolvedValue(null)
  const res: any = await GET({} as any, routeCtx({ id: 'nope' }))
  expect(res.status).toBe(404)
})

it('POST creates a shared item in the group mount', async () => {
  const res: any = await POST(
    { json: async () => ({ title: 'Parade gloves', types: ['accessories'] }) } as any,
    routeCtx({ id: GROUP_ID }),
  )

  expect(res.status).toBe(201)
  expect(createProjectWardrobeItem).toHaveBeenCalledWith(
    MOUNT_ID,
    expect.objectContaining({ id: 'new-item-uuid', characterId: null, title: 'Parade gloves' }),
  )
  expect(res.body.wardrobeItem.title).toBe('Parade gloves')
})

it('GET item returns one item from the group mount', async () => {
  const res: any = await GET_ITEM({} as any, routeCtx({ id: GROUP_ID, itemId: ITEM_ID }))
  expect(res.status).toBe(200)
  expect(res.body.wardrobeItem.id).toBe(ITEM_ID)
})

it('PUT updates the item through the group mount', async () => {
  const res: any = await PUT(
    { json: async () => ({ title: 'Renamed sash' }) } as any,
    routeCtx({ id: GROUP_ID, itemId: ITEM_ID }),
  )

  expect(res.status).toBe(200)
  expect(updateProjectWardrobeItem).toHaveBeenCalledWith(
    MOUNT_ID,
    ITEM_ID,
    expect.objectContaining({ title: 'Renamed sash' }),
  )
  expect(res.body.wardrobeItem.title).toBe('Renamed sash')
})

it('DELETE scrubs equipped references then deletes from the group mount', async () => {
  const res: any = await DELETE({} as any, routeCtx({ id: GROUP_ID, itemId: ITEM_ID }))

  expect(res.status).toBe(200)
  expect(mockCtx.repos.chats.removeEquippedItemFromAllChats).toHaveBeenCalledWith(ITEM_ID)
  expect(deleteProjectWardrobeItem).toHaveBeenCalledWith(MOUNT_ID, ITEM_ID)
})

it('DELETE 404s when the item is not in the group mount', async () => {
  ;(deleteProjectWardrobeItem as jest.Mock).mockResolvedValue(false)
  const res: any = await DELETE({} as any, routeCtx({ id: GROUP_ID, itemId: 'missing' }))
  expect(res.status).toBe(404)
})
