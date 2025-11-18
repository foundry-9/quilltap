/**
 * Unit Tests for Connection Profile Test Message Endpoint
 * Tests app/api/profiles/test-message/route.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { getServerSession } from 'next-auth'
import { POST as testMessage } from '@/app/api/profiles/test-message/route'
import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm/factory'
import { Provider } from '@prisma/client'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findFirst: jest.fn(),
    },
  },
}))
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
}))
jest.mock('@/lib/llm/factory')

// Helper to create a mock NextRequest
function createMockRequest(body: any) {
  return {
    json: async () => body,
  } as any
}

describe('POST /api/profiles/test-message', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  const mockSession = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
    },
  }

  beforeEach(() => {
    ;(getServerSession as jest.Mock).mockClear?.()
    ;(prisma.apiKey.findFirst as jest.Mock).mockClear?.()
    ;(decryptApiKey as jest.Mock).mockClear?.()
    ;(createLLMProvider as jest.Mock).mockClear?.()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Authentication', () => {
    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 401 when session has no user id', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue({ user: {} })

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)

      expect(response.status).toBe(401)
    })
  })

  describe('Validation', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    })

    it('should return 400 for invalid provider', async () => {
      const req = createMockRequest({
        provider: 'INVALID',
        apiKeyId: 'key-123',
        modelName: 'test-model',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })

    it('should return 400 when modelName is missing', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })

    it('should return 400 when baseUrl is missing for OLLAMA', async () => {
      const req = createMockRequest({
        provider: 'OLLAMA',
        modelName: 'llama2',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Base URL is required')
    })

    it('should return 400 when baseUrl is missing for OPENAI_COMPATIBLE', async () => {
      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
        apiKeyId: 'key-123',
        modelName: 'test-model',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Base URL is required')
    })

    it('should return 400 when API key is missing for OPENAI', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('API key is required')
    })

    it('should return 404 when API key is not found', async () => {
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'nonexistent-key',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('API key not found')
    })

    it('should validate temperature parameter range', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
        parameters: {
          temperature: 5.0, // Invalid: exceeds max of 2
        },
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })

    it('should validate top_p parameter range', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
        parameters: {
          top_p: 1.5, // Invalid: exceeds max of 1
        },
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })

    it('should validate max_tokens minimum', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
        parameters: {
          max_tokens: 0, // Invalid: below minimum of 1
        },
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })
  })

  describe('Successful Test Messages', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: Provider.OPENAI,
        keyEncrypted: 'encrypted',
        keyIv: 'iv',
        keyAuthTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-test123')
    })

    it('should successfully send test message to OpenAI', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'Hello! The connection is working perfectly.',
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
        parameters: {
          temperature: 0.7,
          max_tokens: 100,
          top_p: 1,
        },
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.provider).toBe('OPENAI')
      expect(data.modelName).toBe('gpt-3.5-turbo')
      expect(data.message).toContain('Test message successful')
      expect(data.responsePreview).toContain('Hello!')

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: expect.stringContaining('Hello'),
            },
          ],
          temperature: 0.7,
          max_tokens: 100,
          top_p: 1,
        }),
        'sk-test123'
      )
    })

    it('should use default max_tokens of 50 when not provided', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'Test response',
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      await testMessage(req)

      expect(mockProvider.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 50,
        }),
        expect.any(String)
      )
    })

    it('should truncate long responses in message', async () => {
      const longResponse = 'a'.repeat(300)
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: longResponse,
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(data.message.length).toBeLessThan(200)
      expect(data.message).toContain('...')
      expect(data.responsePreview.length).toBeLessThanOrEqual(200)
    })

    it('should work with Ollama provider without API key', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'Response from Ollama',
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OLLAMA',
        baseUrl: 'http://localhost:11434',
        modelName: 'llama2',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(createLLMProvider).toHaveBeenCalledWith('OLLAMA', 'http://localhost:11434')
    })

    it('should pass baseUrl to provider factory for Ollama', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({ content: 'Test' }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OLLAMA',
        baseUrl: 'http://192.168.1.100:11434',
        modelName: 'llama2',
      })

      await testMessage(req)

      expect(createLLMProvider).toHaveBeenCalledWith('OLLAMA', 'http://192.168.1.100:11434')
    })

    it('should pass baseUrl to provider factory for OpenAI-compatible', async () => {
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: Provider.OPENAI_COMPATIBLE,
        keyEncrypted: 'encrypted',
        keyIv: 'iv',
        keyAuthTag: 'tag',
      })

      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({ content: 'Test' }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
        apiKeyId: 'key-123',
        baseUrl: 'http://localhost:8000',
        modelName: 'custom-model',
      })

      await testMessage(req)

      expect(createLLMProvider).toHaveBeenCalledWith('OPENAI_COMPATIBLE', 'http://localhost:8000')
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: Provider.OPENAI,
        keyEncrypted: 'encrypted',
        keyIv: 'iv',
        keyAuthTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-test123')
    })

    it('should handle LLM provider errors', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockRejectedValue(new Error('Rate limit exceeded')),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Rate limit exceeded')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle empty response from provider', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({}),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('No response received')
    })

    it('should handle null response from provider', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue(null),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('No response received')
    })

    it('should handle database errors gracefully', async () => {
      ;(prisma.apiKey.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'gpt-3.5-turbo',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to test message')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle malformed request body', async () => {
      const req = {
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as any

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to test message')
    })

    it('should handle invalid model name error from provider', async () => {
      const mockProvider = {
        sendMessage: jest.fn().mockRejectedValue(new Error('Model not found')),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
        modelName: 'invalid-model',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Model not found')
    })
  })

  describe('Different Providers', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    })

    it('should work with Anthropic provider', async () => {
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: Provider.ANTHROPIC,
        keyEncrypted: 'encrypted',
        keyIv: 'iv',
        keyAuthTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-ant-test123')

      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'Response from Claude',
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'ANTHROPIC',
        apiKeyId: 'key-123',
        modelName: 'claude-3-sonnet-20240229',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.provider).toBe('ANTHROPIC')
    })

    it('should work with OpenRouter provider', async () => {
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: Provider.OPENROUTER,
        keyEncrypted: 'encrypted',
        keyIv: 'iv',
        keyAuthTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-or-test123')

      const mockProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'Response from OpenRouter',
        }),
      }
      ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)

      const req = createMockRequest({
        provider: 'OPENROUTER',
        apiKeyId: 'key-123',
        modelName: 'openai/gpt-4',
      })

      const response = await testMessage(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.provider).toBe('OPENROUTER')
    })
  })
})
