import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

const mockGetCachedCompression = jest.fn()
const mockInvalidateCompressionCache = jest.fn()
const mockExtractMemorySearchKeywords = jest.fn()
const mockExtractVisibleConversation = jest.fn()
const mockStripToolArtifacts = jest.fn((s: string) => s)
const mockSearchMemoriesSemantic = jest.fn()
const mockResolveUncensoredCheapLLMSelection = jest.fn()

const mockSafeEnqueue = jest.fn((_controller: unknown, _chunk: unknown) => true)
const mockEncodeStatusEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => ({ status: payload }))
const mockEncodeKeepAlive = jest.fn((_encoder: TextEncoder) => ({ keepAlive: true }))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  safeEnqueue: (controller: unknown, chunk: unknown) => mockSafeEnqueue(controller, chunk),
  encodeStatusEvent: (encoder: TextEncoder, payload: unknown) => mockEncodeStatusEvent(encoder, payload),
  encodeKeepAlive: (encoder: TextEncoder) => mockEncodeKeepAlive(encoder),
}))

jest.mock('@/lib/services/chat-message/compression-cache.service', () => ({
  getCachedCompression: (...args: any[]) => mockGetCachedCompression(...args),
  invalidateCompressionCache: (...args: any[]) => mockInvalidateCompressionCache(...args),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractMemorySearchKeywords: (...args: any[]) => mockExtractMemorySearchKeywords(...args),
  extractVisibleConversation: (...args: any[]) => mockExtractVisibleConversation(...args),
  stripToolArtifacts: (s: string) => mockStripToolArtifacts(s),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: (...args: any[]) => mockSearchMemoriesSemantic(...args),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  resolveUncensoredCheapLLMSelection: (...args: any[]) => mockResolveUncensoredCheapLLMSelection(...args),
}))

const {
  runPreContextPreCompute,
} = require('@/lib/services/chat-message/pre-compute.service') as typeof import('@/lib/services/chat-message/pre-compute.service')

const baseChat = { id: 'chat-1', isDangerousChat: false } as any
const baseCharacter = { id: 'char-1', name: 'Alice' } as any
const baseDangerSettings = { mode: 'OFF' } as any
const baseCheapLLM = { provider: 'OPENAI', modelName: 'gpt-4.1-mini' } as any

function baseOptions(overrides: Partial<Parameters<typeof runPreContextPreCompute>[0]> = {}) {
  return {
    chatId: 'chat-1',
    userId: 'user-1',
    chat: baseChat,
    character: baseCharacter,
    characterParticipant: { id: 'p-char' },
    isMultiCharacter: false,
    isContinueMode: false,
    content: '',
    existingMessages: [],
    compressionEnabled: false,
    bypassCompression: false,
    cheapLLMSelection: null,
    dangerSettings: baseDangerSettings,
    allProfiles: [],
    controller: { enqueue: jest.fn() } as any,
    encoder: new TextEncoder(),
    ...overrides,
  }
}

