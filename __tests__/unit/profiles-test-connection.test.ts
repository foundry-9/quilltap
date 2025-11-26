/**
 * Unit Tests for Connection Profile Test Connection Endpoint
 * Tests app/api/profiles/test-connection/route.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { getServerSession } from 'next-auth'
import { POST as testConnection } from '@/app/api/profiles/test-connection/route'
import { decryptApiKey } from '@/lib/encryption'
import { getRepositories } from '@/lib/json-store/repositories'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
}))

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>

// Helper to create a mock NextRequest
function createMockRequest(body: any) {
  return {
    json: async () => body,
  } as any
}

describe('POST /api/profiles/test-connection', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>
  let mockConnectionsRepo: any
  const mockGetRepositories = jest.mocked(getRepositories)

  const mockSession = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
    },
  }

  beforeEach(() => {
    ;(getServerSession as jest.Mock).mockClear?.()
    ;(decryptApiKey as jest.Mock).mockClear?.()
    ;(global.fetch as jest.Mock).mockClear?.()

    // Set up repository mocks
    mockConnectionsRepo = {
      getAllApiKeys: jest.fn(),
      findApiKeyById: jest.fn(),
      createApiKey: jest.fn(),
      updateApiKey: jest.fn(),
      deleteApiKey: jest.fn(),
      findByUserId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      connections: mockConnectionsRepo,
      characters: {},
      personas: {},
      chats: {},
      tags: {},
      users: {},
      images: {},
      imageProfiles: {},
    })

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    jest.clearAllMocks()
  })

  describe('Authentication', () => {
    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 401 when session has no user id', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue({ user: {} })

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)

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
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation error')
    })

    it('should return 400 when baseUrl is missing for OLLAMA', async () => {
      const req = createMockRequest({
        provider: 'OLLAMA',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Base URL is required')
    })

    it('should return 400 when baseUrl is missing for OPENAI_COMPATIBLE', async () => {
      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Base URL is required')
    })

    it('should return 400 when API key is missing for OPENAI', async () => {
      const req = createMockRequest({
        provider: 'OPENAI',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('API key is required')
    })

    it('should return 404 when API key is not found', async () => {
      mockConnectionsRepo.findApiKeyById.mockResolvedValue(null)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'nonexistent-key',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('API key not found')
    })
  })

  describe('OpenAI Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.findApiKeyById.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: 'OPENAI',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-test123')
    })

    it('should successfully test OpenAI connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(data.provider).toBe('OPENAI')
      expect(data.message).toContain('Successfully connected')
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer sk-test123',
          },
        })
      )
    })

    it('should handle invalid OpenAI API key', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      } as Response)

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Invalid API key')
    })

    it('should handle OpenAI connection failure', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Failed to connect to OpenAI')
    })
  })

  describe('Anthropic Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.findApiKeyById.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: 'ANTHROPIC',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-ant-test123')
    })

    it('should successfully test Anthropic connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response)

      const req = createMockRequest({
        provider: 'ANTHROPIC',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'x-api-key': 'sk-ant-test123',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        })
      )
    })

    it('should accept 400 status as valid for Anthropic', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
      } as Response)

      const req = createMockRequest({
        provider: 'ANTHROPIC',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should handle invalid Anthropic API key', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const req = createMockRequest({
        provider: 'ANTHROPIC',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Invalid API key')
    })
  })

  describe('Google Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.findApiKeyById.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: 'GOOGLE',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('google-test-key')
    })

    it('should successfully test Google connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
      } as Response)

      const req = createMockRequest({
        provider: 'GOOGLE',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models?key=google-test-key',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should handle invalid Google API key responses', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const req = createMockRequest({
        provider: 'GOOGLE',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toBe('Invalid API key')
    })

    it('should handle Google fetch failures gracefully', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network down'))

      const req = createMockRequest({
        provider: 'GOOGLE',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toBe('Failed to connect to Google')
    })
  })

  describe('Ollama Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    })

    it('should successfully test Ollama connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      } as Response)

      const req = createMockRequest({
        provider: 'OLLAMA',
        baseUrl: 'http://localhost:11434',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should handle unreachable Ollama server', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'))

      const req = createMockRequest({
        provider: 'OLLAMA',
        baseUrl: 'http://localhost:11434',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('unreachable')
    })
  })

  describe('OpenRouter Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.findApiKeyById.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: 'OPENROUTER',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('sk-or-test123')
    })

    it('should successfully test OpenRouter connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const req = createMockRequest({
        provider: 'OPENROUTER',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer sk-or-test123',
          },
        })
      )
    })

    it('should handle invalid OpenRouter API key', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response)

      const req = createMockRequest({
        provider: 'OPENROUTER',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Invalid API key')
    })
  })

  describe('OpenAI Compatible Provider', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.findApiKeyById.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
        provider: 'OPENAI_COMPATIBLE',
        ciphertext: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      ;(decryptApiKey as jest.Mock).mockReturnValue('test-key')
    })

    it('should successfully test OpenAI-compatible connection', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
        apiKeyId: 'key-123',
        baseUrl: 'http://localhost:8000',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-key',
          },
        })
      )
    })

    it('should work without API key for OpenAI-compatible', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
        baseUrl: 'http://localhost:8000',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.valid).toBe(true)
    })

    it('should handle unreachable server', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'))

      const req = createMockRequest({
        provider: 'OPENAI_COMPATIBLE',
        apiKeyId: 'key-123',
        baseUrl: 'http://localhost:8000',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.valid).toBe(false)
      expect(data.error).toContain('unreachable')
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    })

    it('should handle database errors gracefully', async () => {
      mockConnectionsRepo.findApiKeyById.mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest({
        provider: 'OPENAI',
        apiKeyId: 'key-123',
      })

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to test connection')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle malformed request body', async () => {
      const req = {
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as any

      const response = await testConnection(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to test connection')
    })
  })
})
