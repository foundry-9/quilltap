/**
 * Unit Tests for OpenAI-Compatible Provider
 * Tests lib/llm/openai-compatible.ts
 * Phase 0.7: Multi-Provider Support
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { OpenAICompatibleProvider } from '@/lib/llm/openai-compatible'
import { LLMParams } from '@/lib/llm/base'
import OpenAI from 'openai'

// Mock the OpenAI SDK
const mockOpenAI = jest.mocked(OpenAI)

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider
  let mockOpenAIInstance: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>
  const baseUrl = 'http://localhost:1234/v1'

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

    provider = new OpenAICompatibleProvider(baseUrl)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('constructor', () => {
    it('should create provider with baseUrl', () => {
      const provider = new OpenAICompatibleProvider('http://localhost:1234/v1')
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
    })

    it('should accept various baseUrl formats', () => {
      const urls = [
        'http://localhost:1234/v1',
        'http://192.168.1.100:8080/api/v1',
        'https://custom-server.com/api/v1',
      ]

      urls.forEach(url => {
        const provider = new OpenAICompatibleProvider(url)
        expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
      })
    })
  })

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'local-model',
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
        baseURL: baseUrl,
      })

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'local-model',
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
        attachmentResults: { sent: [], failed: [] },
      })
    })

    it('should work without API key (for servers that don\'t require it)', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(mockParams, '')

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'not-needed',
        baseURL: baseUrl,
      })
    })

    it('should use "not-needed" as default API key', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(mockParams, '')

      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.apiKey).toBe('not-needed')
    })

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'my-model',
      }

      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      await provider.sendMessage(minimalParams, 'key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'my-model',
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
        model: 'custom-model',
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

      await provider.sendMessage(customParams, 'key')

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'custom-model',
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

      const result = await provider.sendMessage(mockParams, 'key')

      expect(result.content).toBe('')
    })

    it('should handle missing usage information', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: undefined,
      }

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse)

      const result = await provider.sendMessage(mockParams, 'key')

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })
    })

    it('should propagate errors from the API', async () => {
      const apiError = new Error('API Error')
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(apiError)

      await expect(provider.sendMessage(mockParams, 'key')).rejects.toThrow('API Error')
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'local-model',
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
          attachmentResults: { sent: [], failed: [] },
        },
      ])

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'local-model',
        messages: mockParams.messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        stream: true,
        stream_options: { include_usage: true },
      })
    })

    it('should work without API key when streaming', async () => {
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
      for await (const chunk of provider.streamMessage(mockParams, '')) {
        chunks.push(chunk)
      }

      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.apiKey).toBe('not-needed')
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
      for await (const chunk of provider.streamMessage(mockParams, 'key')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([{ content: 'Content', done: false }])
    })

    it('should use custom parameters for streaming', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'custom-model',
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
      for await (const chunk of provider.streamMessage(customParams, 'key')) {
        chunks.push(chunk)
      }

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'custom-model',
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

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(true)
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: baseUrl,
      })
      expect(mockOpenAIInstance.models.list).toHaveBeenCalled()
    })

    it('should work without API key', async () => {
      mockOpenAIInstance.models.list.mockResolvedValue({ data: [] })

      const result = await provider.validateApiKey('')

      expect(result).toBe(true)
      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.apiKey).toBe('not-needed')
    })

    it('should return false on error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Server error'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'OpenAI-compatible API validation failed:',
        expect.any(Error)
      )
    })

    it('should return false on network error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('Network error'))

      const result = await provider.validateApiKey('test-key')

      expect(result).toBe(false)
    })
  })

  describe('getAvailableModels', () => {
    it('should return sorted list of models', async () => {
      const mockModels = {
        data: [
          { id: 'model-c', object: 'model' },
          { id: 'model-a', object: 'model' },
          { id: 'model-b', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-key')

      expect(result).toEqual(['model-a', 'model-b', 'model-c'])
    })

    it('should work without API key', async () => {
      const mockModels = {
        data: [{ id: 'local-model', object: 'model' }],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('')

      expect(result).toEqual(['local-model'])
      const constructorCall = mockOpenAI.mock.calls[0][0]
      expect(constructorCall.apiKey).toBe('not-needed')
    })

    it('should return empty array when no models available', async () => {
      const mockModels = { data: [] }
      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-key')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      mockOpenAIInstance.models.list.mockRejectedValue(new Error('API Error'))

      const result = await provider.getAvailableModels('test-key')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch OpenAI-compatible models:',
        expect.any(Error)
      )
    })

    it('should handle various model naming conventions', async () => {
      const mockModels = {
        data: [
          { id: 'llama-2-7b', object: 'model' },
          { id: 'mistral-7b-instruct', object: 'model' },
          { id: 'codellama-13b', object: 'model' },
          { id: 'custom-fine-tuned-model', object: 'model' },
        ],
      }

      mockOpenAIInstance.models.list.mockResolvedValue(mockModels)

      const result = await provider.getAvailableModels('test-key')

      expect(result).toHaveLength(4)
      expect(result).toContain('llama-2-7b')
      expect(result).toContain('custom-fine-tuned-model')
    })
  })
})
