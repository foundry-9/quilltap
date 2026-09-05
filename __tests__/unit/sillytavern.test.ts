/**
 * SillyTavern Import/Export Unit Tests
 */

import {
  importSTCharacter,
  exportSTCharacter,
  STCharacterV2,
} from '@/lib/sillytavern/character'
import { importSTChat, exportSTChat, exportSTChatAsJSONL } from '@/lib/sillytavern/chat'
import { parseSTFile } from '@/lib/sillytavern/multi-char-parser'

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

  const now = new Date().toISOString()
  const mockInternalCharacter = {
    id: '123',
    userId: 'user-456',
    name: 'Test Character',
    description: 'A test character description',
    personality: 'Friendly and helpful',
    scenarios: [{ id: 'test-scenario-id', title: 'Default', content: 'Testing scenario', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
    firstMessage: 'Hello, I am Test Character!',
    exampleDialogues: '<START>\n{{char}}: Example dialogue\n{{user}}: Example response',
    systemPrompts: [{
      id: 'prompt-1',
      name: 'Default',
      content: 'You are Test Character',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }],
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
      expect(result.scenarios).toHaveLength(1)
      expect(result.scenarios[0].content).toBe('Testing scenario')
      expect(result.firstMessage).toBe('Hello, I am Test Character!')
      expect(result.exampleDialogues).toBe('<START>\n{{char}}: Example dialogue\n{{user}}: Example response')
      expect(result.systemPrompts).toHaveLength(1)
      expect(result.systemPrompts[0].content).toBe('You are Test Character')
      expect(result.systemPrompts[0].isDefault).toBe(true)
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
      expect(result.systemPrompts).toHaveLength(0)
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

    it('should attribute each message to its own participant in multi-character chats', () => {
      // Regression: every assistant line used to be stamped with the first
      // character's name. Each message must keep its real author.
      const participantNames = new Map<string, string>([
        ['participant-alice', 'Alice'],
        ['participant-bob', 'Bob'],
        ['participant-carol', 'Carol'], // user-controlled character
      ])

      const multiCharMessages = [
        {
          id: 'mc-1',
          role: 'USER',
          content: "Carol's line",
          swipeGroupId: null,
          swipeIndex: 0,
          createdAt: new Date(),
          rawResponse: null,
          participantId: 'participant-carol', // user-controlled character
        },
        {
          id: 'mc-2',
          role: 'ASSISTANT',
          content: "Alice's line",
          swipeGroupId: null,
          swipeIndex: 0,
          createdAt: new Date(),
          rawResponse: null,
          participantId: 'participant-alice',
        },
        {
          id: 'mc-3',
          role: 'ASSISTANT',
          content: "Bob's line",
          swipeGroupId: null,
          swipeIndex: 0,
          createdAt: new Date(),
          rawResponse: null,
          participantId: 'participant-bob',
        },
      ]

      const result = exportSTChat(
        mockInternalChat,
        multiCharMessages,
        'Alice', // primary / fallback name
        'Operator',
        participantNames
      )

      const byContent = (text: string) => result.messages.find((m) => m.mes === text)!

      // Each assistant message keeps its OWN speaker — not the first character's.
      expect(byContent("Alice's line").name).toBe('Alice')
      expect(byContent("Bob's line").name).toBe('Bob')

      // A user-controlled character exports under the character's name, not the
      // human operator's name.
      expect(byContent("Carol's line").name).toBe('Carol')
    })

    it('should fall back to role-based names when a message has no participantId', () => {
      // Legacy / single-character messages carry no participantId, so the
      // role-based character/user names still apply.
      const result = exportSTChat(mockInternalChat, mockMessages, 'Character', 'User', new Map())

      const userMsg = result.messages.find((m) => m.is_user)
      const assistantMsg = result.messages.find((m) => !m.is_user)
      expect(userMsg?.name).toBe('User')
      expect(assistantMsg?.name).toBe('Character')
    })
  })

  describe('exportSTChatAsJSONL', () => {
    it('should export chat as JSONL with header on first line', () => {
      const result = exportSTChatAsJSONL(mockInternalChat, mockMessages, 'Character', 'User')

      const lines = result.split('\n')
      expect(lines.length).toBeGreaterThan(1)

      // First line should be header with metadata
      const header = JSON.parse(lines[0])
      expect(header.user_name).toBe('User')
      expect(header.character_name).toBe('Character')
      expect(header.chat_metadata).toBeDefined()
      expect(header.create_date).toBeDefined()
    })

    it('should have individual messages on subsequent lines', () => {
      const result = exportSTChatAsJSONL(mockInternalChat, mockMessages, 'Character', 'User')

      const lines = result.split('\n')
      // Header + messages (3 messages, but 2 are swipes so should be 2 message lines)
      expect(lines.length).toBeGreaterThanOrEqual(2)

      // Each line after header should be a valid message object
      for (let i = 1; i < lines.length; i++) {
        const msg = JSON.parse(lines[i])
        expect(msg.name).toBeDefined()
        expect(msg.mes).toBeDefined()
        expect(typeof msg.is_user).toBe('boolean')
      }
    })

    it('should produce output that can be re-imported via parseSTFile', () => {
      const jsonlContent = exportSTChatAsJSONL(mockInternalChat, mockMessages, 'Character', 'User')

      // This should now work since parseSTFile handles JSONL properly
      const parsed = parseSTFile(jsonlContent, 'test.jsonl')

      expect(parsed.messages.length).toBeGreaterThan(0)
      expect(parsed.metadata.characterName).toBe('Character')
      expect(parsed.metadata.userName).toBe('User')
    })
  })
})

