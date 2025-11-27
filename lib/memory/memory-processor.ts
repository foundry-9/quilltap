/**
 * Memory Processor
 * Sprint 3: Auto-Memory Formation
 *
 * This module handles automatic memory extraction from chat messages.
 * It runs as a background task to avoid blocking chat responses.
 */

import { getRepositories } from '@/lib/json-store/repositories'
import { extractMemoryFromMessage, extractCharacterMemoryFromMessage, MemoryCandidate } from './cheap-llm-tasks'
import { getCheapLLMProvider, CheapLLMConfig, CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { ConnectionProfile, CheapLLMSettings, Memory } from '@/lib/json-store/schemas/types'
import { createMemoryWithEmbedding, findSimilarMemories } from './memory-service'

/**
 * Context for memory extraction
 */
export interface MemoryExtractionContext {
  /** Character ID to associate the memory with */
  characterId: string
  /** Character name for context */
  characterName: string
  /** Persona name if available */
  personaName?: string
  /** Chat ID for source reference */
  chatId: string
  /** User message content */
  userMessage: string
  /** Assistant response content */
  assistantMessage: string
  /** Source message ID for tracking */
  sourceMessageId: string
  /** User ID for API access */
  userId: string
  /** Connection profile for cheap LLM */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for user-defined strategy */
  availableProfiles?: ConnectionProfile[]
}

/**
 * Result of memory processing
 */
export interface MemoryProcessingResult {
  /** Whether extraction was successful */
  success: boolean
  /** Whether a memory was created */
  memoryCreated: boolean
  /** The created memory ID if successful */
  memoryId?: string
  /** Error message if failed */
  error?: string
  /** Token usage for cost tracking */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Debug log messages for display in frontend */
  debugLogs?: string[]
}

/**
 * Converts CheapLLMSettings to CheapLLMConfig for the provider selection
 */
function toCheapLLMConfig(settings: CheapLLMSettings): CheapLLMConfig {
  return {
    strategy: settings.strategy,
    userDefinedProfileId: settings.userDefinedProfileId || undefined,
    fallbackToLocal: settings.fallbackToLocal,
  }
}

/**
 * Builds context string for memory extraction
 */
function buildExtractionContext(ctx: MemoryExtractionContext): string {
  const parts: string[] = []

  parts.push(`Character: ${ctx.characterName}`)

  if (ctx.personaName) {
    parts.push(`User persona: ${ctx.personaName}`)
  }

  return parts.join('\n')
}

/**
 * Checks if a similar memory already exists using semantic similarity
 * Falls back to keyword-based search if embedding is not available
 */
async function checkForDuplicateMemory(
  characterId: string,
  candidate: MemoryCandidate,
  userId: string
): Promise<boolean> {
  const content = candidate.content || ''
  const summary = candidate.summary || ''

  // Try semantic similarity first
  try {
    const similarMemories = await findSimilarMemories(
      characterId,
      content,
      summary,
      {
        userId,
        threshold: 0.85, // High threshold for duplicate detection
      }
    )

    if (similarMemories.length > 0) {
      return true
    }
  } catch (error) {
    // Fall back to keyword-based search
  }

  // Fallback: keyword-based duplicate detection
  if (!candidate.keywords || candidate.keywords.length === 0) {
    return false
  }

  const repos = getRepositories()

  // Search for memories with overlapping keywords
  const existingMemories = await repos.memories.findByKeywords(
    characterId,
    candidate.keywords
  )

  if (existingMemories.length === 0) {
    return false
  }

  // Check for high overlap in content
  const candidateContent = content.toLowerCase()

  for (const memory of existingMemories) {
    const memoryContent = memory.content.toLowerCase()

    // If more than 70% of the candidate keywords are in an existing memory,
    // consider it a duplicate
    const matchingKeywords = candidate.keywords.filter(
      kw => memoryContent.includes(kw.toLowerCase())
    )

    if (matchingKeywords.length >= candidate.keywords.length * 0.7) {
      return true
    }

    // Also check for significant content overlap
    if (candidateContent.length > 50 && memoryContent.length > 50) {
      // Simple substring check
      if (
        candidateContent.includes(memoryContent.substring(0, 50)) ||
        memoryContent.includes(candidateContent.substring(0, 50))
      ) {
        return true
      }
    }
  }

  return false
}

/**
 * Creates a memory from an extraction candidate with embedding generation
 */
async function createMemoryFromCandidate(
  ctx: MemoryExtractionContext,
  candidate: MemoryCandidate
): Promise<Memory> {
  // Use the memory service which handles embedding generation
  const memory = await createMemoryWithEmbedding(
    {
      characterId: ctx.characterId,
      chatId: ctx.chatId,
      content: candidate.content || '',
      summary: candidate.summary || '',
      keywords: candidate.keywords || [],
      importance: candidate.importance || 0.5,
      source: 'AUTO',
      sourceMessageId: ctx.sourceMessageId,
      tags: [], // Could inherit from character/chat tags in the future
    },
    {
      userId: ctx.userId,
      // Embedding generation is automatic if profile is configured
    }
  )

  return memory
}

/**
 * Processes a message exchange for potential memory extraction
 *
 * This is the main entry point for automatic memory formation.
 * It should be called after each assistant response in a chat.
 *
 * The function is designed to be non-blocking and fail-safe:
 * - Errors are caught and logged but don't propagate
 * - The chat flow is never blocked by memory extraction
 */
export async function processMessageForMemory(
  ctx: MemoryExtractionContext
): Promise<MemoryProcessingResult> {
  const debugLogs: string[] = []

  try {
    // Get cheap LLM provider selection
    const config = toCheapLLMConfig(ctx.cheapLLMSettings)
    const selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false // ollamaAvailable - we'll check via available profiles
    )

    // Build context for extraction
    const extractionContext = buildExtractionContext(ctx)

    // Extract memories for both user and character
    const [userMemoryResult, characterMemoryResult] = await Promise.all([
      extractMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        extractionContext,
        selection,
        ctx.userId
      ),
      extractCharacterMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        ctx.characterName,
        selection,
        ctx.userId
      ),
    ])

    let memoryCreated = false
    let memoryId: string | undefined = undefined
    let totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }

    // Process user memory
    if (userMemoryResult.success && userMemoryResult.usage) {
      totalUsage.promptTokens += userMemoryResult.usage.promptTokens
      totalUsage.completionTokens += userMemoryResult.usage.completionTokens
      totalUsage.totalTokens += userMemoryResult.usage.totalTokens
    }

    if (userMemoryResult.success) {
      const userCandidate = userMemoryResult.result

      if (userCandidate?.significant) {
        const isDuplicate = await checkForDuplicateMemory(ctx.characterId, userCandidate, ctx.userId)
        if (!isDuplicate) {
          const memory = await createMemoryFromCandidate(ctx, userCandidate)
          memoryCreated = true
          memoryId = memory.id

          const logMsg = `[Memory] Created USER memory for ${ctx.characterName}:\n` +
            `  Content: ${userCandidate.content}\n` +
            `  Summary: ${userCandidate.summary}\n` +
            `  Importance: ${userCandidate.importance}\n` +
            `  Keywords: ${userCandidate.keywords?.join(', ')}`
          debugLogs.push(logMsg)
        } else {
          const logMsg = `[Memory] USER memory skipped (duplicate) for ${ctx.characterName}:\n` +
            `  Summary: ${userCandidate.summary}`
          debugLogs.push(logMsg)
        }
      } else {
        const logMsg = `[Memory] USER memory not significant enough for ${ctx.characterName}:\n` +
          `  Summary: ${userCandidate?.summary || 'N/A'}\n` +
          `  Importance: ${userCandidate?.importance || 'N/A'}`
        debugLogs.push(logMsg)
      }
    } else if (!userMemoryResult.success) {
      const logMsg = `[Memory] USER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${userMemoryResult.error}\n` +
        `  User message: ${ctx.userMessage.substring(0, 200)}${ctx.userMessage.length > 200 ? '...' : ''}`
      debugLogs.push(logMsg)
    }

    // Process character memory
    if (characterMemoryResult.success && characterMemoryResult.usage) {
      totalUsage.promptTokens += characterMemoryResult.usage.promptTokens
      totalUsage.completionTokens += characterMemoryResult.usage.completionTokens
      totalUsage.totalTokens += characterMemoryResult.usage.totalTokens
    }

    if (characterMemoryResult.success) {
      const charCandidate = characterMemoryResult.result

      if (charCandidate?.significant) {
        const isDuplicate = await checkForDuplicateMemory(ctx.characterId, charCandidate, ctx.userId)
        if (!isDuplicate) {
          await createMemoryFromCandidate(ctx, charCandidate)

          const logMsg = `[Memory] Created CHARACTER memory for ${ctx.characterName}:\n` +
            `  Content: ${charCandidate.content}\n` +
            `  Summary: ${charCandidate.summary}\n` +
            `  Importance: ${charCandidate.importance}\n` +
            `  Keywords: ${charCandidate.keywords?.join(', ')}`
          debugLogs.push(logMsg)
        } else {
          const logMsg = `[Memory] CHARACTER memory skipped (duplicate) for ${ctx.characterName}:\n` +
            `  Summary: ${charCandidate.summary}`
          debugLogs.push(logMsg)
        }
      } else {
        const logMsg = `[Memory] CHARACTER memory not significant enough for ${ctx.characterName}:\n` +
          `  Summary: ${charCandidate?.summary || 'N/A'}\n` +
          `  Importance: ${charCandidate?.importance || 'N/A'}`
        debugLogs.push(logMsg)
      }
    } else if (!characterMemoryResult.success) {
      const logMsg = `[Memory] CHARACTER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${characterMemoryResult.error}\n` +
        `  Character message: ${ctx.assistantMessage.substring(0, 200)}${ctx.assistantMessage.length > 200 ? '...' : ''}`
      debugLogs.push(logMsg)
    }

    return {
      success: true,
      memoryCreated,
      memoryId,
      usage: totalUsage,
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  } catch (error) {
    // Never let memory processing break the chat flow
    const errorMsg = 'Memory processing error:' + (error instanceof Error ? error.message : 'Unknown error')
    console.error(errorMsg)
    return {
      success: false,
      memoryCreated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  }
}

