import { describe, it, expect, jest, beforeEach } from '@jest/globals'

type ChunkLike = {
  content?: string
  done?: boolean
  usage?: unknown
  cacheUsage?: unknown
  attachmentResults?: unknown
  rawResponse?: unknown
  thoughtSignature?: string
}

// --- streamMessage controllable generator -------------------------------------
let nextStreamMessageScripts: ChunkLike[][] = []
let nextStreamMessageBehaviours: Array<'happy' | 'throw'> = []
let nextStreamMessageErrors: Array<Error> = []
const streamMessageCalls: Array<Record<string, unknown>> = []

async function* mockStreamMessageImpl(opts: Record<string, unknown>): AsyncGenerator<ChunkLike> {
  const callIndex = streamMessageCalls.length
  streamMessageCalls.push(opts)
  const chunks = nextStreamMessageScripts[callIndex] ?? []
  const behaviour = nextStreamMessageBehaviours[callIndex] ?? 'happy'
  for (const chunk of chunks) {
    yield chunk
  }
  if (behaviour === 'throw') {
    throw nextStreamMessageErrors[callIndex] ?? new Error(`stream-${callIndex}-broke`)
  }
}

const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
  return true
})
const mockEncodeContentChunk = jest.fn((_encoder: TextEncoder, text: string) => ({ contentChunk: text }))
const mockEncodeStatusEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => ({ status: payload }))

const mockSaveAssistantMessage = jest.fn<() => Promise<string>>().mockResolvedValue('preserved-id-1')
const mockAttemptRequestLimitRecovery = jest.fn<() => Promise<{ success: boolean; messageId?: string; isStaticFallback: boolean }>>()
const mockAttemptHardErrorFailover = jest.fn<() => Promise<{ recovered: boolean; attempts: unknown[]; tierPickWasOffered: boolean }>>()
const mockIsToolUnsupportedError = jest.fn<(e: unknown) => boolean>(() => false)
const mockIsRecoverableRequestError = jest.fn<(e: unknown) => boolean>(() => false)

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (opts: Record<string, unknown>) => mockStreamMessageImpl(opts),
  encodeContentChunk: (encoder: TextEncoder, text: string) => mockEncodeContentChunk(encoder, text),
  encodeStatusEvent: (encoder: TextEncoder, payload: unknown) => mockEncodeStatusEvent(encoder, payload),
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => mockSafeEnqueue(controller, chunk),
  applyReasoningChunk: jest.fn(),
  flushReasoningSegment: jest.fn(),
  nextTurnSeq: (s: { nextTurnSeq?: number }) => {
    const n = s.nextTurnSeq ?? 0
    s.nextTurnSeq = n + 1
    return n
  },
}))

jest.mock('@/lib/services/chat-message/message-finalizer.service', () => ({
  saveAssistantMessage: (...args: any[]) => mockSaveAssistantMessage(...(args as [])),
}))

jest.mock('@/lib/services/chat-message/recovery.service', () => ({
  attemptRequestLimitRecovery: (...args: any[]) => mockAttemptRequestLimitRecovery(...(args as [])),
}))

jest.mock('@/lib/llm/errors', () => ({
  isToolUnsupportedError: (e: unknown) => mockIsToolUnsupportedError(e),
  isRecoverableRequestError: (e: unknown) => mockIsRecoverableRequestError(e),
}))

// The fallback chain is a sibling service with its own suite; isolate it here
// the way `recovery.service` already is, so these cases keep testing what
// `runPrimaryStream` does with an error rather than what the chain does.
// `attemptHardErrorFailover` returning `recovered: false` with no attempts is
// exactly what it returns for a failure that is not fallback-eligible.
jest.mock('@/lib/services/chat-message/provider-failover.service', () => ({
  attemptHardErrorFailover: (...args: any[]) => mockAttemptHardErrorFailover(...(args as [])),
}))

jest.mock('@/lib/llm/message-formatter', () => ({
  // Pass through unchanged — the closure does final newline trimming itself.
  normalizeContentBlockFormat: (s: string) => s,
  stripCharacterNamePrefix: (s: string, _name: string, _aliases: unknown) => s,
}))

