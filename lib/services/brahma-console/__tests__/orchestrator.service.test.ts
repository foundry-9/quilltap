/**
 * @jest-environment node
 *
 * (node env: the orchestrator returns a `ReadableStream`, which jsdom lacks but
 * Node provides as a global.)
 *
 * Unit tests for the Brahma Console orchestrator.
 *
 * The load-bearing guarantee: a Brahma turn fires the context-summary check
 * (so past chats get auto-titled) but NEVER triggers memory extraction — the
 * console forms no persistent memories. We also cover the model resolution
 * helper (pinned-vs-default).
 *
 * Mocks follow the repo convention: BARE factory functions, configured via
 * jest.mocked(...) in beforeEach. The repos object is passed into the
 * orchestrator directly (it does not call getRepositories itself).
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  handleBrahmaConsoleMessage,
  resolveBrahmaConnectionProfile,
} from '../orchestrator.service'

// ── Mocks ─────────────────────────────────────────────────────────────────
jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  streamMessage: jest.fn(),
  encodeContentChunk: jest.fn(() => new Uint8Array()),
  encodeReasoningChunk: jest.fn(() => new Uint8Array()),
  encodeDoneEvent: jest.fn(() => new Uint8Array()),
  encodeErrorEvent: jest.fn(() => new Uint8Array()),
  safeEnqueue: (controller: ReadableStreamDefaultController<Uint8Array>, data: Uint8Array) => {
    try { controller.enqueue(data); return true } catch { return false }
  },
  safeClose: (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try { controller.close() } catch { /* already closed */ }
  },
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn(),
  saveToolMessages: jest.fn(),
  detectToolCallsInResponse: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn(() => 'native tool instructions'),
  checkShouldUseTextBlockTools: jest.fn(() => false),
  buildTextBlockSystemInstructions: jest.fn(() => 'text block instructions'),
  parseTextBlocksFromResponse: jest.fn(() => []),
  stripTextBlockMarkersFromResponse: jest.fn((s: string) => s),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn(() => 'agent instructions'),
  buildForceFinalMessage: jest.fn(() => 'force final'),
  extractSubmitFinalResponseFromText: jest.fn((text: string) => text),
}))

jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerContextSummaryCheck: jest.fn(),
  triggerTurnMemoryExtraction: jest.fn(),
}))

jest.mock('../turn-budget', () => ({
  resolveBrahmaMaxAgentTurns: jest.fn().mockResolvedValue(25),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  trackMessageTokenUsage: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}))

jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn(() => false),
}))

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { buildTools, streamMessage, encodeReasoningChunk, encodeDoneEvent } from '@/lib/services/chat-message/streaming.service'
import {
  detectToolCallsInResponse,
  processToolCalls,
  saveToolMessages,
} from '@/lib/services/chat-message/tool-execution.service'
import {
  triggerContextSummaryCheck,
  triggerTurnMemoryExtraction,
} from '@/lib/services/chat-message/memory-trigger.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { resolveBrahmaMaxAgentTurns } from '../turn-budget'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const MOCK_PROFILE = {
  id: 'conn-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o',
  allowWebSearch: false,
}

function makeMockRepos(overrides: Record<string, unknown> = {}) {
  return {
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        userId: 'user-1',
        chatType: 'brahma',
        consoleConnectionProfileId: 'conn-1',
        participants: [],
      }),
      addMessage: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn().mockResolvedValue([]),
    },
    connections: {
      findById: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findDefault: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findApiKeyById: jest.fn().mockResolvedValue({ id: 'key-1', key_value: 'sk-test' }),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({ cheapLLMSettings: { enabled: true } }),
    },
    ...overrides,
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(buildTools).mockResolvedValue({
    tools: [],
    modelSupportsNativeTools: false,
    useNativeWebSearch: false,
  } as never)
  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'Hello from the console.' }
    yield { done: true, rawResponse: { finishReason: 'stop' } }
  } as never)
  jest.mocked(detectToolCallsInResponse).mockReturnValue([])
  jest.mocked(estimateMessageCost).mockResolvedValue({ cost: 0, source: 'fallback' } as never)
})

