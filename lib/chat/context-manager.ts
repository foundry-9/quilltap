/**
 * Context Manager
 * Sprint 5: Context Management
 *
 * Intelligently builds LLM context within token budgets.
 * Handles system prompts, memory injection, conversation summaries,
 * and message selection to stay within model limits.
 */

import { Provider, Memory, Character, ChatParticipantBase, ChatMetadataBase } from '@/lib/json-store/schemas/types'
import { estimateTokens, countMessagesTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic, SemanticSearchResult } from '@/lib/memory/memory-service'

/**
 * Message format expected by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Optional metadata for the message */
  metadata?: {
    messageId?: string
    tokenCount?: number
    isInjected?: boolean
  }
}

/**
 * Context budget allocation
 */
export interface ContextBudget {
  /** Total context window size for the model */
  totalLimit: number
  /** Tokens allocated for system prompt */
  systemPromptBudget: number
  /** Tokens allocated for memories */
  memoryBudget: number
  /** Tokens allocated for conversation summary */
  summaryBudget: number
  /** Tokens allocated for recent messages */
  recentMessagesBudget: number
  /** Tokens reserved for response */
  responseReserve: number
}

/**
 * Result of context building
 */
export interface BuiltContext {
  /** Messages ready to send to LLM */
  messages: ContextMessage[]
  /** Token usage breakdown */
  tokenUsage: {
    systemPrompt: number
    memories: number
    summary: number
    recentMessages: number
    total: number
  }
  /** Context budget that was used */
  budget: ContextBudget
  /** Whether a conversation summary was included */
  includedSummary: boolean
  /** Number of memories included */
  memoriesIncluded: number
  /** Number of messages included */
  messagesIncluded: number
  /** Whether messages were truncated to fit */
  messagesTruncated: boolean
  /** Warnings generated during context building */
  warnings: string[]
  /** Debug info: the actual memories that were included */
  debugMemories?: Array<{ summary: string; importance: number; score: number }>
  /** Debug info: the conversation summary that was included */
  debugSummary?: string
  /** Debug info: the system prompt that was built */
  debugSystemPrompt?: string
}

/**
 * Options for building context
 */
export interface BuildContextOptions {
  /** Provider for token estimation */
  provider: Provider
  /** Model name for context limit lookup */
  modelName: string
  /** User ID for memory access */
  userId: string
  /** Character for system prompt */
  character: Character
  /** Persona information (optional) */
  persona?: { name: string; description: string } | null
  /** Chat metadata */
  chat: ChatMetadataBase
  /** Existing messages in the conversation */
  existingMessages: Array<{ role: string; content: string; id?: string }>
  /** New user message being sent */
  newUserMessage: string
  /** Custom system prompt override */
  systemPromptOverride?: string | null
  /** Embedding profile ID for semantic search */
  embeddingProfileId?: string
  /** Skip memory retrieval */
  skipMemories?: boolean
  /** Maximum memories to retrieve */
  maxMemories?: number
  /** Minimum importance for memories */
  minMemoryImportance?: number
}

/**
 * Calculate context budget based on model limits
 */
export function calculateContextBudget(
  provider: Provider,
  modelName: string
): ContextBudget {
  const allocation = getRecommendedContextAllocation(provider, modelName)

  return {
    totalLimit: allocation.totalLimit,
    systemPromptBudget: allocation.systemPrompt,
    memoryBudget: allocation.memories,
    summaryBudget: allocation.conversationSummary,
    recentMessagesBudget: allocation.recentMessages,
    responseReserve: allocation.responseReserve,
  }
}

/**
 * Build the system prompt for a character
 */
export function buildSystemPrompt(
  character: Character,
  persona?: { name: string; description: string } | null,
  systemPromptOverride?: string | null
): string {
  const parts: string[] = []

  // Base system prompt from character or override
  if (systemPromptOverride) {
    parts.push(systemPromptOverride)
  } else if (character.systemPrompt) {
    parts.push(character.systemPrompt)
  }

  // Character personality
  if (character.personality) {
    parts.push(`\n## Character Personality\n${character.personality}`)
  }

  // Scenario/setting
  if (character.scenario) {
    parts.push(`\n## Scenario\n${character.scenario}`)
  }

  // Example dialogues for style reference
  if (character.exampleDialogues) {
    parts.push(`\n## Example Dialogue Style\n${character.exampleDialogues}`)
  }

  // Persona information if provided
  if (persona) {
    parts.push(`\n## User Persona\nYou are speaking with ${persona.name}. ${persona.description}`)
  }

  return parts.join('\n\n').trim()
}

/**
 * Format memories for injection into context
 */
