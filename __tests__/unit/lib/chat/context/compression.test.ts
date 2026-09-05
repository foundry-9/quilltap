/**
 * Unit Tests for Context Compression Module
 * Tests lib/chat/context/compression.ts
 * v2.7-dev: Sliding Window Context Compression Feature
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Define mock functions at the module level with explicit typing to avoid inference issues
const mockCompressConversationHistory = jest.fn<(...args: any[]) => any>()
// Kept for completeness — system prompt compression is disabled but the mock export still exists
const mockCompressSystemPrompt = jest.fn<(...args: any[]) => any>()

// Mock the cheap LLM tasks module
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  __esModule: true,
  compressConversationHistory: (...args: unknown[]) => mockCompressConversationHistory(...args),
  compressSystemPrompt: (...args: unknown[]) => mockCompressSystemPrompt(...args),
}))

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Import after mocks are set up
const {
  shouldApplyCompression,
  splitMessagesForCompression,
  applyContextCompression,
  buildCompressedHistoryBlock,
} = require('@/lib/chat/context/compression') as typeof import('@/lib/chat/context/compression')

import type { CompressibleMessage, ContextCompressionOptions } from '@/lib/chat/context/compression'

// Inline the settings type shape to avoid module resolution issues in jest
interface ContextCompressionSettingsLike {
  enabled: boolean
  windowSize: number
  compressionTargetTokens: number
  systemPromptTargetTokens: number
}

// Test fixtures
const makeMessage = (role: 'user' | 'assistant' | 'system', content: string): CompressibleMessage => ({
  role,
  content,
})

const makeSettings = (overrides: Partial<ContextCompressionSettingsLike> = {}): ContextCompressionSettingsLike => ({
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 2000,
  systemPromptTargetTokens: 1000,
  ...overrides,
})

const makeOptions = (overrides: Partial<ContextCompressionOptions> = {}): ContextCompressionOptions => ({
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 2000,
  systemPromptTargetTokens: 1000,
  selection: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
  userId: 'user-123',
  characterName: 'Luna',
  userName: 'John',
  ...overrides,
})

describe('Context Compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('shouldApplyCompression', () => {
    it('returns false when compression is disabled', () => {
      const settings = makeSettings({ enabled: false })
      expect(shouldApplyCompression(10, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(false)
    })

    it('returns false when bypass is requested', () => {
      const settings = makeSettings({ enabled: true })
      expect(shouldApplyCompression(10, settings as Parameters<typeof shouldApplyCompression>[1], true)).toBe(false)
    })

    it('returns false when message count is within window size', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      expect(shouldApplyCompression(5, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(false)
      expect(shouldApplyCompression(3, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(false)
    })

    it('returns true when message count exceeds window size', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      expect(shouldApplyCompression(6, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(true)
      expect(shouldApplyCompression(10, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(true)
    })

    it('handles edge case at exact window boundary', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      // At exactly windowSize, we don't compress (nothing before window)
      expect(shouldApplyCompression(5, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(false)
      // One more than windowSize, we do compress
      expect(shouldApplyCompression(6, settings as Parameters<typeof shouldApplyCompression>[1], false)).toBe(true)
    })
  })

  describe('splitMessagesForCompression', () => {
    it('returns all messages in window when count is less than window size', () => {
      const messages = [
        makeMessage('user', 'Hello'),
        makeMessage('assistant', 'Hi there!'),
      ]

      const result = splitMessagesForCompression(messages, 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(2)
      expect(result.windowMessages).toEqual(messages)
    })

    it('returns all messages in window when count equals window size', () => {
      const messages = [
        makeMessage('user', 'Message 1'),
        makeMessage('assistant', 'Response 1'),
        makeMessage('user', 'Message 2'),
        makeMessage('assistant', 'Response 2'),
        makeMessage('user', 'Message 3'),
      ]

      const result = splitMessagesForCompression(messages, 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(5)
    })

    it('correctly splits messages when count exceeds window size', () => {
      const messages = [
        makeMessage('user', 'Old message 1'),
        makeMessage('assistant', 'Old response 1'),
        makeMessage('user', 'Old message 2'),
        makeMessage('assistant', 'Old response 2'),
        makeMessage('user', 'Recent message 1'),
        makeMessage('assistant', 'Recent response 1'),
        makeMessage('user', 'Recent message 2'),
      ]

      const result = splitMessagesForCompression(messages, 3)

      expect(result.messagesToCompress).toHaveLength(4)
      expect(result.messagesToCompress[0].content).toBe('Old message 1')
      expect(result.messagesToCompress[3].content).toBe('Old response 2')

      expect(result.windowMessages).toHaveLength(3)
      expect(result.windowMessages[0].content).toBe('Recent message 1')
      expect(result.windowMessages[2].content).toBe('Recent message 2')
    })

    it('handles window size of 1', () => {
      const messages = [
        makeMessage('user', 'First'),
        makeMessage('assistant', 'Second'),
        makeMessage('user', 'Last'),
      ]

      const result = splitMessagesForCompression(messages, 1)

      expect(result.messagesToCompress).toHaveLength(2)
      expect(result.windowMessages).toHaveLength(1)
      expect(result.windowMessages[0].content).toBe('Last')
    })

    it('handles empty message array', () => {
      const result = splitMessagesForCompression([], 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(0)
    })
  })

  describe('applyContextCompression', () => {
    const systemPrompt = 'You are Luna, a friendly assistant.'
    const messages: CompressibleMessage[] = [
      makeMessage('user', 'Old message 1'),
      makeMessage('assistant', 'Old response 1'),
      makeMessage('user', 'Old message 2'),
      makeMessage('assistant', 'Old response 2'),
      makeMessage('user', 'Recent message'),
      makeMessage('assistant', 'Recent response'),
    ]

    it('returns not applied when no messages to compress', async () => {
      const options = makeOptions({ windowSize: 10 }) // Larger than message count

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toContain('No messages to compress (all within window size)')
      expect(mockCompressConversationHistory).not.toHaveBeenCalled()
      expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
    })

    it('successfully compresses history (system prompt compression is disabled)', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: true,
        result: {
          compressedText: 'User discussed old topics with assistant.',
          originalTokens: 500,
          compressedTokens: 50,
        },
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(true)
      expect(result.compressedHistory).toBe('User discussed old topics with assistant.')
      // System prompt compression is disabled — always undefined
      expect(result.compressedSystemPrompt).toBeUndefined()
      expect(result.compressionDetails).toBeDefined()
      expect(result.compressionDetails?.originalMessageCount).toBe(6)
      expect(result.compressionDetails?.compressedMessageCount).toBe(4)
      expect(result.compressionDetails?.windowMessageCount).toBe(2)
      // Savings are from history only (500-50=450); system prompt is never compressed
      expect(result.compressionDetails?.totalSavings).toBe(450)
      expect(result.warnings).toHaveLength(0)
      // System prompt compressor is never called
      expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
    })

    it('handles history compression failure gracefully', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: false,
        error: 'API rate limited',
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      // When only history compression fails and system prompt compression is disabled,
      // compressionApplied is false (nothing was compressed)
      expect(result.compressionApplied).toBe(false)
      expect(result.compressedHistory).toBeUndefined()
      expect(result.compressedSystemPrompt).toBeUndefined()
      expect(result.warnings).toContain('Failed to compress conversation history: API rate limited')
    })

    it('returns not applied when history compression fails', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: false,
        error: 'Error 1',
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('Error 1')
    })

    it('handles thrown errors during history compression', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockRejectedValue(new Error('Network error'))

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toContain('Error during conversation compression: Network error')
    })

    it('passes correct parameters to compression functions', async () => {
      const options = makeOptions({
        windowSize: 4,
        compressionTargetTokens: 3000,
        systemPromptTargetTokens: 1500,
        characterName: 'TestChar',
        userName: 'TestUser',
        userId: 'test-user-id',
      })

      mockCompressConversationHistory.mockResolvedValue({ success: false, error: 'test' })

      await applyContextCompression(messages, systemPrompt, options)

      expect(mockCompressConversationHistory).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Old message 1' }),
        ]),
        'TestChar',
        'TestUser',
        3000,
        options.selection,
        'test-user-id',
        undefined,
        undefined,
        // Latency class: unset here, so compression falls back to the
        // background budget. The inline caller passes 'interactive' (bug 107).
        undefined
      )

      // System prompt compression is disabled — should never be called
      expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
    })
  })

  describe('buildCompressedHistoryBlock', () => {
    it('returns null when there is no compressed history', () => {
      expect(buildCompressedHistoryBlock(undefined)).toBeNull()
    })

    it('returns the wrapped history block when compression has run', () => {
      const compressedHistory = 'User asked about weather, Luna responded helpfully.'
      const result = buildCompressedHistoryBlock(compressedHistory)

      expect(result).not.toBeNull()
      expect(result).toContain('## Conversation Context (Compressed Summary of Earlier Messages)')
      expect(result).toContain('following is a summary of the earlier conversation')
      expect(result).toContain('Recent messages follow this summary')
      expect(result).toContain(compressedHistory)
    })

    it('does not include the persona prompt — that lives in its own system block', () => {
      const compressedHistory = 'Summary of earlier conversation.'
      const result = buildCompressedHistoryBlock(compressedHistory)

      // The persona/system prompt must stay byte-stable across turns, so the
      // compressed-history block returns only the wrapped history. The caller
      // emits it as a separate system message after the persona prompt.
      expect(result).not.toContain('You are')
      expect(result).not.toContain('assistant who loves helping')
    })
  })
})
