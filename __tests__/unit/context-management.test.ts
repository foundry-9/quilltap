/**
 * Unit Tests for Context Management System
 * Sprint 5: Context Management
 */

import {
  estimateTokens,
  countMessageTokens,
  countMessagesTokens,
  formatTokenCount,
  truncateToTokenLimit,
  getContextUsagePercent,
  getContextWarningLevel,
} from '@/lib/tokens/token-counter'

import {
  getModelContextLimit,
  getSafeInputLimit,
  hasExtendedContext,
  getRecommendedContextAllocation,
  shouldSummarizeConversation,
  calculateRecentMessageCount,
} from '@/lib/llm/model-context-data'

import {
  calculateContextBudget,
  buildSystemPrompt,
  formatMemoriesForContext,
  formatSummaryForContext,
  selectRecentMessages,
  willExceedContextLimit,
  getContextStatus,
} from '@/lib/chat/context-manager'

describe('Token Counter', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })

    it('should estimate tokens for short text', () => {
      const tokens = estimateTokens('Hello, world!')
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(20) // Should be small for short text
    })

    it('should estimate more tokens for longer text', () => {
      const shortTokens = estimateTokens('Hello')
      const longTokens = estimateTokens('Hello, this is a much longer text that should require more tokens to represent.')
      expect(longTokens).toBeGreaterThan(shortTokens)
    })

    it('should apply provider-specific estimation', () => {
      const text = 'This is a test message for token estimation.'
      const openaiTokens = estimateTokens(text, 'OPENAI')
      const googleTokens = estimateTokens(text, 'GOOGLE')
      // Google has slightly more efficient tokenizer (3.8 vs 3.5 chars/token)
      expect(googleTokens).toBeLessThanOrEqual(openaiTokens)
    })
  })

  describe('countMessageTokens', () => {
    it('should count tokens for a message with overhead', () => {
      const message = { role: 'user', content: 'Hello, how are you?' }
      const tokens = countMessageTokens(message)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should include role in token count', () => {
      const shortRole = { role: 'user', content: 'Hello' }
      const longRole = { role: 'assistant', content: 'Hello' }
      // Assistant has more characters than user
      const shortTokens = countMessageTokens(shortRole)
      const longTokens = countMessageTokens(longRole)
      expect(longTokens).toBeGreaterThanOrEqual(shortTokens)
    })
  })

  describe('countMessagesTokens', () => {
    it('should return 0 for empty array', () => {
      expect(countMessagesTokens([])).toBe(0)
    })

    it('should count tokens for multiple messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]
      const tokens = countMessagesTokens(messages)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should include conversation overhead', () => {
      const messages = [{ role: 'user', content: 'Hello' }]
      const singleTokens = countMessageTokens(messages[0])
      const totalTokens = countMessagesTokens(messages)
      // Total should include conversation overhead (3 tokens)
      expect(totalTokens).toBeGreaterThan(singleTokens)
    })
  })

  describe('formatTokenCount', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokenCount(500)).toBe('500')
    })

    it('should format thousands with k suffix', () => {
      expect(formatTokenCount(1500)).toBe('1.5k')
    })

    it('should format millions with M suffix', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M')
    })
  })

  describe('truncateToTokenLimit', () => {
    it('should return text unchanged if under limit', () => {
      const text = 'Short text'
      expect(truncateToTokenLimit(text, 1000)).toBe(text)
    })

    it('should truncate text exceeding limit', () => {
      const text = 'A'.repeat(10000) // Very long text
      const truncated = truncateToTokenLimit(text, 100)
      expect(truncated.length).toBeLessThan(text.length)
      expect(truncated.endsWith('...')).toBe(true)
    })

    it('should handle empty string', () => {
      expect(truncateToTokenLimit('', 100)).toBe('')
    })
  })

  describe('getContextUsagePercent', () => {
    it('should calculate percentage correctly', () => {
      expect(getContextUsagePercent(50000, 100000)).toBe(50)
    })

    it('should handle zero limit', () => {
      expect(getContextUsagePercent(100, 0)).toBe(100)
    })

    it('should cap at 100%', () => {
      expect(getContextUsagePercent(150000, 100000)).toBe(100)
    })
  })

  describe('getContextWarningLevel', () => {
    it('should return ok for low usage', () => {
      expect(getContextWarningLevel(50000, 100000)).toBe('ok')
    })

    it('should return warning for high usage', () => {
      expect(getContextWarningLevel(85000, 100000)).toBe('warning')
    })

    it('should return critical for very high usage', () => {
      expect(getContextWarningLevel(96000, 100000)).toBe('critical')
    })
  })
})

