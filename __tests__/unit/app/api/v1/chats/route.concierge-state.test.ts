/**
 * POST /api/v1/chats — the Concierge state chosen on the New Chat form.
 *
 * The four-state control moved from the Salon sidebar onto the creation form,
 * so the create route now accepts `conciergeState` and applies it through the
 * one transition chokepoint (`applyConciergeFlip`) *after* the system-prompt
 * message and *before* any staff announcement or greeting. The greeting itself
 * then asks the chat, not the globe, which desk it belongs at.
 *
 * Uses the global `jest` (not @jest/globals) so jest.mock(...) calls hoist
 * above the ES module imports under the SWC transform.
 */

// ---------------------------------------------------------------------------
// Heavy dependency mocks — the route just needs to traverse them intact.
// ---------------------------------------------------------------------------

jest.mock('@/lib/chat/initialize', () => ({
  buildChatContext: jest.fn(),
}))

jest.mock('@/lib/chat/initial-greeting', () => ({
  generateGreetingMessage: jest.fn(),
}))

// The resolver keeps its real semantics — the whole point of §5 is that a
// Vouched Safe chat resolves to `mode: 'OFF'` and an Uncensored one to
// `AUTO_ROUTE` — but is wrapped in a spy so the tests can see what it was asked.
jest.mock('@/lib/services/dangerous-content/resolver.service', () => {
  const actual = jest.requireActual('@/lib/services/dangerous-content/resolver.service')
  return {
    ...actual,
    resolveDangerousContentSettings: jest.fn(actual.resolveDangerousContentSettings),
  }
})

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn().mockResolvedValue({ newState: 'uncensored', changed: true }),
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
  postProsperoGroupContextWhisper: jest.fn().mockResolvedValue(undefined),
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
import { buildChatContext } from '@/lib/chat/initialize'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip'
import { applyChatContinuation } from '@/lib/chat/apply-chat-continuation'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import { postProsperoContextAnnouncement } from '@/lib/services/prospero-notifications/writer'
import {
  createMockRepositoryContainer,
  setupAuthMocks,
  type MockRepositoryContainer,
} from '@/__tests__/unit/lib/fixtures/mock-repositories'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'c1111111-1111-4111-8111-111111111111'
const CHAR_ID = 'c2222222-2222-4222-8222-222222222222'
const PROFILE_ID = 'c3333333-3333-4333-8333-333333333333'
const NEW_CHAT_ID = 'c4444444-4444-4444-8444-444444444444'
const SOURCE_CHAT_ID = 'c5555555-5555-4555-8555-555555555555'
const UNCENSORED_PROFILE_ID = 'c6666666-6666-4666-8666-666666666666'

const mockedBuildChatContext = buildChatContext as unknown as jest.Mock
const mockedGenerateGreeting = generateGreetingMessage as unknown as jest.Mock
const mockedApplyConciergeFlip = applyConciergeFlip as unknown as jest.Mock
const mockedApplyContinuation = applyChatContinuation as unknown as jest.Mock
const mockedResolveSettings = resolveDangerousContentSettings as unknown as jest.Mock
const mockedResolveProvider = resolveProviderForDangerousContent as unknown as jest.Mock
const mockedProsperoAnnouncement = postProsperoContextAnnouncement as unknown as jest.Mock