/**
 * Processes memory extraction in the background (fire-and-forget)
 *
 * This is a convenience wrapper that logs the result but doesn't await it.
 * Use this when you want to trigger memory extraction without blocking.
 */
export function processMessageForMemoryAsync(
  ctx: MemoryExtractionContext,
  onComplete?: (result: MemoryProcessingResult) => void
): void {
  processMessageForMemory(ctx)
    .then(result => {
      if (result.memoryCreated) {
        console.log(
          `[Memory] Created memory ${result.memoryId} for character ${ctx.characterId}`
        )
      } else if (!result.success) {
        console.warn(`[Memory] Extraction failed: ${result.error}`)
      }
      // Call the callback with the full result
      onComplete?.(result)
      // Silent success without memory creation is normal (not everything is significant)
    })
    .catch(error => {
      console.error('[Memory] Async processing error:', error)
    })
}

/**
 * Batch process existing chat messages for memory extraction
 *
 * Useful for extracting memories from historical conversations
 * or when memory extraction was temporarily disabled.
 *
 * @param chatId - The chat to process
 * @param characterId - The character ID
 * @param userId - The user ID for API access
 * @param options - Processing options
 */
export async function batchProcessChatForMemories(
  chatId: string,
  characterId: string,
  userId: string,
  options: {
    /** Only process messages after this timestamp */
    afterTimestamp?: string
    /** Maximum number of message pairs to process */
    maxPairs?: number
    /** Connection profile ID to use */
    connectionProfileId: string
  }
): Promise<{
  processed: number
  memoriesCreated: number
  errors: number
}> {
  const repos = getRepositories()

  // Get chat messages
  const messages = await repos.chats.getMessages(chatId)

  // Get character
  const character = await repos.characters.findById(characterId)
  if (!character) {
    throw new Error(`Character ${characterId} not found`)
  }

  // Get connection profile
  const connectionProfile = await repos.connections.findById(options.connectionProfileId)
  if (!connectionProfile) {
    throw new Error(`Connection profile ${options.connectionProfileId} not found`)
  }

  // Get chat settings for cheap LLM config
  const chatSettings = await repos.users.getChatSettings(userId)
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user ${userId}`)
  }

  // Get all available profiles for user-defined strategy
  const availableProfiles = await repos.connections.findByUserId(userId)

  // Filter and pair messages - only include message events with USER or ASSISTANT role
  const messageEvents = messages
    .filter((m): m is typeof m & { type: 'message'; role: 'USER' | 'ASSISTANT' } =>
      m.type === 'message' &&
      (m.role === 'USER' || m.role === 'ASSISTANT') &&
      (!options.afterTimestamp || m.createdAt > options.afterTimestamp)
    )

  // Pair user messages with their subsequent assistant responses
  const pairs: Array<{
    userMessage: { id: string; content: string }
    assistantMessage: { id: string; content: string }
  }> = []

  for (let i = 0; i < messageEvents.length - 1; i++) {
    const current = messageEvents[i]
    const next = messageEvents[i + 1]

    if (current.role === 'USER' && next.role === 'ASSISTANT') {
      pairs.push({
        userMessage: { id: current.id, content: current.content },
        assistantMessage: { id: next.id, content: next.content },
      })
    }
  }

  // Limit pairs if specified
  const pairsToProcess = options.maxPairs
    ? pairs.slice(0, options.maxPairs)
    : pairs

  let processed = 0
  let memoriesCreated = 0
  let errors = 0

  // Process each pair
  for (const pair of pairsToProcess) {
    const result = await processMessageForMemory({
      characterId,
      characterName: character.name,
      chatId,
      userMessage: pair.userMessage.content,
      assistantMessage: pair.assistantMessage.content,
      sourceMessageId: pair.assistantMessage.id,
      userId,
      connectionProfile,
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      availableProfiles,
    })

    processed++

    if (result.memoryCreated) {
      memoriesCreated++
    }

    if (!result.success) {
      errors++
    }

    // Small delay between API calls to avoid rate limiting
    if (processed < pairsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { processed, memoriesCreated, errors }
}
