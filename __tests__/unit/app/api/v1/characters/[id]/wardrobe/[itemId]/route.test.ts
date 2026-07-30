/**
 * Regression test for the character-wardrobe DELETE route (commit fafd5449).
 *
 * The DELETE pre-check queried the legacy `wardrobe_items` SQL table via
 * repos.wardrobe.findById(itemId). That table was emptied when wardrobe storage
 * cut over to the vault, so the pre-check always 404'd even for items the vault
 * still listed (GET/PUT already used the vault-aware findByIdForCharacter). The
 * fix switches DELETE to the same vault-aware lookup.
 *
 * These tests pin that DELETE resolves the item through findByIdForCharacter
 * (never the stale findById) and only deletes when the vault confirms it.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  exists: (entity: unknown) => entity != null,
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  // Mirrors the real helper through the global next/server mock: the payload
  // lands on `.body`, exactly as the raw NextResponse.json call used to.
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

import { DELETE } from '@/app/api/v1/characters/[id]/wardrobe/[itemId]/route'

const CHAR_ID = 'char-1'
const ITEM_ID = 'item-1'
const OWNER_ID = 'user-1'

function buildRepos(overrides: Record<string, any> = {}) {
  return {
    characters: {
      findById: jest.fn().mockResolvedValue({ id: CHAR_ID, userId: OWNER_ID }),
    },
    wardrobe: {
      // The stale SQL-table lookup — must NOT be used by the pre-check anymore.
      findById: jest.fn().mockResolvedValue(null),
      // The vault-aware lookup GET/PUT/DELETE all share.
      findByIdForCharacter: jest.fn().mockResolvedValue({ id: ITEM_ID, characterId: CHAR_ID }),
      delete: jest.fn().mockResolvedValue(true),
      ...overrides.wardrobe,
    },
    chats: {
      removeEquippedItemFromAllChats: jest.fn().mockResolvedValue(undefined),
      ...overrides.chats,
    },
  }
}

const params = { params: Promise.resolve({ id: CHAR_ID, itemId: ITEM_ID }) }
const req = {}

beforeEach(() => {
  jest.clearAllMocks()
})

it('resolves the item via the vault-aware lookup, not the stale wardrobe_items table', async () => {
  const repos = buildRepos()
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(repos.wardrobe.findByIdForCharacter).toHaveBeenCalledWith(CHAR_ID, ITEM_ID)
  expect(repos.wardrobe.findById).not.toHaveBeenCalled()
  expect(repos.wardrobe.delete).toHaveBeenCalledWith(ITEM_ID, CHAR_ID)
  expect(res.body?.success ?? res?.success).toBe(true)
})

it('404s when the vault-aware lookup finds nothing (and never deletes)', async () => {
  const repos = buildRepos({ wardrobe: { findByIdForCharacter: jest.fn().mockResolvedValue(null) } })
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(res.__kind).toBe('notFound')
  expect(res.what).toBe('Wardrobe item')
  expect(repos.wardrobe.delete).not.toHaveBeenCalled()
})

it('404s Character when the character does not exist (and never reaches the vault)', async () => {
  const repos = buildRepos({})
  repos.characters.findById = jest.fn().mockResolvedValue(null)
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(res.__kind).toBe('notFound')
  expect(res.what).toBe('Character')
  expect(repos.wardrobe.findByIdForCharacter).not.toHaveBeenCalled()
})
