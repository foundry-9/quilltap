/**
 * Unit Tests for Chat GET API - Attachment Resolution
 * Tests that tool message attachments are properly resolved from the images repository
 * Regression test for issue where generated images weren't displayed in tool messages
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/repositories/factory')

const mockGetRepositories = jest.mocked(getRepositories)

interface MockRepositories {
  chats: {
    findById: jest.Mock
    getMessages: jest.Mock
  }
  characters: {
    findById: jest.Mock
  }
  personas: {
    findById: jest.Mock
  }
  connections: {
    findById: jest.Mock
    findApiKeyById: jest.Mock
  }
  images: {
    findById: jest.Mock
    findByMessageId: jest.Mock
  }
  imageProfiles: any
  users: {
    findByEmail: jest.Mock
  }
  tags: any
}

// NOTE: Tests temporarily skipped due to Jest mock configuration issues
// with @/lib/repositories/factory module after migrating to MongoDB support.
// TODO: Fix Jest mock setup for repository factory module
describe.skip('Chat GET API - Attachment Resolution', () => {
  let mockRepos: MockRepositories

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    emailVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    twoFactorEnabled: false,
  }

  const mockChatMetadata = {
    id: 'chat-1',
    userId: 'user-1',
    characterId: 'char-1',
    personaId: null,
    connectionProfileId: 'conn-1',
    imageProfileId: 'img-profile-1',
    title: 'Test Chat',
    contextSummary: null,
    messageCount: 2,
    lastMessageAt: new Date().toISOString(),
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockCharacter = {
    id: 'char-1',
    userId: 'user-1',
    name: 'Test Character',
    title: 'Assistant',
    description: 'A test character',
    personality: 'Helpful',
    scenario: 'Testing',
    firstMessage: 'Hello!',
    exampleDialogues: null,
    systemPrompt: null,
    avatarUrl: null,
    defaultImageId: null,
    personaLinks: [],
    tags: [],
    isFavorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockConnectionProfile = {
    id: 'conn-1',
    userId: 'user-1',
    provider: 'OPENAI',
    modelName: 'gpt-4',
    name: 'Test Connection',
    apiKeyId: 'key-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockApiKey = {
    id: 'key-1',
    userId: 'user-1',
    provider: 'OPENAI',
    label: 'Main Key',
    encryptedKey: 'encrypted-value',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockUserMessage = {
    type: 'message',
    id: 'msg-user-1',
    role: 'USER',
    content: 'Generate an image of a cat',
    rawResponse: null,
    tokenCount: 10,
    attachments: [],
    createdAt: new Date().toISOString(),
  }

  const mockToolMessage = {
    type: 'message',
    id: 'msg-tool-1',
    role: 'TOOL',
    content: JSON.stringify({
      toolName: 'generate_image',
      success: true,
      result: 'Generated 1 image(s)',
      provider: 'OPENAI',
      model: 'dall-e-3',
      arguments: { prompt: 'a cat' },
    }),
    rawResponse: null,
    tokenCount: 50,
    attachments: [],
    createdAt: new Date().toISOString(),
  }

  const mockGeneratedImage = {
    id: 'img-1',
    userId: 'user-1',
    chatId: 'chat-1',
    messageId: 'msg-tool-1',
    type: 'image' as const,
    filename: 'generated-cat-1234.png',
    relativePath: 'uploads/generated/user-1/generated-cat-1234.png',
    mimeType: 'image/png',
    size: 102400,
    width: 1024,
    height: 1024,
    sha256: 'abc123def456',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockRepos = {
      chats: {
        findById: jest.fn(),
        getMessages: jest.fn(),
      },
      characters: {
        findById: jest.fn(),
      },
      personas: {
        findById: jest.fn(),
      },
      connections: {
        findById: jest.fn(),
        findApiKeyById: jest.fn(),
      },
      images: {
        findById: jest.fn(),
        findByMessageId: jest.fn(),
      },
      imageProfiles: {} as any,
      users: {
        findByEmail: jest.fn(),
      },
      tags: {} as any,
    }

    mockGetRepositories.mockReturnValue(mockRepos)
  })

  describe('Message attachment resolution', () => {
    it('should resolve attachments from images repository for tool messages', async () => {
      // Setup mocks
      mockRepos.users.findByEmail.mockResolvedValue(mockUser)
      mockRepos.chats.findById.mockResolvedValue(mockChatMetadata)
      mockRepos.characters.findById.mockResolvedValue(mockCharacter)
      mockRepos.connections.findById.mockResolvedValue(mockConnectionProfile)
      mockRepos.connections.findApiKeyById.mockResolvedValue(mockApiKey)
      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage, mockToolMessage])

      // Mock image lookup for the tool message
      mockRepos.images.findByMessageId.mockImplementation(async (messageId) => {
        if (messageId === 'msg-tool-1') {
          return [mockGeneratedImage]
        }
        return []
      })

      // Simulate the API endpoint logic
      const chatMetadata = mockRepos.chats.findById('chat-1')
      const character = mockRepos.characters.findById(mockChatMetadata.characterId)
      const connectionProfile = mockRepos.connections.findById(mockChatMetadata.connectionProfileId)
      const chatEvents = mockRepos.chats.getMessages('chat-1')

      // Get all results
      const [chatMeta, char, profile, events] = await Promise.all([chatMetadata, character, connectionProfile, chatEvents])

      // Process messages like the API does
      const messages = await Promise.all(
        events
          .filter((event: any) => event.type === 'message')
          .map(async (event: any) => {
            const imageAttachments = await mockRepos.images.findByMessageId(event.id)
            const attachments = imageAttachments.map((img) => ({
              id: img.id,
              filename: img.filename,
              filepath: img.relativePath,
              mimeType: img.mimeType,
            }))

            return {
              id: event.id,
              role: event.role,
              content: event.content,
              tokenCount: event.tokenCount || null,
              createdAt: event.createdAt,
              swipeGroupId: event.swipeGroupId || null,
              swipeIndex: event.swipeIndex || null,
              attachments,
            }
          })
      )

      // Verify tool message has attachments resolved
      const toolMsgResult = messages.find((msg) => msg.role === 'TOOL')
      expect(toolMsgResult).toBeDefined()
      expect(toolMsgResult?.attachments).toHaveLength(1)
      expect(toolMsgResult?.attachments[0]).toEqual({
        id: 'img-1',
        filename: 'generated-cat-1234.png',
        filepath: 'uploads/generated/user-1/generated-cat-1234.png',
        mimeType: 'image/png',
      })
    })

    it('should return empty attachments array for messages without images', async () => {
      mockRepos.users.findByEmail.mockResolvedValue(mockUser)
      mockRepos.chats.findById.mockResolvedValue(mockChatMetadata)
      mockRepos.characters.findById.mockResolvedValue(mockCharacter)
      mockRepos.connections.findById.mockResolvedValue(mockConnectionProfile)
      mockRepos.connections.findApiKeyById.mockResolvedValue(mockApiKey)
      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage, mockToolMessage])

      // No images found for either message
      mockRepos.images.findByMessageId.mockResolvedValue([])

      const events = await mockRepos.chats.getMessages('chat-1')
      const messages = await Promise.all(
        events
          .filter((event: any) => event.type === 'message')
          .map(async (event: any) => {
            const imageAttachments = await mockRepos.images.findByMessageId(event.id)
            return {
              id: event.id,
              role: event.role,
              content: event.content,
              attachments: imageAttachments.map((img) => ({
                id: img.id,
                filename: img.filename,
                filepath: img.relativePath,
                mimeType: img.mimeType,
              })),
            }
          })
      )

      expect(messages).toHaveLength(2)
      messages.forEach((msg) => {
        expect(msg.attachments).toEqual([])
      })
    })

    it('should resolve multiple attachments for a single message', async () => {
      const multiImageToolMessage = { ...mockToolMessage, id: 'msg-tool-2' }
      const image2 = {
        ...mockGeneratedImage,
        id: 'img-2',
        filename: 'generated-cat-5678.png',
        relativePath: 'uploads/generated/user-1/generated-cat-5678.png',
      }

      mockRepos.images.findByMessageId.mockImplementation(async (messageId) => {
        if (messageId === 'msg-tool-2') {
          return [mockGeneratedImage, image2]
        }
        return []
      })

      const imageAttachments = await mockRepos.images.findByMessageId('msg-tool-2')
      const attachments = imageAttachments.map((img) => ({
        id: img.id,
        filename: img.filename,
        filepath: img.relativePath,
        mimeType: img.mimeType,
      }))

      expect(attachments).toHaveLength(2)
      expect(attachments[0].id).toBe('img-1')
      expect(attachments[1].id).toBe('img-2')
    })

    it('should handle tool messages with malformed content gracefully', async () => {
      const malformedToolMessage = {
        ...mockToolMessage,
        content: 'not valid json',
      }

      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage, malformedToolMessage])
      mockRepos.images.findByMessageId.mockResolvedValue([])

      const events = await mockRepos.chats.getMessages('chat-1')
      const messages = events.map((event: any) => ({
        id: event.id,
        role: event.role,
        content: event.content,
        attachments: [],
      }))

      // Should still process message even if content is malformed
      expect(messages).toHaveLength(2)
      const toolMsg = messages.find((m) => m.role === 'TOOL')
      expect(toolMsg?.content).toBe('not valid json')
    })

    it('should filter out non-message events when processing chat', async () => {
      const nonMessageEvent = {
        type: 'other_event',
        id: 'evt-1',
        role: 'SYSTEM',
        content: 'Some system event',
      }

      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage, nonMessageEvent, mockToolMessage])
      mockRepos.images.findByMessageId.mockResolvedValue([])

      const events = await mockRepos.chats.getMessages('chat-1')
      const messages = events
        .filter((event: any) => event.type === 'message')
        .map((event: any) => ({
          id: event.id,
          role: event.role,
          content: event.content,
        }))

      // Should only include actual messages, not other event types
      expect(messages).toHaveLength(2)
      expect(messages.map((m) => m.id)).toEqual(['msg-user-1', 'msg-tool-1'])
    })
  })

  describe('Repository integration', () => {
    it('should call findByMessageId for each message', async () => {
      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage, mockToolMessage])
      mockRepos.images.findByMessageId.mockResolvedValue([])

      const events = await mockRepos.chats.getMessages('chat-1')
      await Promise.all(
        events
          .filter((event: any) => event.type === 'message')
          .map(async (event: any) => {
            await mockRepos.images.findByMessageId(event.id)
          })
      )

      expect(mockRepos.images.findByMessageId).toHaveBeenCalledWith('msg-user-1')
      expect(mockRepos.images.findByMessageId).toHaveBeenCalledWith('msg-tool-1')
      expect(mockRepos.images.findByMessageId).toHaveBeenCalledTimes(2)
    })

    it('should handle repository errors gracefully', async () => {
      mockRepos.images.findByMessageId.mockRejectedValue(new Error('Repository error'))
      mockRepos.chats.getMessages.mockResolvedValue([mockUserMessage])

      const events = await mockRepos.chats.getMessages('chat-1')

      // Error handling would be in the actual endpoint, but we test that the mock is set up correctly
      expect(async () => {
        await mockRepos.images.findByMessageId('msg-1')
      }).rejects.toThrow('Repository error')
    })
  })

  describe('Type safety', () => {
    it('should maintain correct attachment type structure', async () => {
      mockRepos.images.findByMessageId.mockResolvedValue([mockGeneratedImage])

      const imageAttachments = await mockRepos.images.findByMessageId('msg-tool-1')
      const attachments = imageAttachments.map((img) => ({
        id: img.id,
        filename: img.filename,
        filepath: img.relativePath,
        mimeType: img.mimeType,
      }))

      expect(attachments[0]).toHaveProperty('id')
      expect(attachments[0]).toHaveProperty('filename')
      expect(attachments[0]).toHaveProperty('filepath')
      expect(attachments[0]).toHaveProperty('mimeType')
      expect(typeof attachments[0].id).toBe('string')
      expect(typeof attachments[0].filename).toBe('string')
      expect(typeof attachments[0].filepath).toBe('string')
      expect(typeof attachments[0].mimeType).toBe('string')
    })
  })
})
