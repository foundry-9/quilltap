/**
 * Unit Tests for Chat Initialization
 * Tests lib/chat/initialize.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { getRepositories } from '@/lib/json-store/repositories'
import { buildChatContext } from '@/lib/chat/initialize'

jest.mock('@/lib/json-store/repositories')

const mockGetRepositories = jest.mocked(getRepositories)
let mockCharactersRepo: { findById: jest.Mock }
let mockPersonasRepo: { findById: jest.Mock }

describe('buildChatContext', () => {
  const mockCharacter = {
    id: 'char-1',
    name: 'Alice',
    description: 'A friendly assistant',
    personality: 'Helpful and kind',
    scenario: 'You are helping a user with their tasks',
    firstMessage: 'Hello! How can I help you today?',
    exampleDialogues: 'User: Hi\nAlice: Hello there!',
    systemPrompt: 'You are Alice, a helpful AI assistant.',
    personaLinks: [],
    tags: [],
    userId: 'user-1',
    isFavorite: false,
    defaultImageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockPersona = {
    id: 'persona-1',
    name: 'John',
    description: 'A curious learner',
    personalityTraits: 'Inquisitive, friendly',
    tags: [],
    userId: 'user-1',
    defaultImageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockCharactersRepo = {
      findById: jest.fn(),
    }

    mockPersonasRepo = {
      findById: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      characters: mockCharactersRepo,
      personas: mockPersonasRepo,
      chats: {} as any,
      tags: {} as any,
      users: {} as any,
      connections: {} as any,
      images: {} as any,
      imageProfiles: {} as any,
    })
  })

  describe('Basic functionality', () => {
    it('should build chat context with character only', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.character).toEqual(expect.objectContaining({
        id: 'char-1',
        name: 'Alice',
      }))
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
      expect(context.persona).toBeNull()
      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should build chat context with character and specified persona', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })
      mockPersonasRepo.findById.mockResolvedValue(mockPersona)

      const context = await buildChatContext('char-1', 'persona-1')

      expect(context.persona).toEqual(expect.objectContaining({
        id: 'persona-1',
        name: 'John',
      }))
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should use default persona from character personas', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [
          {
            personaId: 'persona-1',
            isDefault: true,
          },
        ],
      })
      mockPersonasRepo.findById.mockResolvedValue(mockPersona)

      const context = await buildChatContext('char-1')

      expect(context.persona).toEqual(expect.objectContaining({
        id: 'persona-1',
        name: 'John',
      }))
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should throw error when character not found', async () => {
      mockCharactersRepo.findById.mockResolvedValue(null)

      await expect(buildChatContext('nonexistent')).rejects.toThrow('Character not found')
    })
  })

  describe('System prompt building', () => {
    it('should include character name in system prompt', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should include character description', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Character Description:')
      expect(context.systemPrompt).toContain('A friendly assistant')
    })

    it('should include personality', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Personality:')
      expect(context.systemPrompt).toContain('Helpful and kind')
    })

    it('should include roleplay instructions', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Stay in character at all times')
      expect(context.systemPrompt).toContain("Alice's personality")
    })
  })

  describe('Edge cases', () => {
    it('should handle character with null optional fields', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        exampleDialogues: null,
        systemPrompt: null,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toBeDefined()
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
    })

    it('should trim whitespace from system prompt', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        personaLinks: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).not.toMatch(/^\s/)
      expect(context.systemPrompt).not.toMatch(/\s$/)
    })
  })
})
