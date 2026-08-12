/**
 * Unit Tests for Cheap LLM Tasks Service
 * Tests lib/memory/cheap-llm-tasks.ts
 * Sprint 2: Memory System - Background LLM Tasks
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

// Mock the dependencies
jest.mock('@/lib/llm/plugin-factory')
jest.mock('@/lib/repositories/factory')

// Import the mocked modules
import { createLLMProvider } from '@/lib/llm'
import { getRepositories } from '@/lib/repositories/factory'

// Import the module under test AFTER mocking
import {
  extractOtherMemoriesFromTurn,
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
  batchExtractMemories,
  type MemoryCandidate,
  type ChatMessage,
  type OtherSubjectInput,
} from '@/lib/memory/cheap-llm-tasks'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'

/**
 * Build a TurnTranscript fixture for the user-pass extraction tests.
 * Single character + single user message — matches the shape the prior
 * per-message tests exercised.
 */
function makeTurnTranscript(opts: {
  userMessage: string | null
  userCharacterName?: string
  characterName: string
  characterText: string
}): TurnTranscript {
  return {
    turnOpenerMessageId: opts.userMessage === null ? null : 'turn-opener-id',
    userMessage: opts.userMessage,
    userCharacterId: opts.userCharacterName ? 'user-char-id' : undefined,
    userCharacterName: opts.userCharacterName,
    userCharacterPronouns: null,
    characterSlices: [{
      characterId: 'char-1',
      characterName: opts.characterName,
      characterPronouns: null,
      text: opts.characterText,
      contributingMessageIds: ['assistant-id-1'],
    }],
    latestAssistantMessageId: 'assistant-id-1',
  }
}

// Mock provider instance
const mockSendMessage = jest.fn()
const mockProvider = {
  sendMessage: mockSendMessage,
  streamMessage: jest.fn(),
  validateApiKey: jest.fn(),
  getAvailableModels: jest.fn(),
  generateImage: jest.fn(),
  supportsFileAttachments: true,
  supportedMimeTypes: ['image/jpeg', 'image/png'],
  supportsImageGeneration: false,
}

// Mock repositories
const mockFindById = jest.fn()
const mockFindApiKeyById = jest.fn()
const mockFindApiKeyByIdAndUserId = jest.fn()
const mockRepos = {
  connections: {
    findById: mockFindById,
    findApiKeyById: mockFindApiKeyById,
    findApiKeyByIdAndUserId: mockFindApiKeyByIdAndUserId,
  },
}

// Test fixtures
const testSelection: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
  connectionProfileId: 'test-profile-id',
  isLocal: false,
}

const localSelection: CheapLLMSelection = {
  provider: 'OLLAMA',
  modelName: 'llama3.2:3b',
  baseUrl: 'http://localhost:11434',
  connectionProfileId: 'ollama-profile-id',
  isLocal: true,
}

const testUserId = 'test-user-id'