export function formatMemoriesForContext(
  memories: SemanticSearchResult[],
  maxTokens: number,
  provider: Provider
): {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: Array<{ summary: string; importance: number; score: number }>
} {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Relevant Memories']
  let currentTokens = estimateTokens('## Relevant Memories\n', provider)
  let memoriesUsed = 0
  const debugMemories: Array<{ summary: string; importance: number; score: number }> = []

  // Sort by relevance score (highest first)
  const sortedMemories = [...memories].sort((a, b) => {
    // First by score, then by importance
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff
    return b.memory.importance - a.memory.importance
  })

  for (const { memory, score } of sortedMemories) {
    // Use summary for context (more concise)
    const memoryLine = `- ${memory.summary}`
    const lineTokens = estimateTokens(memoryLine + '\n', provider)

    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format conversation summary for context
 */
export function formatSummaryForContext(
  summary: string,
  maxTokens: number,
  provider: Provider
): { content: string; tokenCount: number } {
  if (!summary || summary.trim().length === 0) {
    return { content: '', tokenCount: 0 }
  }

  const header = '## Previous Conversation Summary'
  const fullContent = `${header}\n${summary}`
  const fullTokens = estimateTokens(fullContent, provider)

  if (fullTokens <= maxTokens) {
    return { content: fullContent, tokenCount: fullTokens }
  }

  // Truncate summary to fit
  const headerTokens = estimateTokens(header + '\n', provider)
  const availableForSummary = maxTokens - headerTokens
  const truncatedSummary = truncateToTokenLimit(summary, availableForSummary, provider)

  return {
    content: `${header}\n${truncatedSummary}`,
    tokenCount: estimateTokens(`${header}\n${truncatedSummary}`, provider),
  }
}

/**
 * Select recent messages to fit within token budget
 */
export function selectRecentMessages(
  messages: Array<{ role: string; content: string; id?: string }>,
  maxTokens: number,
  provider: Provider
): { messages: Array<{ role: string; content: string }>; tokenCount: number; truncated: boolean } {
  if (messages.length === 0) {
    return { messages: [], tokenCount: 0, truncated: false }
  }

  const selectedMessages: Array<{ role: string; content: string }> = []
  let totalTokens = 0
  let truncated = false

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgTokens = estimateTokens(msg.content, provider) + 4 // +4 for message overhead

    if (totalTokens + msgTokens > maxTokens) {
      truncated = true
      break
    }

    selectedMessages.unshift({ role: msg.role, content: msg.content })
    totalTokens += msgTokens
  }

  // Ensure we have at least the last message if possible
  if (selectedMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    selectedMessages.push({ role: lastMsg.role, content: lastMsg.content })
    totalTokens = estimateTokens(lastMsg.content, provider) + 4
    truncated = true
  }

  return {
    messages: selectedMessages,
    tokenCount: totalTokens,
    truncated,
  }
}

/**
 * Main context building function
 * Assembles all components into a context that fits within token limits
 */
export async function buildContext(options: BuildContextOptions): Promise<BuiltContext> {
  const {
    provider,
    modelName,
    userId,
    character,
    persona,
    chat,
    existingMessages,
    newUserMessage,
    systemPromptOverride,
    embeddingProfileId,
    skipMemories = false,
    maxMemories = 10,
    minMemoryImportance = 0.3,
  } = options

  const warnings: string[] = []
  const budget = calculateContextBudget(provider, modelName)

  // 1. Build system prompt
  const systemPrompt = buildSystemPrompt(character, persona, systemPromptOverride)
  const systemPromptTokens = estimateTokens(systemPrompt, provider)

  // Check if system prompt exceeds budget
  let finalSystemPrompt = systemPrompt
  if (systemPromptTokens > budget.systemPromptBudget) {
    warnings.push(`System prompt (${systemPromptTokens} tokens) exceeds budget (${budget.systemPromptBudget}). Truncating.`)
    finalSystemPrompt = truncateToTokenLimit(systemPrompt, budget.systemPromptBudget, provider)
  }
  const finalSystemPromptTokens = estimateTokens(finalSystemPrompt, provider)

  // 2. Retrieve and format relevant memories
  let memoryContent = ''
  let memoryTokens = 0
  let memoriesIncluded = 0
  let debugMemories: Array<{ summary: string; importance: number; score: number }> = []

  if (!skipMemories && character.id) {
    try {
      // Search for memories relevant to the new user message
      const memoryResults = await searchMemoriesSemantic(
        character.id,
        newUserMessage,
        {
          userId,
          embeddingProfileId,
          limit: maxMemories * 2, // Get more to filter
          minImportance: minMemoryImportance,
        }
      )

      const formatted = formatMemoriesForContext(
        memoryResults.slice(0, maxMemories),
        budget.memoryBudget,
        provider
      )

      memoryContent = formatted.content
      memoryTokens = formatted.tokenCount
      memoriesIncluded = formatted.memoriesUsed
      debugMemories = formatted.debugMemories
    } catch (error) {
      warnings.push(`Failed to retrieve memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // 3. Include conversation summary if available
  let summaryContent = ''
  let summaryTokens = 0

  if (chat.contextSummary) {
    const formatted = formatSummaryForContext(
      chat.contextSummary,
      budget.summaryBudget,
      provider
    )
    summaryContent = formatted.content
    summaryTokens = formatted.tokenCount
  }

  // 4. Calculate remaining budget for messages
  const usedTokens = finalSystemPromptTokens + memoryTokens + summaryTokens
  const remainingBudget = budget.totalLimit - usedTokens - budget.responseReserve

  // 5. Select recent messages
  const { messages: selectedMessages, tokenCount: messagesTokens, truncated } = selectRecentMessages(
    existingMessages,
    Math.min(remainingBudget, budget.recentMessagesBudget),
    provider
  )

  if (truncated) {
    // Check if we should recommend summarization
    const totalMessageTokens = countMessagesTokens(
      existingMessages.map(m => ({ role: m.role, content: m.content })),
      provider
    )
    if (shouldSummarizeConversation(existingMessages.length, totalMessageTokens, budget.totalLimit)) {
      warnings.push('Conversation is getting long. Consider generating a summary for better context management.')
    }
  }

  // 6. Add new user message
  const newUserMessageTokens = estimateTokens(newUserMessage, provider) + 4

  // 7. Assemble final context
  const contextMessages: ContextMessage[] = []

  // System prompt with injected memories and summary
  let fullSystemContent = finalSystemPrompt

  if (memoryContent) {
    fullSystemContent += '\n\n' + memoryContent
  }

  if (summaryContent) {
    fullSystemContent += '\n\n' + summaryContent
  }

  contextMessages.push({
    role: 'system',
    content: fullSystemContent,
    metadata: { isInjected: true },
  })

  // Add selected conversation messages
  for (const msg of selectedMessages) {
    contextMessages.push({
      role: msg.role.toLowerCase() as 'user' | 'assistant',
      content: msg.content,
    })
  }

  // Add new user message
  contextMessages.push({
    role: 'user',
    content: newUserMessage,
  })

  // Calculate final token usage
  const totalUsed = finalSystemPromptTokens + memoryTokens + summaryTokens + messagesTokens + newUserMessageTokens

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: finalSystemPromptTokens,
      memories: memoryTokens,
      summary: summaryTokens,
      recentMessages: messagesTokens + newUserMessageTokens,
      total: totalUsed,
    },
    budget,
    includedSummary: summaryTokens > 0,
    memoriesIncluded,
    messagesIncluded: selectedMessages.length + 1, // +1 for new message
    messagesTruncated: truncated,
    warnings,
    // Debug info for the debug panel
    debugMemories,
    debugSummary: chat.contextSummary || undefined,
    debugSystemPrompt: finalSystemPrompt,
  }
}

/**
 * Quick check if context building will likely exceed limits
 * Useful for UI warnings before sending
 */
export function willExceedContextLimit(
  existingMessages: Array<{ content: string }>,
  newMessage: string,
  provider: Provider,
  modelName: string,
  systemPromptEstimate: number = 2000
): { willExceed: boolean; estimatedUsage: number; limit: number; percentUsed: number } {
  const limit = getModelContextLimit(provider, modelName)
  const responseReserve = 4096

  const messagesTokens = countMessagesTokens(
    existingMessages.map(m => ({ role: 'user', content: m.content })),
    provider
  )
  const newMessageTokens = estimateTokens(newMessage, provider)

  const estimatedUsage = systemPromptEstimate + messagesTokens + newMessageTokens + responseReserve
  const percentUsed = Math.round((estimatedUsage / limit) * 100)

  return {
    willExceed: estimatedUsage > limit,
    estimatedUsage,
    limit,
    percentUsed,
  }
}

/**
 * Get context usage status for UI display
 */
export function getContextStatus(
  usedTokens: number,
  totalLimit: number
): {
  level: 'ok' | 'warning' | 'critical'
  percentUsed: number
  remainingTokens: number
  message: string
} {
  const percentUsed = Math.round((usedTokens / totalLimit) * 100)
  const remainingTokens = totalLimit - usedTokens

  if (percentUsed >= 95) {
    return {
      level: 'critical',
      percentUsed,
      remainingTokens,
      message: 'Context nearly full. Consider starting a new conversation or generating a summary.',
    }
  }

  if (percentUsed >= 80) {
    return {
      level: 'warning',
      percentUsed,
      remainingTokens,
      message: 'Context filling up. Older messages may be dropped soon.',
    }
  }

  return {
    level: 'ok',
    percentUsed,
    remainingTokens,
    message: `Using ${percentUsed}% of context window.`,
  }
}
