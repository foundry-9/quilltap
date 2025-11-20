/**
 * Unit Tests for API Keys Routes
 * Tests app/api/keys/route.ts and app/api/keys/[id]/route.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { getServerSession } from 'next-auth'
import { GET as getKeys, POST as createKey } from '@/app/api/keys/route'
import {
  GET as getKey,
  PUT as updateKey,
  DELETE as deleteKey,
} from '@/app/api/keys/[id]/route'
import { prisma } from '@/lib/prisma'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { Provider } from '@/lib/types/prisma'

// Mock dependencies
jest.mock('next-auth')
jest.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

// Encryption is mocked globally in jest.setup.ts
// Get the mocked versions for use in tests
const mockEncryptApiKey = jest.mocked(encryptApiKey)
const mockMaskApiKey = jest.mocked(maskApiKey)

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

  beforeEach(() => {
    // Clear mock call history
    ;(getServerSession as jest.Mock).mockClear?.()
    ;(prisma.apiKey.findMany as jest.Mock).mockClear?.()
    ;(prisma.apiKey.findFirst as jest.Mock).mockClear?.()
    ;(prisma.apiKey.create as jest.Mock).mockClear?.()
    ;(prisma.apiKey.update as jest.Mock).mockClear?.()
    ;(prisma.apiKey.delete as jest.Mock).mockClear?.()

    // Set up default mock implementations for encryption functions
    mockEncryptApiKey.mockReturnValue({
      encrypted: 'encrypted-data',
      iv: 'iv-data',
      authTag: 'auth-tag',
    })
    mockMaskApiKey.mockImplementation((key: string) => `***${key.slice(-4)}`)

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
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
          provider: Provider.OPENAI,
          label: 'My OpenAI Key',
          isActive: true,
          lastUsed: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          keyEncrypted: 'encrypted-data-here-1234567890',
        },
        {
          id: 'key-2',
          provider: Provider.ANTHROPIC,
          label: 'My Claude Key',
          isActive: false,
          lastUsed: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          keyEncrypted: 'encrypted-data-here-0987654321',
        },
      ]

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findMany as jest.Mock).mockResolvedValue(mockKeys)

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(getServerSession).toHaveBeenCalled()
      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          label: true,
          isActive: true,
          lastUsed: true,
          createdAt: true,
          updatedAt: true,
          keyEncrypted: true,
        },
      })

      expect(response.status).toBe(200)
      expect(data).toHaveLength(2)
      expect(data[0]).toHaveProperty('keyPreview')
      expect(data[0]).not.toHaveProperty('keyEncrypted')
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
      expect(prisma.apiKey.findMany).not.toHaveBeenCalled()
    })

    it('should return 401 when session has no user id', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue({ user: {} })

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)

      expect(response.status).toBe(401)
    })

    it('should return empty array when user has no keys', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findMany as jest.Mock).mockResolvedValue([])

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual([])
    })

    it('should handle database errors gracefully', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest('http://localhost:3000/api/keys')
      const response = await getKeys(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Failed to fetch API keys' })
      expect(consoleErrorSpy).toHaveBeenCalled()
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
      const mockEncrypted = {
        encrypted: 'encrypted-data',
        iv: 'iv-data',
        authTag: 'auth-tag',
      }

      const mockCreatedKey = {
        id: 'key-new',
        provider: Provider.OPENAI,
        label: 'My API Key',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.create as jest.Mock).mockResolvedValue(mockCreatedKey)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      const response = await createKey(req)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('key-new')
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            provider: 'OPENAI',
            label: 'My API Key',
          }),
        })
      )
      expect(data).toEqual(mockCreatedKey)
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

    it('should return 400 for invalid provider', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, provider: 'INVALID' }),
      })

      const response = await createKey(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Invalid provider' })
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
      ;(prisma.apiKey.create as jest.Mock).mockResolvedValue({
        id: 'key-1',
        provider: Provider.OPENAI,
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

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'Trimmed',
          }),
        })
      )
    })

    it('should handle database errors', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.create as jest.Mock).mockRejectedValue(new Error('DB Error'))

      const req = createMockRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify(validBody),
      })

      const response = await createKey(req)

      expect(response.status).toBe(500)
      expect((await response.json()).error).toBe('Failed to create API key')
    })
  })

  describe('GET /api/keys/[id]', () => {
    const mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    }

    it('should return a specific API key', async () => {
      const mockKey = {
        id: 'key-1',
        provider: Provider.OPENAI,
        label: 'My Key',
        isActive: true,
        lastUsed: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        keyEncrypted: 'encrypted-data-1234567890',
      }

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockKey)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1')
      const response = await getKey(req, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('keyPreview')
      expect(typeof data.keyPreview).toBe('string')
      expect(data).not.toHaveProperty('keyEncrypted')
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1')
      const response = await getKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(401)
    })

    it('should return 404 when key not found', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/nonexistent')
      const response = await getKey(req, {
        params: Promise.resolve({ id: 'nonexistent' }),
      })

      expect(response.status).toBe(404)
      expect((await response.json()).error).toBe('API key not found')
    })

    it('should not return keys from other users', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/other-key')
      const response = await getKey(req, {
        params: Promise.resolve({ id: 'other-key' }),
      })

      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'other-key',
          userId: 'user-123',
        },
        select: expect.any(Object),
      })
      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/keys/[id]', () => {
    const mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    }

    const mockExistingKey = {
      id: 'key-1',
      userId: 'user-123',
      provider: Provider.OPENAI,
      label: 'Old Label',
      isActive: true,
    }

    it('should update API key label', async () => {
      const mockUpdated = {
        ...mockExistingKey,
        label: 'New Label',
        lastUsed: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)
      ;(prisma.apiKey.update as jest.Mock).mockResolvedValue(mockUpdated)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ label: 'New Label' }),
      })

      const response = await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.label).toBe('New Label')
    })

    it('should update isActive status', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)
      ;(prisma.apiKey.update as jest.Mock).mockResolvedValue({
        ...mockExistingKey,
        isActive: false,
      })

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ isActive: false }),
      })

      await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isActive: false },
        select: expect.any(Object),
      })
    })

    it('should re-encrypt API key when provided', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)
      ;(prisma.apiKey.update as jest.Mock).mockResolvedValue(mockExistingKey)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-newkey123' }),
      })

      const response = await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(200)
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1' },
          data: expect.objectContaining({
            keyEncrypted: expect.any(String),
            keyIv: expect.any(String),
            keyAuthTag: expect.any(String),
          }),
        })
      )
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ label: 'New' }),
      })

      const response = await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(401)
    })

    it('should return 404 for non-existent key', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ label: 'New' }),
      })

      const response = await updateKey(req, {
        params: Promise.resolve({ id: 'nonexistent' }),
      })

      expect(response.status).toBe(404)
    })

    it('should return 400 for invalid label', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ label: '' }),
      })

      const response = await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid isActive', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'PUT',
        body: JSON.stringify({ isActive: 'true' }),
      })

      const response = await updateKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(400)
    })
  })

  describe('DELETE /api/keys/[id]', () => {
    const mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    }

    const mockExistingKey = {
      id: 'key-1',
      userId: 'user-123',
    }

    it('should delete an API key', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(mockExistingKey)
      ;(prisma.apiKey.delete as jest.Mock).mockResolvedValue(mockExistingKey)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'DELETE',
      })

      const response = await deleteKey(req, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ message: 'API key deleted successfully' })
      expect(prisma.apiKey.delete).toHaveBeenCalledWith({
        where: { id: 'key-1' },
      })
    })

    it('should return 401 for unauthenticated user', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/key-1', {
        method: 'DELETE',
      })

      const response = await deleteKey(req, { params: Promise.resolve({ id: 'key-1' }) })

      expect(response.status).toBe(401)
    })

    it('should return 404 for non-existent key', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/nonexistent', {
        method: 'DELETE',
      })

      const response = await deleteKey(req, {
        params: Promise.resolve({ id: 'nonexistent' }),
      })

      expect(response.status).toBe(404)
      expect(prisma.apiKey.delete).not.toHaveBeenCalled()
    })

    it('should not allow deleting other users keys', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
      ;(prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null)

      const req = createMockRequest('http://localhost:3000/api/keys/other-key', {
        method: 'DELETE',
      })

      const response = await deleteKey(req, {
        params: Promise.resolve({ id: 'other-key' }),
      })

      expect(response.status).toBe(404)
    })
  })
})