function makeCharacter() {
  return {
    id: CHAR_ID,
    userId: USER_ID,
    name: 'Alice',
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

function makeUncensoredProfile() {
  return {
    id: UNCENSORED_PROFILE_ID,
    userId: USER_ID,
    name: 'The frank desk',
    provider: 'OPENROUTER',
    modelName: 'frank-model',
    baseUrl: null,
    apiKeyId: null,
    isDefault: false,
    parameters: {},
  }
}

/** The stored Concierge pair the chat row carries; defaults to Monitored. */
function makeCreatedChat(
  pair: { conciergeOverride?: string | null; isDangerousChat?: boolean } = {},
) {
  return {
    id: NEW_CHAT_ID,
    userId: USER_ID,
    title: 'Chat with Alice',
    chatType: 'salon',
    participants: [
      { id: 'np-a', type: 'CHARACTER', characterId: CHAR_ID, controlledBy: 'llm', isActive: true, displayOrder: 0 },
    ],
    messageCount: 0,
    conciergeOverride: pair.conciergeOverride ?? null,
    isDangerousChat: pair.isDangerousChat ?? false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

function baseBody(extra: Record<string, unknown> = {}) {
  return {
    title: 'Chat with Alice',
    participants: [
      { type: 'CHARACTER', characterId: CHAR_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
    ],
    ...extra,
  }
}

/** Jest's monotonic call counter, for "did A happen before B" assertions. */
function firstCallOrder(mock: jest.Mock): number {
  return mock.mock.invocationCallOrder[0]
}

describe('POST /api/v1/chats — Concierge state at creation', () => {
  let mockRepos: MockRepositoryContainer
  let chatRow: ReturnType<typeof makeCreatedChat>

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepositoryContainer()
    chatRow = makeCreatedChat()

    ;(mockRepos.chats as any).getEquippedOutfitForCharacter = jest.fn().mockResolvedValue(null)
    ;(mockRepos as any).wardrobe = { findByIdsForCharacter: jest.fn().mockResolvedValue([]) }
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

    mockedBuildChatContext.mockResolvedValue({
      systemPrompt: 'system prompt',
      firstMessage: 'hi',
      character: { id: CHAR_ID, name: 'Alice' },
      userCharacter: null,
      persona: null,
    })
    mockedGenerateGreeting.mockResolvedValue({ content: '', reasoningContent: '' })

    mockRepos.chats.findById.mockImplementation(async (id: string) =>
      id === NEW_CHAT_ID ? (chatRow as any) : null
    )
    mockRepos.characters.findById.mockImplementation(async (id: string) =>
      id === CHAR_ID ? (makeCharacter() as any) : null
    )
    mockRepos.connections.findById.mockResolvedValue(makeConnectionProfile() as any)
    mockRepos.chats.create.mockImplementation(async () => chatRow as any)
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      userId: USER_ID,
      dangerousContentSettings: { mode: 'OFF', threshold: 0.7 },
    } as any)
  })

  // -------------------------------------------------------------------------
  // The flip itself
  // -------------------------------------------------------------------------

  it('does not touch the Concierge when the field is omitted', async () => {
    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    expect(mockedApplyConciergeFlip).not.toHaveBeenCalled()
  })

  it('does not touch the Concierge when Monitored is requested', async () => {
    const res = await POST(createMockRequest(baseBody({ conciergeState: 'monitored' })))

    expect(res.status).toBe(201)
    expect(mockedApplyConciergeFlip).not.toHaveBeenCalled()
  })

  it.each(['flagged', 'vouched', 'uncensored'])(
    'applies %s through the flip chokepoint with the created chat',
    async (state) => {
      const res = await POST(createMockRequest(baseBody({ conciergeState: state })))

      expect(res.status).toBe(201)
      expect(mockedApplyConciergeFlip).toHaveBeenCalledTimes(1)
      expect(mockedApplyConciergeFlip).toHaveBeenCalledWith(NEW_CHAT_ID, state, chatRow)
    }
  )

  it('flips after the system-prompt message and before the staff and the greeting', async () => {
    // A general shelf makes Prospero's chat-start announcement — the first
    // staff bubble of the scenario-and-staff phase — actually fire.
    const { loadProsperoGeneralContext } = jest.requireMock(
      '@/lib/services/prospero-notifications/writer'
    ) as { loadProsperoGeneralContext: jest.Mock }
    loadProsperoGeneralContext.mockResolvedValue({ shelfName: 'Quilltap General' })

    const res = await POST(createMockRequest(baseBody({ conciergeState: 'uncensored' })))
    expect(res.status).toBe(201)

    const addMessageOrders = mockRepos.chats.addMessage.mock.invocationCallOrder
    const flipOrder = firstCallOrder(mockedApplyConciergeFlip)

    // Two messages land: the SYSTEM prompt, then the opening line.
    expect(addMessageOrders.length).toBe(2)
    expect(flipOrder).toBeGreaterThan(addMessageOrders[0])
    expect(flipOrder).toBeLessThan(firstCallOrder(mockedProsperoAnnouncement))
    expect(flipOrder).toBeLessThan(addMessageOrders[1])
  })

  it('flips before the continuation backfill replays the previous chapter', async () => {
    mockRepos.chats.findById.mockImplementation(async (id: string) =>
      id === NEW_CHAT_ID || id === SOURCE_CHAT_ID ? (chatRow as any) : null
    )

    const res = await POST(
      createMockRequest(
        baseBody({ conciergeState: 'flagged', continuationFromChatId: SOURCE_CHAT_ID })
      )
    )

    expect(res.status).toBe(201)
    expect(mockedApplyConciergeFlip).toHaveBeenCalledTimes(1)
    expect(firstCallOrder(mockedApplyConciergeFlip)).toBeLessThan(
      firstCallOrder(mockedApplyContinuation)
    )
  })

  it('rejects a state outside the four', async () => {
    const res = await POST(createMockRequest(baseBody({ conciergeState: 'spicy' })))

    expect(res.status).toBe(400)
    expect(mockRepos.chats.create).not.toHaveBeenCalled()
    expect(mockedApplyConciergeFlip).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Greeting routing under the chosen state (§5)
  // -------------------------------------------------------------------------

  describe('greeting routing', () => {
    beforeEach(() => {
      // No scripted first message, so the route generates the greeting.
      mockedBuildChatContext.mockResolvedValue({
        systemPrompt: 'system prompt',
        firstMessage: '',
        character: { id: CHAR_ID, name: 'Alice' },
        userCharacter: null,
        persona: null,
      })
    })

    it('sends an Uncensored chat to the frank desk first, even under a global OFF', async () => {
      chatRow = makeCreatedChat({ conciergeOverride: 'UNCENSORED' })
      mockedResolveProvider.mockResolvedValue({
        rerouted: true,
        connectionProfile: makeUncensoredProfile(),
        apiKey: 'frank-key',
        reason: 'configured uncensored profile',
      })
      mockedGenerateGreeting.mockResolvedValue({ content: 'Well then.', reasoningContent: '' })

      const res = await POST(createMockRequest(baseBody({ conciergeState: 'uncensored' })))
      expect(res.status).toBe(201)

      // The resolver was asked about the chat, not just the globe...
      expect(mockedResolveSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ conciergeOverride: 'UNCENSORED' })
      )
      // ...and the reroute happened before any greeting call at all.
      expect(firstCallOrder(mockedResolveProvider)).toBeLessThan(
        firstCallOrder(mockedGenerateGreeting)
      )
      expect(mockedGenerateGreeting).toHaveBeenCalledTimes(1)
      expect(mockedGenerateGreeting).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'OPENROUTER', modelName: 'frank-model' })
      )
    })

    it('never reroutes a Vouched Safe chat, content filter or no', async () => {
      chatRow = makeCreatedChat({ conciergeOverride: 'OFF' })
      mockRepos.chatSettings.findByUserId.mockResolvedValue({
        userId: USER_ID,
        dangerousContentSettings: { mode: 'AUTO_ROUTE', threshold: 0.7 },
      } as any)
      mockedGenerateGreeting
        .mockResolvedValueOnce({ content: '', reasoningContent: '', contentFilterDetected: true })
        .mockResolvedValue({ content: 'Good evening.', reasoningContent: '' })

      const res = await POST(createMockRequest(baseBody({ conciergeState: 'vouched' })))
      expect(res.status).toBe(201)

      expect(mockedResolveSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ conciergeOverride: 'OFF' })
      )
      expect(mockedResolveProvider).not.toHaveBeenCalled()
    })
  })
})
