import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { NextResponse } from 'next/server'

jest.mock('@/lib/logger', () => {
  const base = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  return { logger: { ...base, child: jest.fn().mockReturnValue(base) } }
})

const handleResetState = jest.fn()
const handleStopImpersonate = jest.fn()
jest.mock('@/app/api/v1/chats/[id]/actions', () => ({
  handleResetState: (...args: unknown[]) => handleResetState(...args),
  handleStopImpersonate: (...args: unknown[]) => handleStopImpersonate(...args),
}))

const { handleDelete } = require('@/app/api/v1/chats/[id]/handlers/delete')

const chatId = 'chat-1'

function makeRequest(action?: string): any {
  const url = action
    ? `http://localhost:3000/api/v1/chats/${chatId}?action=${action}`
    : `http://localhost:3000/api/v1/chats/${chatId}`
  return { nextUrl: new URL(url) }
}

describe('chats [id] DELETE handler — stop-impersonate routing (Bug 25)', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = {
      user: { id: 'user-1' },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue({ id: chatId, participants: [] }),
          delete: jest.fn().mockResolvedValue(undefined),
        },
      },
    }
  })

  it('routes DELETE ?action=stop-impersonate to handleStopImpersonate', async () => {
    handleStopImpersonate.mockResolvedValue(NextResponse.json({ success: true }))

    const res = await handleDelete(makeRequest('stop-impersonate'), ctx, chatId)

    expect(handleStopImpersonate).toHaveBeenCalledTimes(1)
    // The chat is fetched and forwarded to the impersonation handler.
    expect(ctx.repos.chats.findById).toHaveBeenCalledWith(chatId)
    expect(res.status).toBe(200)
    // A stop-impersonate DELETE must never fall through to chat deletion.
    expect(ctx.repos.chats.delete).not.toHaveBeenCalled()
  })

  it('still rejects unknown DELETE actions to guard against data loss', async () => {
    const res = await handleDelete(makeRequest('bogus'), ctx, chatId)

    expect(res.status).toBe(400)
    expect(ctx.repos.chats.delete).not.toHaveBeenCalled()
    expect(handleStopImpersonate).not.toHaveBeenCalled()
  })

  it('deletes the chat when no action is given', async () => {
    const res = await handleDelete(makeRequest(), ctx, chatId)

    expect(res.status).toBe(200)
    expect(ctx.repos.chats.delete).toHaveBeenCalledWith(chatId)
  })
})