describe('handleBrahmaConsoleMessage — memory omission', () => {
  it('fires the context-summary check but NEVER triggers memory extraction', async () => {
    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi there' })
    await drain(stream)

    expect(triggerContextSummaryCheck).toHaveBeenCalledTimes(1)
    expect(triggerTurnMemoryExtraction).not.toHaveBeenCalled()
  })

  it('persists the user message and the assistant reply', async () => {
    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi there' })
    await drain(stream)

    const saved = repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as { role: string; content: string })
    expect(saved.some(m => m.role === 'USER' && m.content === 'hi there')).toBe(true)
    expect(saved.some(m => m.role === 'ASSISTANT' && m.content === 'Hello from the console.')).toBe(true)
  })

  it('forwards reasoning ("thinking") live and persists it on the assistant message', async () => {
    // Provider emits cumulative reasoning across chunks, then prose.
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { content: '', reasoningContent: 'Let me think.' }
      yield { content: '', reasoningContent: 'Let me think. Then act.' }
      yield { content: 'The answer.' }
      yield { done: true, rawResponse: { finishReason: 'stop' } }
    } as never)

    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'ponder this' })
    await drain(stream)

    // Live-forwarded: the cumulative chain is emitted as it grows.
    expect(encodeReasoningChunk).toHaveBeenCalledTimes(2)
    expect(jest.mocked(encodeReasoningChunk).mock.calls.map(c => c[1])).toEqual([
      'Let me think.',
      'Let me think. Then act.',
    ])

    // Persisted: the saved assistant message carries the full reasoning.
    const saved = repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as { role: string; content: string; reasoningContent?: string | null })
    const assistant = saved.find(m => m.role === 'ASSISTANT' && m.content === 'The answer.')
    expect(assistant?.reasoningContent).toBe('Let me think. Then act.')
  })

  it('rejects a non-brahma chat', async () => {
    const repos = makeMockRepos({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', userId: 'user-1', chatType: 'salon', participants: [] }),
        addMessage: jest.fn(),
        getMessages: jest.fn().mockResolvedValue([]),
      },
    })
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi' })
    await drain(stream) // should emit an error event and close, not throw
    expect(triggerContextSummaryCheck).not.toHaveBeenCalled()
  })
})

describe('handleBrahmaConsoleMessage — tool-call threading', () => {
  it('threads the assistant tool-call turn + paired tool result onto the follow-up stream', async () => {
    jest.mocked(buildTools).mockResolvedValue({
      tools: [{ name: 'run_sql' }],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
    } as never)

    const slates: Array<Array<{ role: string; content: string; toolCallId?: string; name?: string; toolCalls?: unknown[] }>> = []
    let call = 0
    jest.mocked(streamMessage).mockImplementation(async function* (opts: { messages: unknown[] }) {
      slates.push(JSON.parse(JSON.stringify(opts.messages)))
      call++
      if (call === 1) {
        yield { content: '', done: false }
        yield { done: true, rawResponse: { tool: 1 } }
      } else {
        yield { content: 'Here is your answer.' }
        yield { done: true, rawResponse: { finishReason: 'stop' } }
      }
    } as never)

    jest.mocked(detectToolCallsInResponse)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { database: 'main', sql: 'SELECT 1' }, callId: 'call_1' }] as never)
      .mockReturnValue([] as never)

    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: '{"rows":[1]}', callId: 'call_1', arguments: { database: 'main', sql: 'SELECT 1' } }],
      generatedImagePaths: [],
    } as never)
    jest.mocked(saveToolMessages).mockResolvedValue(undefined as never)

    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'count rows' })
    await drain(stream)

    expect(slates.length).toBe(2)
    const followUp = slates[1]

    // The assistant turn carries the native tool_calls so the model can see it
    // already issued the query (the core fix for the repeat-the-same-SQL loop).
    const assistant = followUp.find(m => m.role === 'assistant' && Array.isArray(m.toolCalls))
    expect(assistant?.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'run_sql', arguments: JSON.stringify({ database: 'main', sql: 'SELECT 1' }) } },
    ])

    // The result is paired back to the call by toolCallId.
    const toolResult = followUp.find(m => m.role === 'tool')
    expect(toolResult).toMatchObject({ role: 'tool', toolCallId: 'call_1', name: 'run_sql', content: '{"rows":[1]}' })

    // Regression: the old bug emitted a role:'tool' message whose content was
    // JSON {tool,success,result} bound to no call — never again.
    expect(followUp.some(m => m.role === 'tool' && !m.toolCallId)).toBe(false)
    expect(followUp.some(m => typeof m.content === 'string' && m.content.includes('"success"'))).toBe(false)
  })

  it('replays prior tool activity as readable [Tool Result] text, dropping empty tool-turn assistants', async () => {
    jest.mocked(buildTools).mockResolvedValue({
      tools: [{ name: 'run_sql' }],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
    } as never)

    const slates: Array<Array<{ role: string; content: string; toolCallId?: string }>> = []
    jest.mocked(streamMessage).mockImplementation(async function* (opts: { messages: unknown[] }) {
      slates.push(JSON.parse(JSON.stringify(opts.messages)))
      yield { content: 'done' }
      yield { done: true, rawResponse: {} }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValue([] as never)

    const repos = makeMockRepos({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', userId: 'user-1', chatType: 'brahma', consoleConnectionProfileId: 'conn-1', participants: [] }),
        addMessage: jest.fn().mockResolvedValue(undefined),
        getMessages: jest.fn().mockResolvedValue([
          { type: 'message', role: 'USER', content: 'earlier question', id: 'm1' },
          { type: 'message', role: 'ASSISTANT', content: '', id: 'm2' },
          { type: 'message', role: 'TOOL', content: JSON.stringify({ toolName: 'run_sql', success: true, result: '{"rows":[42]}', arguments: { sql: 'SELECT 1' }, callId: 'call_x' }), id: 'm3' },
          { type: 'message', role: 'ASSISTANT', content: 'prior answer', id: 'm4' },
          { type: 'message', role: 'USER', content: 'new question', id: 'm5' },
        ]),
      },
    })

    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'new question' })
    await drain(stream)

    const slate = slates[0]
    // No bare tool-role messages from history; rendered as user-readable text.
    expect(slate.some(m => m.role === 'tool')).toBe(false)
    const toolText = slate.find(m => typeof m.content === 'string' && m.content.startsWith('[Tool Result: run_sql]'))
    expect(toolText?.role).toBe('user')
    expect(toolText?.content).toContain('{"rows":[42]}')
    // The empty tool-turn assistant (m2) is dropped; the substantive one stays.
    expect(slate.filter(m => m.role === 'assistant').map(m => m.content)).toEqual(['prior answer'])
    // No raw stored-tool JSON leaks into the model context.
    expect(slate.some(m => typeof m.content === 'string' && m.content.includes('"toolName"'))).toBe(false)
  })

  it('breaks the loop when repeated queries surface no new information (stale-result guard)', async () => {
    jest.mocked(buildTools).mockResolvedValue({
      tools: [{ name: 'run_sql' }],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
    } as never)

    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { content: 'x' }
      yield { done: true, rawResponse: {} }
    } as never)

    // Three semantically-different queries (so the normalized-signature guard
    // does NOT trip), each returning the identical result — then a fourth call
    // that should be cut off by the stale-result guard before it executes.
    jest.mocked(detectToolCallsInResponse)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c' }] as never)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1 -- a' }, callId: 'c' }] as never)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1 where 1=1' }, callId: 'c' }] as never)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1 limit 1' }, callId: 'c' }] as never)
      .mockReturnValue([] as never)

    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: '{"same":1}', callId: 'c' }],
      generatedImagePaths: [],
    } as never)
    jest.mocked(saveToolMessages).mockResolvedValue(undefined as never)

    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'how many?' })
    await drain(stream)

    // Executed exactly the 3 information-bearing iterations, then the guard
    // forced a finalize instead of letting it run to the 25-turn cap.
    expect(jest.mocked(processToolCalls)).toHaveBeenCalledTimes(3)
  })
})

