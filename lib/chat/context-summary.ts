/**
 * Context Summary Service
 * Sprint 5: Context Management
 *
 * Generates and updates conversation summaries for long chats.
 * Uses the cheap LLM system for efficient summarization.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { updateContextSummary, summarizeChat, ChatMessage, generateTitleFromSummary, considerTitleUpdate } from '@/lib/memory/cheap-llm-tasks'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getModelContextLimit, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { Provider, ConnectionProfile, CheapLLMSettings } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/**
 * Calculates the number of interchanges in a chat
 * An interchange is one user message + one assistant response
 */
export function calculateInterchangeCount(messages: Array<{ role?: string; type?: string }>): number {
  let userMessages = 0
  let assistantMessages = 0
  
  for (const msg of messages) {
    // Skip non-message types (like context-summary, tool-result, etc.)
    if (msg.type && msg.type !== 'message') {
      continue
    }
    
    const role = msg.role?.toUpperCase()
    if (role === 'USER') {
      userMessages++
    } else if (role === 'ASSISTANT') {
      assistantMessages++
    }
  }
  
  // An interchange is complete when both user and assistant have spoken
  // Return the minimum of the two (limiting factor)
  return Math.min(userMessages, assistantMessages)
}

/**
 * Determines if we should check for title update at this interchange count
 * Checks at: 2, 3, 5, 7, 10, then every 10 after
 */
export function shouldCheckTitleAtInterchange(
  currentInterchange: number,
  lastCheckedInterchange: number
): boolean {
  // Never check at 0 or 1
  if (currentInterchange < 2) {
    return false
  }
  
  // If we haven't checked yet, and we're at one of the early checkpoints
  const earlyCheckpoints = [2, 3, 5, 7, 10]
  if (earlyCheckpoints.includes(currentInterchange) && currentInterchange > lastCheckedInterchange) {
    return true
  }
  
  // After 10, check every 10 interchanges
  if (currentInterchange >= 10 && currentInterchange % 10 === 0 && currentInterchange > lastCheckedInterchange) {
    return true
  }
  
  return false
}

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

      // Generate a title from the summary using the cheap LLM
      try {
        const titleResult = await generateTitleFromSummary(result.summary, cheapLLM, userId)
        if (titleResult.success && titleResult.result) {
          await repos.chats.update(chatId, {
            title: titleResult.result,
            updatedAt: new Date().toISOString(),
          })
          logger.info(`[Context Summary] Generated title for chat ${chatId}: ${titleResult.result}`)
        } else {
          logger.warn(`[Context Summary] Failed to generate title for chat ${chatId}: ${titleResult.error}`)
        }
      } catch (titleError) {
        logger.error(`[Context Summary] Error generating title for chat ${chatId}:`, {}, titleError instanceof Error ? titleError : new Error(String(titleError)))
      }
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
    logger.error('Failed to clear context summary:', {}, error instanceof Error ? error : new Error(String(error)))
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
        logger.info(`[Context Summary] Generated summary for chat ${options.chatId}`)
      } else if (!result.success) {
        logger.warn(`[Context Summary] Failed for chat ${options.chatId}: ${result.error}`)
      }
    })
    .catch(error => {
      logger.error(`[Context Summary] Error for chat ${options.chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    })
}

/**
 * Considers updating the chat title based on recent messages
 * Runs asynchronously in the background
 */
async function considerTitleUpdateAsync(
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  cheapLLMSettings: CheapLLMSettings,
  availableProfiles: ConnectionProfile[],
  currentInterchange: number
): Promise<void> {
  try {
    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)

    if (!chat) {
      logger.warn(`[Title Update] Chat ${chatId} not found`)
      return
    }

    // Get cheap LLM provider
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
      logger.warn(`[Title Update] No cheap LLM available for chat ${chatId}`)
      return
    }
    
    // Get messages for context
    const allMessages = await repos.chats.getMessages(chatId)
    const conversationMessages: ChatMessage[] = allMessages
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
      return
    }
    
    // Get recent messages since last check
    // We'll take the last 10 messages as "recent" context
    const recentMessages = conversationMessages.slice(-10)
    
    // Use existing summary if available, otherwise use current title
    const context = chat.contextSummary || chat.title
    
    // Ask the cheap LLM if title needs updating
    const considerationResult = await considerTitleUpdate(
      chat.title,
      recentMessages,
      context,
      cheapLLM,
      userId
    )
    
    if (considerationResult.success && considerationResult.result) {
      const { needsNewTitle, reason, suggestedTitle } = considerationResult.result

      logger.info(`[Title Update] Chat ${chatId} - needsNewTitle: ${needsNewTitle}, reason: ${reason}`)

      if (needsNewTitle && suggestedTitle) {
        // Update the chat title
        await repos.chats.update(chatId, {
          title: suggestedTitle,
          lastRenameCheckInterchange: currentInterchange,
          updatedAt: new Date().toISOString(),
        })
        logger.info(`[Title Update] Updated title for chat ${chatId} to: "${suggestedTitle}"`)
      } else {
        // Still update the last check interchange even if no title change
        await repos.chats.update(chatId, {
          lastRenameCheckInterchange: currentInterchange,
          updatedAt: new Date().toISOString(),
        })
      }
    } else {
      logger.warn(`[Title Update] Failed for chat ${chatId}: ${considerationResult.error}`)
    }
  } catch (error) {
    logger.error(`[Title Update] Error for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Check and generate summary if needed after a message
 * Also checks if title should be updated based on interchange count
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
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)
  
  if (!chat) {
    return
  }
  
  // Get all messages to calculate interchange count
  const allMessages = await repos.chats.getMessages(chatId)
  const currentInterchange = calculateInterchangeCount(allMessages)
  
  // Check if we should consider updating the title
  const lastCheckedInterchange = chat.lastRenameCheckInterchange || 0
  if (shouldCheckTitleAtInterchange(currentInterchange, lastCheckedInterchange)) {
    logger.info(`[Title Update] Checking title at interchange ${currentInterchange} for chat ${chatId}`)

    // Run title consideration in background (non-blocking)
    considerTitleUpdateAsync(
      chatId,
      userId,
      connectionProfile,
      cheapLLMSettings,
      availableProfiles,
      currentInterchange
    ).catch(error => {
      logger.error(`[Title Update] Background error for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    })
  }

  // Original summary check logic
  const needsCheck = await chatNeedsSummary(chatId, provider, modelName)

  if (needsCheck.needsSummary) {
    logger.info(`[Context Summary] Chat ${chatId} needs summary: ${needsCheck.reason}`)

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

