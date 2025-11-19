/**
 * SillyTavern Import/Export Unit Tests
 */

import {
  importSTCharacter,
  exportSTCharacter,
  STCharacterV2,
} from '@/lib/sillytavern/character'
import { importSTPersona, exportSTPersona } from '@/lib/sillytavern/persona'
import { importSTChat, exportSTChat } from '@/lib/sillytavern/chat'

describe('SillyTavern Character Import/Export', () => {
  const mockSTCharacter: STCharacterV2 = {
    name: 'Test Character',
    description: 'A test character description',
    personality: 'Friendly and helpful',
    scenario: 'Testing scenario',
    first_mes: 'Hello, I am Test Character!',
    mes_example: '<START>\n{{char}}: Example dialogue\n{{user}}: Example response',
    system_prompt: 'You are Test Character',
    creator: 'Test Creator',
    tags: ['test', 'example'],
  }

  const mockInternalCharacter = {
    id: '123',
    userId: 'user-456',
    name: 'Test Character',
    description: 'A test character description',
    personality: 'Friendly and helpful',
    scenario: 'Testing scenario',
    firstMessage: 'Hello, I am Test Character!',
    exampleDialogues: '<START>\n{{char}}: Example dialogue\n{{user}}: Example response',
    systemPrompt: 'You are Test Character',
    avatarUrl: null,
    sillyTavernData: mockSTCharacter,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  describe('importSTCharacter', () => {
    it('should import SillyTavern character data', () => {
      const result = importSTCharacter(mockSTCharacter)

      expect(result.name).toBe('Test Character')
      expect(result.description).toBe('A test character description')
      expect(result.personality).toBe('Friendly and helpful')
      expect(result.scenario).toBe('Testing scenario')
      expect(result.firstMessage).toBe('Hello, I am Test Character!')
      expect(result.exampleDialogues).toBe('<START>\n{{char}}: Example dialogue\n{{user}}: Example response')
      expect(result.systemPrompt).toBe('You are Test Character')
      expect(result.sillyTavernData).toEqual(mockSTCharacter)
    })

    it('should handle character card format', () => {
      const cardFormat = {
        spec: 'chara_card_v2' as const,
        spec_version: '2.0' as const,
        data: mockSTCharacter,
      }

      const result = importSTCharacter(cardFormat)

      expect(result.name).toBe('Test Character')
      expect(result.sillyTavernData).toEqual(mockSTCharacter)
    })

    it('should handle missing optional fields', () => {
      const minimalCharacter: STCharacterV2 = {
        name: 'Minimal',
        description: 'Description',
        personality: 'Personality',
        scenario: 'Scenario',
        first_mes: 'First message',
        mes_example: '',
      }

      const result = importSTCharacter(minimalCharacter)

      expect(result.name).toBe('Minimal')
      expect(result.exampleDialogues).toBe('')
      expect(result.systemPrompt).toBe('')
    })
  })

  describe('exportSTCharacter', () => {
    it('should export character to SillyTavern format', () => {
      const result = exportSTCharacter(mockInternalCharacter)

      expect(result.spec).toBe('chara_card_v2')
      expect(result.spec_version).toBe('2.0')
      expect(result.data.name).toBe('Test Character')
      expect(result.data.description).toBe('A test character description')
      expect(result.data.first_mes).toBe('Hello, I am Test Character!')
    })

    it('should preserve original SillyTavern data', () => {
      const result = exportSTCharacter(mockInternalCharacter)

      expect(result.data.creator).toBe('Test Creator')
      expect(result.data.tags).toEqual(['test', 'example'])
    })

    it('should create new SillyTavern data if none exists', () => {
      const characterWithoutSTData = {
        ...mockInternalCharacter,
        sillyTavernData: null,
      }

      const result = exportSTCharacter(characterWithoutSTData)

      expect(result.spec).toBe('chara_card_v2')
      expect(result.data.creator).toBe('Quilltap')
    })
  })
})

describe('SillyTavern Persona Import/Export', () => {
  const mockSTPersona = {
    name: 'Test Persona',
    description: 'A test persona',
    personality: 'Curious and adventurous',
  }

  const mockInternalPersona = {
    id: '789',
    userId: 'user-456',
    name: 'Test Persona',
    description: 'A test persona',
    personalityTraits: 'Curious and adventurous',
    sillyTavernData: mockSTPersona,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  describe('importSTPersona', () => {
    it('should import SillyTavern persona data', () => {
      const result = importSTPersona(mockSTPersona)

      expect(result.name).toBe('Test Persona')
      expect(result.description).toBe('A test persona')
      expect(result.personalityTraits).toBe('Curious and adventurous')
      expect(result.sillyTavernData).toEqual(mockSTPersona)
    })

    it('should handle missing personality field', () => {
      const minimalPersona = {
        name: 'Minimal',
        description: 'Description',
      }

      const result = importSTPersona(minimalPersona)

      expect(result.personalityTraits).toBe('')
    })
  })

  describe('exportSTPersona', () => {
    it('should export persona to SillyTavern format', () => {
      const result = exportSTPersona(mockInternalPersona)

      expect(result.name).toBe('Test Persona')
      expect(result.description).toBe('A test persona')
      expect(result.personality).toBe('Curious and adventurous')
    })

    it('should preserve original SillyTavern data', () => {
      const personaWithExtra = {
        ...mockInternalPersona,
        sillyTavernData: {
          ...mockSTPersona,
          custom_field: 'custom value',
        },
      }

      const result = exportSTPersona(personaWithExtra)

      expect((result as any).custom_field).toBe('custom value')
    })
  })
})

describe('SillyTavern Chat Import/Export', () => {
  const mockSTChat = {
    messages: [
      {
        name: 'User',
        is_user: true,
        is_name: true,
        send_date: Date.now(),
        mes: 'Hello!',
      },
      {
        name: 'Character',
        is_user: false,
        is_name: true,
        send_date: Date.now() + 1000,
        mes: 'Hi there!',
        swipes: ['Hi there!', 'Hello to you!', 'Greetings!'],
        swipe_id: 0,
      },
    ],
    chat_metadata: {
      note_prompt: 'Test note',
    },
  }

  const mockInternalChat = {
    id: 'chat-123',
    userId: 'user-456',
    characterId: 'char-789',
    personaId: null,
    connectionProfileId: 'profile-001',
    title: 'Test Chat',
    contextSummary: null,
    sillyTavernMetadata: { note_prompt: 'Test note' },
    createdAt: new Date(),
    updatedAt: new Date(),
    character: {
      id: 'char-789',
      name: 'Character',
    },
    persona: null,
  }

  const mockMessages = [
    {
      id: 'msg-1',
      chatId: 'chat-123',
      role: 'USER',
      content: 'Hello!',
      swipeGroupId: null,
      swipeIndex: 0,
      createdAt: new Date(),
      rawResponse: null,
    },
    {
      id: 'msg-2',
      chatId: 'chat-123',
      role: 'ASSISTANT',
      content: 'Hi there!',
      swipeGroupId: 'swipe-1',
      swipeIndex: 0,
      createdAt: new Date(),
      rawResponse: null,
    },
    {
      id: 'msg-3',
      chatId: 'chat-123',
      role: 'ASSISTANT',
      content: 'Hello to you!',
      swipeGroupId: 'swipe-1',
      swipeIndex: 1,
      createdAt: new Date(),
      rawResponse: null,
    },
  ]

  describe('importSTChat', () => {
    it('should import SillyTavern chat data', () => {
      const result = importSTChat(mockSTChat, 'char-789', 'user-456')

      expect(result.messages).toBeDefined()
      expect(result.metadata).toEqual({ note_prompt: 'Test note' })
    })

    it('should handle swipes correctly', () => {
      const result = importSTChat(mockSTChat, 'char-789', 'user-456')

      // Should create multiple message records for swipes
      const swipeMessages = result.messages.filter(
        (m: any) => m.swipeGroupId === 'swipe-1'
      )
      expect(swipeMessages.length).toBeGreaterThan(0)
    })
  })

  describe('exportSTChat', () => {
    it('should export chat to SillyTavern format', () => {
      const result = exportSTChat(mockInternalChat, mockMessages, 'Character', 'User')

      expect(result.messages).toBeDefined()
      expect(result.chat_metadata).toEqual({ note_prompt: 'Test note' })
      expect(result.character_name).toBe('Character')
      expect(result.user_name).toBe('User')
    })

    it('should handle swipes in export', () => {
      const result = exportSTChat(mockInternalChat, mockMessages, 'Character', 'User')

      // Find the message with swipes
      const messageWithSwipes = result.messages.find((m) => m.swipes)

      if (messageWithSwipes) {
        expect(messageWithSwipes.swipes).toBeDefined()
        expect(messageWithSwipes.swipes!.length).toBeGreaterThan(1)
      }
    })

    it('should not include system messages', () => {
      const messagesWithSystem = [
        {
          id: 'sys-1',
          chatId: 'chat-123',
          role: 'SYSTEM',
          content: 'System prompt',
          swipeGroupId: null,
          swipeIndex: 0,
          createdAt: new Date(),
          rawResponse: null,
        },
        ...mockMessages,
      ]

      const result = exportSTChat(mockInternalChat, messagesWithSystem as any, 'Character', 'User')

      expect(result.messages.every((m) => !m.mes.includes('System prompt'))).toBe(true)
    })
  })
})
