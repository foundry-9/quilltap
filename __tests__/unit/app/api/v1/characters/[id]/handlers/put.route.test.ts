/**
 * Regression test for the character PUT handler's wardrobe-permission fields.
 *
 * `updateCharacterSchema` is a `z.object(...)` whose `.parse()` strips keys not
 * declared in the schema. `canDressThemselves` / `canCreateOutfits` were absent,
 * so a PUT carrying them had those keys silently dropped before reaching
 * `repos.characters.update()` — the editor toggles never persisted even though
 * the client showed a success toast.
 *
 * These tests pin that both tri-state flags survive validation and reach
 * update() intact (including the `null` = inherit-from-global case).
 */

// Use global `jest` so module mocks hoist before the handler import.

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: any) => ({ __kind: 'json', body }) },
}))

jest.mock('@/lib/api/middleware', () => ({
  exists: (entity: unknown) => entity != null,
}))

jest.mock('@/lib/api/middleware/actions', () => ({
  getActionParam: () => null,
}))

jest.mock('@/lib/api/responses', () => ({
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  successResponse: (data: any) => ({ __kind: 'success', data }),
}))

jest.mock('@/lib/image-gen/aesthetic', () => ({
  writeStoreFile: jest.fn(),
  DEPICTION_GUIDELINES_FILENAME: 'depiction-guidelines.md',
}))

import { handlePut } from '@/app/api/v1/characters/[id]/handlers/put'

const CHAR_ID = 'char-1'
const OWNER_ID = 'user-1'

function buildCtx(updateImpl?: jest.Mock) {
  const update = updateImpl ?? jest.fn().mockImplementation((_id, payload) => ({ id: CHAR_ID, ...payload }))
  return {
    ctx: {
      user: { id: OWNER_ID },
      repos: {
        characters: {
          findByIdRaw: jest.fn().mockResolvedValue({ id: CHAR_ID, userId: OWNER_ID }),
          update,
        },
      },
    } as any,
    update,
  }
}

function reqWith(body: any) {
  return { json: jest.fn().mockResolvedValue(body) } as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('passes canDressThemselves and canCreateOutfits through validation to update()', async () => {
  const { ctx, update } = buildCtx()
  await handlePut(reqWith({ canDressThemselves: false, canCreateOutfits: true }), ctx, CHAR_ID)

  expect(update).toHaveBeenCalledTimes(1)
  const payload = update.mock.calls[0][1]
  expect(payload.canDressThemselves).toBe(false)
  expect(payload.canCreateOutfits).toBe(true)
})

it('preserves the null (inherit-from-global) tri-state, not stripping it', async () => {
  const { ctx, update } = buildCtx()
  await handlePut(reqWith({ canDressThemselves: null }), ctx, CHAR_ID)

  const payload = update.mock.calls[0][1]
  expect('canDressThemselves' in payload).toBe(true)
  expect(payload.canDressThemselves).toBeNull()
})
