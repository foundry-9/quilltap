/**
 * Regression test: continuation-into-autonomous chat creation.
 *
 * The "Continue Elsewhere" flow used to flatly reject the combination of
 * `continuationFromChatId` + `chatType: 'autonomous'` with a 400. That
 * blocked the intended use case of withdrawing from a salon chat and
 * handing it off to the LLMs as an autonomous room.
 *
 * This test exercises the POST handler with that combination and confirms
 * the previously-removed 400 doesn't come back.
 */

// Use the global `jest` (not @jest/globals) so jest.mock(...) calls are
// hoisted above the ES module imports by the SWC transform.

// ---------------------------------------------------------------------------
// Heavy dependency mocks — none of these need real behavior for this test.
// We just need the route to traverse the gate without exploding.
// ---------------------------------------------------------------------------

jest.mock('@/lib/chat/initialize', () => ({
  buildChatContext: jest.fn().mockResolvedValue({
    systemPrompt: 'system prompt',
    firstMessage: 'hi',
    character: { id: 'char-a', name: 'Alice' },
    userCharacter: null,
    persona: null,
  }),
}))

jest.mock('@/lib/chat/initial-greeting', () => ({
  generateGreetingMessage: jest.fn().mockResolvedValue({ content: '' }),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn().mockReturnValue({
    settings: { mode: 'DISABLED' },
  }),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
}))

jest.mock('@/lib/chat/first-message-context', () => ({
  buildFirstMessageContext: jest.fn().mockResolvedValue({
    participantMemories: [],
    projectContext: null,
  }),
}))

jest.mock('@/lib/memory/memory-recap', () => ({
  buildRecentConversationsBlock: jest.fn().mockResolvedValue(''),
  calculateRecentConversationsLimit: jest.fn().mockReturnValue(0),
}))

jest.mock('@/lib/llm/model-context-data', () => ({
  getModelContextLimit: jest.fn().mockReturnValue(128000),
}))

jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  ...jest.requireActual('@/lib/llm/cheap-llm'),
  buildCheapLLMConfig: jest.fn().mockReturnValue(null),
}))

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantSummary: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
  enrichChatsForList: jest.fn().mockImplementation((chats: unknown) => chats),
  filterChatsByExcludedTags: jest.fn().mockImplementation((chats: unknown) => chats),
  cleanEnrichedChats: jest.fn().mockImplementation((chats: unknown) => chats),
}))

jest.mock('@/lib/import/sillytavern-import-service', () => ({
  importMultiCharacterChat: jest.fn(),
  importLegacyChat: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostScenarioAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostUserCharacterAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostContinuationFromAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostContinuationToAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/aurora-notifications/writer', () => ({
  postOpeningOutfitWhisper: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  loadProsperoProjectContext: jest.fn().mockResolvedValue(null),
  loadProsperoGeneralContext: jest.fn().mockResolvedValue(null),
  postProsperoContextAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/chat/apply-chat-continuation', () => ({
  applyChatContinuation: jest.fn().mockResolvedValue({
    replayedMessageCount: 0,
    hadLibrarianSummary: false,
    postedSourceTailBubble: false,
  }),
}))

jest.mock('@/lib/services/chat-message/autonomous-room.service', () => ({
  startAutonomousRoomManually: jest.fn().mockResolvedValue({ ok: true }),
}))

// ---------------------------------------------------------------------------
// Imports under test must come after the mocks above.
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/v1/chats/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { startAutonomousRoomManually } from '@/lib/services/chat-message/autonomous-room.service'
import {
  createMockRepositoryContainer,
  setupAuthMocks,
  type MockRepositoryContainer,
} from '@/__tests__/unit/lib/fixtures/mock-repositories'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'a1111111-1111-4111-8111-111111111111'
const SOURCE_CHAT_ID = 'a2222222-2222-4222-8222-222222222222'
const CHAR_A_ID = 'a3333333-3333-4333-8333-333333333333'
const CHAR_B_ID = 'a4444444-4444-4444-8444-444444444444'
const PROFILE_ID = 'a5555555-5555-4555-8555-555555555555'
const NEW_CHAT_ID = 'a6666666-6666-4666-8666-666666666666'

