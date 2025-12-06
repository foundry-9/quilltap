/**
 * Unit Tests for API Keys Routes
 * Tests app/api/keys/route.ts and app/api/keys/[id]/route.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { getServerSession } from 'next-auth'
import { GET as getKeys, POST as createKey } from '@/app/api/keys/route'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { getRepositories } from '@/lib/repositories/factory'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/repositories/factory')

// Encryption is mocked globally in jest.setup.ts
// Get the mocked versions for use in tests
const mockEncryptApiKey = jest.mocked(encryptApiKey)
const mockMaskApiKey = jest.mocked(maskApiKey)
const mockGetRepositories = jest.mocked(getRepositories)

// Helper to create a mock NextRequest
function createMockRequest(url: string, options?: { method?: string; body?: string }) {
  return {
    url: new URL(url),
    method: options?.method || 'GET',
    json: async () => options?.body ? JSON.parse(options.body) : {},
    text: async () => options?.body || '',
    headers: new Map([['content-type', 'application/json']]),
    cookies: new Map(),
  } as any
}

describe('API Keys Routes', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>
  let mockConnectionsRepo: any

  beforeEach(() => {
    // Clear mock call history
    ;(getServerSession as jest.Mock).mockClear?.()

    // Set up default mock implementations for encryption functions
    mockEncryptApiKey.mockReturnValue({
      encrypted: 'encrypted-data',
      iv: 'iv-data',
      authTag: 'auth-tag',
    })
    mockMaskApiKey.mockImplementation((key: string) => `***${key.slice(-4)}`)

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

  describe('GET /api/keys', () => {
    const mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    }

    it('should return all API keys for authenticated user', async () => {
      const mockKeys = [
        {
          id: 'key-1',
          provider: 'OPENAI' as const,
          label: 'My OpenAI Key',
          isActive: true,
          lastUsed: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          ciphertext: 'encrypted-data-here-1234567890',
        },
        {
          id: 'key-2',
          provider: 'ANTHROPIC' as const,
          label: 'My Claude Key',
          isActive: false,
          lastUsed: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          ciphertext: 'encrypted-data-here-0987654321',
        },
      ]

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.getAllApiKeys.mockResolvedValue(mockKeys)

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(getServerSession).toHaveBeenCalled()
      expect(mockConnectionsRepo.getAllApiKeys).toHaveBeenCalled()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(2)
      expect(data[0]).toHaveProperty('keyPreview')
      expect(data[0]).not.toHaveProperty('ciphertext')
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
      expect(mockConnectionsRepo.getAllApiKeys).not.toHaveBeenCalled()
    })

    it('should return 401 when session has no user id', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue({ user: {} })

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)

      expect(response.status).toBe(401)
    })

    it('should return empty array when user has no keys', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.getAllApiKeys.mockResolvedValue([])

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual([])
    })

    it('should handle database errors gracefully', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.getAllApiKeys.mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Failed to fetch API keys' })
    })

    it('should sort keys by creation date descending', async () => {
      const mockKeys = [
        {
          id: 'key-1',
          provider: 'OPENAI' as const,
          label: 'First',
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          ciphertext: 'enc1',
        },
        {
          id: 'key-2',
          provider: 'ANTHROPIC' as const,
          label: 'Second',
          isActive: true,
          createdAt: '2024-01-03T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
          ciphertext: 'enc2',
        },
        {
          id: 'key-3',
          provider: 'OPENAI' as const,
          label: 'Third',
          isActive: true,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          ciphertext: 'enc3',
        },
      ]

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.getAllApiKeys.mockResolvedValue(mockKeys)

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      // Should be sorted: key-2 (2024-01-03), key-3 (2024-01-02), key-1 (2024-01-01)
      expect(data[0].id).toBe('key-2')
      expect(data[1].id).toBe('key-3')
      expect(data[2].id).toBe('key-1')
    })
  })

  describe('POST /api/keys', () => {
    const mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    }

    const validBody = {
      provider: 'OPENAI',
      label: 'My API Key',
      apiKey: 'sk-1234567890abcdef',
    }

    it('should create a new API key', async () => {
      const mockCreatedKey = {
        id: 'key-new',
        provider: 'OPENAI' as const,
        label: 'My API Key',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.createApiKey.mockResolvedValue(mockCreatedKey)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      const response = await createKey(req)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('key-new')
      expect(mockConnectionsRepo.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'OPENAI',
          label: 'My API Key',
        })
      )
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      const response = await createKey(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should accept any non-empty string as provider (for plugin flexibility)', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const mockCreatedKey = {
        id: 'key-custom',
        provider: 'CUSTOM_PROVIDER' as const,
        label: 'Custom Provider Key',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockConnectionsRepo.createApiKey.mockResolvedValue(mockCreatedKey)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, provider: 'CUSTOM_PROVIDER' }),
      })

      const response = await createKey(req)
      const data = await response.json()

      // Should succeed even for unregistered providers (plugin system is dynamic)
      expect(response.status).toBe(201)
      expect(data.id).toBe('key-custom')
    })

    it('should return 400 when provider is missing', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'Test', apiKey: 'key' }),
      })

      const response = await createKey(req)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Invalid provider')
    })

    it('should return 400 when label is missing', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'OPENAI', apiKey: 'key' }),
      })

      const response = await createKey(req)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Label is required')
    })

    it('should return 400 when label is empty', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, label: '   ' }),
      })

      const response = await createKey(req)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Label is required')
    })

    it('should return 400 when apiKey is missing', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'OPENAI', label: 'Test' }),
      })

      const response = await createKey(req)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('API key is required')
    })

    it('should trim label whitespace', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.createApiKey.mockResolvedValue({
        id: 'key-1',
        provider: 'OPENAI' as const,
        label: 'Trimmed',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, label: '  Trimmed  ' }),
      })

      await createKey(req)

      expect(mockConnectionsRepo.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Trimmed',
        })
      )
    })

    it('should encrypt the API key', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.createApiKey.mockResolvedValue({
        id: 'key-1',
        provider: 'OPENAI' as const,
        label: 'Test',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      await createKey(req)

      expect(mockEncryptApiKey).toHaveBeenCalledWith(validBody.apiKey, 'user-123')
      expect(mockConnectionsRepo.createApiKey).toHaveBeenCalledWith(
        expect.objectContaining({
          ciphertext: 'encrypted-data',
          iv: 'iv-data',
          authTag: 'auth-tag',
        })
      )
    })

    it('should handle database errors', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      mockConnectionsRepo.createApiKey.mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      const response = await createKey(req)

      expect(response.status).toBe(500)
      expect((await response.json()).error).toBe('Failed to create API key')
    })
  })
})
