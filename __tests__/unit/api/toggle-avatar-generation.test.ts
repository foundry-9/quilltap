import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import type { RequestContext } from '@/lib/api/middleware'

const mockEnqueueCharacterAvatarGeneration = jest.fn()
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueCharacterAvatarGeneration: (...args: unknown[]) => mockEnqueueCharacterAvatarGeneration(...args),
}))

jest.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

const { handleToggleAvatarGeneration } = require('@/app/api/v1/chats/[id]/actions/toggle-avatar-generation') as {
  handleToggleAvatarGeneration: typeof import('@/app/api/v1/chats/[id]/actions/toggle-avatar-generation').handleToggleAvatarGeneration
}

function createContext(options: {
  chat?: Record<string, unknown>
  updatedChat?: Record<string, unknown>
  profiles?: Array<Record<string, unknown>>
  chatProfile?: Record<string, unknown> | null
} = {}): RequestContext {
  const chat = {
    id: 'chat-1',
    avatarGenerationEnabled: false,
    imageProfileId: null,
    participants: [],
    ...options.chat,
  }

  const updatedChat = {
    ...chat,
    avatarGenerationEnabled: !chat.avatarGenerationEnabled,
    ...options.updatedChat,
  }

  return {
    user: { id: 'user-1' },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue(chat),
        update: jest.fn().mockResolvedValue(updatedChat),
      },
      imageProfiles: {
        findById: jest.fn().mockResolvedValue(options.chatProfile ?? null),
        findAll: jest.fn().mockResolvedValue(options.profiles ?? []),
      },
    },
  } as unknown as RequestContext
}

describe('handleToggleAvatarGeneration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueueCharacterAvatarGeneration.mockResolvedValue(undefined)
  })

  it('toggles on and enqueues initial avatars only for LLM-controlled characters', async () => {
    const ctx = createContext({
      chat: {
        imageProfileId: 'profile-chat',
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
          { id: 'p-2', type: 'CHARACTER', characterId: 'char-2', controlledBy: 'user' },
          { id: 'p-3', type: 'NARRATOR', characterId: 'char-3', controlledBy: 'assistant' },
        ],
      },
      updatedChat: {
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
          { id: 'p-2', type: 'CHARACTER', characterId: 'char-2', controlledBy: 'user' },
          { id: 'p-3', type: 'NARRATOR', characterId: 'char-3', controlledBy: 'assistant' },
        ],
      },
      chatProfile: { id: 'profile-chat' },
    })

    const response = await handleToggleAvatarGeneration('chat-1', ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ avatarGenerationEnabled: true })
    expect(ctx.repos.chats.update).toHaveBeenCalledWith('chat-1', {
      avatarGenerationEnabled: true,
    })
    expect(mockEnqueueCharacterAvatarGeneration).toHaveBeenCalledTimes(1)
    expect(mockEnqueueCharacterAvatarGeneration).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      characterId: 'char-1',
      imageProfileId: 'profile-chat',
    })
  })

  it('toggles off without enqueueing any avatar generation jobs', async () => {
    const ctx = createContext({
      chat: {
        avatarGenerationEnabled: true,
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
        ],
      },
      updatedChat: {
        avatarGenerationEnabled: false,
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
        ],
      },
    })

    const response = await handleToggleAvatarGeneration('chat-1', ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ avatarGenerationEnabled: false })
    expect(mockEnqueueCharacterAvatarGeneration).not.toHaveBeenCalled()
  })

  it('still succeeds when no usable image profile is available', async () => {
    const ctx = createContext({
      chat: {
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
        ],
      },
      updatedChat: {
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'assistant' },
        ],
      },
      profiles: [],
      chatProfile: null,
    })

    const response = await handleToggleAvatarGeneration('chat-1', ctx)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ avatarGenerationEnabled: true })
    expect(mockEnqueueCharacterAvatarGeneration).not.toHaveBeenCalled()
  })
})