function makeCharacter(id: string, name: string) {
  return {
    id,
    userId: USER_ID,
    name,
    description: '',
    personality: '',
    manifesto: null,
    identity: '',
    title: '',
    scenarios: [],
    systemPrompts: [
      { id: 'sp-1', name: 'Default', content: 'You are a character.', isDefault: true, createdAt: '', updatedAt: '' },
    ],
    tags: [],
    controlledBy: 'llm',
    talkativeness: 0.5,
    defaultPartnerId: null,
    defaultTimestampConfig: null,
    defaultScenarioId: null,
    defaultImageProfileId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeConnectionProfile() {
  return {
    id: PROFILE_ID,
    userId: USER_ID,
    name: 'Test profile',
    provider: 'ANTHROPIC',
    modelName: 'claude-test',
    baseUrl: null,
    apiKeyId: null,
    isDefault: false,
    parameters: {},
  }
}

function makeSourceChat() {
  return {
    id: SOURCE_CHAT_ID,
    userId: USER_ID,
    title: 'Source salon',
    participants: [
      { id: 'sp-a', type: 'CHARACTER', characterId: CHAR_A_ID, controlledBy: 'llm', isActive: true, displayOrder: 0 },
      { id: 'sp-b', type: 'CHARACTER', characterId: CHAR_B_ID, controlledBy: 'llm', isActive: true, displayOrder: 1 },
    ],
    chatType: 'salon',
    messageCount: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeCreatedChat() {
  return {
    id: NEW_CHAT_ID,
    userId: USER_ID,
    title: 'Continued autonomously',
    chatType: 'autonomous',
    participants: [
      { id: 'np-a', type: 'CHARACTER', characterId: CHAR_A_ID, controlledBy: 'llm', isActive: true, displayOrder: 0 },
      { id: 'np-b', type: 'CHARACTER', characterId: CHAR_B_ID, controlledBy: 'llm', isActive: true, displayOrder: 1 },
    ],
    runState: 'idle',
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeCreatedChatWithSchedule(scheduleCron: string | null) {
  return {
    ...makeCreatedChat(),
    scheduleCron,
  }
}

function createMockRequest(body: Record<string, unknown>) {
  return {
    url: 'http://localhost:3000/api/v1/chats',
    method: 'POST',
    nextUrl: new URL('http://localhost:3000/api/v1/chats'),
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/chats — continuation into autonomous room', () => {
  let mockRepos: MockRepositoryContainer

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepositoryContainer()

    // Augment the chats mock with autonomous- and outfit-related methods that
    // the standard fixture doesn't include but the route walks through.
    ;(mockRepos.chats as any).getEquippedOutfitForCharacter = jest.fn().mockResolvedValue(null)

    // Wardrobe isn't part of the standard fixture container at all.
    ;(mockRepos as any).wardrobe = {
      findByIds: jest.fn().mockResolvedValue([]),
    }

    ;(mockRepos as any).projects = {
      findById: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    }

    setupAuthMocks(getServerSession as unknown as jest.Mock, mockRepos, {
      id: USER_ID,
      email: 'csebold@example.com',
      name: 'Test User',
    } as any)

    ;(getRepositoriesSafe as unknown as jest.Mock).mockResolvedValue(mockRepos)
    ;(getRepositories as unknown as jest.Mock).mockReturnValue(mockRepos)

    // Source chat lookup (the continuation source) — and the new chat lookup
    // post-create, which goes through the same findById in some sub-flows.
    mockRepos.chats.findById.mockImplementation(async (id: string) => {
      if (id === SOURCE_CHAT_ID) return makeSourceChat() as any
      if (id === NEW_CHAT_ID) return makeCreatedChat() as any
      return null
    })

    mockRepos.characters.findById.mockImplementation(async (id: string) => {
      if (id === CHAR_A_ID) return makeCharacter(CHAR_A_ID, 'Alice') as any
      if (id === CHAR_B_ID) return makeCharacter(CHAR_B_ID, 'Bob') as any
      return null
    })

    mockRepos.connections.findById.mockResolvedValue(makeConnectionProfile() as any)
    mockRepos.chatSettings.findByUserId.mockResolvedValue(null as any)

    mockRepos.chats.create.mockResolvedValue(makeCreatedChat() as any)
  })

  it('accepts continuationFromChatId together with chatType=autonomous', async () => {
    const body = {
      title: 'Hand-off to the LLMs',
      continuationFromChatId: SOURCE_CHAT_ID,
      chatType: 'autonomous',
      runVisibility: 'owner_only',
      participants: [
        { type: 'CHARACTER', characterId: CHAR_A_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
        { type: 'CHARACTER', characterId: CHAR_B_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
      ],
    }

    const res = await POST(createMockRequest(body))
    const json = await res.json()

    // Primary regression assertion: the formerly-hard-coded 400 must not return.
    expect(json?.error).not.toBe('Autonomous rooms cannot be created via continuation')

    // We expect a clean 201 — the gate passed and all downstream mocks succeeded.
    expect(res.status).toBe(201)
    expect(json?.chat?.id).toBe(NEW_CHAT_ID)
    expect(json?.chat?.chatType).toBe('autonomous')

    // The continuation backfill ran exactly once with the source chat.
    const { applyChatContinuation } = jest.requireMock(
      '@/lib/chat/apply-chat-continuation',
    ) as { applyChatContinuation: jest.Mock }
    expect(applyChatContinuation).toHaveBeenCalledTimes(1)
    expect(applyChatContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        newChatId: NEW_CHAT_ID,
        sourceChatId: SOURCE_CHAT_ID,
        userId: USER_ID,
      }),
    )

    // The created chat was written with autonomous-mode fields.
    expect(mockRepos.chats.create).toHaveBeenCalledTimes(1)
    const createArg = (mockRepos.chats.create as jest.Mock).mock.calls[0][0] as any
    expect(createArg.chatType).toBe('autonomous')
    expect(createArg.runState).toBe('idle')
    // Budget counting mode defaults to excluding cache hits (1) when unset.
    expect(createArg.budgetExcludeCacheHits).toBe(1)
  })

  it('persists budgetExcludeCacheHits=0 when the room opts into counting all tokens', async () => {
    const body = {
      title: 'Count every token',
      chatType: 'autonomous',
      budgetExcludeCacheHits: false,
      participants: [
        { type: 'CHARACTER', characterId: CHAR_A_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
        { type: 'CHARACTER', characterId: CHAR_B_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
      ],
    }

    const res = await POST(createMockRequest(body))
    expect(res.status).toBe(201)

    expect(mockRepos.chats.create).toHaveBeenCalledTimes(1)
    const createArg = (mockRepos.chats.create as jest.Mock).mock.calls[0][0] as any
    expect(createArg.chatType).toBe('autonomous')
    expect(createArg.budgetExcludeCacheHits).toBe(0)
  })

  it('still rejects autonomous rooms without at least two LLM characters even with continuation', async () => {
    const body = {
      title: 'Bad request',
      continuationFromChatId: SOURCE_CHAT_ID,
      chatType: 'autonomous',
      participants: [
        { type: 'CHARACTER', characterId: CHAR_A_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
      ],
    }

    const res = await POST(createMockRequest(body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json?.error).toMatch(/at least two LLM-controlled/i)
  })

  it('auto-starts ad-hoc autonomous rooms (no scheduleCron) after creation', async () => {
    mockRepos.chats.create.mockResolvedValueOnce(makeCreatedChatWithSchedule(null) as any)
    mockRepos.chats.findById.mockImplementationOnce(async (id: string) => {
      if (id === SOURCE_CHAT_ID) return makeSourceChat() as any
      return null
    })

    const body = {
      title: 'Autonomous ad-hoc room',
      chatType: 'autonomous',
      participants: [
        { type: 'CHARACTER', characterId: CHAR_A_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
        { type: 'CHARACTER', characterId: CHAR_B_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
      ],
    }

    const res = await POST(createMockRequest(body))
    expect(res.status).toBe(201)
    expect(startAutonomousRoomManually).toHaveBeenCalledWith(NEW_CHAT_ID, USER_ID)
  })

  it('does not auto-start scheduled autonomous rooms', async () => {
    mockRepos.chats.create.mockResolvedValueOnce(makeCreatedChatWithSchedule('*/5 * * * *') as any)
    mockRepos.chats.findById.mockImplementationOnce(async (id: string) => {
      if (id === SOURCE_CHAT_ID) return makeSourceChat() as any
      return null
    })

    const body = {
      title: 'Autonomous scheduled room',
      chatType: 'autonomous',
      scheduleCron: '*/5 * * * *',
      participants: [
        { type: 'CHARACTER', characterId: CHAR_A_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
        { type: 'CHARACTER', characterId: CHAR_B_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
      ],
    }

    const res = await POST(createMockRequest(body))
    expect(res.status).toBe(201)
    expect(startAutonomousRoomManually).not.toHaveBeenCalled()
  })
})
