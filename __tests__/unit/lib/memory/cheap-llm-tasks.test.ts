/**
 * Unit Tests for Cheap LLM Tasks Service
 * Tests lib/memory/cheap-llm-tasks.ts
 * Sprint 2: Memory System - Background LLM Tasks
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

// Mock the dependencies
jest.mock('@/lib/llm/factory')
jest.mock('@/lib/json-store/repositories')
jest.mock('@/lib/encryption')

// Import the mocked modules
import { createLLMProvider } from '@/lib/llm/factory'
import { getRepositories } from '@/lib/json-store/repositories'
import { decryptApiKey } from '@/lib/encryption'

// Import the module under test AFTER mocking
import {
  extractMemoryFromMessage,
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
  batchExtractMemories,
  type MemoryCandidate,
  type ChatMessage,
} from '@/lib/memory/cheap-llm-tasks'

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
const mockRepos = {
  connections: {
    findById: mockFindById,
    findApiKeyById: mockFindApiKeyById,
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
    ;(decryptApiKey as jest.Mock).mockReturnValue('decrypted-api-key')

    mockFindById.mockResolvedValue({
      id: 'test-profile-id',
      apiKeyId: 'test-api-key-id',
    })

    mockFindApiKeyById.mockResolvedValue({
      id: 'test-api-key-id',
      ciphertext: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
    })
  })

  describe('extractMemoryFromMessage', () => {
    it('should extract a significant memory', async () => {
      const memoryResponse = {
        significant: true,
        content: 'User mentioned they have a cat named Whiskers',
        summary: 'User has a cat named Whiskers',
        keywords: ['cat', 'pet', 'Whiskers'],
        importance: 0.7,
      }

      mockSendMessage.mockResolvedValue({
        content: JSON.stringify(memoryResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })

      const result = await extractMemoryFromMessage(
        'I need to go feed my cat Whiskers',
        'That sounds like a lovely cat! I hope Whiskers enjoys their meal.',
        'Character: Luna, Persona: John',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result).toEqual({
        significant: true,
        content: 'User mentioned they have a cat named Whiskers',
        summary: 'User has a cat named Whiskers',
        keywords: ['cat', 'pet', 'Whiskers'],
        importance: 0.7,
      })
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    })

    it('should handle non-significant exchanges', async () => {
      mockSendMessage.mockResolvedValue({
        content: '{ "significant": false }',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const result = await extractMemoryFromMessage(
        'Hello!',
        'Hi there! How are you?',
        'Character: Luna',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result?.significant).toBe(false)
    })

    it('should handle JSON wrapped in markdown code blocks', async () => {
      mockSendMessage.mockResolvedValue({
        content: '```json\n{ "significant": true, "content": "Test", "summary": "Test summary", "keywords": [], "importance": 0.5 }\n```',
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })

      const result = await extractMemoryFromMessage(
        'Test message',
        'Test response',
        'Context',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result?.significant).toBe(true)
      expect(result.result?.content).toBe('Test')
    })

    it('should handle malformed JSON gracefully', async () => {
      mockSendMessage.mockResolvedValue({
        content: 'This is not valid JSON',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const result = await extractMemoryFromMessage(
        'Test',
        'Response',
        'Context',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(result.result?.significant).toBe(false)
    })

    it('should work with local Ollama provider', async () => {
      mockSendMessage.mockResolvedValue({
        content: '{ "significant": false }',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      })

      const result = await extractMemoryFromMessage(
        'Hello',
        'Hi',
        'Context',
        localSelection,
        testUserId
      )

      expect(result.success).toBe(true)
      expect(createLLMProvider).toHaveBeenCalledWith('OLLAMA', 'http://localhost:11434')
    })

    it('should return error when no API key available', async () => {
      mockFindById.mockResolvedValue({ id: 'test-profile-id', apiKeyId: null })

      const result = await extractMemoryFromMessage(
        'Hello',
        'Hi',
        'Context',
        testSelection,
        testUserId
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('No API key')
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
          significant: true,
          content: 'User favorite color is blue',
          summary: 'Favorite color: blue',
          keywords: ['color', 'blue', 'favorite'],
          importance: 0.6,
        },
        {
          significant: false,
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
      expect(result.result).toHaveLength(2)
      expect(result.result![0].significant).toBe(true)
      expect(result.result![1].significant).toBe(false)
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

      const result = await extractMemoryFromMessage(
        'Test',
        'Response',
        'Context',
        testSelection,
        testUserId
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
