import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/api/middleware', () => ({
  enrichWithDefaultImage: jest.fn(),
  enrichWithApiKey: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn(),
  postHostStatusChangeAnnouncement: jest.fn(),
  postHostRemoveAnnouncement: jest.fn(),
  postHostSilentModeAnnouncement: jest.fn(),
  postHostJoinScenarioAnnouncement: jest.fn(),
}))

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoConnectionProfileChangeAnnouncement: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn(),
}))

const compileAllIdentityStacks = jest.fn()
const compileIdentityStackForParticipant = jest.fn()
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: (...args: unknown[]) => compileAllIdentityStacks(...args),
  compileIdentityStackForParticipant: (...args: unknown[]) => compileIdentityStackForParticipant(...args),
}))

const { handleParticipantUpdate } = require('@/app/api/v1/chats/[id]/helpers')

describe('handleParticipantUpdate — controlledBy patch (Bug 23)', () => {
  const chatId = 'chat-1'
  const participantId = 'part-1'

  let repos: any
  let finalChat: any

  beforeEach(() => {
    jest.clearAllMocks()

    const baseChat = {
      id: chatId,
      participants: [
        { id: participantId, type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
      ],
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
    }
    // finalChat is the re-read after all writes — the object the recompile must use.
    finalChat = { ...baseChat, participants: [{ ...baseChat.participants[0], controlledBy: 'user' }] }

    repos = {
      chats: {
        findById: jest.fn()
          .mockResolvedValueOnce(baseChat)   // initial read
          .mockResolvedValue(finalChat),     // re-read(s) after writes
        updateParticipant: jest.fn().mockResolvedValue({ ...baseChat, activeTypingParticipantId: null }),
        update: jest.fn().mockResolvedValue(finalChat),
      },
      characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Echo' }) },
      connections: { findById: jest.fn() },
      imageProfiles: { findById: jest.fn() },
    }
  })

  it('recompiles all identity stacks for a controlledBy patch instead of returning early', async () => {
    const result: any = await handleParticipantUpdate(
      chatId,
      { participantId, controlledBy: 'user' } as any,
      'user-1',
      repos,
    )

    // The shared tail runs: the recompile fires (dead before the fix) …
    expect(compileAllIdentityStacks).toHaveBeenCalledTimes(1)
    // … and it is fed the freshly re-read chat, not a stale copy.
    expect(compileAllIdentityStacks).toHaveBeenCalledWith(finalChat)
    // The returned chat is the post-write re-read.
    expect(result.chat).toBe(finalChat)
  })
})
