import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockPostHostAddAnnouncement = jest.fn()
const mockPostHostMergeFromAnnouncement = jest.fn()
const mockPostHostMergeToAnnouncement = jest.fn()
const mockCompileIdentityStackForParticipant = jest.fn()
const mockApplyOutfitSelections = jest.fn()
const mockBuildCheapLLMConfig = jest.fn(() => ({}))

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: (...args: unknown[]) => mockPostHostAddAnnouncement(...args),
  postHostMergeFromAnnouncement: (...args: unknown[]) => mockPostHostMergeFromAnnouncement(...args),
  postHostMergeToAnnouncement: (...args: unknown[]) => mockPostHostMergeToAnnouncement(...args),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: (...args: unknown[]) => mockCompileIdentityStackForParticipant(...args),
}))

jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: (...args: unknown[]) => mockApplyOutfitSelections(...args),
  buildCheapLLMConfig: (...args: unknown[]) => mockBuildCheapLLMConfig(...args),
}))

const { applyChatMerge } = require('@/lib/chat/apply-chat-merge') as {
  applyChatMerge: typeof import('@/lib/chat/apply-chat-merge').applyChatMerge
}

const SOURCE_ID = 'source-chat'
const TARGET_ID = 'target-chat'

function buildRepos() {
  const targetChat: any = {
    id: TARGET_ID,
    title: 'Target Tale',
    scenarioText: null,
    contextSummary: 'Target summary',
    tags: [],
    participants: [
      { id: 'tp-dup', type: 'CHARACTER', characterId: 'char-dup', controlledBy: 'llm', status: 'active' },
      { id: 'tp-user', type: 'CHARACTER', characterId: 'char-target-user', controlledBy: 'user', status: 'active' },
    ],
  }

  const sourceChat: any = {
    id: SOURCE_ID,
    title: 'Source Tale',
    contextSummary: 'They fought a dragon.',
    participants: [
      { id: 'sp-user', type: 'CHARACTER', characterId: 'char-user', controlledBy: 'user', status: 'active', connectionProfileId: null },
      { id: 'sp-llm', type: 'CHARACTER', characterId: 'char-llm', controlledBy: 'llm', status: 'active', connectionProfileId: 'prof-1' },
      { id: 'sp-dup', type: 'CHARACTER', characterId: 'char-dup', controlledBy: 'llm', status: 'active', connectionProfileId: 'prof-1' },
      { id: 'sp-removed', type: 'CHARACTER', characterId: 'char-removed', controlledBy: 'llm', status: 'removed', connectionProfileId: 'prof-1' },
    ],
  }

  const addParticipant = jest.fn(async (_chatId: string, participant: any) => {
    const newP = { ...participant, id: `np-${participant.characterId}` }
    targetChat.participants = [...targetChat.participants, newP]
    return { ...targetChat }
  })

  const repos: any = {
    chats: {
      findById: jest.fn(async (id: string) => {
        if (id === SOURCE_ID) return sourceChat
        if (id === TARGET_ID) return targetChat
        return null
      }),
      addParticipant,
      update: jest.fn(async () => targetChat),
    },
    characters: {
      findById: jest.fn(async (id: string) => ({ id, name: `Name-${id}`, tags: [] })),
    },
    connections: {
      findById: jest.fn(async (id: string) => (id === 'prof-1' ? { id: 'prof-1' } : null)),
      findDefault: jest.fn(async () => ({ id: 'prof-default' })),
      findByUserId: jest.fn(async () => [{ id: 'prof-default' }]),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => null),
    },
  }

  return { repos, sourceChat, targetChat, addParticipant }
}

