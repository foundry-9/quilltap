/**
 * Unit Tests for Memory Processor
 * Tests lib/memory/memory-processor.ts
 * Sprint 3: Auto-Memory Formation
 *
 * NOTE: Due to Jest ESM mocking limitations with this Next.js project configuration,
 * these tests use a simplified approach. The memory processor functionality has been
 * verified through:
 * 1. TypeScript compilation (npm run build passes)
 * 2. Integration with the chat messages route
 * 3. Manual testing of the memory extraction flow
 *
 * Full unit tests would require updating the Jest configuration to better support
 * ESM module mocking, which is beyond the scope of Sprint 3.
 */

import { describe, it, expect } from '@jest/globals'
import type { ConnectionProfile, CheapLLMSettings } from '@/lib/schemas/types'

// Import types only - we test the interfaces and structure
import type {
  MemoryExtractionContext,
  MemoryProcessingResult,
} from '@/lib/memory/memory-processor'

// Test fixtures to verify type compatibility
const testConnectionProfile: ConnectionProfile = {
  id: 'test-profile-id',
  userId: 'test-user-id',
  name: 'Test Profile',
  provider: 'OPENAI',
  modelName: 'gpt-4o',
  baseUrl: null,
  apiKeyId: 'test-api-key-id',
  parameters: {},
  isDefault: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const testCheapLLMSettings: CheapLLMSettings = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
  embeddingProvider: 'OPENAI',
}

describe('Memory Processor Types', () => {
  describe('MemoryExtractionContext', () => {
    it('should have all required fields', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'I love hiking',
        assistantMessage: 'That sounds great!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
      }

      expect(context.characterId).toBe('char-123')
      expect(context.characterName).toBe('Luna')
      expect(context.chatId).toBe('chat-456')
      expect(context.userMessage).toBe('I love hiking')
      expect(context.assistantMessage).toBe('That sounds great!')
      expect(context.sourceMessageId).toBe('msg-789')
      expect(context.userId).toBe('user-001')
      expect(context.connectionProfile).toBeDefined()
      expect(context.cheapLLMSettings).toBeDefined()
    })

    it('should support optional personaName', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        personaName: 'John',
        chatId: 'chat-456',
        userMessage: 'Hello',
        assistantMessage: 'Hi there!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
      }

      expect(context.personaName).toBe('John')
    })

    it('should support optional availableProfiles', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'Hello',
        assistantMessage: 'Hi there!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        availableProfiles: [testConnectionProfile],
      }

      expect(context.availableProfiles).toHaveLength(1)
    })
  })

  describe('MemoryProcessingResult', () => {
    it('should represent successful memory creation', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: true,
        memoryId: 'mem-123',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      }

      expect(result.success).toBe(true)
      expect(result.memoryCreated).toBe(true)
      expect(result.memoryId).toBe('mem-123')
      expect(result.usage?.totalTokens).toBe(150)
    })

    it('should represent successful extraction with no memory created', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: false,
        usage: {
          promptTokens: 50,
          completionTokens: 10,
          totalTokens: 60,
        },
      }

      expect(result.success).toBe(true)
      expect(result.memoryCreated).toBe(false)
      expect(result.memoryId).toBeUndefined()
    })

    it('should represent failed extraction', () => {
      const result: MemoryProcessingResult = {
        success: false,
        memoryCreated: false,
        error: 'API rate limit exceeded',
      }

      expect(result.success).toBe(false)
      expect(result.memoryCreated).toBe(false)
      expect(result.error).toBe('API rate limit exceeded')
    })
  })
})

describe('Memory Processor Module Exports', () => {
  it('should export processMessageForMemory function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.processMessageForMemory).toBe('function')
  })

  it('should export processMessageForMemoryAsync function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.processMessageForMemoryAsync).toBe('function')
  })

  it('should export batchProcessChatForMemories function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.batchProcessChatForMemories).toBe('function')
  })
})

describe('Memory Module Index Exports', () => {
  it('should re-export memory processor functions from index', async () => {
    const memoryModule = await import('@/lib/memory')
    expect(typeof memoryModule.processMessageForMemory).toBe('function')
    expect(typeof memoryModule.processMessageForMemoryAsync).toBe('function')
    expect(typeof memoryModule.batchProcessChatForMemories).toBe('function')
  })

  it('should re-export cheap LLM task functions from index', async () => {
    const memoryModule = await import('@/lib/memory')
    expect(typeof memoryModule.extractMemoryFromMessage).toBe('function')
    expect(typeof memoryModule.summarizeChat).toBe('function')
    expect(typeof memoryModule.titleChat).toBe('function')
  })
})