describe('SillyTavern File Format Detection', () => {
  describe('parseSTFile', () => {
    it('should parse JSON file with messages array', () => {
      const jsonContent = JSON.stringify({
        messages: [
          { name: 'User', is_user: true, mes: 'Hello!', send_date: Date.now() },
          { name: 'Bot', is_user: false, mes: 'Hi!', send_date: Date.now() },
        ],
        character_name: 'Bot',
        user_name: 'User',
      })

      const result = parseSTFile(jsonContent, 'test.json')

      expect(result.messages).toHaveLength(2)
      expect(result.metadata.characterName).toBe('Bot')
      expect(result.metadata.userName).toBe('User')
    })

    it('should parse JSON file even with .jsonl extension (Quilltap export format)', () => {
      // This simulates a Quilltap export which is JSON but has .jsonl extension
      const jsonContent = JSON.stringify({
        messages: [
          { name: 'User', is_user: true, mes: 'Hello!', send_date: Date.now() },
          { name: 'Character', is_user: false, mes: 'Hi there!', send_date: Date.now() },
        ],
        chat_metadata: { note_prompt: 'Test' },
        character_name: 'Character',
        user_name: 'User',
        create_date: Date.now(),
      }, null, 2) // Pretty-printed like Quilltap exports

      const result = parseSTFile(jsonContent, 'Character_chat_1234567890.jsonl')

      expect(result.messages).toHaveLength(2)
      expect(result.metadata.characterName).toBe('Character')
      expect(result.metadata.userName).toBe('User')
      expect(result.speakers).toHaveLength(2)
    })

    it('should parse actual JSONL format (line-delimited)', () => {
      const jsonlContent = [
        JSON.stringify({ chat_metadata: { note: 'test' }, character_name: 'Bot', user_name: 'User' }),
        JSON.stringify({ name: 'User', is_user: true, mes: 'Hello!', send_date: Date.now() }),
        JSON.stringify({ name: 'Bot', is_user: false, mes: 'Hi!', send_date: Date.now() }),
      ].join('\n')

      const result = parseSTFile(jsonlContent, 'chat.jsonl')

      expect(result.messages).toHaveLength(2)
      expect(result.metadata.characterName).toBe('Bot')
    })

    it('should parse array of messages format', () => {
      const arrayContent = JSON.stringify([
        { name: 'User', is_user: true, mes: 'Hello!', send_date: Date.now() },
        { name: 'Bot', is_user: false, mes: 'Hi!', send_date: Date.now() },
      ])

      const result = parseSTFile(arrayContent, 'test.json')

      expect(result.messages).toHaveLength(2)
    })

    it('should extract unique speakers correctly', () => {
      const jsonContent = JSON.stringify({
        messages: [
          { name: 'Alice', is_user: true, mes: 'Hello!', send_date: Date.now() },
          { name: 'Bob', is_user: false, mes: 'Hi!', send_date: Date.now() },
          { name: 'Alice', is_user: true, mes: 'How are you?', send_date: Date.now() },
          { name: 'Bob', is_user: false, mes: 'Good!', send_date: Date.now() },
        ],
      })

      const result = parseSTFile(jsonContent, 'test.json')

      expect(result.speakers).toHaveLength(2)
      expect(result.speakers.find(s => s.name === 'Alice')?.messageCount).toBe(2)
      expect(result.speakers.find(s => s.name === 'Bob')?.messageCount).toBe(2)
    })

    it('should throw error for empty files', () => {
      expect(() => parseSTFile('', 'test.json')).toThrow()
    })

    it('should throw error for files with no messages', () => {
      const noMessages = JSON.stringify({ chat_metadata: {} })

      expect(() => parseSTFile(noMessages, 'test.json')).toThrow('No messages found')
    })
  })
})
