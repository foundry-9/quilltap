/**
 * @jest-environment node
 */

// Polyfill Web Streams API before any imports that might use ReadableStream
const streamWeb = require('stream/web')
if (!globalThis.ReadableStream) {
  globalThis.ReadableStream = streamWeb.ReadableStream
}
if (!globalThis.TextEncoder) {
  const { TextEncoder } = require('util')
  globalThis.TextEncoder = TextEncoder
}
if (!globalThis.TextDecoder) {
  const { TextDecoder } = require('util')
  globalThis.TextDecoder = TextDecoder
}

import { handleHelpChatMessage } from '@/lib/services/help-chat/orchestrator.service'
import { resolveAllHelpContentForUrl } from '@/lib/help-chat/context-resolver'
import { buildHelpChatSystemPrompt } from '@/lib/help-chat/system-prompt-builder'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn().mockReturnValue(false), // false so we skip the API key lookup by default
  acceptsApiKey: jest.fn().mockReturnValue(false), // ditto: a keyless local provider (Bug 81)
  validateProviderConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
}))

jest.mock('@/lib/llm/message-formatter', () => ({
  stripCharacterNamePrefix: jest.fn((text: string) => text),
}))

// streamMessage is an async generator — yield one chunk then return
jest.mock('@/lib/services/chat-message/streaming.service', () => {
  async function* fakeStream() {
    yield { content: 'Hello!', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, rawResponse: null }
  }

  const encoder = new (require('util').TextEncoder)()

  return {
    buildTools: jest.fn().mockResolvedValue({ tools: [], modelSupportsNativeTools: false }),
    streamMessage: jest.fn().mockImplementation(() => fakeStream()),
    encodeContentChunk: jest.fn((_enc: unknown, content: string) => encoder.encode(`data: ${content}\n\n`)),
    encodeDoneEvent: jest.fn((_enc: unknown, _data: unknown) => encoder.encode('data: [DONE]\n\n')),
    encodeErrorEvent: jest.fn((_enc: unknown, msg: string, _code: string, _id: string) =>
      encoder.encode(`data: {"error":"${msg}"}\n\n`)
    ),
    encodeStatusEvent: jest.fn((_enc: unknown, _data: unknown) => encoder.encode('data: [STATUS]\n\n')),
    encodeTurnStartEvent: jest.fn((_enc: unknown, _data: unknown) => encoder.encode('data: [TURN_START]\n\n')),
    encodeTurnCompleteEvent: jest.fn((_enc: unknown, _data: unknown) => encoder.encode('data: [TURN_COMPLETE]\n\n')),
    encodeChainCompleteEvent: jest.fn((_enc: unknown, _data: unknown) =>
      encoder.encode('data: [CHAIN_COMPLETE]\n\n')
    ),
    // safeEnqueue and safeClose must be real so the stream can be consumed
    safeEnqueue: jest.fn((controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) => {
      try { controller.enqueue(chunk) } catch { /* closed */ }
    }),
    safeClose: jest.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      try { controller.close() } catch { /* already closed */ }
    }),
  }
})

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn().mockResolvedValue({ toolMessages: [], generatedImagePaths: [] }),
  saveToolMessages: jest.fn().mockResolvedValue(undefined),
  detectToolCallsInResponse: jest.fn().mockReturnValue(null),
  createToolContext: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn().mockReturnValue(''),
  checkShouldUseTextBlockTools: jest.fn().mockReturnValue(false),
  buildTextBlockSystemInstructions: jest.fn().mockReturnValue(''),
  parseTextBlocksFromResponse: jest.fn().mockReturnValue([]),
  stripTextBlockMarkersFromResponse: jest.fn((text: string) => text),
  determineTextBlockToolOptions: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn().mockReturnValue(''),
  buildForceFinalMessage: jest.fn().mockReturnValue('Please respond now.'),
}))

jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerMemoryExtraction: jest.fn().mockResolvedValue(undefined),
  triggerContextSummaryCheck: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  trackMessageTokenUsage: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn().mockResolvedValue({ cost: 0, source: 'estimate' }),
}))

jest.mock('@/lib/help-chat/system-prompt-builder', () => ({
  buildHelpChatSystemPrompt: jest.fn().mockReturnValue('You are a help assistant.'),
}))

jest.mock('@/lib/help-chat/context-resolver', () => ({
  resolveAllHelpContentForUrl: jest.fn().mockResolvedValue([]),
}))

const mockResolveAllHelpContentForUrl = resolveAllHelpContentForUrl as jest.MockedFunction<
  typeof resolveAllHelpContentForUrl
>
const mockBuildHelpChatSystemPrompt = buildHelpChatSystemPrompt as jest.MockedFunction<
  typeof buildHelpChatSystemPrompt
>

