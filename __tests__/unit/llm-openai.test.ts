/**
 * Unit Tests for OpenAI Provider
 * Tests lib/llm/openai.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { OpenAIProvider } from '@/lib/llm/openai'
import { LLMParams } from '@/lib/llm/base'

// OpenAI is already mocked in jest.setup.ts
import OpenAI from 'openai'
const mockOpenAI = jest.mocked(OpenAI)

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider
  let mockOpenAIInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset the mock constructor
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

    // Mock the OpenAI constructor to return our mock instance
    mockOpenAI.mockImplementation(() => mockOpenAIInstance)

    provider = new OpenAIProvider()
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
      model: 'gpt-4',
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
        dangerouslyAllowBrowser: true,
      })
      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: mockParams.messages,
        temperature: 0.7,
        max_completion_tokens: 1000,
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
        attachmentResults: { sent: [], failed: [] },
      })
    })

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
      }

      const mockResponse = {
        choices: [
          {
            message: { content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 5,
          total_tokens: 10,
        },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'test-api-key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: minimalParams.messages,
        max_completion_tokens: 1000,
        top_p: 1,
        stop: undefined,
      })
    })

    it('should handle custom temperature, maxTokens, and topP', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-4',
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
        stop: ['END', 'STOP'],
      }

      const mockResponse = {
        choices: [
          {
            message: { content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(customParams, 'test-api-key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: customParams.messages,
        temperature: 0.5,
        max_completion_tokens: 2000,
        top_p: 0.9,
        stop: ['END', 'STOP'],
      })
    })

    it('should handle null content in response', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: null },
            finish_reason: 'length',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'test-api-key')

      expect(result.content).toBe('')
    })

    it('should handle missing usage information', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'Response' },
            finish_reason: 'stop',
          },
        ],
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

    it('should propagate errors from OpenAI API', async () => {
      const apiError = new Error('OpenAI API Error')
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(apiError)

      await expect(provider.sendMessage(mockParams, 'test-api-key')).rejects.toThrow(
        'OpenAI API Error'
      )
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'gpt-4',
    }

    it('should stream message chunks and final usage', async () => {
      const mockStream = [
        {
          choices: [
            {
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: ' there' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: '!' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      ]

      // Create an async iterable
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
          attachmentResults: { sent: [], failed: [] },
          rawResponse: expect.any(Object),
        },
      ])

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: mockParams.messages,
        max_completion_tokens: 1000,
        top_p: 1,
        stream: true,
        stream_options: { include_usage: true },
      })
    })

    it('should handle empty deltas', async () => {
      const mockStream = [
        {
          choices: [
            {
              delta: {},
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: 'Content' },
              finish_reason: null,
            },
          ],
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

      expect(chunks).toEqual([{ content: 'Content', done: false }])
    })

    it('should handle finish reason without usage', async () => {
      const mockStream = [
        {
          choices: [
            {
              delta: { content: 'Done' },
              finish_reason: 'length',
            },
          ],
          usage: undefined,
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

      expect(chunks).toEqual([{ content: 'Done', done: false }])
    })

    it('should use custom parameters for streaming', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'gpt-3.5-turbo',
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
      for await (const chunk of provider.streamMessage(customParams, 'test-api-key')) {
        chunks.push(chunk)
      }

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: customParams.messages,
        temperature: 0.9,
        max_completion_tokens: 500,
        top_p: 0.8,
        stream: true,
        stream_options: { include_usage: true },
      })
    })
  })

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      mockOpenAIInstance.models.list.mockResolvedValue({ data: [] })

      const result = await provider.validateApiKey('valid-api-key')

      expect(result).toBe(true)
      expect(mockOpenAI).toHaveBeenCalledWith({ apiKey: 'valid-api-key' })
      expect(mockOpenAIInstance.models.list).toHaveBeenCalled()
    })

    it('should return false for invalid API key', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Invalid API key'))

      const result = await provider.validateApiKey('invalid-api-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'OpenAI API key validation failed:',
        expect.any(Error)
      )
    })

    it('should return false on network error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Network error'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
    })

    it('should return false on timeout', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Request timeout'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
    })
  })

  describe('getAvailableModels', () => {
    it('should return sorted list of GPT models', async () => {
      const mockModels = {
        data: [
          { id: 'gpt-4', object: 'model', created: 123, owned_by: 'openai' },
          { id: 'gpt-3.5-turbo', object: 'model', created: 456, owned_by: 'openai' },
          { id: 'davinci', object: 'model', created: 789, owned_by: 'openai' },
          { id: 'gpt-4-turbo', object: 'model', created: 101, owned_by: 'openai' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual(['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'])
      expect(result).toHaveLength(3)
      expect(result).not.toContain('davinci')
    })

    it('should filter out non-GPT models', async () => {
      const mockModels = {
        data: [
          { id: 'gpt-4', object: 'model' },
          { id: 'text-embedding-ada-002', object: 'model' },
          { id: 'whisper-1', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual(['gpt-4'])
    })

    it('should return empty array when no GPT models available', async () => {
      const mockModels = {
        data: [
          { id: 'whisper-1', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('API Error'))

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch OpenAI models:',
        expect.any(Error)
      )
    })

    it('should handle empty model list', async () => {
      const mockModels = { data: [] }
      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([])
    })

    it('should sort models alphabetically', async () => {
      const mockModels = {
        data: [
          { id: 'gpt-4-turbo-preview', object: 'model' },
          { id: 'gpt-3.5-turbo', object: 'model' },
          { id: 'gpt-4', object: 'model' },
          { id: 'gpt-3.5-turbo-16k', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-api-key')

      expect(result).toEqual([
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k',
        'gpt-4',
        'gpt-4-turbo-preview',
      ])
    })
  })
})