describe('handleBrahmaConsoleMessage — budget exhaustion (Bug 47)', () => {
  it('salvages a final message + done event when the forced turn only calls a tool', async () => {
    // Budget of 2: turn 1 runs a tool, turn 2 is the forced-final turn (which
    // executes no tools) — and the model answers it with ANOTHER native tool call
    // instead of submit_final_response, so the turn carries no prose.
    jest.mocked(resolveBrahmaMaxAgentTurns).mockResolvedValue(2)
    jest.mocked(buildTools).mockResolvedValue({
      tools: [{ name: 'run_sql' }],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
    } as never)

    // Every turn: empty prose + a native tool call in the raw response.
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { content: '' }
      yield { done: true, rawResponse: { tool: 1 } }
    } as never)
    // Never submit_final_response — always another run_sql.
    jest.mocked(detectToolCallsInResponse).mockReturnValue(
      [{ name: 'run_sql', arguments: { sql: 'SELECT 1' }, callId: 'c1' }] as never,
    )
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: '{"rows":[7]}', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)
    jest.mocked(saveToolMessages).mockResolvedValue(undefined as never)

    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'how many rows?' })
    await drain(stream)

    // A final ASSISTANT message is persisted — not silence — and it explains the
    // budget exhaustion and folds in the last tool result we captured.
    const saved = repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as { role: string; content: string })
    const finalAssistant = saved.find(m => m.role === 'ASSISTANT' && m.content.includes('2-turn budget'))
    expect(finalAssistant).toBeTruthy()
    expect(finalAssistant?.content).toContain('{"rows":[7]}')

    // The stream always signals completion — the client never hangs.
    expect(encodeDoneEvent).toHaveBeenCalledTimes(1)
  })
})

describe('resolveBrahmaConnectionProfile', () => {
  it('returns the pinned profile when it exists and the user owns it', async () => {
    const repos = makeMockRepos()
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', 'conn-1')
    expect(profile?.id).toBe('conn-1')
    expect(repos.connections.findDefault).not.toHaveBeenCalled()
  })

  it('falls back to the default profile when the pinned one belongs to another user', async () => {
    const repos = makeMockRepos({
      connections: {
        findById: jest.fn().mockResolvedValue({ ...MOCK_PROFILE, userId: 'someone-else' }),
        findDefault: jest.fn().mockResolvedValue(MOCK_PROFILE),
        findApiKeyById: jest.fn(),
      },
    })
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', 'conn-1')
    expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1')
    expect(profile?.id).toBe('conn-1')
  })

  it('falls back to the default profile when none is pinned', async () => {
    const repos = makeMockRepos()
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', null)
    expect(repos.connections.findById).not.toHaveBeenCalled()
    expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1')
    expect(profile?.id).toBe('conn-1')
  })
})