/** Drain a ReadableStream to completion and return decoded text. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) result += decoder.decode(value, { stream: true })
  }
  return result
}

const createMockRepos = () => ({
  chats: {
    findById: jest.fn(),
    getMessages: jest.fn().mockResolvedValue([]),
    addMessage: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  },
  characters: {
    findById: jest.fn(),
  },
  connections: {
    findById: jest.fn(),
    findApiKeyById: jest.fn().mockResolvedValue({ id: 'key-1', key_value: 'sk-test' }),
  },
  users: {
    findById: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Tester' }),
  },
  chatSettings: {
    findByUserId: jest.fn().mockResolvedValue({
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
    }),
  },
})

/** A valid help chat record */
const makeHelpChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'help',
  helpPageUrl: '/salon',
  messageCount: 5,
  participants: [
    {
      id: 'p1',
      characterId: 'char-1',
      controlledBy: 'llm',
      isActive: true,
      status: 'active',
      displayOrder: 0,
      connectionProfileId: 'profile-1',
    },
  ],
  ...overrides,
})

const baseConnectionProfile = {
  id: 'profile-1',
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
  apiKeyId: 'key-1',
}

const baseCharacter = {
  id: 'char-1',
  name: 'Harriet',
  description: 'A helpful guide',
  pronouns: 'she/her',
  scenario: '',
}

describe('handleHelpChatMessage', () => {
  let repos: ReturnType<typeof createMockRepos>

  beforeEach(() => {
    jest.clearAllMocks()
    repos = createMockRepos()

    repos.chats.findById.mockResolvedValue(makeHelpChat())
    repos.characters.findById.mockResolvedValue(baseCharacter)
    repos.connections.findById.mockResolvedValue(baseConnectionProfile)
  })

  // ─── 1: Returns a ReadableStream ─────────────────────────────────────────────

  it('returns a ReadableStream', async () => {
    const result = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Hello',
    })

    expect(result).toBeInstanceOf(ReadableStream)
    // Drain to avoid unhandled stream
    await drainStream(result)
  })

  // ─── 2: Chat not found → stream contains error event ─────────────────────────

  it('returns a stream with an error when the chat is not found', async () => {
    repos.chats.findById.mockResolvedValue(null)

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Hello',
    })

    expect(stream).toBeInstanceOf(ReadableStream)
    const content = await drainStream(stream)
    // The error event should be encoded in the stream output
    expect(content).toContain('error')
  })

  // ─── 3: Non-help chat → stream contains error event ──────────────────────────

  it('returns a stream with an error when the chat is not a help chat', async () => {
    repos.chats.findById.mockResolvedValue(makeHelpChat({ chatType: 'salon' }))

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Hello',
    })

    expect(stream).toBeInstanceOf(ReadableStream)
    const content = await drainStream(stream)
    expect(content).toContain('error')
  })

  // ─── 4: Saves user message before processing ─────────────────────────────────

  it('saves the user message to the chat before processing the response', async () => {
    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'What is the Salon?',
    })

    await drainStream(stream)

    expect(repos.chats.addMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        role: 'USER',
        content: 'What is the Salon?',
        type: 'message',
      })
    )
  })

  // ─── 5: Calls resolveAllHelpContentForUrl with chat.helpPageUrl ───────────────

  it('calls resolveAllHelpContentForUrl using the helpPageUrl stored on the chat record', async () => {
    repos.chats.findById.mockResolvedValue(makeHelpChat({ helpPageUrl: '/aurora' }))

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Tell me about Aurora',
    })

    await drainStream(stream)

    expect(mockResolveAllHelpContentForUrl).toHaveBeenCalledWith('/aurora')
  })

  // ─── 6: Uses "/" as fallback when helpPageUrl is absent ───────────────────────

  it('falls back to "/" when the chat record has no helpPageUrl', async () => {
    repos.chats.findById.mockResolvedValue(makeHelpChat({ helpPageUrl: undefined }))

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Hello',
    })

    await drainStream(stream)

    expect(mockResolveAllHelpContentForUrl).toHaveBeenCalledWith('/')
  })

  // ─── 7: Passes help context to buildHelpChatSystemPrompt ─────────────────────

  it('passes resolved help context as pageContext to buildHelpChatSystemPrompt', async () => {
    const mockContext = { title: 'The Salon', content: 'Chat interface docs', url: '/salon' }
    mockResolveAllHelpContentForUrl.mockResolvedValue([mockContext] as any)

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'How do I use the Salon?',
    })

    await drainStream(stream)

    expect(mockBuildHelpChatSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContext: mockContext,
        character: expect.objectContaining({ id: 'char-1' }),
      })
    )
  })

  // ─── 8: Returns stream with error for wrong userId ────────────────────────────

  it('returns a stream with an error when the chat belongs to a different user', async () => {
    repos.chats.findById.mockResolvedValue(makeHelpChat({ userId: 'other-user' }))

    const stream = await handleHelpChatMessage(repos as any, 'chat-1', 'user-1', {
      content: 'Hello',
    })

    expect(stream).toBeInstanceOf(ReadableStream)
    const content = await drainStream(stream)
    expect(content).toContain('error')
  })
})
