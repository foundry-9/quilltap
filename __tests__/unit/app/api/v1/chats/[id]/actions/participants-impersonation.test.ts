import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

const resolveParticipantCharacterName = jest.fn(async () => 'Echo')
const handleRemoveParticipant = jest.fn()
jest.mock('@/app/api/v1/chats/[id]/helpers', () => ({
  enrichParticipant: jest.fn(async (p: unknown) => p),
  handleAddParticipant: jest.fn(),
  handleParticipantUpdate: jest.fn(),
  handleRemoveParticipant: (...args: unknown[]) => handleRemoveParticipant(...args),
  resolveParticipantCharacterName: (...args: unknown[]) => resolveParticipantCharacterName(...args),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn(),
  postHostRemoveAnnouncement: jest.fn(),
  postHostJoinScenarioAnnouncement: jest.fn(),
}))

const compileAllIdentityStacks = jest.fn()
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: jest.fn(),
  compileAllIdentityStacks: (...args: unknown[]) => compileAllIdentityStacks(...args),
}))

jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: jest.fn(),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  buildCheapLLMConfig: jest.fn(() => ({})),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIds: jest.fn(async () => []),
}))

const {
  handleImpersonate,
  handleStopImpersonate,
  handleRemoveParticipantAction,
} = require('@/app/api/v1/chats/[id]/actions/participants')

const chatId = '33333333-3333-4333-8333-333333333333'
const partA = '11111111-1111-4111-8111-111111111111'
const partB = '22222222-2222-4222-8222-222222222222'
const profile9 = '99999999-9999-4999-8999-999999999999'

function makeRequest(body: unknown): any {
  return { json: async () => body }
}

describe('impersonation actions overlay controlledBy without moving it (Bug 44)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('handleImpersonate records the overlay and leaves controlledBy untouched', async () => {
    const chat = {
      id: chatId,
      participants: [{ id: partA, type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', status: 'active' }],
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
    }
    // addImpersonation records the id + sets the active typing participant. The
    // seat's `controlledBy` stays exactly where it was — impersonation is a
    // behavior overlay, not an ownership change (Bug 44).
    const updatedChat = {
      ...chat,
      impersonatingParticipantIds: [partA],
      activeTypingParticipantId: partA,
    }
    const repos: any = {
      chats: {
        updateParticipant: jest.fn(),
        addImpersonation: jest.fn().mockResolvedValue(updatedChat),
      },
    }

    const res = await handleImpersonate(makeRequest({ participantId: partA }), chatId, chat, { user: { id: 'u1' }, repos })
    const body = await res.json()

    expect(repos.chats.addImpersonation).toHaveBeenCalledWith(chatId, partA)
    // No column moves, no identity-stack churn.
    expect(repos.chats.updateParticipant).not.toHaveBeenCalled()
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
    // The seat is still LLM-owned; only the overlay records who is typing.
    expect(updatedChat.participants[0].controlledBy).toBe('llm')
    expect(body.impersonatingParticipantIds).toEqual([partA])
    expect(body.activeTypingParticipantId).toBe(partA)
  })

  it('handleStopImpersonate clears the overlay with nothing to restore', async () => {
    // The seat stayed LLM-owned throughout the impersonation (Bug 44 overlay).
    const chat = {
      id: chatId,
      participants: [{ id: partA, type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', status: 'active' }],
      impersonatingParticipantIds: [partA],
      activeTypingParticipantId: partA,
    }
    const afterRemove = { ...chat, impersonatingParticipantIds: [], activeTypingParticipantId: null }
    const repos: any = {
      chats: {
        removeImpersonation: jest.fn().mockResolvedValue(afterRemove),
        updateParticipant: jest.fn(),
      },
      connections: { findById: jest.fn() },
    }

    const res = await handleStopImpersonate(makeRequest({ participantId: partA }), chatId, chat, { user: { id: 'u1' }, repos })
    const body = await res.json()

    expect(repos.chats.removeImpersonation).toHaveBeenCalledWith(chatId, partA)
    // Nothing to hand back: no controlledBy write, no recompile.
    expect(repos.chats.updateParticipant).not.toHaveBeenCalled()
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
    expect(body.impersonatingParticipantIds).toEqual([])
  })

  it('handleStopImpersonate with a chosen profile reassigns the seat (profile only, no controlledBy)', async () => {
    const chat = {
      id: chatId,
      participants: [{ id: partA, type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', status: 'active' }],
      impersonatingParticipantIds: [partA],
      activeTypingParticipantId: partA,
    }
    const afterRemove = { ...chat, impersonatingParticipantIds: [], activeTypingParticipantId: null }
    const afterReassign = {
      ...afterRemove,
      participants: [{ ...chat.participants[0], connectionProfileId: profile9 }],
    }
    const repos: any = {
      chats: {
        removeImpersonation: jest.fn().mockResolvedValue(afterRemove),
        updateParticipant: jest.fn().mockResolvedValue(afterReassign),
      },
      connections: { findById: jest.fn().mockResolvedValue({ id: profile9 }) },
    }

    const res = await handleStopImpersonate(
      makeRequest({ participantId: partA, newConnectionProfileId: profile9 }),
      chatId,
      chat,
      { user: { id: 'u1' }, repos },
    )
    await res.json()

    expect(repos.chats.removeImpersonation).toHaveBeenCalledWith(chatId, partA)
    // A deliberate seat reassignment — profile only, controlledBy never moves.
    expect(repos.chats.updateParticipant).toHaveBeenCalledWith(chatId, partA, { connectionProfileId: profile9 })
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
  })
})

describe('remove-participant returns a fresh chat after impersonation cleanup (Bug 24)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the post-cleanup chat, not the stale one still listing the removed id', async () => {
    // The chat handed to the action still has two present characters (removal allowed).
    const chat = {
      id: chatId,
      participants: [
        { id: partA, type: 'CHARACTER', characterId: 'char-1', controlledBy: 'user', status: 'active', isActive: true },
        { id: partB, type: 'CHARACTER', characterId: 'char-2', controlledBy: 'llm', status: 'active', isActive: true },
      ],
    }
    // handleRemoveParticipant returns a chat that STILL lists partA in impersonation
    // (the cleanup update runs afterwards).
    const staleChat = {
      id: chatId,
      participants: chat.participants,
      impersonatingParticipantIds: [partA],
      activeTypingParticipantId: partA,
    }
    handleRemoveParticipant.mockResolvedValue({ chat: staleChat })

    const cleanedChat = {
      id: chatId,
      participants: chat.participants,
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
    }
    const repos: any = {
      chats: { update: jest.fn().mockResolvedValue(cleanedChat) },
      characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Echo' }) },
    }

    const res = await handleRemoveParticipantAction(
      makeRequest({ participantId: partA }),
      chatId,
      chat,
      { user: { id: 'u1' }, repos },
    )
    const body = await res.json()

    expect(repos.chats.update).toHaveBeenCalled()
    // The response reflects the cleanup: partA is gone from impersonation.
    expect(body.chat.impersonatingParticipantIds).toEqual([])
    expect(body.chat.activeTypingParticipantId).toBeNull()
  })
})