const {
  runPrimaryStream,
  makePreservePartialOnError,
  findPreviousResponseId,
} = require('@/lib/services/chat-message/primary-stream.service') as typeof import('@/lib/services/chat-message/primary-stream.service')

function makeStreaming(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fullResponse: '',
    effectiveProfile: { provider: 'ANTHROPIC', modelName: 'claude', baseUrl: null } as any,
    effectiveApiKey: 'k',
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: null,
    thoughtSignature: undefined,
    hasStartedStreaming: false,
    ...overrides,
  } as any
}

function makeBaseOpts(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    repos: {} as any,
    chatId: 'chat-1',
    userId: 'user-1',
    chat: { isPaused: false } as any,
    character: { id: 'char-1', name: 'Alice', aliases: [] } as any,
    characterParticipant: { id: 'cp-1' } as any,
    userParticipantId: 'up-1',
    isMultiCharacter: false,
    formattedMessages: [{ role: 'user', content: 'Hi' }] as any,
    modelParams: { temperature: 0.7 },
    actualTools: [{ name: 'doc_open_file' }],
    useNativeWebSearch: false,
    previousResponseId: undefined,
    preGeneratedAssistantMessageId: 'pre-msg-1',
    attachedFiles: [],
    originalMessage: 'Hi',
    connectionProfile: { provider: 'ANTHROPIC', modelName: 'claude' } as any,
    streaming: makeStreaming(),
    controller: { enqueue: jest.fn() } as any,
    encoder: new TextEncoder(),
    preservePartialOnError: jest.fn(async () => undefined),
    ...overrides,
  }
}