describe('pre-compute.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockExtractVisibleConversation.mockReturnValue([])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('compressionTask', () => {
    it('returns the cached compression result when compression is enabled and the cache hits', async () => {
      const cached = { result: { compressionDetails: { totalSavings: 123 } }, cachedMessageCount: 4, isFallback: false }
      ;(mockGetCachedCompression as jest.Mock).mockResolvedValue(cached)
      mockExtractVisibleConversation.mockReturnValue([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }])

      const result = await runPreContextPreCompute(baseOptions({ compressionEnabled: true }))

      expect(mockGetCachedCompression).toHaveBeenCalledWith('chat-1', 2, undefined)
      expect(result.cachedCompressionResponse).toBe(cached)
    })

    it('passes the participantId to the cache lookup in multi-character chats', async () => {
      ;(mockGetCachedCompression as jest.Mock).mockResolvedValue(undefined)
      mockExtractVisibleConversation.mockReturnValue([])

      await runPreContextPreCompute(baseOptions({
        compressionEnabled: true,
        isMultiCharacter: true,
      }))

      expect(mockGetCachedCompression).toHaveBeenCalledWith('chat-1', 0, 'p-char')
    })

    it('invalidates the cache and returns undefined when bypassCompression is true', async () => {
      const result = await runPreContextPreCompute(baseOptions({
        compressionEnabled: false,
        bypassCompression: true,
      }))

      expect(mockInvalidateCompressionCache).toHaveBeenCalledWith('chat-1')
      expect(mockGetCachedCompression).not.toHaveBeenCalled()
      expect(result.cachedCompressionResponse).toBeUndefined()
    })

    it('returns undefined and skips the cache call when compression is disabled', async () => {
      const result = await runPreContextPreCompute(baseOptions({
        compressionEnabled: false,
        bypassCompression: false,
      }))

      expect(mockGetCachedCompression).not.toHaveBeenCalled()
      expect(mockInvalidateCompressionCache).not.toHaveBeenCalled()
      expect(result.cachedCompressionResponse).toBeUndefined()
    })
  })

  describe('proactiveRecallTask', () => {
    it('returns undefined when no cheap LLM is selected', async () => {
      const result = await runPreContextPreCompute(baseOptions({ cheapLLMSelection: null }))
      expect(result.preSearchedMemories).toBeUndefined()
      expect(mockExtractMemorySearchKeywords).not.toHaveBeenCalled()
    })

    it('returns undefined when the character has never spoken (no prior ASSISTANT msg from them)', async () => {
      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'USER', content: 'hi', participantId: 'p-user' } as any,
        ],
      }))
      expect(result.preSearchedMemories).toBeUndefined()
      expect(mockExtractMemorySearchKeywords).not.toHaveBeenCalled()
    })

    it('extracts keywords from messages since the character last spoke, then searches memories', async () => {
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({
        success: true,
        result: { keywords: ['ship', 'storm'], temporal: 'present', context: 'history' },
      })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockResolvedValue([
        { id: 'm1', content: 'memory 1', importance: 0.6 },
        { id: 'm2', content: 'memory 2', importance: 0.5 },
      ])

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        content: 'a fresh user line',
        presentAboutCharacterIds: ['char-1', 'char-2'],
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past line', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'a new question', participantId: 'p-user' } as any,
        ],
      }))

      expect(mockExtractMemorySearchKeywords).toHaveBeenCalledTimes(1)
      const callArgs = mockExtractMemorySearchKeywords.mock.calls[0] as unknown[]
      const sentMessages = callArgs[0] as Array<{ role: string; content: string }>
      expect(sentMessages.map(m => m.content)).toEqual(['a new question', 'a fresh user line'])

      // The distilled keywords drive the embedding query, and the turn-level
      // guess + present-character set + scope policy ride along in recallContext.
      expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
        'char-1',
        'ship storm',
        expect.objectContaining({
          userId: 'user-1',
          recallContext: expect.objectContaining({
            scopePolicy: 'down-weight',
            turnContext: 'history',
            turnTemporal: 'present',
            presentAboutCharacterIds: ['char-1', 'char-2'],
            expandRelated: false,
          }),
        }),
      )
      expect(result.preSearchedMemories).toHaveLength(2)
    })

    it('forwards a resolved time window even when the turn is not retrospective', async () => {
      // The deterministic day-reference resolver can hand back a window on a
      // turn the classifier still calls non-retrospective (and vice versa).
      // The window must ride along regardless — searchMemoriesSemantic's
      // two-stage filter makes it starvation-safe — while the multi-probe
      // block stays gated on the flag.
      const timeRange = { from: '2026-07-28T05:00:00.000Z', to: '2026-07-29T02:44:00.000Z' }
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({
        success: true,
        result: {
          keywords: ['mission'],
          paraphrase: 'Charlie is asking how the mission went.',
          retrospective: false,
          timeRange,
          entities: ['Constantinople'],
        },
      })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockResolvedValue([])

      await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'the mission today?', participantId: 'p-user' } as any,
        ],
      }))

      expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
        'char-1',
        'Charlie is asking how the mission went.',
        expect.objectContaining({
          occurredWithin: timeRange,
          extraProbes: undefined,
          recallContext: expect.objectContaining({
            turnRetrospective: false,
            currentChatId: 'chat-1',
            nowMs: expect.any(Number),
          }),
        }),
      )
    })

    it('hands back the vector the memory search embedded, for reuse later in the turn', async () => {
      // The per-turn conversation-summary list rides this vector instead of
      // embedding the same sentence a second time, so it has to survive the
      // trip out of the proactive task.
      const captured = new Float32Array([0.25, 0.5, 0.25])
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({
        success: true,
        result: { keywords: ['storm'], paraphrase: 'They are talking about the storm.' },
      })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockImplementation(
        async (_characterId: string, query: string, options: any) => {
          options.captureQueryEmbedding?.({ query, embedding: captured })
          return [{ id: 'm1', content: 'memory 1' }]
        },
      )

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        content: 'and then the storm hit',
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
        ],
      }))

      expect(result.preSearchedQueryEmbedding).toEqual({
        query: 'They are talking about the storm.',
        embedding: captured,
      })
    })

    it('still reports the embedded vector when the search finds no memories', async () => {
      const captured = new Float32Array([1, 0])
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({
        success: true,
        result: { keywords: ['storm'], paraphrase: 'They are talking about the storm.' },
      })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockImplementation(
        async (_characterId: string, query: string, options: any) => {
          options.captureQueryEmbedding?.({ query, embedding: captured })
          return []
        },
      )

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        content: 'and then the storm hit',
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
        ],
      }))

      expect(result.preSearchedMemories).toBeUndefined()
      expect(result.preSearchedQueryEmbedding?.embedding).toBe(captured)
    })

    it('passes null for occurredWithin when no window was resolved', async () => {
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({
        success: true,
        result: { keywords: ['mission'], retrospective: false, timeRange: null },
      })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockResolvedValue([])

      await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'q', participantId: 'p-user' } as any,
        ],
      }))

      expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
        'char-1',
        'mission',
        expect.objectContaining({ occurredWithin: null }),
      )
    })

    it('routes through the uncensored cheap-LLM selection in dangerous chats', async () => {
      const uncensored = { provider: 'LOCAL', modelName: 'unc' } as any
      ;(mockResolveUncensoredCheapLLMSelection as jest.Mock).mockReturnValue(uncensored)
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({ success: false })

      await runPreContextPreCompute(baseOptions({
        chat: { ...baseChat, isDangerousChat: true } as any,
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'follow-up', participantId: 'p-user' } as any,
        ],
      }))

      expect(mockResolveUncensoredCheapLLMSelection).toHaveBeenCalledWith(baseCheapLLM, true, baseDangerSettings, [])
      const callArgs = mockExtractMemorySearchKeywords.mock.calls[0] as unknown[]
      expect(callArgs[2]).toBe(uncensored)
    })

    it('returns undefined when keyword extraction fails', async () => {
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({ success: false, result: null })

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'q', participantId: 'p-user' } as any,
        ],
      }))

      expect(result.preSearchedMemories).toBeUndefined()
      expect(mockSearchMemoriesSemantic).not.toHaveBeenCalled()
    })

    it('returns undefined when semantic search throws', async () => {
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({ success: true, result: { keywords: ['k'] } })
      ;(mockSearchMemoriesSemantic as jest.Mock).mockRejectedValue(new Error('search broke'))

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'q', participantId: 'p-user' } as any,
        ],
      }))

      expect(result.preSearchedMemories).toBeUndefined()
    })

    it('caps the returned memory list at 10', async () => {
      ;(mockExtractMemorySearchKeywords as jest.Mock).mockResolvedValue({ success: true, result: { keywords: ['k'] } })
      const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, content: `c${i}`, importance: 0.5 }))
      ;(mockSearchMemoriesSemantic as jest.Mock).mockResolvedValue(many)

      const result = await runPreContextPreCompute(baseOptions({
        cheapLLMSelection: baseCheapLLM,
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'past', participantId: 'p-char' } as any,
          { type: 'message', role: 'USER', content: 'q', participantId: 'p-user' } as any,
        ],
      }))

      expect(result.preSearchedMemories).toHaveLength(10)
    })
  })

  describe('keep-alive interval', () => {
    it('arms a keep-alive ping every 15s when compression is enabled and cache misses', async () => {
      ;(mockGetCachedCompression as jest.Mock).mockResolvedValue(undefined)
      mockExtractVisibleConversation.mockReturnValue([])

      const result = await runPreContextPreCompute(baseOptions({ compressionEnabled: true }))

      mockSafeEnqueue.mockClear()
      jest.advanceTimersByTime(15000)
      expect(mockSafeEnqueue).toHaveBeenCalledTimes(1)
      expect(mockEncodeKeepAlive).toHaveBeenCalled()

      result.stopKeepAlive()
      mockSafeEnqueue.mockClear()
      jest.advanceTimersByTime(30000)
      expect(mockSafeEnqueue).not.toHaveBeenCalled()
    })

    it('does NOT arm a keep-alive when compression is enabled but the cache hit', async () => {
      ;(mockGetCachedCompression as jest.Mock).mockResolvedValue({ result: {}, cachedMessageCount: 0, isFallback: false })
      mockExtractVisibleConversation.mockReturnValue([])

      const result = await runPreContextPreCompute(baseOptions({ compressionEnabled: true }))

      mockSafeEnqueue.mockClear()
      jest.advanceTimersByTime(60000)
      expect(mockEncodeKeepAlive).not.toHaveBeenCalled()

      result.stopKeepAlive() // idempotent no-op
    })

    it('does NOT arm a keep-alive when compression is disabled entirely', async () => {
      const result = await runPreContextPreCompute(baseOptions({ compressionEnabled: false }))

      jest.advanceTimersByTime(60000)
      expect(mockEncodeKeepAlive).not.toHaveBeenCalled()

      // stopKeepAlive must still be safe to call.
      expect(() => result.stopKeepAlive()).not.toThrow()
    })

    it('auto-stops pinging when safeEnqueue reports the stream is closed', async () => {
      ;(mockGetCachedCompression as jest.Mock).mockResolvedValue(undefined)
      mockExtractVisibleConversation.mockReturnValue([])
      mockSafeEnqueue.mockImplementation(() => false)

      const result = await runPreContextPreCompute(baseOptions({ compressionEnabled: true }))

      jest.advanceTimersByTime(15000)
      // After the first ping returned false, the interval clears itself.
      mockSafeEnqueue.mockImplementation(() => true)
      mockSafeEnqueue.mockClear()
      jest.advanceTimersByTime(30000)
      expect(mockSafeEnqueue).not.toHaveBeenCalled()

      result.stopKeepAlive()
    })
  })
})
