import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import type { RequestContext } from '@/lib/api/middleware'

const mockTriggerAvatarGeneration = jest.fn()
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGeneration: (...args: unknown[]) => mockTriggerAvatarGeneration(...args),
}))

jest.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

const { handleRegenerateAvatar } = require('@/app/api/v1/chats/[id]/actions/regenerate-avatar') as {
  handleRegenerateAvatar: typeof import('@/app/api/v1/chats/[id]/actions/regenerate-avatar').handleRegenerateAvatar
}

function createMockRequest(body: unknown) {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/chats/chat-1?action=regenerate-avatar',
    json: jest.fn().mockResolvedValue(body),
  } as any
}

function createContext(chat: Record<string, unknown> | null): RequestContext {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue(chat),
      },
    },
  } as unknown as RequestContext
}

describe('handleRegenerateAvatar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTriggerAvatarGeneration.mockResolvedValue({ queued: true })
  })

  it('queues avatar regeneration for a chat participant', async () => {
    const ctx = createContext({
      id: 'chat-1',
      avatarGenerationEnabled: false, // toggle off — manual button still fires
      participants: [
        { id: 'p-1', type: 'CHARACTER', characterId: 'char-1' },
      ],
    })

    const response = await handleRegenerateAvatar(createMockRequest({ characterId: 'char-1' }), 'chat-1', ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      message: 'Avatar regeneration queued',
      queued: true,
    })
    expect(mockTriggerAvatarGeneration).toHaveBeenCalledWith(ctx.repos, {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      callerContext: '[Chats v1] regenerate-avatar',
      imageProfileIdOverride: null,
      equippedSlotsOverride: null,
    })
  })

  it('returns 400 when the chat does not exist', async () => {
    const response = await handleRegenerateAvatar(
      createMockRequest({ characterId: 'char-1' }),
      'chat-missing',
      createContext(null),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Chat not found' })
    expect(mockTriggerAvatarGeneration).not.toHaveBeenCalled()
  })

  it('returns 400 with the helper message when no image profile is configured', async () => {
    mockTriggerAvatarGeneration.mockResolvedValue({
      queued: false,
      reason: 'no-image-profile',
      message: 'No image profile is configured. Set one in Settings → Images before generating avatars.',
    })

    const response = await handleRegenerateAvatar(
      createMockRequest({ characterId: 'char-1' }),
      'chat-1',
      createContext({
        id: 'chat-1',
        avatarGenerationEnabled: false,
        participants: [{ id: 'p-1', characterId: 'char-1' }],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('No image profile is configured')
  })

  it('returns 400 when the character is not a participant in the chat', async () => {
    const response = await handleRegenerateAvatar(
      createMockRequest({ characterId: 'char-2' }),
      'chat-1',
      createContext({
        id: 'chat-1',
        avatarGenerationEnabled: true,
        participants: [{ id: 'p-1', characterId: 'char-1' }],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Character is not a participant in this chat.' })
    expect(mockTriggerAvatarGeneration).not.toHaveBeenCalled()
  })

  it('returns 400 when characterId is missing from the request body', async () => {
    const response = await handleRegenerateAvatar(
      createMockRequest({}),
      'chat-1',
      createContext({
        id: 'chat-1',
        avatarGenerationEnabled: true,
        participants: [{ id: 'p-1', characterId: 'char-1' }],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('expected string')
    expect(mockTriggerAvatarGeneration).not.toHaveBeenCalled()
  })

  it('returns 500 when queueing unexpectedly fails', async () => {
    mockTriggerAvatarGeneration.mockRejectedValue(new Error('queue offline'))

    const response = await handleRegenerateAvatar(
      createMockRequest({ characterId: 'char-1' }),
      'chat-1',
      createContext({
        id: 'chat-1',
        avatarGenerationEnabled: true,
        participants: [{ id: 'p-1', characterId: 'char-1' }],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to queue avatar regeneration' })
  })
})
