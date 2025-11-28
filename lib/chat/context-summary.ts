/**
 * Context Summary Service
 * Sprint 5: Context Management
 *
 * Generates and updates conversation summaries for long chats.
 * Uses the cheap LLM system for efficient summarization.
 */

import { getRepositories } from '@/lib/json-store/repositories'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { updateContextSummary, summarizeChat, ChatMessage } from '@/lib/memory/cheap-llm-tasks'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getModelContextLimit, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { Provider, ConnectionProfile, CheapLLMSettings } from '@/lib/json-store/schemas/types'

/**
 * Options for generating a context summary
 */
export interface GenerateSummaryOptions {
  /** User ID for API access */
  userId: string
  /** Chat ID to summarize */
  chatId: string
  /** Current connection profile being used */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for fallback */
  availableProfiles: ConnectionProfile[]
  /** Force regeneration even if summary exists */
  forceRegenerate?: boolean
}

/**
 * Result of summary generation
 */
export interface SummaryGenerationResult {
  success: boolean
  summary?: string
  error?: string
  /** Whether the summary was newly generated or already existed */
  wasGenerated: boolean
  /** Token usage for the generation */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Check if a chat needs a context summary
 * Based on message count and estimated token usage
 */
export async function chatNeedsSummary(
  chatId: string,
  provider: Provider,
  modelName: string
): Promise<{ needsSummary: boolean; reason?: string }> {
  const repos = getRepositories()

  // Get chat metadata
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    return { needsSummary: false, reason: 'Chat not found' }
  }

  // If already has a summary, check if it needs updating
  if (chat.contextSummary) {
    // Get message count since last summary
    // For now, we regenerate if message count exceeds threshold
    if (chat.messageCount < 100) {
      return { needsSummary: false, reason: 'Existing summary is recent enough' }
    }
  }

  // Get messages to estimate token count
  const messages = await repos.chats.getMessages(chatId)
  const conversationMessages = messages
    .filter(msg => msg.type === 'message')
    .filter(msg => {
      const role = (msg as { role: string }).role
      return role === 'USER' || role === 'ASSISTANT'
    })
    .map(msg => ({ role: (msg as { role: string }).role, content: (msg as { content: string }).content }))

  const estimatedTokens = countMessagesTokens(conversationMessages, provider)
  const contextLimit = getModelContextLimit(provider, modelName)

  if (shouldSummarizeConversation(conversationMessages.length, estimatedTokens, contextLimit)) {
    return {
      needsSummary: true,
      reason: `Conversation has ${conversationMessages.length} messages using ~${estimatedTokens} tokens (${Math.round((estimatedTokens / contextLimit) * 100)}% of context)`,
    }
  }

  return { needsSummary: false }
}

/**
 * Generate or update a context summary for a chat
 */
