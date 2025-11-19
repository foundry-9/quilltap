/**
 * Unit Tests for Gab AI Provider
 * Tests lib/llm/gab-ai.ts
 * Gab AI is an OpenAI-compatible API from Gab
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { GabAIProvider } from '@/lib/llm/gab-ai'
import { LLMParams } from '@/lib/llm/base'
import OpenAI from 'openai'

// Mock the OpenAI SDK
const mockOpenAI = jest.mocked(OpenAI)

describe('GabAIProvider', () => {
  let provider: GabAIProvider
  let mockOpenAIInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()

    mockOpenAI.mockClear()

    // Create a mock OpenAI instance
    mockOpenAIInstance = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
      models: {
        list: jest.fn(),
      },
    }

    // Mock the OpenAI constructor
    mockOpenAI.mockImplementation(() => mockOpenAIInstance)

    provider = new GabAIProvider()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('constructor', () => {
    it('should create provider with hardcoded Gab AI base URL', () => {
      const provider = new GabAIProvider()
      expect(provider).toBeInstanceOf(GabAIProvider)
    })
  })

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'arya',
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

      const result = await provider.sendMessage(mockParams, 'gab-api-key')

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'gab-api-key',
        baseURL: 'https://gab.ai/v1',
      })

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'arya',
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

    it('should throw error without API key', async () => {
      await expect(provider.sendMessage(mockParams, '')).rejects.toThrow(
        'Gab AI provider requires an API key'
      )

      // Verify the OpenAI client was never created
      expect(mockOpenAI).not.toHaveBeenCalled()
    })

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'arya',
      }

      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'gab-api-key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'arya',
        messages: minimalParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stop: undefined,
      })
    })

    it('should handle custom temperature, maxTokens, topP, and stop sequences', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'arya',
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
        stop: ['END', 'STOP'],
      }

      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(customParams, 'gab-api-key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'arya',
        messages: customParams.messages,
        temperature: 0.5,
        max_tokens: 2000,
        top_p: 0.9,
        stop: ['END', 'STOP'],
      })
    })

    it('should handle null content in response', async () => {
      const mockResponse = {
        choices: [{ message: { content: null }, finish_reason: 'length' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'gab-api-key')

      expect(result.content).toBe('')
    })

    it('should handle missing usage information', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: undefined,
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'gab-api-key')

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })
    })

    it('should propagate errors from the API', async () => {
      const apiError = new Error('Gab AI API Error')
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(apiError)

      await expect(provider.sendMessage(mockParams, 'gab-api-key')).rejects.toThrow(
        'Gab AI API Error'
      )
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'arya',
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
      for await (const chunk of provider.streamMessage(mockParams, 'gab-api-key')) {
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
        model: 'arya',
        messages: mockParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stream: true,
        stream_options: { include_usage: true },
      })
    })

    it('should throw error without API key when streaming', async () => {
      const generator = provider.streamMessage(mockParams, '')

      await expect(generator.next()).rejects.toThrow('Gab AI provider requires an API key')

      // Verify the OpenAI client was never created
      expect(mockOpenAI).not.toHaveBeenCalled()
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
      for await (const chunk of provider.streamMessage(mockParams, 'gab-api-key')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([{ content: 'Content', done: false }])
    })

    it('should use custom parameters for streaming', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'arya',
        temperature: 0.9,
        maxTokens: 500,
        topP: 0.8,
      }

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
      for await (const chunk of provider.streamMessage(customParams, 'gab-api-key')) {
        chunks.push(chunk)
      }

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'arya',
        messages: customParams.messages,
        temperature: 0.9,
        max_tokens: 500,
        top_p: 0.8,
        stream: true,
        stream_options: { include_usage: true },
      })
    })
  })

  describe('validateApiKey', () => {
    it('should return true when models endpoint is accessible', async () => {
      mockOpenAIInstance.models.list.mockResolvedValue({ data: [] })

      const result = await provider.validateApiKey('gab-api-key')

      expect(result).toBe(true)
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'gab-api-key',
        baseURL: 'https://gab.ai/v1',
      })
      expect(mockOpenAIInstance.models.list).toHaveBeenCalled()
    })

    it('should return false without API key', async () => {
      const result = await provider.validateApiKey('')

      expect(result).toBe(false)
      // Should not even attempt to create client
      expect(mockOpenAI).not.toHaveBeenCalled()
    })

    it('should return false on error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Server error'))

      const result = await provider.validateApiKey('gab-api-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Gab AI API validation failed:',
        expect.any(Error)
      )
    })

    it('should return false on network error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Network error'))

      const result = await provider.validateApiKey('gab-api-key')

      expect(result).toBe(false)
    })

    it('should return false on authentication error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Unauthorized'))

      const result = await provider.validateApiKey('invalid-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Gab AI API validation failed:',
        expect.any(Error)
      )
    })
  })

  describe('getAvailableModels', () => {
    it('should return sorted list of Gab AI models', async () => {
      const mockModels = {
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'arya', object: 'model' },
          { id: 'gpt-3.5-turbo', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('gab-api-key')

      expect(result).toEqual(['arya', 'gpt-3.5-turbo', 'gpt-4o'])
    })

    it('should return empty array without API key', async () => {
      const result = await provider.getAvailableModels('')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Gab AI provider requires an API key to fetch models'
      )
      // Should not even attempt to create client
      expect(mockOpenAI).not.toHaveBeenCalled()
    })

    it('should return empty array when no models available', async () => {
      const mockModels = { data: [] }
      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('gab-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('API Error'))

      const result = await provider.getAvailableModels('gab-api-key')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch Gab AI models:',
        expect.any(Error)
      )
    })

    it('should handle Gab AI-specific model names', async () => {
      const mockModels = {
        data: [
          { id: 'arya', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
          { id: 'gpt-4o-mini', object: 'model' },
          { id: 'gpt-3.5-turbo', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('gab-api-key')

      expect(result).toHaveLength(4)
      expect(result).toContain('arya')
      expect(result).toContain('gpt-4o')
      expect(result[0]).toBe('arya') // Verifies sorting
    })
  })
})
