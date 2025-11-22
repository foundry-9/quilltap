/**
 * Unit Tests for Anthropic Provider
 * Tests lib/llm/anthropic.ts
 * Phase 0.7: Multi-Provider Support
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { AnthropicProvider } from '@/lib/llm/anthropic'
import { LLMParams } from '@/lib/llm/base'
import Anthropic from '@anthropic-ai/sdk'

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk')
const mockAnthropic = jest.mocked(Anthropic)

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider
  let mockAnthropicInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()

    mockAnthropic.mockClear()

    // Create a mock Anthropic instance
    mockAnthropicInstance = {
      messages: {
        create: jest.fn(),
      },
    }

    // Mock the Anthropic constructor
    mockAnthropic.mockImplementation(() => mockAnthropicInstance)

    provider = new AnthropicProvider()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 1000,
    }

    it('should send a message and return formatted response', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: 'Hello! How can I help you today?',
          },
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 20,
          output_tokens: 10,
        },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(mockAnthropic).toHaveBeenCalledWith({ apiKey: 'test-api-key' })
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 1,
      })

      expect(result).toEqual({
        content: 'Hello! How can I help you today?',
        finishReason: 'end_turn',
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
        raw: mockResponse,
        attachmentResults: { sent: [], failed: [] },
      })
    })

    it('should handle messages without system message', async () => {
      const paramsWithoutSystem: LLMParams = {
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
        model: 'claude-3-haiku-20240307',
      }

      const mockResponse = {
        content: [{ type: 'text', text: 'I am doing well, thank you!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 12 },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(paramsWithoutSystem, 'test-api-key')

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-haiku-20240307',
        system: undefined,
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 1,
      })
    })

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'claude-3-opus-20240229',
      }

      const mockResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'test-api-key')

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-opus-20240229',
        system: undefined,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 1,
      })
    })

    it('should handle custom temperature, maxTokens, and topP', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'claude-3-sonnet-20240229',
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
      }

      const mockResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(customParams, 'test-api-key')

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        system: undefined,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 2000,
        temperature: 0.5,
        top_p: 0.9,
      })
    })

    it('should handle null stop_reason', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.finishReason).toBe('stop')
    })

    it('should handle non-text content type', async () => {
      const mockResponse = {
        content: [{ type: 'image', source: {} }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.content).toBe('')
    })

    it('should propagate errors from Anthropic API', async () => {
      const apiError = new Error('Anthropic API Error')
      mockAnthropicInstance.messages.create.mockRejectedValue(apiError)

      await expect(provider.sendMessage(mockParams, 'test-api-key')).rejects.toThrow(
        'Anthropic API Error'
      )
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'claude-3-5-sonnet-20241022',
    }

    it('should stream message chunks and track usage', async () => {
      const mockStream = [
        {
          type: 'message_start',
          message: {
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' there' },
        },
        {
          type: 'message_delta',
          usage: { output_tokens: 5 },
        },
        {
          type: 'message_stop',
        },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockStream) {
            yield event
          }
        },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([
        { content: 'Hello', done: false },
        { content: ' there', done: false },
        {
          content: '',
          done: true,
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          attachmentResults: { sent: [], failed: [] },
          rawResponse: expect.any(Object),
        },
      ])

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        system: undefined,
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 1000,
        temperature: 0.7,
        stream: true,
      })
    })

    it('should handle system message in streaming', async () => {
      const paramsWithSystem: LLMParams = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
        ],
        model: 'claude-3-haiku-20240307',
      }

      const mockStream = [
        { type: 'message_start', message: { usage: { input_tokens: 15, output_tokens: 0 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi!' } },
        { type: 'message_delta', usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockStream) {
            yield event
          }
        },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(paramsWithSystem, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      )
    })

    it('should handle empty stream', async () => {
      const mockStream = [
        { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockStream) {
            yield event
          }
        },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0].done).toBe(true)
    })

    it('should use custom parameters for streaming', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'claude-3-opus-20240229',
        temperature: 0.9,
        maxTokens: 500,
        topP: 0.8,
      }

      const mockStream: any[] = []
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockStream) {
            yield event
          }
        },
      }

      mockAnthropicInstance.messages.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(customParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-opus-20240229',
        system: undefined,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 500,
        temperature: 0.9,
        stream: true,
      })
    })
  })

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      mockAnthropicInstance.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'test' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      })

      const result = await provider.validateApiKey('valid-api-key')

      expect(result).toBe(true)
      expect(mockAnthropic).toHaveBeenCalledWith({ apiKey: 'valid-api-key' })
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-haiku-4-5-20251015',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })
    })

    it('should return false for invalid API key', async () => {
      mockAnthropicInstance.messages.create.mockRejectedValue(new Error('Invalid API key'))

      const result = await provider.validateApiKey('invalid-api-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Anthropic API key validation failed:',
        expect.any(Error)
      )
    })

    it('should return false on network error', async () => {
      mockAnthropicInstance.messages.create.mockRejectedValue(new Error('Network error'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
    })
  })

  describe('getAvailableModels', () => {
    it('should return list of known Claude models', async () => {
      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251015',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
      ])
      expect(result).toHaveLength(7)
    })

    it('should return same models regardless of API key', async () => {
      const result1 = await provider.getAvailableModels('key1')
      const result2 = await provider.getAvailableModels('key2')

      expect(result1).toEqual(result2)
    })

    it('should include latest Claude Sonnet 4.5', async () => {
      const result = await provider.getAvailableModels('test-key')

      expect(result).toContain('claude-sonnet-4-5-20250929')
    })

    it('should include all Claude model families', async () => {
      const result = await provider.getAvailableModels('test-key')

      const hasSonnet = result.some(m => m.includes('sonnet'))
      const hasOpus = result.some(m => m.includes('opus'))
      const hasHaiku = result.some(m => m.includes('haiku'))

      expect(hasSonnet).toBe(true)
      expect(hasOpus).toBe(true)
      expect(hasHaiku).toBe(true)
    })
  })
})
