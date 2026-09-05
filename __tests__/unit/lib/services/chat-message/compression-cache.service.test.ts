/**
 * Unit Tests for Compression Cache Service
 * Tests lib/services/chat-message/compression-cache.service.ts
 * v2.7-dev: Async Pre-Compression Feature
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// Define the result type inline to avoid module resolution issues in IDE
interface ContextCompressionResult {
  compressionApplied: boolean
  compressedHistory?: string
  compressedSystemPrompt?: string
  compressionDetails?: {
    originalMessageCount: number
    compressedMessageCount: number
    windowMessageCount: number
    originalHistoryTokens?: number
    compressedHistoryTokens?: number
    originalSystemPromptTokens?: number
    compressedSystemPromptTokens?: number
    totalSavings: number
  }
  warnings: string[]
}

// Define the cached compression response type
interface CachedCompressionResponse {
  result: ContextCompressionResult
  cachedMessageCount: number
  isFallback: boolean
}

// Define mock at module level with explicit typing
const mockApplyContextCompression = jest.fn<
  (messages: unknown[], systemPrompt: string, options: unknown) => Promise<ContextCompressionResult>
>()

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/chat/context/compression', () => ({
  __esModule: true,
  applyContextCompression: (messages: unknown[], systemPrompt: string, options: unknown) => 
    mockApplyContextCompression(messages, systemPrompt, options),
}))

// Define AsyncCompressionOptions type inline
interface AsyncCompressionOptions {
  chatId: string
  participantId?: string
  messages: Array<{ role: string; content: string }>
  systemPrompt: string
  compressionOptions: {
    enabled: boolean
    windowSize: number
    compressionTargetTokens: number
    systemPromptTargetTokens: number
    selection: { strategy: string; fallbackToLocal: boolean }
    userId: string
    characterName: string
    userName: string
  }
}

// Import after mocks using require
const {
  triggerAsyncCompression,
  getCachedCompression,
  invalidateCompressionCache,
  clearCompressionCache,
  getCompressionCacheStats,
  withPersistLock,
} = require('@/lib/services/chat-message/compression-cache.service') as {
  triggerAsyncCompression: (options: AsyncCompressionOptions) => void
  getCachedCompression: (chatId: string, messageCount: number, participantId?: string, currentSystemPromptHash?: string) => Promise<CachedCompressionResponse | undefined>
  invalidateCompressionCache: (chatId: string, participantId?: string) => void
  clearCompressionCache: () => void
  getCompressionCacheStats: () => {
    size: number
    entries: Array<{
      cacheKey: string
      messageCount: number
      hasResult: boolean
      hasPromise: boolean
      ageMs: number
    }>
  }
  withPersistLock: <T>(chatId: string, fn: () => Promise<T>) => Promise<T>
}

// Test fixtures
const makeAsyncOptions = (overrides: Partial<AsyncCompressionOptions> = {}): AsyncCompressionOptions => ({
  chatId: 'chat-123',
  messages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
    { role: 'assistant', content: 'I am doing well!' },
    { role: 'user', content: 'Great to hear' },
    { role: 'assistant', content: 'Thanks!' },
  ],
  systemPrompt: 'You are a helpful assistant.',
  compressionOptions: {
    enabled: true,
    windowSize: 2,
    compressionTargetTokens: 2000,
    systemPromptTargetTokens: 1000,
    selection: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
    userId: 'user-123',
    characterName: 'Assistant',
    userName: 'User',
  },
  ...overrides,
})

const makeCompressionResult = (overrides: Partial<ContextCompressionResult> = {}): ContextCompressionResult => ({
  compressionApplied: true,
  compressedHistory: 'Compressed history content.',
  compressedSystemPrompt: 'Compressed system prompt.',
  compressionDetails: {
    originalMessageCount: 6,
    compressedMessageCount: 4,
    windowMessageCount: 2,
    originalHistoryTokens: 500,
    compressedHistoryTokens: 50,
    originalSystemPromptTokens: 100,
    compressedSystemPromptTokens: 20,
    totalSavings: 530,
  },
  warnings: [],
  ...overrides,
})

describe('Compression Cache Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCompressionCache()
  })

  afterEach(() => {
    clearCompressionCache()
  })

  describe('triggerAsyncCompression', () => {
    it('skips compression when not enough messages', () => {
      const options = makeAsyncOptions({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        compressionOptions: {
          ...makeAsyncOptions().compressionOptions,
          windowSize: 5, // Larger than message count
        },
      })

      triggerAsyncCompression(options)

      expect(mockApplyContextCompression).not.toHaveBeenCalled()
      expect(getCompressionCacheStats().size).toBe(0)
    })

    it('triggers compression when messages exceed window size', () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      expect(mockApplyContextCompression).toHaveBeenCalledWith(
        options.messages,
        options.systemPrompt,
        // Pre-computation runs after the turn is already delivered, so it gets
        // the generous budget — the tight one belongs to the inline call the
        // operator is waiting on (bug 107).
        { ...options.compressionOptions, latency: 'background' }
      )
      expect(getCompressionCacheStats().size).toBe(1)
    })

    it('does not re-trigger compression if valid cache entry exists', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()

      // First trigger
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Reset mock
      mockApplyContextCompression.mockClear()

      // Second trigger with same options
      triggerAsyncCompression(options)

      // Should not trigger again because cache is valid
      expect(mockApplyContextCompression).not.toHaveBeenCalled()
    })

    it('re-triggers compression when windowSize or more new messages accumulate', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      // First trigger with 6 messages, windowSize=2
      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Reset mock
      mockApplyContextCompression.mockClear()
      mockApplyContextCompression.mockResolvedValue(makeCompressionResult({
        compressionDetails: {
          originalMessageCount: 8,
          compressedMessageCount: 6,
          windowMessageCount: 2,
          totalSavings: 800,
        },
      }))

      // Trigger again with 2 more messages (equals windowSize=2) — should re-compress
      const updatedOptions = makeAsyncOptions({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
          { role: 'assistant', content: 'I am doing well!' },
          { role: 'user', content: 'Great to hear' },
          { role: 'assistant', content: 'Thanks!' },
          { role: 'user', content: 'New message 1' },
          { role: 'assistant', content: 'New response 1' },
        ],
      })
      triggerAsyncCompression(updatedOptions)

      // Should have triggered re-compression because messagesSinceCache (2) >= windowSize (2)
      expect(mockApplyContextCompression).toHaveBeenCalled()
    })

    it('does not re-trigger when fewer than windowSize new messages', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      // First trigger with 6 messages, windowSize=2
      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Reset mock
      mockApplyContextCompression.mockClear()

      // Trigger again with only 1 more message (less than windowSize=2) — should NOT re-compress
      const updatedOptions = makeAsyncOptions({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
          { role: 'assistant', content: 'I am doing well!' },
          { role: 'user', content: 'Great to hear' },
          { role: 'assistant', content: 'Thanks!' },
          { role: 'user', content: 'New message' },
        ],
      })
      triggerAsyncCompression(updatedOptions)

      expect(mockApplyContextCompression).not.toHaveBeenCalled()
    })

    it('stores cache entry with promise while in-flight', () => {
      // Create a promise that we control
      let resolveCompression: (result: ContextCompressionResult) => void
      const compressionPromise = new Promise<ContextCompressionResult>(resolve => {
        resolveCompression = resolve
      })
      mockApplyContextCompression.mockReturnValue(compressionPromise)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasPromise).toBe(true)
      expect(stats.entries[0].hasResult).toBe(false)

      // Resolve to clean up
      resolveCompression!(makeCompressionResult())
    })

    it('updates cache entry with result when compression completes', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for the async operation to complete
      await new Promise(resolve => setTimeout(resolve, 10))

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasResult).toBe(true)
      expect(stats.entries[0].hasPromise).toBe(false)
    })

    it('stores error result when compression fails', async () => {
      mockApplyContextCompression.mockRejectedValue(new Error('Compression failed'))

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for the async operation to complete (including error handling)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Cache entry should still exist with a "not applied" result
      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasResult).toBe(true)

      // Verify the result indicates failure
      const response = await getCachedCompression('chat-123', 6)
      expect(response).toBeDefined()
      expect(response?.result.compressionApplied).toBe(false)
      expect(response?.result.warnings?.[0]).toContain('Compression failed')
    })
  })

  describe('getCachedCompression', () => {
    it('returns undefined when no cache entry exists', async () => {
      const result = await getCachedCompression('nonexistent-chat', 10)
      expect(result).toBeUndefined()
    })

    it('returns cached result when available', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      const response = await getCachedCompression('chat-123', 6)
      expect(response).toBeDefined()
      expect(response?.result.compressionApplied).toBe(true)
      expect(response?.result.compressedHistory).toBe('Compressed history content.')
      expect(response?.cachedMessageCount).toBe(6)
      expect(response?.isFallback).toBe(false)
    })

    it('returns undefined when compression is in-flight (does not wait)', async () => {
      // This test verifies the new behavior: we DON'T wait for in-flight compression
      // Instead, we return undefined immediately (or fallback to database cache)
      let resolveCompression: (result: ContextCompressionResult) => void
      const compressionPromise = new Promise<ContextCompressionResult>(resolve => {
        resolveCompression = resolve
      })
      mockApplyContextCompression.mockReturnValue(compressionPromise)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Getting cached result should return undefined immediately (no waiting)
      // since compression is still in-flight and there's no database fallback
      const response = await getCachedCompression('chat-123', 6)
      expect(response).toBeUndefined()

      // Clean up: resolve the compression so it doesn't hang
      resolveCompression!(makeCompressionResult())
    })

    it('returns undefined when cache is too stale (>50 messages behind)', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Request with message count more than 50 ahead of cached (6 + 51 = 57)
      const result = await getCachedCompression('chat-123', 57)
      expect(result).toBeUndefined()
    })

    it('accepts cache when message count is up to 50 messages ahead', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      // Trigger with 6 messages
      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should be valid for count 6 (exact match)
      const response1 = await getCachedCompression('chat-123', 6)
      expect(response1).toBeDefined()
      expect(response1?.cachedMessageCount).toBe(6)

      // Should be valid for count 56 (50 messages ahead, at the limit)
      const response2 = await getCachedCompression('chat-123', 56)
      expect(response2).toBeDefined()
      expect(response2?.cachedMessageCount).toBe(6)

      // Should be valid for count 20 (14 messages ahead, well within tolerance)
      const response3 = await getCachedCompression('chat-123', 20)
      expect(response3).toBeDefined()
      expect(response3?.cachedMessageCount).toBe(6)
    })

    it('returns undefined when compression is in-flight and failing (does not wait for failure)', async () => {
      // Create a slow-failing promise to ensure we're testing in-flight behavior
      let rejectCompression: (error: Error) => void
      const compressionPromise = new Promise<ContextCompressionResult>((_, reject) => {
        rejectCompression = reject
      })
      mockApplyContextCompression.mockReturnValue(compressionPromise)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Getting cached result while in-flight should return undefined (no waiting)
      const response = await getCachedCompression('chat-123', 6)
      expect(response).toBeUndefined()

      // Clean up: reject the compression
      rejectCompression!(new Error('API Error'))

      // Wait for the error to be handled
      await new Promise(resolve => setTimeout(resolve, 10))

      // Now after the failure is recorded, we should get the failure result
      const responseAfterFailure = await getCachedCompression('chat-123', 6)
      expect(responseAfterFailure).toBeDefined()
      expect(responseAfterFailure?.result.compressionApplied).toBe(false)
      expect(responseAfterFailure?.result.warnings?.[0]).toContain('API Error')
    })
  })

  describe('invalidateCompressionCache', () => {
    it('removes cache entry for specified chat', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-2' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(getCompressionCacheStats().size).toBe(2)

      invalidateCompressionCache('chat-1')

      expect(getCompressionCacheStats().size).toBe(1)
      expect(getCompressionCacheStats().entries[0].cacheKey).toBe('chat-2')
    })

    it('does nothing when chat not in cache', () => {
      expect(() => invalidateCompressionCache('nonexistent')).not.toThrow()
      expect(getCompressionCacheStats().size).toBe(0)
    })
  })

  describe('clearCompressionCache', () => {
    it('removes all cache entries', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-2' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-3' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(getCompressionCacheStats().size).toBe(3)

      clearCompressionCache()

      expect(getCompressionCacheStats().size).toBe(0)
    })
  })

  describe('getCompressionCacheStats', () => {
    it('returns empty stats when cache is empty', () => {
      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.entries).toHaveLength(0)
    })

    it('returns accurate stats for cache entries', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].cacheKey).toBe('chat-1')
      expect(stats.entries[0].messageCount).toBe(6)
      expect(stats.entries[0].hasResult).toBe(true)
      expect(stats.entries[0].hasPromise).toBe(false)
      expect(stats.entries[0].ageMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('withPersistLock', () => {
    /**
     * Regression test: two concurrent finalizers (e.g. Amy and Ariadne) used to
     * race on `chat.compressionCache`. Each read the same snapshot, merged in
     * their own participantId key, and wrote the whole field back. Whichever
     * write landed second silently erased the other participant's entry.
     *
     * The simulated chat row below is the load-modify-save target; without
     * `withPersistLock` the test's "AmyEntry" or "AriadneEntry" key would be
     * missing after both run concurrently.
     */
    it('serializes load-modify-save on the same chatId so concurrent writes preserve all keys', async () => {
      // Simulated database row holding the compressionCache JSON object.
      const chatRow: { compressionCache: Record<string, string> } = { compressionCache: {} }

      // Each "transaction" reads the current cache, splices in its own entry,
      // and writes it back, with awaits in between to simulate I/O latency
      // and force the would-be race to materialize when unserialized.
      const writeEntry = async (participantId: string, value: string) => {
        const snapshot = { ...chatRow.compressionCache }
        await new Promise(resolve => setTimeout(resolve, 5))
        snapshot[participantId] = value
        await new Promise(resolve => setTimeout(resolve, 5))
        chatRow.compressionCache = snapshot
      }

      await Promise.all([
        withPersistLock('chat-race', () => writeEntry('amy', 'AmyEntry')),
        withPersistLock('chat-race', () => writeEntry('ariadne', 'AriadneEntry')),
      ])

      expect(chatRow.compressionCache).toEqual({
        amy: 'AmyEntry',
        ariadne: 'AriadneEntry',
      })
    })

    it('demonstrates the race exists when the lock is not used (sanity check for above)', async () => {
      // This test exists to confirm the simulated load-modify-save actually
      // races without the lock — if it didn't, the serialization test above
      // would pass trivially and prove nothing.
      const chatRow: { compressionCache: Record<string, string> } = { compressionCache: {} }

      const writeEntry = async (participantId: string, value: string) => {
        const snapshot = { ...chatRow.compressionCache }
        await new Promise(resolve => setTimeout(resolve, 5))
        snapshot[participantId] = value
        await new Promise(resolve => setTimeout(resolve, 5))
        chatRow.compressionCache = snapshot
      }

      // Same two writes, but with NO lock — one will clobber the other.
      await Promise.all([
        writeEntry('amy', 'AmyEntry'),
        writeEntry('ariadne', 'AriadneEntry'),
      ])

      const keys = Object.keys(chatRow.compressionCache)
      // Exactly one key survives — proves the race exists.
      expect(keys.length).toBe(1)
    })

    it('allows different chatIds to run concurrently (does not over-serialize)', async () => {
      // Two locks on different chatIds should overlap in time. We measure
      // wall-clock duration; if the lock incorrectly serialized across chatIds
      // we'd see ~2x the per-op latency.
      const start = Date.now()
      await Promise.all([
        withPersistLock('chat-A', () => new Promise(resolve => setTimeout(resolve, 30))),
        withPersistLock('chat-B', () => new Promise(resolve => setTimeout(resolve, 30))),
      ])
      const elapsed = Date.now() - start
      // Sequential would be ~60ms; concurrent ~30ms. Allow generous slack for
      // CI jitter but still well under the sequential floor.
      expect(elapsed).toBeLessThan(55)
    })

    it('continues processing the queue after a failing operation', async () => {
      // A throwing operation must not jam later writes on the same chatId —
      // the lock helper uses .then(fn, fn) so the next operation runs whether
      // the previous one resolved or rejected.
      let followingRan = false

      const failing = withPersistLock('chat-error', async () => {
        throw new Error('boom')
      })

      const following = withPersistLock('chat-error', async () => {
        followingRan = true
      })

      // The failing op rejects; capture it so Promise.all doesn't short-circuit.
      const failingOutcome = await failing.then(
        () => 'resolved',
        (err: Error) => `rejected:${err.message}`
      )
      await following

      expect(failingOutcome).toBe('rejected:boom')
      expect(followingRan).toBe(true)
    })

    it('returns the value resolved by the wrapped function', async () => {
      const value = await withPersistLock('chat-return', async () => 42)
      expect(value).toBe(42)
    })
  })
})
