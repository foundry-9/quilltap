import { handleSceneStateTracking } from '@/lib/background-jobs/handlers/scene-state-tracking'
import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { updateSceneState, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'
import { createSystemEvent } from '@/lib/services/system-events.service'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service'
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash'

jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn().mockResolvedValue({
    outfitValues: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
    leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
    itemsById: new Map(),
  }),
  // What the real pipeline renders for the empty outfit mocked above.
  describeEquippedOutfitTitleOnly: jest.fn().mockResolvedValue('- completely naked and unadorned\n'),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  updateSceneState: jest.fn(),
  extractVisibleConversation: jest.fn().mockReturnValue([]),
}))

jest.mock('@/lib/services/system-events.service', () => ({
  createSystemEvent: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest
    .fn()
    .mockReturnValue({ settings: { mode: 'OFF', threshold: 0.7 }, source: 'default' }),
}))

jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  classifyContent: jest
    .fn()
    .mockResolvedValue({ isDangerous: false, score: 0, categories: [] }),
}))

jest.mock('@/lib/schemas/chat.types', () => ({
  SceneStateSchema: { safeParse: jest.fn().mockReturnValue({ success: false }) },
  isParticipantPresent: (status: string) => status === 'active' || status === 'silent',
  canReceiveWhisper: (status: string) => status === 'active' || status === 'silent',
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGetCheapLLMProvider = getCheapLLMProvider as jest.MockedFunction<typeof getCheapLLMProvider>
const mockResolveUncensoredCheapLLMSelection = resolveUncensoredCheapLLMSelection as jest.MockedFunction<typeof resolveUncensoredCheapLLMSelection>
const mockUpdateSceneState = updateSceneState as jest.MockedFunction<typeof updateSceneState>
const mockExtractVisibleConversation = extractVisibleConversation as jest.MockedFunction<typeof extractVisibleConversation>
const mockCreateSystemEvent = createSystemEvent as jest.MockedFunction<typeof createSystemEvent>
const mockResolveDangerousContentSettings = resolveDangerousContentSettings as jest.MockedFunction<typeof resolveDangerousContentSettings>
const mockClassifyContent = classifyContent as jest.MockedFunction<typeof classifyContent>

const buildJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'SCENE_STATE_TRACKING' as const,
  status: 'PROCESSING' as const,
  payload: {
    chatId: 'chat-1',
    characterIds: ['char-1'],
    connectionProfileId: 'profile-1',
    ...overrides,
  },
  priority: -1,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const createMockRepos = () => ({
  chats: {
    findById: jest.fn().mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      messageCount: 10,
      sceneState: null,
      isDangerousChat: false,
      participants: [
        {
          id: 'p1',
          characterId: 'char-1',
          controlledBy: 'llm',
          isActive: true,
          status: 'active',

        },
      ],
      contextSummary: null,
    }),
    getMessages: jest.fn().mockResolvedValue([]),
    getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
  },
  characters: {
    findById: jest.fn().mockResolvedValue({
      id: 'char-1',
      name: 'Alice',
      description: 'Test',
      scenario: 'Garden',
      physicalDescriptions: [],
      clothingRecords: [],
    }),
  },
  chatSettings: {
    findByUserId: jest.fn().mockResolvedValue({
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
    }),
  },
  connections: {
    findById: jest.fn().mockResolvedValue({
      id: 'profile-1',
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      apiKeyId: 'key-1',
    }),
    findByUserId: jest.fn().mockResolvedValue([
      { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4o-mini' },
    ]),
  },
  apiKeys: {
    findById: jest.fn().mockResolvedValue({ id: 'key-1' }),
    decrypt: jest.fn().mockResolvedValue('sk-test'),
  },
})

describe('handleSceneStateTracking', () => {
  let repos: ReturnType<typeof createMockRepos>

  const cheapLLMSelection = {
    provider: 'OPENAI',
    modelName: 'gpt-4o-mini',
    connectionProfileId: 'profile-1',
    isLocal: false,
  }

  const twoMessages = [
    { role: 'USER', content: 'Hello' },
    { role: 'ASSISTANT', content: 'Hi!' },
  ]

  const successResult = {
    success: true as const,
    result: { location: 'Garden', time: 'afternoon' },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    repos = createMockRepos()
    mockGetRepositories.mockReturnValue(repos as any)
    mockGetCheapLLMProvider.mockReturnValue(cheapLLMSelection as any)
    mockResolveUncensoredCheapLLMSelection.mockReturnValue(null)
    mockExtractVisibleConversation.mockReturnValue(twoMessages as any)
    mockUpdateSceneState.mockResolvedValue(successResult as any)
    mockResolveDangerousContentSettings.mockReturnValue({
      settings: { mode: 'OFF', threshold: 0.7 },
      source: 'default',
    } as any)
    mockClassifyContent.mockResolvedValue({ isDangerous: false, score: 0, categories: [] } as any)
  })

  // ─── 1: Skips when chat not found ───────────────────────────────────────────

  it('skips when chat not found', async () => {
    repos.chats.findById.mockResolvedValue(null)
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockUpdateSceneState).not.toHaveBeenCalled()
    expect(repos.chats.update).not.toHaveBeenCalled()
  })

  // ─── 2: Calls updateSceneState on happy path ────────────────────────────────

  it('calls updateSceneState on the happy path', async () => {
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockUpdateSceneState).toHaveBeenCalledTimes(1)
    const [sceneStateInput, selection, userId, chatId] = mockUpdateSceneState.mock.calls[0]
    expect(chatId).toBe('chat-1')
    expect(userId).toBe('user-1')
    expect(selection).toMatchObject({ provider: 'OPENAI', modelName: 'gpt-4o-mini' })
    expect(sceneStateInput).toMatchObject({
      characters: expect.arrayContaining([
        expect.objectContaining({ characterId: 'char-1', characterName: 'Alice' }),
      ]),
      recentMessages: twoMessages,
      messageCount: 10,
    })
  })

  // ─── 3: Persists scene state via repos.chats.update ─────────────────────────

  it('persists scene state to the chat record', async () => {
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(repos.chats.update).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        sceneState: expect.objectContaining({
          location: 'Garden',
          time: 'afternoon',
          updatedAt: expect.any(String),
          updatedAtMessageCount: 10,
        }),
      })
    )
  })

  // ─── 3b: Clothing hash-cache reuse / re-summarize ───────────────────────────

  it('reuses the cached clothing summary when the equipped-outfit hash is unchanged', async () => {
    const slots = { top: ['t1'], bottom: [], footwear: [], accessories: [], hair: [] }
    const matchingHash = hashEquippedSlots(slots)

    // Previous scene state holds a cached clothing line + the hash it came from.
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      messageCount: 10,
      isDangerousChat: false,
      participants: [{ id: 'p1', characterId: 'char-1', controlledBy: 'llm', isActive: true, status: 'active' }],
      contextSummary: null,
      sceneState: {
        location: 'Garden',
        updatedAtMessageCount: 0,
        characters: [{ characterId: 'char-1', characterName: 'Alice', clothing: 'an old gown', clothingHash: matchingHash }],
      },
    } as any)
    repos.chats.getEquippedOutfitForCharacter.mockResolvedValue(slots as any)

    const sceneTypesMock = jest.requireMock('@/lib/schemas/chat.types') as { SceneStateSchema: { safeParse: jest.Mock } }
    sceneTypesMock.SceneStateSchema.safeParse.mockReturnValueOnce({ success: true, data: { updatedAtMessageCount: 0 } })

    // LLM proposes a different (fresh) clothing line.
    mockUpdateSceneState.mockResolvedValue({
      success: true,
      result: { location: 'Garden', characters: [{ characterId: 'char-1', characterName: 'Alice', clothing: 'a red dress' }] },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    await handleSceneStateTracking(buildJob() as any)

    const persisted = repos.chats.update.mock.calls[0][1].sceneState as any
    const alice = persisted.characters.find((c: any) => c.characterId === 'char-1')
    expect(alice.clothing).toBe('an old gown') // cached summary reused, not the LLM's fresh line
    expect(alice.clothingHash).toBe(matchingHash)
  })

  it('takes the LLM clothing line and records a new hash when the wardrobe changed', async () => {
    const cachedSlots = { top: ['t1'], bottom: [], footwear: [], accessories: [], hair: [] }
    const liveSlots = { top: ['t1', 't2'], bottom: [], footwear: [], accessories: [], hair: [] }
    const cachedHash = hashEquippedSlots(cachedSlots)
    const liveHash = hashEquippedSlots(liveSlots)

    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      messageCount: 10,
      isDangerousChat: false,
      participants: [{ id: 'p1', characterId: 'char-1', controlledBy: 'llm', isActive: true, status: 'active' }],
      contextSummary: null,
      sceneState: {
        location: 'Garden',
        updatedAtMessageCount: 0,
        characters: [{ characterId: 'char-1', characterName: 'Alice', clothing: 'an old gown', clothingHash: cachedHash }],
      },
    } as any)
    repos.chats.getEquippedOutfitForCharacter.mockResolvedValue(liveSlots as any)

    const sceneTypesMock = jest.requireMock('@/lib/schemas/chat.types') as { SceneStateSchema: { safeParse: jest.Mock } }
    sceneTypesMock.SceneStateSchema.safeParse.mockReturnValueOnce({ success: true, data: { updatedAtMessageCount: 0 } })

    mockUpdateSceneState.mockResolvedValue({
      success: true,
      result: { location: 'Garden', characters: [{ characterId: 'char-1', characterName: 'Alice', clothing: 'a red dress' }] },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    await handleSceneStateTracking(buildJob() as any)

    const persisted = repos.chats.update.mock.calls[0][1].sceneState as any
    const alice = persisted.characters.find((c: any) => c.characterId === 'char-1')
    expect(alice.clothing).toBe('a red dress') // wardrobe changed → fresh LLM line kept
    expect(alice.clothingHash).toBe(liveHash)
    expect(alice.clothingHash).not.toBe(cachedHash)
  })

  // ─── 4: Creates system event when usage present ─────────────────────────────

  it('creates a system event when usage is present', async () => {
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockCreateSystemEvent).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        systemEventType: 'SCENE_STATE_TRACKING',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        provider: 'OPENAI',
        modelName: 'gpt-4o-mini',
      })
    )
  })

  // ─── 5: Does not create system event when no usage ──────────────────────────

  it('does not create a system event when usage is absent', async () => {
    mockUpdateSceneState.mockResolvedValue({
      success: true,
      result: { location: 'Garden', time: 'afternoon' },
    } as any)
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockCreateSystemEvent).not.toHaveBeenCalled()
  })

  // ─── 6: Skips when no messages ──────────────────────────────────────────────

  it('skips when extractVisibleConversation returns no messages', async () => {
    mockExtractVisibleConversation.mockReturnValue([])
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockUpdateSceneState).not.toHaveBeenCalled()
  })

  // ─── 7: Handles updateSceneState failure ────────────────────────────────────

  it('skips persisting when updateSceneState returns success=false', async () => {
    mockUpdateSceneState.mockResolvedValue({
      success: false,
      error: 'LLM refused',
    } as any)
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(repos.chats.update).not.toHaveBeenCalled()
  })

  // ─── 8: Skips when connection profile not found and no available profiles ────

  it('skips when connection profile not found and no available profiles', async () => {
    repos.connections.findById.mockResolvedValue(null)
    repos.connections.findByUserId.mockResolvedValue([])
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockUpdateSceneState).not.toHaveBeenCalled()
  })

  // ─── 9: Falls back to available profile when connection profile not found ────

  it('falls back to first available profile when the specified profile is not found', async () => {
    repos.connections.findById.mockResolvedValue(null)
    repos.connections.findByUserId.mockResolvedValue([
      { id: 'profile-fallback', provider: 'ANTHROPIC', modelName: 'claude-3-haiku-20240307' },
    ])
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    // The handler should continue and call getCheapLLMProvider with the fallback profile
    expect(mockGetCheapLLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'profile-fallback' }),
      expect.any(Object),
      expect.any(Array),
      false
    )
    expect(mockUpdateSceneState).toHaveBeenCalled()
  })

  // ─── 10: Detects refusal and retries with uncensored ────────────────────────

  it('retries with uncensored provider when result location is "Unknown"', async () => {
    // Set up an uncensored profile in cheapLLMSettings
    repos.chatSettings.findByUserId.mockResolvedValue({
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
        imagePromptProfileId: 'profile-uncensored',
      },
    })
    repos.connections.findByUserId.mockResolvedValue([
      { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4o-mini' },
      { id: 'profile-uncensored', provider: 'OLLAMA', modelName: 'llama3', baseUrl: 'http://localhost:11434' },
    ])

    // First call looks like a refusal
    mockUpdateSceneState
      .mockResolvedValueOnce({
        success: true,
        result: { location: 'Unknown' },
        usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
      } as any)
      // Retry succeeds
      .mockResolvedValueOnce({
        success: true,
        result: { location: 'Throne Room', time: 'night' },
        usage: { promptTokens: 90, completionTokens: 40, totalTokens: 130 },
      } as any)

    const job = buildJob()

    await handleSceneStateTracking(job as any)

    // Should have called updateSceneState twice
    expect(mockUpdateSceneState).toHaveBeenCalledTimes(2)
    // Second call should use the uncensored selection
    const secondCallSelection = mockUpdateSceneState.mock.calls[1][1] as any
    expect(secondCallSelection).toMatchObject({ connectionProfileId: 'profile-uncensored' })
    // Final persisted state should be from the retry
    expect(repos.chats.update).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        sceneState: expect.objectContaining({ location: 'Throne Room' }),
      })
    )
  })

  // ─── 11: Does not retry when no uncensored selection available ───────────────

  it('does not retry when no uncensored provider is available', async () => {
    // No imagePromptProfileId → uncensoredLLMSelection stays null
    repos.chatSettings.findByUserId.mockResolvedValue({
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
    })

    mockUpdateSceneState.mockResolvedValue({
      success: true,
      result: { location: 'Unknown' },
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    } as any)

    const job = buildJob()

    await handleSceneStateTracking(job as any)

    // No retry without an uncensored provider
    expect(mockUpdateSceneState).toHaveBeenCalledTimes(1)
    // Still persists whatever we got
    expect(repos.chats.update).toHaveBeenCalled()
  })

  // ─── Additional: uses getCheapLLMProvider with correct args ─────────────────

  it('calls getCheapLLMProvider with the connection profile, config, available profiles, and false', async () => {
    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockGetCheapLLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'profile-1' }),
      expect.objectContaining({ strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true }),
      expect.any(Array),
      false
    )
  })

  // ─── Additional: uses resolveUncensoredCheapLLMSelection for dangerous chats ─

  it('calls resolveUncensoredCheapLLMSelection for dangerous chats', async () => {
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      messageCount: 5,
      sceneState: null,
      isDangerousChat: true,
      participants: [{ id: 'p1', characterId: 'char-1', controlledBy: 'llm', isActive: true, status: 'active' }],
      contextSummary: null,
    })
    // Must return a valid selection so cheapLLMSelection stays non-null after the call
    const uncensoredSelection = { provider: 'OLLAMA', modelName: 'llama3', connectionProfileId: 'profile-uncensored', isLocal: true }
    mockResolveUncensoredCheapLLMSelection.mockReturnValue(uncensoredSelection as any)

    const job = buildJob()

    await handleSceneStateTracking(job as any)

    expect(mockResolveUncensoredCheapLLMSelection).toHaveBeenCalledWith(
      cheapLLMSelection,
      true,
      expect.objectContaining({ mode: 'OFF' }),
      expect.any(Array)
    )
  })

  // ─── Additional: loads characters for all characterIds ───────────────────────

  it('loads all characters listed in characterIds', async () => {
    const job = buildJob({ characterIds: ['char-1', 'char-2'], connectionProfileId: 'profile-1' })
    // Both characters must have active participants in the chat for them to appear in scene state
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      messageCount: 10,
      sceneState: null,
      isDangerousChat: false,
      participants: [
        { id: 'p1', characterId: 'char-1', controlledBy: 'llm', isActive: true, status: 'active' },
        { id: 'p2', characterId: 'char-2', controlledBy: 'llm', isActive: true, status: 'active' },
      ],
      contextSummary: null,
    })
    repos.characters.findById
      .mockResolvedValueOnce({ id: 'char-1', name: 'Alice', description: '', scenario: '', physicalDescriptions: [], clothingRecords: [] })
      .mockResolvedValueOnce({ id: 'char-2', name: 'Bob', description: '', scenario: '', physicalDescriptions: [], clothingRecords: [] })

    await handleSceneStateTracking(job as any)

    expect(repos.characters.findById).toHaveBeenCalledWith('char-1')
    expect(repos.characters.findById).toHaveBeenCalledWith('char-2')
    expect(mockUpdateSceneState).toHaveBeenCalledTimes(1)
    const [sceneStateInput] = mockUpdateSceneState.mock.calls[0]
    expect(sceneStateInput.characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ characterId: 'char-1' }),
        expect.objectContaining({ characterId: 'char-2' }),
      ])
    )
  })
})
