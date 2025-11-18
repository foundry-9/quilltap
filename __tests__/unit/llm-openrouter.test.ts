/**
 * Unit Tests for OpenRouter Provider
 * Tests lib/llm/openrouter.ts
 * Phase 0.7: Multi-Provider Support
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { OpenRouterProvider } from '@/lib/llm/openrouter'
import { LLMParams } from '@/lib/llm/base'

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>

// Mock the OpenAI SDK (OpenRouter uses it)
jest.mock('openai')
import OpenAI from 'openai'
const mockOpenAI = jest.mocked(OpenAI)

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider
  let mockOpenAIInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockClear()

    mockOpenAI.mockClear()

    // Create a mock OpenAI instance
    mockOpenAIInstance = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    }

    // Mock the OpenAI constructor
    mockOpenAI.mockImplementation(() => mockOpenAIInstance)

    provider = new OpenRouterProvider()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('constructor', () => {
    it('should create provider with default baseUrl', () => {
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
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': expect.any(String),
          'X-Title': 'Quilltap',
        },
      })

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'anthropic/claude-3-opus',
        messages: mockParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stop: undefined,
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
      })
    })

    it('should include proper headers for attribution', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(mockParams, 'test-api-key')

      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.defaultHeaders).toEqual({
        'HTTP-Referer': expect.any(String),
        'X-Title': 'Quilltap',
      })
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
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }

        mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

        await provider.sendMessage(params, 'test-api-key')

        expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith(
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
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'test-api-key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'openai/gpt-3.5-turbo',
        messages: minimalParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stop: undefined,
      })
    })

    it('should handle null content in response', async () => {
      const mockResponse = {
        choices: [{ message: { content: null }, finish_reason: 'length' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.content).toBe('')
    })

    it('should handle missing usage information', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: undefined,
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })
    })

    it('should propagate errors from OpenRouter API', async () => {
      const apiError = new Error('OpenRouter API Error')
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(apiError)

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
      const mockStream = [
        {
          choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
        },
        {
          choices: [{ delta: { content: ' there' }, finish_reason: null }],
        },
        {
          choices: [{ delta: { content: '!' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStream) {
            yield chunk
          }
        },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(asyncIterable)

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
        },
      ])

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'anthropic/claude-3-sonnet',
        messages: mockParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stream: true,
        stream_options: { include_usage: true },
      })
    })

    it('should include attribution headers when streaming', async () => {
      const mockStream: any[] = []
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStream) {
            yield chunk
          }
        },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.defaultHeaders['X-Title']).toBe('Quilltap')
      expect(constructorCall.defaultHeaders['HTTP-Referer']).toBeDefined()
    })

    it('should handle empty deltas', async () => {
      const mockStream = [
        { choices: [{ delta: {}, finish_reason: null }] },
        { choices: [{ delta: { content: 'Content' }, finish_reason: null }] },
      ]

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStream) {
            yield chunk
          }
        },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(asyncIterable)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([{ content: 'Content', done: false }])
    })
  })

  describe('validateApiKey', () => {
    beforeEach(() => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockClear()
    })

    it('should return true for valid API key', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
      } as Response)

      const result = await provider.validateApiKey('valid-api-key')

      expect(result).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-api-key',
            'HTTP-Referer': expect.any(String),
            'X-Title': 'Quilltap',
          }),
        })
      )
    })

    it('should return false for invalid API key', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const result = await provider.validateApiKey('invalid-api-key')

      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network error')
      )

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'OpenRouter API key validation failed:',
        expect.any(Error)
      )
    })
  })

  describe('getAvailableModels', () => {
    beforeEach(() => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockClear()
    })

    it('should return list of available models', async () => {
      const mockModels = {
        data: [
          { id: 'anthropic/claude-3-opus' },
          { id: 'openai/gpt-4' },
          { id: 'meta-llama/llama-2-70b-chat' },
        ],
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockModels,
      } as Response)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([
        'anthropic/claude-3-opus',
        'openai/gpt-4',
        'meta-llama/llama-2-70b-chat',
      ])

      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      )
    })

    it('should return empty array when no models available', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array when data field is missing', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('API Error')
      )

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch OpenRouter models:',
        expect.any(Error)
      )
    })

    it('should return empty array when response is not ok', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })
  })
})
