/**
 * Custom-tool LLM consults — the invoker behind `executeCustomTool`'s
 * `llmInvoke` seam.
 *
 * The contract that matters is total containment: nothing this module can hit
 * — no profiles, a thrown provider, a provider that simply never answers —
 * may escape as an exception, because one level up the failure has to become
 * the author's `errorMessage` rather than a wedged turn. The other load-bearing
 * bit is Concierge rerouting: a dangerous chat must reach the uncensored
 * selection, and a bench run (no chat) must never be rerouted.
 *
 * `consultMaxTokens` is covered in custom-tools-execution.test.ts.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
}))

jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  buildCheapLLMConfig: jest.fn(() => ({ cheap: true })),
}))

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({ settings: { mode: 'reroute' } })),
}))

jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(() => false),
}))

import { buildCustomToolLlmInvoker, CONSULT_TIMEOUT_MS } from '@/lib/pascal/llm-consult'
import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'

const mockRepos = getRepositories as jest.Mock
const mockGetCheap = getCheapLLMProvider as jest.Mock
const mockUncensored = resolveUncensoredCheapLLMSelection as jest.Mock
const mockExecute = executeCheapLLMTask as jest.Mock
const mockResolveDanger = resolveDangerousContentSettings as jest.Mock
const mockShouldUseUncensoredRoute = shouldUseUncensoredRoute as jest.Mock

type AnyRecord = Record<string, unknown>

const PROFILES = [{ id: 'prof-1', name: 'Everyday' }, { id: 'prof-2', name: 'Uncensored' }]
const SAFE_SELECTION = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' }
const UNCENSORED_SELECTION = { provider: 'openrouter', modelName: 'some/uncensored' }

let findChatById: jest.Mock

function primeRepos(over: { profiles?: AnyRecord[]; chat?: AnyRecord | null } = {}) {
  findChatById = jest.fn(async () => (over.chat === undefined ? { id: 'chat-1' } : over.chat))
  mockRepos.mockReturnValue({
    chatSettings: { findByUserId: jest.fn(async () => ({ id: 'cs-1' })) },
    connections: { findByUserId: jest.fn(async () => over.profiles ?? PROFILES) },
    chats: { findById: findChatById },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockGetCheap.mockReturnValue(SAFE_SELECTION)
  mockUncensored.mockReturnValue(UNCENSORED_SELECTION)
  mockResolveDanger.mockReturnValue({ settings: { mode: 'reroute' } })
  mockShouldUseUncensoredRoute.mockReturnValue(false)
  mockExecute.mockResolvedValue({ success: true, result: 'The oracle speaks.' })
})

describe('buildCustomToolLlmInvoker — the happy path', () => {
  it('returns the answer with the provider and model that produced it', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    await expect(invoke('What lies below?')).resolves.toEqual({
      ok: true,
      output: 'The oracle speaks.',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    })
  })

  it("poses the author's prompt as the entire conversation, with no framing of ours", async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    await invoke('What lies below?')

    const [, messages, userId, , taskName, chatId] = mockExecute.mock.calls[0]
    expect(messages).toEqual([{ role: 'user', content: 'What lies below?' }])
    expect(userId).toBe('u1')
    expect(taskName).toBe('custom-tool-consult')
    expect(chatId).toBe('chat-1')
  })

  it('scales the token budget from the caller-supplied output cap', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await invoke('prompt', { maxOutputChars: 30_000 })

    expect(mockExecute.mock.calls[0][8]).toBe(10_000)
  })

  it('falls back to the default output cap when the caller names none', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await invoke('prompt')

    // Whatever MAX_LLM_OUTPUT_LENGTH is, the budget respects the 2048 floor.
    expect(mockExecute.mock.calls[0][8]).toBeGreaterThanOrEqual(2048)
  })

  it('resolves settings and profiles fresh on every invocation', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    await invoke('first')
    await invoke('second')

    // A cheap-model change must be live on the very next roll.
    expect(mockRepos).toHaveBeenCalledTimes(2)
    expect(mockGetCheap).toHaveBeenCalledTimes(2)
  })
})

describe('buildCustomToolLlmInvoker — Concierge rerouting', () => {
  it('reroutes a dangerous chat to the uncensored selection', async () => {
    mockShouldUseUncensoredRoute.mockReturnValue(true)
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    const result = await invoke('prompt')

    expect(mockUncensored).toHaveBeenCalledWith(
      SAFE_SELECTION,
      true,
      { mode: 'reroute' },
      PROFILES
    )
    expect(mockExecute.mock.calls[0][0]).toBe(UNCENSORED_SELECTION)
    expect(mockExecute.mock.calls[0][7]).toMatchObject({ isDangerousChat: true })
    expect(result).toMatchObject({ ok: true, provider: 'openrouter' })
  })

  it('leaves a safe chat on the ordinary selection', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    await invoke('prompt')

    expect(mockUncensored).not.toHaveBeenCalled()
    expect(mockExecute.mock.calls[0][0]).toBe(SAFE_SELECTION)
    expect(mockExecute.mock.calls[0][7]).toMatchObject({ isDangerousChat: false })
  })

  it('never looks up a chat for a bench run', async () => {
    // Pascal's Workbench belongs to no room and is never rerouted.
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: null })

    await invoke('prompt')

    expect(findChatById).not.toHaveBeenCalled()
    expect(mockResolveDanger).toHaveBeenCalledWith({ id: 'cs-1' }, undefined)
    expect(mockExecute.mock.calls[0][5]).toBeUndefined()
  })

  it('hands the resolved danger settings and profile list to the executor', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    await invoke('prompt')

    expect(mockExecute.mock.calls[0][7]).toEqual({
      dangerSettings: { mode: 'reroute' },
      availableProfiles: PROFILES,
      isDangerousChat: false,
    })
  })
})

describe('buildCustomToolLlmInvoker — failure containment', () => {
  it('reports the absence of connection profiles rather than calling out', async () => {
    primeRepos({ profiles: [] })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toEqual({
      ok: false,
      reason: 'no connection profiles are configured',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("passes the executor's own error through as the reason", async () => {
    mockExecute.mockResolvedValue({ success: false, error: 'rate limited' })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toEqual({ ok: false, reason: 'rate limited' })
  })

  it('supplies a reason when the executor fails without one', async () => {
    mockExecute.mockResolvedValue({ success: false })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toEqual({
      ok: false,
      reason: 'the model returned nothing',
    })
  })

  it('rejects a non-string result even when the task claims success', async () => {
    mockExecute.mockResolvedValue({ success: true, result: { unexpected: true } })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toMatchObject({ ok: false })
  })

  it('accepts an empty string as a genuine answer', async () => {
    // '' is a string; the author's outcome table decides what to make of it.
    mockExecute.mockResolvedValue({ success: true, result: '' })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toMatchObject({ ok: true, output: '' })
  })

  it('converts a thrown repository error into a reason, never a rejection', async () => {
    mockRepos.mockImplementation(() => {
      throw new Error('database on fire')
    })
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toEqual({ ok: false, reason: 'database on fire' })
  })

  it('converts a thrown provider error into a reason', async () => {
    mockExecute.mockRejectedValue(new Error('socket hang up'))
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await expect(invoke('prompt')).resolves.toEqual({ ok: false, reason: 'socket hang up' })
  })
})

describe('buildCustomToolLlmInvoker — the timeout', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('gives up on a hung provider rather than wedging the turn', async () => {
    mockExecute.mockReturnValue(new Promise(() => {}))
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1', chatId: 'chat-1' })

    const pending = invoke('prompt')
    await jest.advanceTimersByTimeAsync(CONSULT_TIMEOUT_MS + 1)

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'the consult timed out after 60s',
    })
  })

  it('lets an answer that lands just inside the window through', async () => {
    mockExecute.mockReturnValue(
      new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, result: 'just in time' }), CONSULT_TIMEOUT_MS - 1)
      )
    )
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    const pending = invoke('prompt')
    await jest.advanceTimersByTimeAsync(CONSULT_TIMEOUT_MS)

    await expect(pending).resolves.toMatchObject({ ok: true, output: 'just in time' })
  })

  it('clears the timer once an answer arrives, leaving nothing pending', async () => {
    const invoke = buildCustomToolLlmInvoker({ userId: 'u1' })

    await invoke('prompt')

    expect(jest.getTimerCount()).toBe(0)
  })
})
