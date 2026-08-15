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
  resolveContextWindow,
  computeSafeInputLimit,
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
  filterMessagesByHistoryAccess,
  getParticipantName,
  attributeMessagesForCharacter,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  formatInterCharacterMemoriesForContext,
  buildContext,
  type MessageWithParticipant,
} from '@/lib/chat/context-manager'
import type { ChatParticipantBase, Character, Memory } from '@/lib/schemas/types'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: jest.fn().mockResolvedValue([]),
}))

const mockedSearchMemories = searchMemoriesSemantic as jest.MockedFunction<typeof searchMemoriesSemantic>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

afterEach(() => {
  mockedSearchMemories.mockReset()
  mockedSearchMemories.mockResolvedValue([])
  mockedGetRepositories.mockReset()
})

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

    it("should allocate from the profile's maxContext for an unrecognised model", () => {
      // An Ollama tag no table knows falls back to the 8192 provider default
      // without a profile. With one, the user's Max Context is authoritative.
      const model = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'
      expect(getRecommendedContextAllocation('OLLAMA', model).totalLimit).toBe(8192)
      expect(
        getRecommendedContextAllocation('OLLAMA', model, { maxContext: 65536 }).totalLimit
      ).toBe(65536)
    })
  })

  describe('computeSafeInputLimit', () => {
    it('holds back the response reserve and a 10% margin', () => {
      // 8192 − 2048 − ceil(819.2) = 5324, the figure the pre-send check has
      // always used; it is now the figure the builder packs to as well.
      expect(computeSafeInputLimit(8192, 2048)).toBe(5324)
    })

    it('floors at 1000 rather than going negative', () => {
      expect(computeSafeInputLimit(4096, 8192)).toBe(1000)
    })

    it('is the same limit the allocation exposes', () => {
      const allocation = getRecommendedContextAllocation('OLLAMA', 'llama3.2:3b')
      expect(allocation.safeInputLimit).toBe(
        computeSafeInputLimit(allocation.totalLimit, allocation.responseReserve)
      )
      expect(allocation.safetyMargin).toBe(Math.ceil(allocation.totalLimit * 0.10))
    })
  })

  describe('resolveContextWindow', () => {
    it('should prefer the profile maxContext over the table lookup', () => {
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: 16384 })).toBe(16384)
    })

    it('should fall back to the table when maxContext is absent or degenerate', () => {
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b')).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', null)).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: null })).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: 0 })).toBe(131072)
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

    it('should budget against the profile window, not the provider default', () => {
      // Regression: the budget used to come from a model-name lookup only, so a
      // 64k Ollama profile on an unrecognised tag was budgeted as 8192 — and the
      // recent-message trimmer silently dropped history to fit it, while the
      // compression trigger (which does read the profile) saw the real window.
      const model = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'
      const budget = calculateContextBudget('OLLAMA', model, { maxContext: 65536 })

      expect(budget.totalLimit).toBe(65536)
      expect(budget.responseReserve).toBe(4096)
      expect(budget.totalLimit - budget.responseReserve).toBeGreaterThan(
        calculateContextBudget('OLLAMA', model).totalLimit
      )
    })

    it('exposes the one ceiling the builder and the validator share', () => {
      const budget = calculateContextBudget('OLLAMA', 'llama3.2:3b')

      expect(budget.safeInputLimit).toBe(
        budget.totalLimit - budget.responseReserve - budget.safetyMargin
      )
      // Strictly below the old builder-side ceiling: that gap is precisely what
      // used to be packed with history and then reported as an overage.
      expect(budget.safeInputLimit).toBeLessThan(budget.totalLimit - budget.responseReserve)
    })
  })

  describe('buildSystemPrompt', () => {
    const now = new Date().toISOString()
    const character = {
      id: 'test-char-id',
      userId: 'test-user-id',
      name: 'Test Character',
      systemPrompts: [{
        id: 'prompt-1',
        name: 'Default',
        content: 'You are a helpful assistant.',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      }],
      personality: 'Friendly and helpful',
      scenarios: [{ id: 'test-scenario-id', title: 'Default', content: 'A typical chat scenario', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
      exampleDialogues: 'User: Hello\nAssistant: Hi there!',
      createdAt: now,
      updatedAt: now,
    }

    it('should build prompt from character data', () => {
      const prompt = buildSystemPrompt({ character: character as any })
      expect(prompt).toContain('You are a helpful assistant')
      expect(prompt).toContain('Friendly and helpful')
    })

    it('does not inline persona/user-character info into the system prompt (moved to Host whisper in Phase C)', () => {
      const persona = { name: 'John', description: 'A curious user' }
      const prompt = buildSystemPrompt({ character: character as any, userCharacter: persona })
      expect(prompt).not.toContain('John')
      expect(prompt).not.toContain('curious user')
    })

    it('processes template variables across roleplay and persona sections', () => {
      const persona = { name: 'Alex', description: 'A curious tester' }
      const roleplayTemplate = { systemPrompt: 'Stay in {{char}} mindset when talking to {{user}}.' }
      const toolInstructions = 'Tools should mention {{char}} assisting {{user}}.'
      const prompt = buildSystemPrompt({
        character: {
          ...character,
          personality: '{{char}} is thoughtful',
          scenarios: [{ id: 'test-scenario-id', title: 'Default', content: '{{char}} meets {{user}} under the stars', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
          exampleDialogues: '{{char}}: Hello {{user}}',
        } as any,
        userCharacter: persona,
        roleplayTemplate,
        toolInstructions,
      })

      expect(prompt).toContain('Stay in Test Character mindset when talking to Alex.')
      expect(prompt).toContain('Test Character is thoughtful')
      expect(prompt).toContain('Tools should mention Test Character assisting Alex.')
      // Phase C: scenario text is no longer inlined into the system prompt — it
      // ships as a Host whisper now — so 'meets Alex under the stars' will not
      // appear here.
      expect(prompt).not.toContain('meets Alex under the stars')
      expect(prompt).not.toContain('{{char}}')
      expect(prompt).not.toContain('{{user}}')
    })

    it('uses the selected system prompt when provided and processes templates', () => {
      const persona = { name: 'Jordan', description: 'An analyst' }
      const multiPromptCharacter = {
        ...character,
        systemPrompts: [
          {
            id: 'prompt-default',
            name: 'Default',
            content: 'Default prompt for {{char}}',
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'prompt-alt',
            name: 'Battle Plan',
            content: '{{char}} must protect {{user}} at all costs.',
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }

      const prompt = buildSystemPrompt({
        character: multiPromptCharacter as any,
        userCharacter: persona,
        roleplayTemplate: null,
        selectedSystemPromptId: 'prompt-alt',
      })

      expect(prompt).toContain('Test Character must protect Jordan at all costs.')
      expect(prompt).not.toContain('Default prompt')
    })

    it('uses precompiledIdentityStack verbatim and skips the rebuild', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '## Frozen Identity\nThis is a precompiled stack.',
      })
      expect(prompt).toContain('## Frozen Identity')
      expect(prompt).toContain('This is a precompiled stack.')
      // The character's actual prompt content should NOT be rebuilt when a
      // precompiled stack is supplied.
      expect(prompt).not.toContain('You are a helpful assistant')
      expect(prompt).not.toContain('Friendly and helpful')
    })

    it('falls back to a fresh build when precompiledIdentityStack is empty', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '',
      })
      // Empty cache → rebuild. The character's prompt content is restored.
      expect(prompt).toContain('You are a helpful assistant')
      expect(prompt).toContain('Friendly and helpful')
    })

    it('appends roleplay template, tool instructions, and tool reinforcement after the identity stack', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '## Frozen Identity\nstatic.',
        roleplayTemplate: { systemPrompt: 'Format: bullet points.' },
        toolInstructions: 'Tools available: foo, bar.',
      })
      const idx = prompt.indexOf('## Frozen Identity')
      const rpIdx = prompt.indexOf('Format: bullet points.')
      const toolIdx = prompt.indexOf('Tools available: foo, bar.')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(rpIdx).toBeGreaterThan(idx)
      expect(toolIdx).toBeGreaterThan(rpIdx)
      // Tool reinforcement uses character pronouns (defaults to 'they').
      expect(prompt).toContain('they CALLS them')
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
      // Whisper lines now carry the full memory.content (not summary), so we
      // assert against the content body — "User likes coffee" — rather than
      // the summary text.
      expect(content).toContain('User likes coffee')
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

    it('should truncate oversized summaries so content is shorter than the input — regression for dynamic-require bug', () => {
      // Before fix(chat) ea152d27, formatSummaryForContext called
      //   const { truncateToTokenLimit } = require('@/lib/tokens/token-counter')
      // which silently returned undefined in the Next.js webpack ESM bundle,
      // causing a TypeError mid-turn on any chat with accumulated summary text.
      // This test exercises the truncation path and verifies that content is
      // actually shortened, confirming truncateToTokenLimit is reachable.
      const longSummary = 'word '.repeat(3000).trim() // ~3000 tokens
      const { content, tokenCount } = formatSummaryForContext(longSummary, 200, 'OPENAI')
      // The result must be shorter than the input
      expect(content.length).toBeLessThan(longSummary.length)
      // Token count must respect the budget
      expect(tokenCount).toBeLessThanOrEqual(200)
      // The header must still be present
      expect(content).toContain('## Previous Conversation Summary')
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

  describe('filterMessagesByHistoryAccess', () => {
    const participant: ChatParticipantBase = {
      id: 'char-1',
      type: 'CHARACTER',
      characterId: 'char-1',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: false,
      joinScenario: null,
      createdAt: '2024-01-05T00:00:00.000Z',
      updatedAt: '2024-01-05T00:00:00.000Z',
    }

    const messages: MessageWithParticipant[] = [
      { role: 'USER', content: 'Earlier', participantId: 'user-1', createdAt: '2024-01-01T00:00:00.000Z' },
      { role: 'ASSISTANT', content: 'Welcome!', participantId: 'char-1', createdAt: '2024-01-06T00:00:00.000Z' },
    ]

    it('returns all messages when participant has history access', () => {
      const withAccess = { ...participant, hasHistoryAccess: true }
      const result = filterMessagesByHistoryAccess(messages, withAccess)
      expect(result).toHaveLength(2)
    })

    it('filters out messages that happened before the participant joined', () => {
      const result = filterMessagesByHistoryAccess(messages, participant)
      expect(result).toEqual([messages[1]])
    })
  })

  describe('participant attribution helpers', () => {
    const createdAt = new Date().toISOString()
    const charParticipant: ChatParticipantBase = {
      id: 'p-char',
      type: 'CHARACTER',
      characterId: 'char-1',
      controlledBy: 'llm',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt,
      updatedAt: createdAt,
    }
    const otherCharParticipant: ChatParticipantBase = { ...charParticipant, id: 'p-char-2', characterId: 'char-2' }
    const userCharParticipant: ChatParticipantBase = {
      id: 'p-user',
      type: 'CHARACTER',
      characterId: 'char-user',
      controlledBy: 'user',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt,
      updatedAt: createdAt,
    }

    const characterMap = new Map<string, Character>([
      ['char-1', {
        id: 'char-1',
        userId: 'user',
        name: 'Lyra',
        title: 'Navigator',
        description: null,
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
      ['char-2', {
        id: 'char-2',
        userId: 'user',
        name: 'Iris',
        title: null,
        description: 'Strategist',
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
      ['char-user', {
        id: 'char-user',
        userId: 'user',
        name: 'Alex',
        title: null,
        description: 'Curious human',
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
    ])

    const allParticipants = [charParticipant, otherCharParticipant, userCharParticipant]

    it('returns friendly names for all character participants', () => {
      expect(getParticipantName('p-char', characterMap, allParticipants)).toBe('Lyra')
      expect(getParticipantName('p-user', characterMap, allParticipants)).toBe('Alex')
      expect(getParticipantName('missing', characterMap, allParticipants)).toBeUndefined()
    })

    it('attributes messages to the responding character perspective', () => {
      const messages: MessageWithParticipant[] = [
        { role: 'USER', content: 'Hello', participantId: 'p-user' },
        { role: 'ASSISTANT', content: 'Hi there', participantId: 'p-char-2' },
        { role: 'ASSISTANT', content: 'My turn', participantId: 'p-char' },
      ]

      const attributed = attributeMessagesForCharacter(messages, 'p-char', characterMap, allParticipants)
      expect(attributed[0]).toMatchObject({ role: 'user', name: 'Alex' })
      expect(attributed[1]).toMatchObject({ role: 'user', name: 'Iris' })
      expect(attributed[2]).toMatchObject({ role: 'assistant', name: 'Lyra' })
    })

    it('describes other participants for the system prompt', () => {
      const info = buildOtherParticipantsInfo('p-char', allParticipants, characterMap)
      expect(info).toEqual([
        expect.objectContaining({ name: 'Iris', type: 'CHARACTER' }),
        expect.objectContaining({ name: 'Alex', type: 'CHARACTER' }),
      ])
    })
  })

  describe('formatInterCharacterMemoriesForContext', () => {
    const createdAt = new Date().toISOString()
    const memory: Memory = {
      id: 'mem-1',
      characterId: 'char-1',
      aboutCharacterId: 'char-2',
      chatId: null,
      content: 'Detailed note',
      summary: 'Lyra trusts Iris',
      keywords: [],
      tags: [],
      importance: 0.9,
      embedding: null,
      source: 'MANUAL',
      sourceMessageId: null,
      lastAccessedAt: null,
      createdAt,
      updatedAt: createdAt,
    }

    it('groups memories by character name and respects token budget', () => {
      const result = formatInterCharacterMemoriesForContext([memory], new Map([['char-2', 'Iris']]), 1000, 'OPENAI')
      expect(result.content).toContain('Iris')
      expect(result.memoriesUsed).toBe(1)
    })

    it('returns empty payload when no memories fit', () => {
      const result = formatInterCharacterMemoriesForContext([], new Map(), 10, 'OPENAI')
      expect(result.content).toBe('')
      expect(result.memoriesUsed).toBe(0)
    })
  })

  describe('buildContext multi-character integration', () => {
    const timestamp = new Date().toISOString()
    const participantA: ChatParticipantBase = {
      id: 'participant-a',
      type: 'CHARACTER',
      characterId: 'char-a',
      controlledBy: 'llm',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const participantB: ChatParticipantBase = { ...participantA, id: 'participant-b', characterId: 'char-b' }
    const userParticipant: ChatParticipantBase = {
      id: 'participant-user',
      type: 'CHARACTER',
      characterId: 'char-user',
      controlledBy: 'user',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const characterA: Character = {
      id: 'char-a',
      userId: 'user',
      name: 'Lyra',
      title: null,
      description: null,
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      systemPrompts: [{
        id: 'prompt-a',
        name: 'Default',
        content: 'Stay focused',
        isDefault: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      avatarUrl: null,
      defaultImageId: null,
      defaultConnectionProfileId: null,
      sillyTavernData: null,
      isFavorite: false,
      talkativeness: 0.6,
      partnerLinks: [],
      tags: [],
      avatarOverrides: [],
      physicalDescriptions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const characterB: Character = { ...characterA, id: 'char-b', name: 'Iris', talkativeness: 0.4 }
    const characterUser: Character = {
      id: 'char-user',
      userId: 'user',
      name: 'Alex',
      title: null,
      description: 'Curious',
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      systemPrompts: [],
      avatarUrl: null,
      defaultImageId: null,
      defaultConnectionProfileId: null,
      sillyTavernData: null,
      isFavorite: false,
      talkativeness: 0.5,
      partnerLinks: [],
      tags: [],
      avatarOverrides: [],
      physicalDescriptions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const participantCharacters = new Map<string, Character>([
      ['char-a', characterA],
      ['char-b', characterB],
      ['char-user', characterUser],
    ])
    const allParticipants = [participantA, participantB, userParticipant]

    const memory: Memory = {
      id: 'mem-1',
      characterId: 'char-a',
      aboutCharacterId: 'char-b',
      chatId: 'chat-1',
      content: 'Detailed history',
      summary: 'Lyra respects Iris',
      keywords: [],
      tags: [],
      importance: 0.8,
      embedding: null,
      source: 'MANUAL',
      sourceMessageId: null,
      lastAccessedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    it('retrieves inter-character memories and injects them into context', async () => {
      const repoMock = {
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([memory]),
        },
      }
      mockedGetRepositories.mockReturnValue(repoMock as any)
      mockedSearchMemories.mockResolvedValue([])

      const messagesWithParticipants: MessageWithParticipant[] = [
        { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
        { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
      ]

      const result = await buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character: characterA,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-1',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: null,
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: 'Ready for the next task?',
  
        embeddingProfileId: null,
        skipMemories: false,
        maxMemories: 1,
        minMemoryImportance: 0.3,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants,
      })

      expect(repoMock.memories.findByCharacterAboutCharacters).toHaveBeenCalledWith(
        'char-a',
        expect.arrayContaining(['char-b', 'char-user']),
        expect.any(Number),
      )
      // Phase B: inter-character memories now ride inline on the new user
      // message body (plain "you also recall about the others present" framing
      // for the LLM) rather than concatenated onto the system prompt. The
      // Commonplace Book persona-voiced version is persisted separately.
      const userMsg = result.messages[result.messages.length - 1]
      expect(userMsg.role).toBe('user')
      expect(userMsg.content).toContain('You also recall about the others present')
      expect(userMsg.content).toContain('## Memories About Other Characters')
    })

    it('ignores summary/system messages when scanning off-scene mentions', async () => {
      const offSceneCharacter: Character = {
        ...characterA,
        id: 'char-c',
        name: 'Morgan',
      }
      const repoMock = {
        characters: {
          findByUserId: jest.fn().mockResolvedValue([characterA, characterB, characterUser, offSceneCharacter]),
        },
        chats: {
          getMessages: jest.fn().mockResolvedValue([
            {
              type: 'message',
              role: 'ASSISTANT',
              systemSender: 'commonplaceBook',
              content: 'Morgan should help here.',
              createdAt: timestamp,
            },
            {
              type: 'message',
              role: 'USER',
              content: 'Let us keep going.',
              createdAt: timestamp,
            },
          ]),
          addMessage: jest.fn(),
        },
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]),
        },
      }
      mockedGetRepositories.mockReturnValue(repoMock as any)
      mockedSearchMemories.mockResolvedValue([])

      const result = await buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character: characterA,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-1',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: 'Morgan was discussed in summary text only.',
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: 'Ready for the next task?',
        embeddingProfileId: null,
        skipMemories: true,
        maxMemories: 1,
        minMemoryImportance: 0.3,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants: [
          { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
          { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
        ],
      })

      expect(repoMock.chats.getMessages).toHaveBeenCalledTimes(1)
      expect(repoMock.chats.addMessage).not.toHaveBeenCalled()
      expect(result.messages.some(m => m.role === 'assistant' && m.content.includes('Off-Scene Character Mentioned'))).toBe(false)
    })
  })

  describe('buildIdentityReinforcement', () => {
    it('produces a reminder anchored on the character name', () => {
      const result = buildIdentityReinforcement('Artemis')
      expect(result).toContain('## Identity Reminder')
      expect(result).toContain('You are Artemis')
      expect(result).toContain('Respond as Artemis and no one else.')
      expect(result).not.toContain('{{char}}')
      expect(result).not.toContain('{{user}}')
    })

    it('uses a fully static "any other character" phrasing — no inline list', () => {
      // The reminder is now emitted as a separate, fully-static second system
      // message. It must NOT name individual participants (those used to live
      // here as a comma-separated list and bisected provider prompt caching);
      // participant attribution comes from Host roster announcements + each
      // history message's `name` field instead.
      const result = buildIdentityReinforcement('Artemis')
      expect(result).toContain('any other character')
      // Still static — must not interpolate a comma-separated participant list.
      expect(result).not.toMatch(/(?:on behalf of|as|for) [A-Z][a-z]+,/)
    })

    it('produces byte-identical output across calls for the same character', () => {
      const a = buildIdentityReinforcement('Friday')
      const b = buildIdentityReinforcement('Friday')
      expect(a).toBe(b)
    })

    it('instructs LLM not to prefix response with character name', () => {
      const result = buildIdentityReinforcement('Friday')
      expect(result).toContain('Do not prefix or label your response with your own name')
      expect(result).toContain('[Friday]')
      expect(result).toContain('Friday:')
    })
  })
})