describe('primary-stream.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    streamMessageCalls.length = 0
    nextStreamMessageScripts = []
    nextStreamMessageBehaviours = []
    nextStreamMessageErrors = []
    mockIsToolUnsupportedError.mockReturnValue(false)
    mockIsRecoverableRequestError.mockReturnValue(false)
    // Default: no understudy takes the turn, so the error propagates the way
    // it did before fallback chains existed. Cases that exercise the chain
    // override this.
    mockAttemptHardErrorFailover.mockResolvedValue({
      recovered: false,
      attempts: [],
      tierPickWasOffered: false,
    })
  })

  describe('makePreservePartialOnError', () => {
    it('no-ops when nothing has streamed yet', async () => {
      const streaming = makeStreaming({ hasStartedStreaming: false, fullResponse: '' })
      const preserve = makePreservePartialOnError({
        repos: {} as any,
        chatId: 'c',
        character: { id: 'ch', name: 'Alice', aliases: [] } as any,
        characterParticipant: { id: 'cp' },
        streaming,
        preGeneratedAssistantMessageId: 'pre',
      })
      await preserve(new Error('boom'))
      expect(mockSaveAssistantMessage).not.toHaveBeenCalled()
    })

    it('preserves once and is idempotent on subsequent calls', async () => {
      const streaming = makeStreaming({
        hasStartedStreaming: true,
        fullResponse: 'partial response here',
        effectiveProfile: { provider: 'ANTHROPIC', modelName: 'claude' } as any,
        usage: { promptTokens: 3 },
      })
      const preserve = makePreservePartialOnError({
        repos: { tag: 'repos' } as any,
        chatId: 'c',
        character: { id: 'ch', name: 'Alice', aliases: [] } as any,
        characterParticipant: { id: 'cp' },
        streaming,
        preGeneratedAssistantMessageId: 'pre',
      })

      await preserve(new Error('boom'))
      await preserve(new Error('boom-again'))

      expect(mockSaveAssistantMessage).toHaveBeenCalledTimes(1)
      const args = mockSaveAssistantMessage.mock.calls[0]
      const preservedContent = args[4] as string
      expect(preservedContent).toContain('partial response here')
      expect(preservedContent).toContain('OOC: stream ended abruptly (boom)')
    })

    it('swallows persistError so the original error still propagates from the caller', async () => {
      mockSaveAssistantMessage.mockRejectedValueOnce(new Error('db-down'))
      const streaming = makeStreaming({
        hasStartedStreaming: true,
        fullResponse: 'something',
      })
      const preserve = makePreservePartialOnError({
        repos: {} as any,
        chatId: 'c',
        character: { id: 'ch', name: 'Alice', aliases: [] } as any,
        characterParticipant: { id: 'cp' },
        streaming,
        preGeneratedAssistantMessageId: 'pre',
      })

      await expect(preserve(new Error('boom'))).resolves.toBeUndefined()
    })
  })

  describe('findPreviousResponseId', () => {
    it('returns undefined for non-OPENAI providers', () => {
      expect(findPreviousResponseId('ANTHROPIC', [])).toBeUndefined()
      expect(findPreviousResponseId('GOOGLE', [
        { type: 'message', role: 'ASSISTANT', rawResponse: { id: 'resp_x' } } as any,
      ])).toBeUndefined()
    })

    it('returns the most recent resp_-prefixed assistant id for OPENAI', () => {
      const result = findPreviousResponseId('OPENAI', [
        { type: 'message', role: 'USER', content: 'hi' } as any,
        { type: 'message', role: 'ASSISTANT', rawResponse: { id: 'resp_a' } } as any,
        { type: 'message', role: 'USER', content: 'hi again' } as any,
        { type: 'message', role: 'ASSISTANT', rawResponse: { id: 'resp_b' } } as any,
      ])
      expect(result).toBe('resp_b')
    })

    it('ignores assistant messages whose rawResponse.id is not resp_-prefixed', () => {
      const result = findPreviousResponseId('OPENAI', [
        { type: 'message', role: 'ASSISTANT', rawResponse: { id: 'chatcmpl_x' } } as any,
      ])
      expect(result).toBeUndefined()
    })
  })

  describe('runPrimaryStream — happy path', () => {
    it('streams content, flips hasStartedStreaming, updates streaming state, returns no earlyReturn', async () => {
      nextStreamMessageScripts = [[
        { content: 'Hel' },
        { content: 'lo!' },
        { done: true, usage: { promptTokens: 5 }, cacheUsage: { cacheReadInputTokens: 1 }, rawResponse: { id: 'r1' }, thoughtSignature: 'sig' },
      ]]
      nextStreamMessageBehaviours = ['happy']

      const opts = makeBaseOpts()
      const result = await runPrimaryStream(opts as any)

      expect(result.earlyReturn).toBeUndefined()
      expect(opts.streaming.fullResponse).toBe('Hello!')
      expect(opts.streaming.hasStartedStreaming).toBe(true)
      expect(opts.streaming.usage).toEqual({ promptTokens: 5 })
      expect(opts.streaming.cacheUsage).toEqual({ cacheReadInputTokens: 1 })
      expect(opts.streaming.rawResponse).toEqual({ id: 'r1' })
      expect(opts.streaming.thoughtSignature).toBe('sig')
      expect(opts.preservePartialOnError).not.toHaveBeenCalled()

      const sent = streamMessageCalls[0]!
      expect(sent.tools).toEqual([{ name: 'doc_open_file' }])
      expect(sent.previousResponseId).toBeUndefined()
      expect(sent.userId).toBe('user-1')
      expect(sent.messageId).toBe('pre-msg-1')
      expect(sent.characterId).toBe('char-1')
    })

    it('forwards previousResponseId when provided', async () => {
      nextStreamMessageScripts = [[{ done: true, usage: null, cacheUsage: null }]]
      nextStreamMessageBehaviours = ['happy']
      const opts = makeBaseOpts({ previousResponseId: 'resp_prev' })
      await runPrimaryStream(opts as any)
      expect(streamMessageCalls[0]?.previousResponseId).toBe('resp_prev')
    })
  })

  describe('runPrimaryStream — tool-unsupported retry', () => {
    it('retries with empty tools and succeeds', async () => {
      mockIsToolUnsupportedError.mockReturnValue(true)
      nextStreamMessageScripts = [
        [], // first call yields nothing then throws
        [
          { content: 'retried-fine' },
          { done: true, usage: { promptTokens: 7 }, cacheUsage: null, rawResponse: { id: 'r2' } },
        ],
      ]
      nextStreamMessageBehaviours = ['throw', 'happy']
      nextStreamMessageErrors = [new Error('TOOLS_UNSUPPORTED')]

      const opts = makeBaseOpts()
      const result = await runPrimaryStream(opts as any)

      expect(result.earlyReturn).toBeUndefined()
      expect(streamMessageCalls).toHaveLength(2)
      expect(streamMessageCalls[1]?.tools).toEqual([])
      expect(opts.streaming.fullResponse).toBe('retried-fine')
      expect(opts.streaming.usage).toEqual({ promptTokens: 7 })
      expect(opts.preservePartialOnError).not.toHaveBeenCalled()
    })

    it('preserves partial + re-throws when the retry also fails', async () => {
      mockIsToolUnsupportedError.mockReturnValue(true)
      nextStreamMessageScripts = [
        [{ content: 'partial-' }],
        [],
      ]
      nextStreamMessageBehaviours = ['throw', 'throw']
      nextStreamMessageErrors = [new Error('first-fail'), new Error('retry-fail')]

      const opts = makeBaseOpts()
      await expect(runPrimaryStream(opts as any)).rejects.toThrow('retry-fail')
      expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
      expect((opts.preservePartialOnError as jest.Mock).mock.calls[0]?.[0]).toBeInstanceOf(Error)
    })

    it('does not retry when actualTools is empty (falls through to preserve)', async () => {
      mockIsToolUnsupportedError.mockReturnValue(true)
      nextStreamMessageScripts = [[]]
      nextStreamMessageBehaviours = ['throw']
      nextStreamMessageErrors = [new Error('TOOLS_UNSUPPORTED')]

      const opts = makeBaseOpts({ actualTools: [] })
      await expect(runPrimaryStream(opts as any)).rejects.toThrow('TOOLS_UNSUPPORTED')
      expect(streamMessageCalls).toHaveLength(1)
      expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
    })
  })

  describe('runPrimaryStream — recoverable request error', () => {
    it('returns earlyReturn when recovery succeeds', async () => {
      mockIsRecoverableRequestError.mockReturnValue(true)
      mockAttemptRequestLimitRecovery.mockResolvedValueOnce({
        success: true,
        messageId: 'recovered-msg-id',
        isStaticFallback: false,
      })
      nextStreamMessageScripts = [[]]
      nextStreamMessageBehaviours = ['throw']
      nextStreamMessageErrors = [new Error('CONTEXT_TOO_LONG')]

      const opts = makeBaseOpts({
        isMultiCharacter: true,
        chat: { isPaused: true },
        userParticipantId: 'up-special',
      })
      const result = await runPrimaryStream(opts as any)

      expect(result.earlyReturn).toEqual({
        isMultiCharacter: true,
        hasContent: true,
        messageId: 'recovered-msg-id',
        userParticipantId: 'up-special',
        isPaused: true,
      })
      expect(opts.preservePartialOnError).not.toHaveBeenCalled()
    })

    it('re-throws + preserves when recovery fails', async () => {
      mockIsRecoverableRequestError.mockReturnValue(true)
      mockAttemptRequestLimitRecovery.mockResolvedValueOnce({
        success: false,
        isStaticFallback: false,
      })
      nextStreamMessageScripts = [[]]
      nextStreamMessageBehaviours = ['throw']
      nextStreamMessageErrors = [new Error('CONTEXT_TOO_LONG')]

      const opts = makeBaseOpts()
      await expect(runPrimaryStream(opts as any)).rejects.toThrow('CONTEXT_TOO_LONG')
      expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
    })
  })

  describe('runPrimaryStream — generic error', () => {
    it('preserves + re-throws for non-tool-unsupported, non-recoverable errors', async () => {
      nextStreamMessageScripts = [[{ content: 'mid-' }]]
      nextStreamMessageBehaviours = ['throw']
      nextStreamMessageErrors = [new Error('network-down')]

      const opts = makeBaseOpts()
      await expect(runPrimaryStream(opts as any)).rejects.toThrow('network-down')
      expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
      expect(opts.streaming.fullResponse).toBe('mid-')
    })
  })
})