describe('Cheap LLM Tasks Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Setup default mocks
    ;(createLLMProvider as jest.Mock).mockReturnValue(mockProvider)
    ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

    mockFindById.mockResolvedValue({
      id: 'test-profile-id',
      apiKeyId: 'test-api-key-id',
    })

    mockFindApiKeyById.mockResolvedValue({
      id: 'test-api-key-id',
      key_value: 'decrypted-api-key',
    })

    mockFindApiKeyByIdAndUserId.mockResolvedValue({
      id: 'test-api-key-id',
      key_value: 'decrypted-api-key',
    })
  })

  describe('extractOtherMemoriesFromTurn (multi-subject)', () => {
    const userSubject: OtherSubjectInput = {
      id: 'user-char-id',
      name: 'John',
      pronouns: null,
      isUser: true,
      canonBlock: 'ALREADY ESTABLISHED about John\nThe operator.',
    }

    const callExtract = (
      transcript: TurnTranscript,
      subjects: OtherSubjectInput[] = [userSubject],
      selection = testSelection,
    ) =>
      extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        subjects,
        selection,
        testUserId,
      )

    it('routes a single-subject extraction back to the subject id', async () => {
      mockSendMessage.mockResolvedValue({
        content: JSON.stringify([{
          subjectIndex: 1,
          content: 'User mentioned they have a cat named Whiskers',
          summary: 'User has a cat named Whiskers',
          keywords: ['cat', 'pet', 'Whiskers'],
          importance: 0.7,
        }]),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'I need to go feed my cat Whiskers',
        userCharacterName: 'John',
        characterName: 'Luna',
        characterText: 'That sounds like a lovely cat! I hope Whiskers enjoys their meal.',
      })

      const result = await callExtract(transcript)

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toEqual([{
        content: 'User mentioned they have a cat named Whiskers',
        summary: 'User has a cat named Whiskers',
        // Free keywords, then the three defaulted targeting tags (no tags in input).
        keywords: ['cat', 'pet', 'Whiskers', 'present', 'scope: wide', 'information'],
        importance: 0.7,
        // Episodic spine defaults (no EVENT fields in input).
        kind: 'semantic',
        when: undefined,
        entities: undefined,
      }])
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    })

    it('splits items across subjects by 1-based subjectIndex', async () => {
      const otherSubject: OtherSubjectInput = {
        id: 'char-2',
        name: 'Beatrice',
        pronouns: null,
        isUser: false,
        canonBlock: 'ALREADY ESTABLISHED about Beatrice\nA stoic engineer.',
      }

      mockSendMessage.mockResolvedValue({
        content: JSON.stringify([
          { subjectIndex: 1, content: 'About John', summary: 'john', keywords: [], importance: 0.6 },
          { subjectIndex: 2, content: 'About Beatrice', summary: 'beatrice', keywords: [], importance: 0.6 },
        ]),
        usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Hi everyone',
        userCharacterName: 'John',
        characterName: 'Luna',
        characterText: 'Welcome.',
      })

      const result = await extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        [userSubject, otherSubject],
        testSelection,
        testUserId,
      )

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')?.[0]?.content).toBe('About John')
      expect(map.get('char-2')?.[0]?.content).toBe('About Beatrice')
    })

    it('drops items whose subjectIndex is missing or out of range', async () => {
      mockSendMessage.mockResolvedValue({
        content: JSON.stringify([
          { content: 'no index', summary: 'a', keywords: [], importance: 0.6 },
          { subjectIndex: 99, content: 'out of range', summary: 'b', keywords: [], importance: 0.6 },
          { subjectIndex: 1, content: 'ok', summary: 'c', keywords: [], importance: 0.6 },
        ]),
        usage: null,
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Hi',
        userCharacterName: 'John',
        characterName: 'Luna',
        characterText: 'Hello.',
      })

      const result = await callExtract(transcript)
      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toEqual([
        {
          content: 'ok',
          summary: 'c',
          keywords: ['present', 'scope: wide', 'information'],
          importance: 0.6,
          kind: 'semantic',
          when: undefined,
          entities: undefined,
        },
      ])
    })

    it('handles an empty array response (no significant memories surfaced)', async () => {
      mockSendMessage.mockResolvedValue({
        content: '[]',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Hello!',
        userCharacterName: 'John',
        characterName: 'Luna',
        characterText: 'Hi there! How are you?',
      })

      const result = await callExtract(transcript)

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toEqual([])
    })

    it('handles JSON wrapped in markdown code blocks', async () => {
      mockSendMessage.mockResolvedValue({
        content: '```json\n[{ "subjectIndex": 1, "content": "Test", "summary": "Test summary", "keywords": [], "importance": 0.5 }]\n```',
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Test message',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Test response',
      })

      const result = await callExtract(transcript)

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toHaveLength(1)
      expect(map.get('user-char-id')?.[0]?.content).toBe('Test')
    })

    it('handles malformed JSON gracefully', async () => {
      mockSendMessage.mockResolvedValue({
        content: 'This is not valid JSON',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Test',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Response',
      })

      const result = await callExtract(transcript)

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toEqual([])
    })

    it('works with local Ollama provider', async () => {
      mockSendMessage.mockResolvedValue({
        content: '[]',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Hello',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Hi',
      })

      const result = await callExtract(transcript, undefined, localSelection)

      expect(result.success).toBe(true)
      expect(createLLMProvider).toHaveBeenCalledWith('OLLAMA', 'http://localhost:11434')
    })

    it('returns an error when no API key is available', async () => {
      mockFindById.mockResolvedValue({ id: 'test-profile-id', apiKeyId: null })

      const transcript = makeTurnTranscript({
        userMessage: 'Hello',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Hi',
      })

      const result = await callExtract(transcript)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No API key')
    })

    it('returns empty (no LLM call) when the observer is not in the transcript', async () => {
      const transcript = makeTurnTranscript({
        userMessage: 'Hello',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Hi',
      })

      const result = await extractOtherMemoriesFromTurn(
        transcript,
        'unknown-observer',
        [userSubject],
        testSelection,
        testUserId,
      )

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toEqual([])
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('returns empty (no LLM call) when the subjects list is empty', async () => {
      const transcript = makeTurnTranscript({
        userMessage: 'Hello',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Hi',
      })

      const result = await extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        [],
        testSelection,
        testUserId,
      )

      expect(result.success).toBe(true)
      expect((result.result as Map<string, MemoryCandidate[]>).size).toBe(0)
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('caps candidates per subject when the LLM overshoots', async () => {
      // 12 items, all targeting subject 1 — hard cap is 2 per subject so
      // only the first 2 should land in the bucket.
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        subjectIndex: 1,
        content: `Fact ${i}`,
        summary: `Summary ${i}`,
        keywords: ['k'],
        importance: 0.6,
      }))

      mockSendMessage.mockResolvedValue({
        content: JSON.stringify(candidates),
        usage: { promptTokens: 100, completionTokens: 500, totalTokens: 600 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'User message',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Assistant message',
      })

      const result = await extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        [userSubject],
        testSelection,
        testUserId,
        undefined,
        undefined,
        128000, // large output budget would otherwise raise the cap
      )

      expect(result.success).toBe(true)
      const map = result.result as Map<string, MemoryCandidate[]>
      expect(map.get('user-char-id')).toHaveLength(2)
    })

    it('injects every subject canon block into the system prompt', async () => {
      mockSendMessage.mockResolvedValue({
        content: '[]',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const transcript = makeTurnTranscript({
        userMessage: 'Hi',
        userCharacterName: 'John',
        characterName: 'Luna',
        characterText: 'Hello.',
      })

      const otherSubject: OtherSubjectInput = {
        id: 'char-2',
        name: 'Beatrice',
        pronouns: null,
        isUser: false,
        canonBlock: 'ALREADY ESTABLISHED about Beatrice\nReads philosophy.',
      }

      await extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        [
          { ...userSubject, canonBlock: 'ALREADY ESTABLISHED about John\nLikes jazz.' },
          otherSubject,
        ],
        testSelection,
        testUserId,
      )

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringMatching(/Likes jazz[\s\S]*Reads philosophy/),
            }),
          ]),
        }),
        'decrypted-api-key',
      )
    })
  })

  describe('summarizeChat', () => {
    it('should summarize a conversation', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Tell me about the weather' },
        { role: 'assistant', content: 'It is sunny today with temperatures around 75°F' },
        { role: 'user', content: 'Great, should I bring a jacket?' },
        { role: 'assistant', content: 'A light jacket might be nice for the evening.' },
      ]

      const summary = 'The user asked about the weather. The assistant reported sunny conditions with 75°F temperatures and recommended bringing a light jacket for evening.'

      mockSendMessage.mockResolvedValue({
        content: summary,
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      })

      const result = await summarizeChat(messages, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe(summary)
    })

    it('should handle empty message list', async () => {
      mockSendMessage.mockResolvedValue({
        content: 'No conversation to summarize.',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const result = await summarizeChat([], testSelection, testUserId)

      expect(result.success).toBe(true)
    })
  })

  describe('titleChat', () => {
    it('should generate a title for a new chat', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Can you help me plan a birthday party?' },
        { role: 'assistant', content: 'I would love to help! What kind of theme are you thinking?' },
      ]

      mockSendMessage.mockResolvedValue({
        content: 'Planning a Birthday Party',
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      })

      const result = await titleChat(messages, undefined, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe('Planning a Birthday Party')
    })

    it('should remove quotes from generated title', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Tell me a story' },
      ]

      mockSendMessage.mockResolvedValue({
        content: '"Story Time Adventure"',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const result = await titleChat(messages, undefined, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe('Story Time Adventure')
    })

    it('should truncate very long titles', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]

      mockSendMessage.mockResolvedValue({
        content: 'This is an extremely long title that goes on and on and definitely exceeds the maximum allowed length',
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      })

      const result = await titleChat(messages, undefined, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result!.length).toBeLessThanOrEqual(50)
      expect(result.result).toContain('...')
    })

    it('should consider existing title when updating', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Actually, let us talk about cooking instead' },
      ]

      mockSendMessage.mockResolvedValue({
        content: 'Cooking Discussion',
        usage: { promptTokens: 80, completionTokens: 10, totalTokens: 90 },
      })

      const result = await titleChat(messages, 'Birthday Party Planning', testSelection, testUserId)

      expect(result.success).toBe(true)
      // Verify the system prompt includes the existing title
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('Birthday Party Planning'),
            }),
          ]),
        }),
        'decrypted-api-key'
      )
    })
  })

  describe('updateContextSummary', () => {
    it('should update context summary with new messages', async () => {
      const currentSummary = 'User and assistant discussed the weather.'
      const newMessages: ChatMessage[] = [
        { role: 'user', content: 'Now let us talk about dinner plans' },
        { role: 'assistant', content: 'Sure! What cuisine are you in the mood for?' },
      ]

      const updatedSummary = 'User and assistant discussed the weather, then moved on to dinner planning, exploring cuisine preferences.'

      mockSendMessage.mockResolvedValue({
        content: updatedSummary,
        usage: { promptTokens: 150, completionTokens: 50, totalTokens: 200 },
      })

      const result = await updateContextSummary(currentSummary, newMessages, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe(updatedSummary)
    })
  })

  describe('describeAttachment', () => {
    it('should return basic description for non-image files', async () => {
      const attachment = {
        id: 'file-id',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        data: 'base64data',
      }

      const result = await describeAttachment(attachment, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe('File: document.pdf (application/pdf)')
      // Should not call LLM for non-image files
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should describe image attachments using LLM', async () => {
      const attachment = {
        id: 'image-id',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        data: 'base64imagedata',
      }

      mockSendMessage.mockResolvedValue({
        content: 'A scenic photograph of a mountain landscape at sunset.',
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      })

      const result = await describeAttachment(attachment, testSelection, testUserId)

      expect(result.success).toBe(true)
      expect(result.result).toBe('A scenic photograph of a mountain landscape at sunset.')
    })

    it('should return error when no attachment data provided', async () => {
      const attachment = {
        id: 'image-id',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
      }

      const result = await describeAttachment(attachment, testSelection, testUserId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No attachment data')
    })
  })

  describe('batchExtractMemories', () => {
    it('should extract memories from multiple exchanges', async () => {
      const exchanges = [
        {
          userMessage: 'My favorite color is blue',
          assistantMessage: 'Blue is a lovely color!',
        },
        {
          userMessage: 'Just saying hello',
          assistantMessage: 'Hello to you too!',
        },
      ]

      const batchResponse: MemoryCandidate[] = [
        {
          content: 'User favorite color is blue',
          summary: 'Favorite color: blue',
          keywords: ['color', 'blue', 'favorite'],
          importance: 0.6,
        },
      ]

      mockSendMessage.mockResolvedValue({
        content: JSON.stringify(batchResponse),
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      })

      const result = await batchExtractMemories(
        exchanges,
        'Character: Luna',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result).toHaveLength(1)
      expect(result.result![0].content).toBe('User favorite color is blue')
    })

    it('should handle malformed batch response', async () => {
      mockSendMessage.mockResolvedValue({
        content: 'Invalid response',
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      })

      const result = await batchExtractMemories(
        [{ userMessage: 'Test', assistantMessage: 'Response' }],
        'Context',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result).toEqual([])
    })
  })

  describe('Error handling', () => {
    it('should handle LLM provider errors gracefully', async () => {
      mockSendMessage.mockRejectedValue(new Error('API rate limit exceeded'))

      const transcript = makeTurnTranscript({
        userMessage: 'Test',
        userCharacterName: 'John',
        characterName: 'TestChar',
        characterText: 'Response',
      })

      const result = await extractOtherMemoriesFromTurn(
        transcript,
        'char-1',
        [{
          id: 'user-char-id',
          name: 'John',
          pronouns: null,
          isUser: true,
          canonBlock: 'CANON',
        }],
        testSelection,
        testUserId,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('API rate limit exceeded')
    })

    it('should handle missing connection profile', async () => {
      mockFindById.mockResolvedValue(null)

      const result = await summarizeChat(
        [{ role: 'user', content: 'Hello' }],
        testSelection,
        testUserId
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('No API key')
    })
  })
})
