/**
 * Unit Tests for OpenRouter Provider
 * Tests lib/llm/openrouter.ts
 * Phase 0.7: Multi-Provider Support
 * Updated to use @openrouter/sdk
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { OpenRouterProvider } from '@/lib/llm/openrouter'
import { LLMParams } from '@/lib/llm/base'

// Mock the OpenRouter SDK
jest.mock('@openrouter/sdk')
import { OpenRouter } from '@openrouter/sdk'
const mockOpenRouter = jest.mocked(OpenRouter)

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider
  let mockOpenRouterInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock OpenRouter instance
    mockOpenRouterInstance = {
      chat: {
        send: jest.fn(),
      },
      models: {
        list: jest.fn(),
      },
    }

    // Mock the OpenRouter constructor
    mockOpenRouter.mockImplementation(() => mockOpenRouterInstance)

    provider = new OpenRouterProvider()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('constructor', () => {
    it('should create provider instance', () => {
      const provider = new OpenRouterProvider()
      expect(provider).toBeInstanceOf(OpenRouterProvider)
    })
  })

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'anthropic/claude-3-opus',
      temperature: 0.7,
      maxTokens: 1000,
    }

    it('should send a message and return formatted response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello! How can I help you today?',
            },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(mockOpenRouter).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        httpReferer: expect.any(String),
        xTitle: 'Quilltap',
      })

      expect(mockOpenRouterInstance.chat.send).toHaveBeenCalledWith({
        model: 'anthropic/claude-3-opus',
        messages: mockParams.messages,
        temperature: 0.7,
        maxTokens: 1000,
        topP: 1,
        stop: undefined,
        stream: false,
      })

      expect(result).toEqual({
        content: 'Hello! How can I help you today?',
        finishReason: 'stop',
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
        raw: mockResponse,
        attachmentResults: { sent: [], failed: [] },
      })
    })

    it('should include proper configuration options', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finishReason: 'stop' }],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      await provider.sendMessage(mockParams, 'test-api-key')

      const constructorCall = mockOpenRouter.mock.calls[0][0]
      expect(constructorCall.httpReferer).toBeDefined()
      expect(constructorCall.xTitle).toBe('Quilltap')
    })

    it('should support various model namespaces', async () => {
      const models = [
        'anthropic/claude-3-opus',
        'openai/gpt-4',
        'meta-llama/llama-2-70b-chat',
        'google/gemini-pro',
      ]

      for (const model of models) {
        const params = { ...mockParams, model }
        const mockResponse = {
          choices: [{ message: { content: 'Response' }, finishReason: 'stop' }],
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }

        mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

        await provider.sendMessage(params, 'test-api-key')

        expect(mockOpenRouterInstance.chat.send).toHaveBeenCalledWith(
          expect.objectContaining({ model })
        )
      }
    })

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'openai/gpt-3.5-turbo',
      }

      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finishReason: 'stop' }],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'test-api-key')

      expect(mockOpenRouterInstance.chat.send).toHaveBeenCalledWith({
        model: 'openai/gpt-3.5-turbo',
        messages: minimalParams.messages,
        temperature: 0.7,
        maxTokens: 1000,
        topP: 1,
        stop: undefined,
        stream: false,
      })
    })

    it('should handle null content in response', async () => {
      const mockResponse = {
        choices: [{ message: { content: null }, finishReason: 'length' }],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.content).toBe('')
      expect(result.finishReason).toBe('length')
    })

    it('should handle missing usage information', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finishReason: 'stop' }],
        usage: undefined,
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })
    })

    it('should handle null finishReason', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finishReason: null }],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.finishReason).toBe('stop')
    })

    it('should propagate errors from OpenRouter API', async () => {
      const apiError = new Error('OpenRouter API Error')
      mockOpenRouterInstance.chat.send.mockRejectedValue(apiError)

      await expect(provider.sendMessage(mockParams, 'test-api-key')).rejects.toThrow(
        'OpenRouter API Error'
      )
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'anthropic/claude-3-sonnet',
    }

    it('should stream message chunks and final usage', async () => {
      const mockStreamData = [
        {
          choices: [{ delta: { content: 'Hello' }, finishReason: null }],
          id: '1',
          created: Date.now(),
          model: 'anthropic/claude-3-sonnet',
          object: 'chat.completion.chunk' as const,
        },
        {
          choices: [{ delta: { content: ' there' }, finishReason: null }],
          id: '1',
          created: Date.now(),
          model: 'anthropic/claude-3-sonnet',
          object: 'chat.completion.chunk' as const,
        },
        {
          choices: [{ delta: { content: '!' }, finishReason: 'stop' }],
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          id: '1',
          created: Date.now(),
          model: 'anthropic/claude-3-sonnet',
          object: 'chat.completion.chunk' as const,
        },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamData) {
            yield chunk
          }
        },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(asyncIterable)

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

      expect(mockOpenRouterInstance.chat.send).toHaveBeenCalledWith({
        model: 'anthropic/claude-3-sonnet',
        messages: mockParams.messages,
        temperature: 0.7,
        maxTokens: 1000,
        topP: 1,
        stream: true,
        streamOptions: { includeUsage: true },
      })
    })

    it('should include proper configuration when streaming', async () => {
      const mockStreamData: any[] = []
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamData) {
            yield chunk
          }
        },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      const constructorCall = mockOpenRouter.mock.calls[0][0]
      expect(constructorCall.xTitle).toBe('Quilltap')
      expect(constructorCall.httpReferer).toBeDefined()
    })

    it('should handle empty deltas', async () => {
      const mockStreamData = [
        {
          choices: [{ delta: {}, finishReason: null }],
          id: '1',
          created: Date.now(),
          model: 'anthropic/claude-3-sonnet',
          object: 'chat.completion.chunk' as const,
        },
        {
          choices: [{ delta: { content: 'Content' }, finishReason: null }],
          id: '1',
          created: Date.now(),
          model: 'anthropic/claude-3-sonnet',
          object: 'chat.completion.chunk' as const,
        },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamData) {
            yield chunk
          }
        },
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([{ content: 'Content', done: false }])
    })

    it('should throw error for non-streaming response', async () => {
      const nonStreamResponse = {
        choices: [{ message: { content: 'Response' }, finishReason: 'stop' }],
      }

      mockOpenRouterInstance.chat.send.mockResolvedValue(nonStreamResponse)

      await expect(async () => {
        for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
          // Should throw before yielding any chunks
        }
      }).rejects.toThrow('Expected streaming response from OpenRouter')
    })
  })

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      mockOpenRouterInstance.models.list.mockResolvedValue({ data: [] })

      const result = await provider.validateApiKey('valid-api-key')

      expect(result).toBe(true)
      expect(mockOpenRouter).toHaveBeenCalledWith({
        apiKey: 'valid-api-key',
        httpReferer: expect.any(String),
        xTitle: 'Quilltap',
      })
      expect(mockOpenRouterInstance.models.list).toHaveBeenCalled()
    })

    it('should return false for invalid API key', async () => {
      mockOpenRouterInstance.models.list.mockRejectedValue(new Error('Unauthorized'))

      const result = await provider.validateApiKey('invalid-api-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'OpenRouter API key validation failed:',
        expect.any(Error)
      )
    })

    it('should return false on network error', async () => {
      mockOpenRouterInstance.models.list.mockRejectedValue(new Error('Network error'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'OpenRouter API key validation failed:',
        expect.any(Error)
      )
    })
  })

  describe('getAvailableModels', () => {
    it('should return list of available models', async () => {
      const mockModels = {
        data: [
          { id: 'anthropic/claude-3-opus' },
          { id: 'openai/gpt-4' },
          { id: 'meta-llama/llama-2-70b-chat' },
        ],
      }

      mockOpenRouterInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([
        'anthropic/claude-3-opus',
        'openai/gpt-4',
        'meta-llama/llama-2-70b-chat',
      ])

      expect(mockOpenRouter).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        httpReferer: expect.any(String),
        xTitle: 'Quilltap',
      })
      expect(mockOpenRouterInstance.models.list).toHaveBeenCalled()
    })

    it('should return empty array when no models available', async () => {
      mockOpenRouterInstance.models.list.mockResolvedValue({ data: [] })

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array when data field is missing', async () => {
      mockOpenRouterInstance.models.list.mockResolvedValue({})

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      mockOpenRouterInstance.models.list.mockRejectedValue(new Error('API Error'))

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch OpenRouter models:',
        expect.any(Error)
      )
    })
  })
})
