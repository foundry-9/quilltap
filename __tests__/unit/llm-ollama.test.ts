/**
 * Unit Tests for Ollama Provider
 * Tests lib/llm/ollama.ts
 * Phase 0.7: Multi-Provider Support
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { OllamaProvider } from '@/lib/llm/ollama'
import { LLMParams } from '@/lib/llm/base'

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>

describe('OllamaProvider', () => {
  let provider: OllamaProvider
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>
  const baseUrl = 'http://localhost:11434'

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new OllamaProvider(baseUrl)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  describe('constructor', () => {
    it('should create provider with baseUrl', () => {
      const provider = new OllamaProvider('http://localhost:11434')
      expect(provider).toBeInstanceOf(OllamaProvider)
    })

    it('should accept custom baseUrl', () => {
      const provider = new OllamaProvider('http://custom-server:8080')
      expect(provider).toBeInstanceOf(OllamaProvider)
    })
  })

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'llama2',
      temperature: 0.7,
      maxTokens: 1000,
    }

    it('should send a message and return formatted response', async () => {
      const mockResponse = {
        message: {
          content: 'Hello! How can I help you today?',
        },
        done: true,
        prompt_eval_count: 20,
        eval_count: 10,
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await provider.sendMessage(mockParams, 'not-used')

      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama2',
          messages: mockParams.messages,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1000,
            top_p: 1,
            stop: undefined,
          },
        }),
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

    it('should use default values for optional parameters', async () => {
      const minimalParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'mistral',
      }

      const mockResponse = {
        message: { content: 'Response' },
        done: true,
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      await provider.sendMessage(minimalParams, 'not-used')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"temperature":0.7'),
        })
      )
    })

    it('should handle custom temperature, maxTokens, topP, and stop sequences', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'codellama',
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
        stop: ['END', 'STOP'],
      }

      const mockResponse = {
        message: { content: 'Response' },
        done: true,
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      await provider.sendMessage(customParams, 'not-used')

      const callBody = JSON.parse(
        (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]?.body as string
      )

      expect(callBody.options.temperature).toBe(0.5)
      expect(callBody.options.num_predict).toBe(2000)
      expect(callBody.options.top_p).toBe(0.9)
      expect(callBody.options.stop).toEqual(['END', 'STOP'])
    })

    it('should handle response with missing token counts', async () => {
      const mockResponse = {
        message: { content: 'Response' },
        done: true,
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await provider.sendMessage(mockParams, 'not-used')

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })
    })

    it('should handle done: false as length finish reason', async () => {
      const mockResponse = {
        message: { content: 'Partial response' },
        done: false,
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await provider.sendMessage(mockParams, 'not-used')

      expect(result.finishReason).toBe('length')
    })

    it('should throw error on non-ok response', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response)

      await expect(provider.sendMessage(mockParams, 'not-used')).rejects.toThrow(
        'Ollama API error: 500 Internal Server Error'
      )
    })

    it('should propagate network errors', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network error')
      )

      await expect(provider.sendMessage(mockParams, 'not-used')).rejects.toThrow('Network error')
    })
  })

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'llama2',
    }

    it('should stream message chunks and track usage', async () => {
      const streamData = [
        JSON.stringify({ message: { content: 'Hello' }, done: false }),
        JSON.stringify({ message: { content: ' there' }, done: false }),
        JSON.stringify({
          message: { content: '!' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      ]

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(streamData.join('\n')),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: jest.fn(),
      }

      const mockBody = {
        getReader: jest.fn().mockReturnValue(mockReader),
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        body: mockBody as any,
      } as Response)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'not-used')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([
        { content: 'Hello', done: false },
        { content: ' there', done: false },
        { content: '!', done: false },
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

      expect(mockReader.releaseLock).toHaveBeenCalled()
    })

    it('should handle multi-line responses', async () => {
      const streamData = [
        JSON.stringify({ message: { content: 'Line 1' }, done: false }),
        '',
        JSON.stringify({ message: { content: '\nLine 2' }, done: false }),
        JSON.stringify({ done: true, prompt_eval_count: 5, eval_count: 10 }),
      ]

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(streamData.join('\n')),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: jest.fn(),
      }

      const mockBody = {
        getReader: jest.fn().mockReturnValue(mockReader),
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        body: mockBody as any,
      } as Response)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'not-used')) {
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(3)
      expect(chunks[chunks.length - 1].done).toBe(true)
    })

    it('should skip invalid JSON lines gracefully', async () => {
      const streamData = [
        JSON.stringify({ message: { content: 'Valid' }, done: false }),
        'Invalid JSON',
        JSON.stringify({ message: { content: ' content' }, done: false }),
        JSON.stringify({ done: true }),
      ]

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(streamData.join('\n')),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: jest.fn(),
      }

      const mockBody = {
        getReader: jest.fn().mockReturnValue(mockReader),
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        body: mockBody as any,
      } as Response)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(mockParams, 'not-used')) {
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(3)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to parse Ollama stream line:',
        'Invalid JSON',
        expect.any(Error)
      )
    })

    it('should throw error on non-ok response', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Model not found',
      } as Response)

      const generator = provider.streamMessage(mockParams, 'not-used')
      await expect(generator.next()).rejects.toThrow('Ollama API error: 404 Model not found')
    })

    it('should throw error if no reader available', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        body: null,
      } as Response)

      const generator = provider.streamMessage(mockParams, 'not-used')
      await expect(generator.next()).rejects.toThrow('Failed to get response reader')
    })

    it('should use custom parameters for streaming', async () => {
      const customParams: LLMParams = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'mistral',
        temperature: 0.9,
        maxTokens: 500,
        topP: 0.8,
      }

      const mockReader = {
        read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: jest.fn(),
      }

      const mockBody = {
        getReader: jest.fn().mockReturnValue(mockReader),
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        body: mockBody as any,
      } as Response)

      const chunks: any[] = []
      for await (const chunk of provider.streamMessage(customParams, 'not-used')) {
        chunks.push(chunk)
      }

      const callBody = JSON.parse(
        (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]?.body as string
      )

      expect(callBody.options.temperature).toBe(0.9)
      expect(callBody.options.num_predict).toBe(500)
      expect(callBody.options.top_p).toBe(0.8)
    })
  })

  describe('validateApiKey', () => {
    it('should return true when server is reachable', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
      } as Response)

      const result = await provider.validateApiKey('not-used')

      expect(result).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/tags`, {
        method: 'GET',
      })
    })

    it('should return false when server returns non-ok response', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
      } as Response)

      const result = await provider.validateApiKey('not-used')

      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network error')
      )

      const result = await provider.validateApiKey('not-used')

      expect(result).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Ollama server validation failed:',
        expect.any(Error)
      )
    })

    it('should not require API key (accepts any value)', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
      } as Response)

      const result1 = await provider.validateApiKey('')
      const result2 = await provider.validateApiKey('any-value')

      expect(result1).toBe(true)
      expect(result2).toBe(true)
    })
  })

  describe('getAvailableModels', () => {
    it('should return list of models from server', async () => {
      const mockModels = {
        models: [
          { name: 'llama2' },
          { name: 'mistral' },
          { name: 'codellama' },
        ],
      }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockModels,
      } as Response)

      const result = await provider.getAvailableModels('not-used')

      expect(result).toEqual(['llama2', 'mistral', 'codellama'])
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/tags`, {
        method: 'GET',
      })
    })

    it('should return empty array when no models available', async () => {
      const mockModels = { models: [] }

      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => mockModels,
      } as Response)

      const result = await provider.getAvailableModels('not-used')

      expect(result).toEqual([])
    })

    it('should return empty array when models field is missing', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      const result = await provider.getAvailableModels('not-used')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(
        new Error('Network error')
      )

      const result = await provider.getAvailableModels('not-used')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch Ollama models:',
        expect.any(Error)
      )
    })

    it('should return empty array when response is not ok', async () => {
      ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      const result = await provider.getAvailableModels('not-used')

      expect(result).toEqual([])
    })
  })
})