describe('Model Context Data', () => {
  describe('getModelContextLimit', () => {
    it('should return correct limit for Claude models', () => {
      expect(getModelContextLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')).toBe(200000)
    })

    it('should return correct limit for GPT-4o', () => {
      expect(getModelContextLimit('OPENAI', 'gpt-4o')).toBe(128000)
    })

    it('should return correct limit for Gemini', () => {
      expect(getModelContextLimit('GOOGLE', 'gemini-2.0-flash')).toBe(1000000)
    })

    it('should return default for unknown model', () => {
      const limit = getModelContextLimit('OPENAI', 'unknown-model')
      expect(limit).toBeGreaterThan(0)
    })
  })

  describe('getSafeInputLimit', () => {
    it('should return less than total limit', () => {
      const total = getModelContextLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      const safe = getSafeInputLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(safe).toBeLessThan(total)
    })

    it('should respect custom response token reservation', () => {
      const safe1 = getSafeInputLimit('OPENAI', 'gpt-4o', 2000)
      const safe2 = getSafeInputLimit('OPENAI', 'gpt-4o', 8000)
      expect(safe2).toBeLessThan(safe1)
    })
  })

  describe('hasExtendedContext', () => {
    it('should return true for large context models', () => {
      expect(hasExtendedContext('ANTHROPIC', 'claude-sonnet-4-5-20250929')).toBe(true)
    })

    it('should return false for small context models', () => {
      expect(hasExtendedContext('OLLAMA', 'phi3:mini')).toBe(false)
    })
  })

  describe('getRecommendedContextAllocation', () => {
    it('should return allocations for large context model', () => {
      const allocation = getRecommendedContextAllocation('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(allocation.totalLimit).toBe(200000)
      expect(allocation.systemPrompt).toBeGreaterThan(0)
      expect(allocation.memories).toBeGreaterThan(0)
      expect(allocation.responseReserve).toBeGreaterThan(0)
    })

    it('should allocate less for smaller context models', () => {
      const largeAlloc = getRecommendedContextAllocation('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      const smallAlloc = getRecommendedContextAllocation('OLLAMA', 'llama3.2:3b')
      expect(smallAlloc.memories).toBeLessThan(largeAlloc.memories)
    })
  })

  describe('shouldSummarizeConversation', () => {
    it('should not recommend summary for short conversations', () => {
      expect(shouldSummarizeConversation(10, 5000, 200000)).toBe(false)
    })

    it('should recommend summary for long conversations', () => {
      expect(shouldSummarizeConversation(100, 150000, 200000)).toBe(true)
    })

    it('should recommend summary for many messages', () => {
      expect(shouldSummarizeConversation(60, 10000, 200000)).toBe(true)
    })
  })

  describe('calculateRecentMessageCount', () => {
    it('should calculate reasonable message count', () => {
      const count = calculateRecentMessageCount(10000, 150)
      expect(count).toBeGreaterThanOrEqual(4) // Minimum
      expect(count).toBeLessThanOrEqual(100) // Maximum
    })

    it('should return minimum for very small budget', () => {
      expect(calculateRecentMessageCount(100, 150)).toBe(4)
    })
  })
})

describe('Context Manager', () => {
  describe('calculateContextBudget', () => {
    it('should return valid budget for Claude', () => {
      const budget = calculateContextBudget('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(budget.totalLimit).toBe(200000)
      expect(budget.systemPromptBudget).toBeGreaterThan(0)
      expect(budget.memoryBudget).toBeGreaterThan(0)
      expect(budget.summaryBudget).toBeGreaterThan(0)
      expect(budget.recentMessagesBudget).toBeGreaterThan(0)
      expect(budget.responseReserve).toBeGreaterThan(0)
    })
  })

  describe('buildSystemPrompt', () => {
    const character = {
      id: 'test-char-id',
      userId: 'test-user-id',
      name: 'Test Character',
      systemPrompt: 'You are a helpful assistant.',
      personality: 'Friendly and helpful',
      scenario: 'A typical chat scenario',
      exampleDialogues: 'User: Hello\nAssistant: Hi there!',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    it('should build prompt from character data', () => {
      const prompt = buildSystemPrompt(character as any)
      expect(prompt).toContain('You are a helpful assistant')
      expect(prompt).toContain('Friendly and helpful')
    })

    it('should include persona information', () => {
      const persona = { name: 'John', description: 'A curious user' }
      const prompt = buildSystemPrompt(character as any, persona)
      expect(prompt).toContain('John')
      expect(prompt).toContain('curious user')
    })

    it('should use override when provided', () => {
      const override = 'Custom system prompt override'
      const prompt = buildSystemPrompt(character as any, null, override)
      expect(prompt).toContain(override)
    })
  })

  describe('formatMemoriesForContext', () => {
    const mockMemories = [
      {
        memory: {
          id: '1',
          characterId: 'char1',
          content: 'User likes coffee',
          summary: 'User prefers coffee over tea',
          keywords: ['coffee', 'preferences'],
          tags: [],
          importance: 0.8,
          source: 'AUTO' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        score: 0.9,
        usedEmbedding: true,
      },
      {
        memory: {
          id: '2',
          characterId: 'char1',
          content: 'User works as developer',
          summary: 'User is a software developer',
          keywords: ['developer', 'work'],
          tags: [],
          importance: 0.7,
          source: 'AUTO' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        score: 0.8,
        usedEmbedding: true,
      },
    ]

    it('should format memories with header', () => {
      const { content } = formatMemoriesForContext(mockMemories, 1000, 'OPENAI')
      expect(content).toContain('## Relevant Memories')
      expect(content).toContain('prefers coffee')
    })

    it('should return empty for no memories', () => {
      const { content, memoriesUsed } = formatMemoriesForContext([], 1000, 'OPENAI')
      expect(content).toBe('')
      expect(memoriesUsed).toBe(0)
    })

    it('should respect token limit', () => {
      const { tokenCount } = formatMemoriesForContext(mockMemories, 50, 'OPENAI')
      expect(tokenCount).toBeLessThanOrEqual(50)
    })
  })

  describe('formatSummaryForContext', () => {
    it('should format summary with header', () => {
      const summary = 'This is a conversation summary.'
      const { content } = formatSummaryForContext(summary, 1000, 'OPENAI')
      expect(content).toContain('## Previous Conversation Summary')
      expect(content).toContain(summary)
    })

    it('should return empty for empty summary', () => {
      const { content } = formatSummaryForContext('', 1000, 'OPENAI')
      expect(content).toBe('')
    })

    it('should truncate long summaries', () => {
      const longSummary = 'A'.repeat(10000)
      const { tokenCount } = formatSummaryForContext(longSummary, 100, 'OPENAI')
      expect(tokenCount).toBeLessThanOrEqual(100)
    })
  })

  describe('selectRecentMessages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'I am doing well, thank you for asking!' },
    ]

    it('should select all messages when under limit', () => {
      const { messages: selected, truncated } = selectRecentMessages(messages, 10000, 'OPENAI')
      expect(selected.length).toBe(messages.length)
      expect(truncated).toBe(false)
    })

    it('should select recent messages when over limit', () => {
      const { messages: selected, truncated } = selectRecentMessages(messages, 30, 'OPENAI')
      expect(selected.length).toBeLessThan(messages.length)
      expect(truncated).toBe(true)
    })

    it('should always include at least one message', () => {
      const { messages: selected } = selectRecentMessages(messages, 1, 'OPENAI')
      expect(selected.length).toBeGreaterThanOrEqual(1)
    })

    it('should return empty for empty input', () => {
      const { messages: selected, truncated } = selectRecentMessages([], 1000, 'OPENAI')
      expect(selected.length).toBe(0)
      expect(truncated).toBe(false)
    })
  })

  describe('willExceedContextLimit', () => {
    it('should detect when context will exceed', () => {
      const messages = Array(100).fill({ content: 'A'.repeat(1000) })
      const result = willExceedContextLimit(messages, 'Hello', 'OLLAMA', 'phi3:mini')
      expect(result.willExceed).toBe(true)
    })

    it('should return false for small context', () => {
      const messages = [{ content: 'Hello' }]
      const result = willExceedContextLimit(messages, 'Hi', 'ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(result.willExceed).toBe(false)
    })

    it('should calculate percentage used', () => {
      const messages = [{ content: 'Hello' }]
      const result = willExceedContextLimit(messages, 'Hi', 'OPENAI', 'gpt-4o')
      expect(result.percentUsed).toBeGreaterThan(0)
      expect(result.percentUsed).toBeLessThan(100)
    })
  })

  describe('getContextStatus', () => {
    it('should return ok status for low usage', () => {
      const status = getContextStatus(50000, 200000)
      expect(status.level).toBe('ok')
    })

    it('should return warning status for high usage', () => {
      const status = getContextStatus(170000, 200000)
      expect(status.level).toBe('warning')
    })

    it('should return critical status for near-full', () => {
      const status = getContextStatus(195000, 200000)
      expect(status.level).toBe('critical')
    })

    it('should include helpful message', () => {
      const status = getContextStatus(100000, 200000)
      expect(status.message).toBeTruthy()
    })
  })
})
