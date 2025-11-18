/**
 * Unit Tests for Chat Initialization
 * Tests lib/chat/initialize.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { buildChatContext } from '@/lib/chat/initialize'
import { prisma } from '@/lib/prisma'

// Create mock functions
const mockCharacterFindUnique = jest.fn()
const mockPersonaFindUnique = jest.fn()

// Mock Prisma client
jest.mock('@/lib/prisma', () => ({
  prisma: {
    character: {
      findUnique: mockCharacterFindUnique,
    },
    persona: {
      findUnique: mockPersonaFindUnique,
    },
  },
}))

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
    personas: [],
    userId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockPersona = {
    id: 'persona-1',
    name: 'John',
    description: 'A curious learner',
    personalityTraits: 'Inquisitive, friendly',
    userId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Basic functionality', () => {
    it('should build chat context with character only', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(mockCharacterFindUnique).toHaveBeenCalledWith({
        where: { id: 'char-1' },
        include: {
          personas: {
            where: { isDefault: true },
            include: { persona: true },
          },
        },
      })

      expect(context.character).toEqual(expect.objectContaining({
        id: 'char-1',
        name: 'Alice',
      }))
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
      expect(context.persona).toBeNull()
      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should build chat context with character and specified persona', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })
      mockPersonaFindUnique.mockResolvedValue(mockPersona)

      const context = await buildChatContext('char-1', 'persona-1')

      expect(mockCharacterFindUnique).toHaveBeenCalledWith({
        where: { id: 'char-1' },
        include: {
          personas: {
            where: { personaId: 'persona-1' },
            include: { persona: true },
          },
        },
      })
      expect(mockPersonaFindUnique).toHaveBeenCalledWith({
        where: { id: 'persona-1' },
      })

      expect(context.persona).toEqual(mockPersona)
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should use default persona from character personas', async () => {
      const characterWithDefaultPersona = {
        ...mockCharacter,
        personas: [
          {
            personaId: 'persona-1',
            isDefault: true,
            persona: mockPersona,
          },
        ],
      }

      mockCharacterFindUnique.mockResolvedValue(
        characterWithDefaultPersona
      )

      const context = await buildChatContext('char-1')

      expect(context.persona).toEqual(mockPersona)
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should use custom scenario when provided', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const customScenario = 'You are in a magical forest'
      const context = await buildChatContext('char-1', undefined, customScenario)

      expect(context.systemPrompt).toContain('Scenario:')
      expect(context.systemPrompt).toContain(customScenario)
      expect(context.systemPrompt).not.toContain(mockCharacter.scenario)
    })

    it('should throw error when character not found', async () => {
      mockCharacterFindUnique.mockResolvedValue(null)

      await expect(buildChatContext('nonexistent')).rejects.toThrow('Character not found')
    })
  })

  describe('System prompt building', () => {
    it('should include character name in system prompt', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should include character description', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Character Description:')
      expect(context.systemPrompt).toContain('A friendly assistant')
    })

    it('should include personality', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Personality:')
      expect(context.systemPrompt).toContain('Helpful and kind')
    })

    it('should include scenario', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Scenario:')
      expect(context.systemPrompt).toContain('You are helping a user with their tasks')
    })

    it('should include example dialogues', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Example Dialogue:')
      expect(context.systemPrompt).toContain('User: Hi\nAlice: Hello there!')
    })

    it('should include custom system prompt', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('You are Alice, a helpful AI assistant.')
    })

    it('should include persona information when present', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })
      mockPersonaFindUnique.mockResolvedValue(mockPersona)

      const context = await buildChatContext('char-1', 'persona-1')

      expect(context.systemPrompt).toContain('You are talking to John')
      expect(context.systemPrompt).toContain('A curious learner')
      expect(context.systemPrompt).toContain('They are: Inquisitive, friendly')
    })

    it('should include roleplay instructions', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Stay in character at all times')
      expect(context.systemPrompt).toContain("Alice's personality")
    })

    it('should handle character with minimal fields', async () => {
      const minimalCharacter = {
        id: 'char-2',
        name: 'Bob',
        description: '',
        personality: '',
        scenario: '',
        firstMessage: 'Hi',
        exampleDialogues: null,
        systemPrompt: null,
        personas: [],
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockCharacterFindUnique.mockResolvedValue(minimalCharacter)

      const context = await buildChatContext('char-2')

      expect(context.systemPrompt).toContain('You are roleplaying as Bob')
      expect(context.systemPrompt).toContain('Stay in character at all times')
      expect(context.systemPrompt).not.toContain('Character Description:')
      expect(context.systemPrompt).not.toContain('Personality:')
      expect(context.systemPrompt).not.toContain('Scenario:')
      expect(context.systemPrompt).not.toContain('Example Dialogue:')
    })

    it('should handle persona with minimal fields', async () => {
      const minimalPersona = {
        id: 'persona-2',
        name: 'Jane',
        description: '',
        personalityTraits: null,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })
      mockPersonaFindUnique.mockResolvedValue(minimalPersona)

      const context = await buildChatContext('char-1', 'persona-2')

      expect(context.systemPrompt).toContain('You are talking to Jane')
      expect(context.systemPrompt).not.toContain('They are:')
    })

    it('should build complete system prompt with all components', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })
      mockPersonaFindUnique.mockResolvedValue(mockPersona)

      const customScenario = 'Custom scenario text'
      const context = await buildChatContext('char-1', 'persona-1', customScenario)

      // Verify all sections are present in order
      const prompt = context.systemPrompt

      // Check order using indexes
      const systemPromptIndex = prompt.indexOf('You are Alice, a helpful AI assistant.')
      const roleplayIndex = prompt.indexOf('You are roleplaying as Alice')
      const descriptionIndex = prompt.indexOf('Character Description:')
      const personalityIndex = prompt.indexOf('Personality:')
      const personaIndex = prompt.indexOf('You are talking to John')
      const scenarioIndex = prompt.indexOf('Scenario:')
      const exampleIndex = prompt.indexOf('Example Dialogue:')
      const instructionsIndex = prompt.indexOf('Stay in character at all times')

      expect(systemPromptIndex).toBeGreaterThan(-1)
      expect(roleplayIndex).toBeGreaterThan(systemPromptIndex)
      expect(descriptionIndex).toBeGreaterThan(roleplayIndex)
      expect(personalityIndex).toBeGreaterThan(descriptionIndex)
      expect(personaIndex).toBeGreaterThan(personalityIndex)
      expect(scenarioIndex).toBeGreaterThan(personaIndex)
      expect(exampleIndex).toBeGreaterThan(scenarioIndex)
      expect(instructionsIndex).toBeGreaterThan(exampleIndex)
    })
  })

  describe('Edge cases', () => {
    it('should handle character with null optional fields', async () => {
      const characterWithNulls = {
        ...mockCharacter,
        exampleDialogues: null,
        systemPrompt: null,
        personas: [],
      }

      mockCharacterFindUnique.mockResolvedValue(characterWithNulls)

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toBeDefined()
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
    })

    it('should handle persona being null when no default exists', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.persona).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      mockCharacterFindUnique.mockRejectedValue(
        new Error('Database connection error')
      )

      await expect(buildChatContext('char-1')).rejects.toThrow('Database connection error')
    })

    it('should trim whitespace from system prompt', async () => {
      mockCharacterFindUnique.mockResolvedValue({
        ...mockCharacter,
        personas: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).not.toMatch(/^\s/)
      expect(context.systemPrompt).not.toMatch(/\s$/)
    })

    it('should handle very long system prompts', async () => {
      const longDescription = 'A'.repeat(5000)
      const characterWithLongText = {
        ...mockCharacter,
        description: longDescription,
        personas: [],
      }

      mockCharacterFindUnique.mockResolvedValue(characterWithLongText)

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain(longDescription)
      expect(context.systemPrompt.length).toBeGreaterThan(5000)
    })

    it('should handle special characters in character data', async () => {
      const specialCharacter = {
        ...mockCharacter,
        name: "O'Brien",
        description: 'Uses "quotes" and special chars: @#$%',
        scenario: 'Line 1\nLine 2\tTabbed',
        personas: [],
      }

      mockCharacterFindUnique.mockResolvedValue(specialCharacter)

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain("O'Brien")
      expect(context.systemPrompt).toContain('"quotes"')
      expect(context.systemPrompt).toContain('@#$%')
      expect(context.systemPrompt).toContain('Line 1\nLine 2\tTabbed')
    })
  })
})
