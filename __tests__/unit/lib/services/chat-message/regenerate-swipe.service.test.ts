jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const sendMessage = jest.fn(async () => ({
  content: 'A freshly regenerated line.',
  usage: { totalTokens: 12, promptTokens: 8, completionTokens: 4 },
  raw: {},
}))

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({ sendMessage })),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  deleteMemoriesBySourceMessageWithVectors: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/participant-resolver.service', () => ({
  resolveRespondingParticipant: jest.fn(async () => ({
    characterParticipant: { id: 'p-abigail', status: 'active' },
    character: { id: 'char-abigail', name: 'Abigail' },
    connectionProfile: { provider: 'openai', modelName: 'gpt-x', baseUrl: null, parameters: {} },
    apiKey: 'key',
    isMultiCharacter: true,
  })),
  loadAllParticipantData: jest.fn(async () => ({ participantCharacters: new Map() })),
  getRoleplayTemplate: jest.fn(async () => null),
}))

jest.mock('@/lib/services/chat-message/context-builder.service', () => ({
  buildMessageContext: jest.fn(async () => ({
    formattedMessages: [{ role: 'system', content: 'system prompt for Abigail' }],
    builtContext: {},
    isInitialMessage: false,
  })),
}))

jest.mock('@/lib/services/chat-message/user-identity-resolver.service', () => ({
  resolveUserIdentity: jest.fn(async () => ({ name: 'Revenant', description: '' })),
}))

import { regenerateMessageAsSwipe } from '@/lib/services/chat-message/regenerate-swipe.service'
import { resolveRespondingParticipant } from '@/lib/services/chat-message/participant-resolver.service'
import type { MessageEvent, ChatMetadataBase } from '@/lib/schemas/types'

const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

const buildRepos = (overrides: Record<string, unknown> = {}) => ({
  chats: {
    addMessage: jest.fn(async () => {}),
    updateMessage: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
  },
  chatSettings: {
    findByUserId: jest.fn(async () => ({ memoryCascadePreferences: { onSwipeRegenerate: 'DELETE_MEMORIES' } })),
  },
  memories: {
    countBySourceMessageId: jest.fn(async () => 0),
  },
  ...overrides,
}) as never

const chat = {
  id: 'chat-1',
  participants: [],
  activeTypingParticipantId: null,
} as unknown as ChatMetadataBase

const makeMessage = (id: string, role: 'USER' | 'ASSISTANT', createdMs: number, participantId: string | null, extra: Partial<MessageEvent> = {}): MessageEvent => ({
  type: 'message',
  id,
  role,
  content: `${role} content`,
  attachments: [],
  createdAt: iso(createdMs),
  participantId,
  ...extra,
}) as MessageEvent

beforeEach(() => {
  jest.clearAllMocks()
})

describe('regenerateMessageAsSwipe', () => {
  it('attributes the new swipe to the original message participant and groups it in place', async () => {
    const repos = buildRepos()
    const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail')
    const allMessages = [
      makeMessage('msg-user', 'USER', now, 'p-revenant'),
      target,
    ]

    const newSwipe = await regenerateMessageAsSwipe({
      repos,
      userId: 'user-1',
      chat,
      targetMessage: target,
      allMessages,
    })

    // Attributed to Abigail (the original's participant), not the user / first participant.
    expect(newSwipe.participantId).toBe('p-abigail')
    expect(newSwipe.content).toBe('A freshly regenerated line.')
    expect(newSwipe.swipeGroupId).toBe('swipe-msg-abigail')
    expect(newSwipe.swipeIndex).toBe(1)
    // Same timestamp as the original so it stays in place.
    expect(newSwipe.createdAt).toBe(target.createdAt)

    // The responder was resolved from the target's own participant.
    expect(resolveRespondingParticipant).toHaveBeenCalledWith(
      repos, chat, 'user-1', 'p-abigail', true
    )

    // The original is anchored at index 0 of the new group (persisted, not just in-memory).
    expect((repos as any).chats.updateMessage).toHaveBeenCalledWith(
      'chat-1', 'msg-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 0 }
    )
    expect((repos as any).chats.addMessage).toHaveBeenCalledTimes(1)
  })

  it('appends to an existing swipe group without re-anchoring the original', async () => {
    const repos = buildRepos()
    const target = makeMessage('msg-abigail', 'ASSISTANT', now + 100, 'p-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 0 })
    const sibling = makeMessage('msg-swipe-1', 'ASSISTANT', now + 100, 'p-abigail', { swipeGroupId: 'swipe-msg-abigail', swipeIndex: 1 })
    const allMessages = [makeMessage('msg-user', 'USER', now, 'p-revenant'), target, sibling]

    const newSwipe = await regenerateMessageAsSwipe({
      repos, userId: 'user-1', chat, targetMessage: target, allMessages,
    })

    expect(newSwipe.swipeIndex).toBe(2) // max(0,1) + 1
    expect(newSwipe.participantId).toBe('p-abigail')
    // Original already grouped → no re-anchor write.
    expect((repos as any).chats.updateMessage).not.toHaveBeenCalled()
  })

  it('refuses to regenerate staff/system messages', async () => {
    const repos = buildRepos()
    const staff = makeMessage('msg-host', 'ASSISTANT', now + 100, null, { systemSender: 'host' } as Partial<MessageEvent>)

    await expect(regenerateMessageAsSwipe({
      repos, userId: 'user-1', chat, targetMessage: staff, allMessages: [staff],
    })).rejects.toThrow(/staff and system/i)
    expect((repos as any).chats.addMessage).not.toHaveBeenCalled()
  })
})
