import { handleTitleUpdate } from '@/lib/background-jobs/handlers/title-update'
import { getRepositories } from '@/lib/repositories/factory'
import {
  considerTitleUpdate,
  considerHelpChatTitleUpdate,
  extractVisibleConversation,
} from '@/lib/memory/cheap-llm-tasks'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { createTitleGenerationEvent } from '@/lib/services/system-events.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  considerTitleUpdate: jest.fn(),
  considerHelpChatTitleUpdate: jest.fn(),
  extractVisibleConversation: jest.fn(),
  // The real predicate: the handler must only fail the job for a *timeout*,
  // and these suites' failures are ordinary ones (bug 107).
  throwIfLostToTimeout: jest.requireActual('@/lib/memory/cheap-llm-tasks/core-execution').throwIfLostToTimeout,
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({
    settings: { mode: 'OFF', threshold: 0.7 }, source: 'default',
  })),
}))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: () => false,
}))
jest.mock('@/lib/services/system-events.service', () => ({
  createTitleGenerationEvent: jest.fn(),
}))
jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(async () => ({ cost: 0.0001 })),
}))
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveImageProfileForChat: jest.fn(async () => null),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockConsiderTitleUpdate = considerTitleUpdate as jest.MockedFunction<typeof considerTitleUpdate>
const mockGetCheapLLMProvider = getCheapLLMProvider as jest.MockedFunction<typeof getCheapLLMProvider>
const mockExtractVisibleConversation = extractVisibleConversation as jest.MockedFunction<typeof extractVisibleConversation>

const baseChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'salon',
  title: 'Chat with Alice',
  isManuallyRenamed: false,
  contextSummary: null,
  lastRenameCheckInterchange: 0,
  participants: [],
  ...overrides,
})

const createMockRepos = (chatOverrides: Record<string, unknown> = {}) => ({
  chats: {
    findById: jest.fn(async () => baseChat(chatOverrides)),
    getMessages: jest.fn(async () => []),
    update: jest.fn(async () => undefined),
  },
  connections: {
    findById: jest.fn(async () => ({
      id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4o-mini',
    })),
    findByUserId: jest.fn(async () => []),
  },
  chatSettings: {
    findByUserId: jest.fn(async () => ({
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        userDefinedProfileId: null,
        defaultCheapProfileId: null,
        fallbackToLocal: true,
      },
    })),
  },
})

const baseJob = (payloadOverrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'TITLE_UPDATE' as const,
  status: 'PROCESSING' as const,
  payload: {
    chatId: 'chat-1',
    connectionProfileId: 'profile-1',
    currentInterchange: 2,
    ...payloadOverrides,
  },
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCheapLLMProvider.mockReturnValue({
    provider: 'OPENAI', modelName: 'gpt-4o-mini', connectionProfileId: 'profile-1', isLocal: false,
  } as never)
  mockExtractVisibleConversation.mockReturnValue([
    { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' },
  ] as never)
})

describe('handleTitleUpdate — cursor advancement on failure', () => {
  // Regression: a persistently-failing cheap LLM (e.g. exhausted OpenAI quota)
  // used to leave `lastRenameCheckInterchange` at 0 forever, which caused
  // `shouldCheckTitleAtInterchange` to keep crossing checkpoint 2 on every
  // following turn and re-fire a fresh TITLE_UPDATE job each time.

  it('advances lastRenameCheckInterchange even when the cheap-LLM call fails', async () => {
    const repos = createMockRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockConsiderTitleUpdate.mockResolvedValue({
      success: false,
      error: '429 You exceeded your current quota',
    } as never)

    await handleTitleUpdate(baseJob({ currentInterchange: 2 }) as never)

    const cursorUpdates = repos.chats.update.mock.calls.filter(
      ([, patch]) => (patch as { lastRenameCheckInterchange?: number }).lastRenameCheckInterchange === 2,
    )
    expect(cursorUpdates).toHaveLength(1)
    // And NO title rename should have been applied.
    const titleUpdates = repos.chats.update.mock.calls.filter(
      ([, patch]) => 'title' in (patch as Record<string, unknown>),
    )
    expect(titleUpdates).toHaveLength(0)
  })

  it('does not burn the checkpoint when the check never ran', async () => {
    // Bug 107: burning the cursor is right for a quota error — it will still be
    // exhausted at the next checkpoint — and wrong for a timeout, which would
    // skip the rename entirely rather than defer it. Failing the job instead
    // leaves the cursor where it was for the retry.
    const repos = createMockRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockConsiderTitleUpdate.mockResolvedValue({
      success: false,
      error: 'Request timed out.',
      timedOut: true,
    } as never)

    await expect(handleTitleUpdate(baseJob({ currentInterchange: 2 }) as never))
      .rejects.toThrow(/title-update/)

    const cursorUpdates = repos.chats.update.mock.calls.filter(
      ([, patch]) => (patch as { lastRenameCheckInterchange?: number }).lastRenameCheckInterchange === 2,
    )
    expect(cursorUpdates).toHaveLength(0)
  })

  it('advances lastRenameCheckInterchange when no cheap LLM is configured', async () => {
    const repos = createMockRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockGetCheapLLMProvider.mockReturnValue(null as never)

    await handleTitleUpdate(baseJob({ currentInterchange: 3 }) as never)

    const cursorUpdates = repos.chats.update.mock.calls.filter(
      ([, patch]) => (patch as { lastRenameCheckInterchange?: number }).lastRenameCheckInterchange === 3,
    )
    expect(cursorUpdates).toHaveLength(1)
    // The cheap-LLM call should never have been attempted.
    expect(mockConsiderTitleUpdate).not.toHaveBeenCalled()
  })

  it('still advances lastRenameCheckInterchange when LLM succeeds with no rename', async () => {
    const repos = createMockRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockConsiderTitleUpdate.mockResolvedValue({
      success: true,
      result: { needsNewTitle: false, suggestedTitle: null, reason: 'title still fits' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as never)

    await handleTitleUpdate(baseJob({ currentInterchange: 5 }) as never)

    const cursorUpdates = repos.chats.update.mock.calls.filter(
      ([, patch]) => (patch as { lastRenameCheckInterchange?: number }).lastRenameCheckInterchange === 5,
    )
    expect(cursorUpdates).toHaveLength(1)
  })
})
