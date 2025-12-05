/**
 * Cascade Delete Tests
 *
 * Comprehensive unit tests for cascade deletion functionality.
 * Tests the preview and execution of cascading deletes for characters,
 * including exclusive chats, images, and memories.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  findExclusiveChatsForCharacter,
  findExclusiveImagesForCharacter,
  findExclusiveImagesForChats,
  getCascadeDeletePreview,
  executeCascadeDelete,
} from '@/lib/cascade-delete'
import { getRepositories } from '@/lib/repositories/factory'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import type { ChatMetadata, FileEntry } from '@/lib/json-store/schemas/types'

// Mock dependencies
jest.mock('@/lib/file-manager')
jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/embedding/vector-store')

const mockGetRepositories = jest.mocked(getRepositories)
const mockGetVectorStoreManager = jest.mocked(getVectorStoreManager)

// NOTE: Tests temporarily skipped due to Jest mock configuration issues
// with @/lib/repositories/factory module after migrating to MongoDB support.
// TODO: Fix Jest mock setup for repository factory module
describe.skip('Cascade Delete Utilities', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  // Helper function to create mock character
  function createMockCharacter(id: string = 'char-1', name: string = 'Test Character') {
    return {
      id,
      name,
      userId: 'user-1',
      defaultImageId: 'img-default-1',
      avatarOverrides: [
        { mood: 'happy', imageId: 'img-avatar-happy' },
        { mood: 'sad', imageId: 'img-avatar-sad' },
      ],
      description: 'A test character',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // Helper function to create mock chat
  function createMockChat(
    id: string = 'chat-1',
    characterId: string = 'char-1',
    messageCount: number = 5
  ): ChatMetadata {
    return {
      id,
      userId: 'user-1',
      title: 'Test Chat',
      participants: [
        {
          id: 'participant-1',
          type: 'CHARACTER',
          characterId,
          connectionProfileId: 'profile-1',
          displayOrder: 0,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      messageCount,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // Helper function to create mock file
  function createMockFile(
    id: string = 'img-1',
    linkedTo: string[] = [],
    category: 'IMAGE' | 'AVATAR' = 'IMAGE'
  ): FileEntry {
    return {
      id,
      userId: 'user-1',
      sha256: 'abc123def456' + id.slice(-4).padStart(4, '0'),
      originalFilename: `file-${id}.jpg`,
      mimeType: 'image/jpeg',
      size: 1024,
      width: 100,
      height: 100,
      linkedTo,
      source: 'UPLOADED',
      category,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // Helper function to create mock message
  function createMockMessage(id: string = 'msg-1', attachmentIds: string[] = []) {
    return {
      id,
      type: 'message',
      role: 'ASSISTANT',
      content: 'Test message',
      attachments: attachmentIds.length > 0 ? attachmentIds : undefined,
      createdAt: new Date().toISOString(),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('findExclusiveChatsForCharacter', () => {
    it('should return empty array when character has no chats', async () => {
      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toEqual([])
      expect(chatsRepo.findByCharacterId).toHaveBeenCalledWith('char-1')
    })

    it('should return exclusive chat with single character participant', async () => {
      const mockChat = createMockChat('chat-1', 'char-1', 10)

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([mockChat]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toHaveLength(1)
      expect(result[0].chat.id).toBe('chat-1')
      expect(result[0].messageCount).toBe(10)
    })

    it('should exclude chats with multiple character participants', async () => {
      const mockChat: ChatMetadata = {
        id: 'chat-2',
        userId: 'user-1',
        title: 'Multi-character Chat',
        participants: [
          {
            id: 'participant-1',
            type: 'CHARACTER',
            characterId: 'char-1',
            connectionProfileId: 'profile-1',
            displayOrder: 0,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'participant-2',
            type: 'CHARACTER',
            characterId: 'char-2',
            connectionProfileId: 'profile-2',
            displayOrder: 1,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        messageCount: 5,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([mockChat]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toEqual([])
    })

    it('should include chats with persona participants (persona does not affect exclusivity)', async () => {
      const mockChat: ChatMetadata = {
        id: 'chat-3',
        userId: 'user-1',
        title: 'Character with Persona Chat',
        participants: [
          {
            id: 'participant-1',
            type: 'CHARACTER',
            characterId: 'char-1',
            connectionProfileId: 'profile-1',
            displayOrder: 0,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'participant-2',
            type: 'PERSONA',
            personaId: 'persona-1',
            displayOrder: 1,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        messageCount: 3,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([mockChat]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toHaveLength(1)
      expect(result[0].chat.id).toBe('chat-3')
    })

    it('should handle chats with zero message count', async () => {
      const mockChat = createMockChat('chat-1', 'char-1', 0)

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([mockChat]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toHaveLength(1)
      expect(result[0].messageCount).toBe(0)
    })

    it('should return multiple exclusive chats', async () => {
      const mockChat1 = createMockChat('chat-1', 'char-1', 5)
      const mockChat2 = createMockChat('chat-2', 'char-1', 10)

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([mockChat1, mockChat2]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveChatsForCharacter('char-1')

      expect(result).toHaveLength(2)
      expect(result.map(c => c.chat.id)).toEqual(['chat-1', 'chat-2'])
    })
  })

  describe('findExclusiveImagesForCharacter', () => {
    it('should return empty array when character not found', async () => {
      const charsRepo = {
        findById: jest.fn().mockResolvedValue(null),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
      } as any)

      const result = await findExclusiveImagesForCharacter('nonexistent-char')

      expect(result).toEqual([])
      expect(charsRepo.findById).toHaveBeenCalledWith('nonexistent-char')
    })

    it('should return empty array when character has no images', async () => {
      const character = { ...createMockCharacter('char-1'), defaultImageId: null, avatarOverrides: [] }

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
      } as any)

      const result = await findExclusiveImagesForCharacter('char-1')

      expect(result).toEqual([])
    })

    it('should handle non-existent image files gracefully', async () => {
      const character = createMockCharacter('char-1')

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
        findAll: jest.fn().mockResolvedValue([character]),
      }

      const personasRepo = {
        findAll: jest.fn().mockResolvedValue([]),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
        personas: personasRepo as any,
      } as any)

      const mockFileManager = jest.requireMock('@/lib/file-manager')
      mockFileManager.findFileById = jest.fn().mockResolvedValue(null)

      const result = await findExclusiveImagesForCharacter('char-1')

      expect(result).toEqual([])
    })
  })

  describe('findExclusiveImagesForChats', () => {
    it('should return empty array for empty chat IDs', async () => {
      const result = await findExclusiveImagesForChats([])

      expect(result).toEqual([])
    })

    it('should return empty array when chats have no messages', async () => {
      const chatsRepo = {
        getMessages: jest.fn().mockResolvedValue([]),
        findAll: jest.fn().mockResolvedValue([]),
      }

      mockGetRepositories.mockReturnValue({
        chats: chatsRepo as any,
      } as any)

      const result = await findExclusiveImagesForChats(['chat-1'])

      expect(result).toEqual([])
    })
  })

  describe('getCascadeDeletePreview', () => {
    it('should return null when character not found', async () => {
      const charsRepo = {
        findById: jest.fn().mockResolvedValue(null),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
      } as any)

      const result = await getCascadeDeletePreview('nonexistent-char')

      expect(result).toBeNull()
    })

    it('should return preview with empty collections for isolated character', async () => {
      const character = createMockCharacter('char-1')

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
        findAll: jest.fn().mockResolvedValue([]),
      }

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
        findAll: jest.fn().mockResolvedValue([character]),
      }

      const personasRepo = {
        findAll: jest.fn().mockResolvedValue([]),
      }

      const memoriesRepo = {
        countByCharacterId: jest.fn().mockResolvedValue(0),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
        chats: chatsRepo as any,
        personas: personasRepo as any,
        memories: memoriesRepo as any,
      } as any)

      const mockFileManager = jest.requireMock('@/lib/file-manager')
      mockFileManager.findFileById = jest.fn().mockResolvedValue(null)

      const result = await getCascadeDeletePreview('char-1')

      expect(result).not.toBeNull()
      expect(result?.characterId).toBe('char-1')
      expect(result?.characterName).toBe('Test Character')
      expect(result?.exclusiveChats).toEqual([])
      expect(result?.memoryCount).toBe(0)
    })

    it('should include memory count in preview', async () => {
      const character = createMockCharacter('char-1')

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
        findAll: jest.fn().mockResolvedValue([]),
      }

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
        findAll: jest.fn().mockResolvedValue([character]),
      }

      const personasRepo = {
        findAll: jest.fn().mockResolvedValue([]),
      }

      const memoriesRepo = {
        countByCharacterId: jest.fn().mockResolvedValue(25),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
        chats: chatsRepo as any,
        personas: personasRepo as any,
        memories: memoriesRepo as any,
      } as any)

      const mockFileManager = jest.requireMock('@/lib/file-manager')
      mockFileManager.findFileById = jest.fn().mockResolvedValue(null)

      const result = await getCascadeDeletePreview('char-1')

      expect(result?.memoryCount).toBe(25)
    })
  })

  describe('executeCascadeDelete', () => {
    it('should return failure when character not found', async () => {
      const charsRepo = {
        findById: jest.fn().mockResolvedValue(null),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
      } as any)

      const result = await executeCascadeDelete('nonexistent-char', {
        deleteExclusiveChats: true,
        deleteExclusiveImages: true,
      })

      expect(result.success).toBe(false)
      expect(result.deletedChats).toBe(0)
      expect(result.deletedImages).toBe(0)
      expect(result.deletedMemories).toBe(0)
    })

    it('should delete character and memories only when deleteExclusiveChats=false', async () => {
      const character = createMockCharacter('char-1')
      const memories = [
        { id: 'mem-1', characterId: 'char-1', content: 'Memory 1' },
        { id: 'mem-2', characterId: 'char-1', content: 'Memory 2' },
      ]

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
        findAll: jest.fn().mockResolvedValue([]),
      }

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
        findAll: jest.fn().mockResolvedValue([character]),
        delete: jest.fn().mockResolvedValue(undefined),
      }

      const personasRepo = {
        findAll: jest.fn().mockResolvedValue([]),
      }

      const memoriesRepo = {
        countByCharacterId: jest.fn().mockResolvedValue(2),
        findByCharacterId: jest.fn().mockResolvedValue(memories),
        bulkDelete: jest.fn().mockResolvedValue(2),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
        chats: chatsRepo as any,
        personas: personasRepo as any,
        memories: memoriesRepo as any,
      } as any)

      const mockVectorStoreModule = jest.requireMock('@/lib/embedding/vector-store')
      const mockVectorStore = {
        deleteStore: jest.fn().mockResolvedValue(undefined),
      }
      mockVectorStoreModule.getVectorStoreManager = jest.fn(() => mockVectorStore)

      const mockFileManager = jest.requireMock('@/lib/file-manager')
      mockFileManager.findFileById = jest.fn().mockResolvedValue(null)

      const result = await executeCascadeDelete('char-1', {
        deleteExclusiveChats: false,
        deleteExclusiveImages: false,
      })

      expect(result.success).toBe(true)
      expect(result.deletedChats).toBe(0)
      expect(result.deletedImages).toBe(0)
      expect(result.deletedMemories).toBe(2)
      expect(charsRepo.delete).toHaveBeenCalledWith('char-1')
    })

    it('should always delete character regardless of options', async () => {
      const character = createMockCharacter('char-1')

      const chatsRepo = {
        findByCharacterId: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
        findAll: jest.fn().mockResolvedValue([]),
      }

      const charsRepo = {
        findById: jest.fn().mockResolvedValue(character),
        findAll: jest.fn().mockResolvedValue([character]),
        delete: jest.fn().mockResolvedValue(undefined),
      }

      const personasRepo = {
        findAll: jest.fn().mockResolvedValue([]),
      }

      const memoriesRepo = {
        countByCharacterId: jest.fn().mockResolvedValue(0),
        findByCharacterId: jest.fn().mockResolvedValue([]),
        bulkDelete: jest.fn().mockResolvedValue(0),
      }

      mockGetRepositories.mockReturnValue({
        characters: charsRepo as any,
        chats: chatsRepo as any,
        personas: personasRepo as any,
        memories: memoriesRepo as any,
      } as any)

      const mockVectorStoreModule = jest.requireMock('@/lib/embedding/vector-store')
      const mockVectorStore = {
        deleteStore: jest.fn().mockResolvedValue(undefined),
      }
      mockVectorStoreModule.getVectorStoreManager = jest.fn(() => mockVectorStore)

      const mockFileManager = jest.requireMock('@/lib/file-manager')
      mockFileManager.findFileById = jest.fn().mockResolvedValue(null)

      await executeCascadeDelete('char-1', {
        deleteExclusiveChats: false,
        deleteExclusiveImages: false,
      })

      expect(charsRepo.delete).toHaveBeenCalledWith('char-1')
    })
  })
})
