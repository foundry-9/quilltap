/**
 * `?action=instructions` on the character wardrobe collection route.
 *
 * Pins that:
 *  - GET reads the vault's `Wardrobe/instructions.md` (null when absent or
 *    when the character has no vault) without touching the item list.
 *  - POST writes through `resolveWardrobeMount`, so the archived-character
 *    tombstone is honoured (409) and vault-less characters can still clear.
 *  - An unknown character 404s.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  exists: (v: unknown) => v !== null && v !== undefined,
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  withActionDispatch: (actions: Record<string, any>, defaultHandler: any) => {
    return async (req: any, ctx: any, params: any) => {
      const action = req?.nextUrl?.searchParams?.get?.('action') ?? null
      if (action && actions[action]) return actions[action](req, ctx, params)
      return defaultHandler(req, ctx, params)
    }
  },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  conflict: (msg: string) => ({ __kind: 'conflict', status: 409, msg }),
  created: (data: any) => ({ body: data, status: 201 }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountPointIdsForCharacter: jest.fn(),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  resolveWardrobeMount: jest.fn(),
}))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {
    constructor(id: string) {
      super(`archived: ${id}`)
      this.name = 'CharacterArchivedError'
    }
  },
}))

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/characters/[id]/wardrobe/route'
import { resolveWardrobeMount } from '@/lib/database/repositories/vault-overlay/wardrobe-writes'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions'

const CHAR_ID = 'char-1'
const MOUNT_ID = 'vault-mount-1'

function routeCtx(params: Record<string, string>): any {
  return { params: Promise.resolve(params) }
}

function actionReq(body?: unknown): any {
  return {
    nextUrl: { searchParams: new URLSearchParams('action=instructions') },
    json: async () => body,
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: CHAR_ID,
          name: 'Bertie',
          characterDocumentMountPointId: MOUNT_ID,
        }),
      },
    },
  }

  ;(resolveWardrobeMount as jest.Mock).mockResolvedValue({
    mountPointId: MOUNT_ID,
    scopeId: CHAR_ID,
    characterId: CHAR_ID,
    scope: 'character',
  })
  ;(readWardrobeInstructionsFile as jest.Mock).mockResolvedValue(null)
  ;(writeWardrobeInstructionsFile as jest.Mock).mockResolvedValue(undefined)
})

it('GET reads the vault instructions and reports null when absent', async () => {
  const res: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBeNull()
  expect(readWardrobeInstructionsFile).toHaveBeenCalledWith(MOUNT_ID)
})

it('GET reports null without reading when the character has no vault', async () => {
  mockCtx.repos.characters.findById.mockResolvedValue({ id: CHAR_ID, name: 'Bertie' })
  const res: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBeNull()
  expect(readWardrobeInstructionsFile).not.toHaveBeenCalled()
})

it('POST writes to the resolved vault mount', async () => {
  const res: any = await POST(
    actionReq({ instructions: 'You prefer tweeds for fieldwork.' }),
    routeCtx({ id: CHAR_ID }),
  )
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBe('You prefer tweeds for fieldwork.')
  expect(writeWardrobeInstructionsFile).toHaveBeenCalledWith(
    MOUNT_ID,
    'You prefer tweeds for fieldwork.',
  )
})

it('POST 409s for an archived character (tombstone respected)', async () => {
  ;(resolveWardrobeMount as jest.Mock).mockRejectedValue(new CharacterArchivedError(CHAR_ID))
  const res: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: CHAR_ID }))
  expect(res.status).toBe(409)
  expect(writeWardrobeInstructionsFile).not.toHaveBeenCalled()
})

it('POST clearing succeeds as a no-op when no vault resolves', async () => {
  ;(resolveWardrobeMount as jest.Mock).mockResolvedValue(null)
  const cleared: any = await POST(actionReq({ instructions: null }), routeCtx({ id: CHAR_ID }))
  expect(cleared.status).toBe(200)
  expect(cleared.body.instructions).toBeNull()

  const write: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: CHAR_ID }))
  expect(write.status).toBe(500)
  expect(writeWardrobeInstructionsFile).not.toHaveBeenCalled()
})

it('GET and POST 404 for an unknown character', async () => {
  mockCtx.repos.characters.findById.mockResolvedValue(null)
  const getRes: any = await GET(actionReq(), routeCtx({ id: 'nope' }))
  const postRes: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: 'nope' }))
  expect(getRes.status).toBe(404)
  expect(postRes.status).toBe(404)
})