describe('applyChatMerge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPostHostMergeFromAnnouncement.mockResolvedValue({ id: 'recap' })
    mockPostHostMergeToAnnouncement.mockResolvedValue({ id: 'backlink' })
    mockPostHostAddAnnouncement.mockResolvedValue({ id: 'add' })
  })

  it('merges missing characters, excludes already-present, converts user-controlled to LLM', async () => {
    const { repos, addParticipant } = buildRepos()

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      repos,
    })

    // char-dup already present, char-removed dropped → only user + llm come in.
    expect(result.mergedCharacterIds).toEqual(['char-user', 'char-llm'])
    expect(result.skippedAlreadyPresentCharacterIds).toEqual(['char-dup'])

    // Both added as LLM-controlled; source user-controlled char is converted.
    expect(addParticipant).toHaveBeenCalledTimes(2)
    for (const call of addParticipant.mock.calls) {
      expect((call[1] as any).controlledBy).toBe('llm')
    }

    // Connection profile: source 'prof-1' kept; null → user default fallback.
    const byChar = new Map(addParticipant.mock.calls.map((c) => [(c[1] as any).characterId, (c[1] as any).connectionProfileId]))
    expect(byChar.get('char-user')).toBe('prof-default')
    expect(byChar.get('char-llm')).toBe('prof-1')

    // Host welcome per merged character.
    expect(mockPostHostAddAnnouncement).toHaveBeenCalledTimes(2)
  })

  it('applies previous_chat outfit (sourced from the merged chat) by default', async () => {
    const { repos } = buildRepos()

    await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      repos,
    })

    expect(mockApplyOutfitSelections).toHaveBeenCalledTimes(2)
    for (const call of mockApplyOutfitSelections.mock.calls) {
      const selections = call[1] as any[]
      const context = call[3] as any
      expect(selections[0].mode).toBe('previous_chat')
      expect(context.sourceChatId).toBe(SOURCE_ID)
    }
  })

  it('gates the merge to the operator allowlist (includeCharacterIds)', async () => {
    const { repos, addParticipant } = buildRepos()

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      includeCharacterIds: ['char-llm'], // exclude the eligible char-user
      repos,
    })

    expect(result.mergedCharacterIds).toEqual(['char-llm'])
    expect(addParticipant).toHaveBeenCalledTimes(1)
    expect((addParticipant.mock.calls[0][1] as any).characterId).toBe('char-llm')
    // Already-present tracking is unaffected by the gate.
    expect(result.skippedAlreadyPresentCharacterIds).toEqual(['char-dup'])
  })

  it('treats an empty allowlist as "no gate" (every eligible merges)', async () => {
    const { repos } = buildRepos()

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      includeCharacterIds: [],
      repos,
    })

    expect(result.mergedCharacterIds).toEqual(['char-user', 'char-llm'])
  })

  it('honours explicit per-character outfit selections', async () => {
    const { repos } = buildRepos()

    await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      outfitSelections: [{ characterId: 'char-llm', mode: 'none' }],
      repos,
    })

    const llmCall = mockApplyOutfitSelections.mock.calls.find(
      (c) => (c[1] as any[])[0].characterId === 'char-llm',
    )
    expect((llmCall![1] as any[])[0].mode).toBe('none')
  })

  it('posts the recap in the target and a back-link in the source', async () => {
    const { repos } = buildRepos()

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      repos,
    })

    expect(mockPostHostMergeFromAnnouncement).toHaveBeenCalledTimes(1)
    expect(mockPostHostMergeFromAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: TARGET_ID,
        sourceChatId: SOURCE_ID,
        summaryText: 'They fought a dragon.',
      }),
    )
    expect(mockPostHostMergeToAnnouncement).toHaveBeenCalledTimes(1)
    expect(mockPostHostMergeToAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: SOURCE_ID, targetChatId: TARGET_ID }),
    )
    expect(result.postedRecap).toBe(true)
    expect(result.postedSourceBackLink).toBe(true)
  })

  it('does nothing and posts no bubbles when every source character is already present', async () => {
    const { repos, targetChat, addParticipant } = buildRepos()
    // Put every source character into the target.
    targetChat.participants = [
      { id: 'tp-user', type: 'CHARACTER', characterId: 'char-user', controlledBy: 'user', status: 'active' },
      { id: 'tp-llm', type: 'CHARACTER', characterId: 'char-llm', controlledBy: 'llm', status: 'active' },
      { id: 'tp-dup', type: 'CHARACTER', characterId: 'char-dup', controlledBy: 'llm', status: 'active' },
    ]

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: SOURCE_ID,
      userId: 'user-1',
      repos,
    })

    expect(result.mergedCharacterIds).toEqual([])
    expect(addParticipant).not.toHaveBeenCalled()
    expect(mockPostHostMergeFromAnnouncement).not.toHaveBeenCalled()
    expect(mockPostHostMergeToAnnouncement).not.toHaveBeenCalled()
  })

  it('refuses to merge a chat into itself', async () => {
    const { repos, addParticipant } = buildRepos()

    const result = await applyChatMerge({
      targetChatId: TARGET_ID,
      sourceChatId: TARGET_ID,
      userId: 'user-1',
      repos,
    })

    expect(result.mergedCharacterIds).toEqual([])
    expect(addParticipant).not.toHaveBeenCalled()
  })
})