export async function generateContextSummary(
  options: GenerateSummaryOptions
): Promise<SummaryGenerationResult> {
  const {
    userId,
    chatId,
    connectionProfile,
    cheapLLMSettings,
    availableProfiles,
    forceRegenerate = false,
  } = options

  const repos = getRepositories()

  try {
    // Get chat
    const chat = await repos.chats.findById(chatId)
    if (!chat) {
      return { success: false, error: 'Chat not found', wasGenerated: false }
    }

    // Check if we need to generate (unless forced)
    if (!forceRegenerate && chat.contextSummary) {
      const needsCheck = await chatNeedsSummary(chatId, connectionProfile.provider, connectionProfile.modelName)
      if (!needsCheck.needsSummary) {
        return { success: true, summary: chat.contextSummary, wasGenerated: false }
      }
    }

    // Get cheap LLM provider - convert null values to undefined for compatibility
    const cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    )

    if (!cheapLLM) {
      return { success: false, error: 'No cheap LLM provider available', wasGenerated: false }
    }

    // Get messages
    const messages = await repos.chats.getMessages(chatId)
    const conversationMessages: ChatMessage[] = messages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = (msg as { role: string }).role
        return role === 'USER' || role === 'ASSISTANT'
      })
      .map(msg => ({
        role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
        content: (msg as { content: string }).content,
      }))

    if (conversationMessages.length === 0) {
      return { success: false, error: 'No messages to summarize', wasGenerated: false }
    }

    let result: SummaryGenerationResult

    // If we have an existing summary, update it with recent messages
    if (chat.contextSummary && !forceRegenerate) {
      // Only summarize messages that came after the summary was likely generated
      // Take the last 20 messages for incremental update
      const recentMessages = conversationMessages.slice(-20)

      const updateResult = await updateContextSummary(
        chat.contextSummary,
        recentMessages,
        cheapLLM,
        userId
      )

      if (updateResult.success && updateResult.result) {
        result = {
          success: true,
          summary: updateResult.result,
          wasGenerated: true,
          usage: updateResult.usage,
        }
      } else {
        // Fall back to full regeneration
        const fullResult = await summarizeChat(conversationMessages, cheapLLM, userId)

        if (fullResult.success && fullResult.result) {
          result = {
            success: true,
            summary: fullResult.result,
            wasGenerated: true,
            usage: fullResult.usage,
          }
        } else {
          return {
            success: false,
            error: fullResult.error || 'Failed to generate summary',
            wasGenerated: false,
          }
        }
      }
    } else {
      // Generate new summary from scratch
      const summaryResult = await summarizeChat(conversationMessages, cheapLLM, userId)

      if (summaryResult.success && summaryResult.result) {
        result = {
          success: true,
          summary: summaryResult.result,
          wasGenerated: true,
          usage: summaryResult.usage,
        }
      } else {
        return {
          success: false,
          error: summaryResult.error || 'Failed to generate summary',
          wasGenerated: false,
        }
      }
    }

    // Save summary to chat
    if (result.success && result.summary) {
      await repos.chats.update(chatId, {
        contextSummary: result.summary,
        updatedAt: new Date().toISOString(),
      })

      // Also save as a context-summary event in the chat
      const summaryEvent = {
        type: 'context-summary' as const,
        id: crypto.randomUUID(),
        context: result.summary,
        createdAt: new Date().toISOString(),
      }
      await repos.chats.addMessage(chatId, summaryEvent)
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      wasGenerated: false,
    }
  }
}

/**
 * Clear the context summary for a chat
 */
export async function clearContextSummary(chatId: string): Promise<boolean> {
  const repos = getRepositories()

  try {
    await repos.chats.update(chatId, {
      contextSummary: null,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    console.error('Failed to clear context summary:', error)
    return false
  }
}

/**
 * Generate summary in the background (non-blocking)
 * Used after message exchanges to keep summaries up to date
 */
export function generateContextSummaryAsync(options: GenerateSummaryOptions): void {
  // Run in background without waiting
  generateContextSummary(options)
    .then(result => {
      if (result.success && result.wasGenerated) {
        console.log(`[Context Summary] Generated summary for chat ${options.chatId}`)
      } else if (!result.success) {
        console.warn(`[Context Summary] Failed for chat ${options.chatId}: ${result.error}`)
      }
    })
    .catch(error => {
      console.error(`[Context Summary] Error for chat ${options.chatId}:`, error)
    })
}

/**
 * Check and generate summary if needed after a message
 * Call this after message exchanges to maintain context
 */
export async function checkAndGenerateSummaryIfNeeded(
  chatId: string,
  provider: Provider,
  modelName: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  cheapLLMSettings: CheapLLMSettings,
  availableProfiles: ConnectionProfile[]
): Promise<void> {
  const needsCheck = await chatNeedsSummary(chatId, provider, modelName)

  if (needsCheck.needsSummary) {
    console.log(`[Context Summary] Chat ${chatId} needs summary: ${needsCheck.reason}`)

    // Generate in background to not block the response
    generateContextSummaryAsync({
      userId,
      chatId,
      connectionProfile,
      cheapLLMSettings,
      availableProfiles,
    })
  }
}
