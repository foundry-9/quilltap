/**
 * Cheap LLM Tasks Service
 * Sprint 2: Memory System - Background LLM Tasks
 *
 * This module provides functions that use a cheap/fast LLM for background tasks
 * like memory extraction, chat summarization, and title generation.
 * These tasks don't require expensive models and should be cost-efficient.
 */

import { createLLMProvider, ProviderName } from '@/lib/llm/factory'
import { LLMMessage, LLMResponse } from '@/lib/llm/base'
import { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/json-store/repositories'
import { decryptApiKey } from '@/lib/encryption'

/**
 * Candidate memory extracted from a conversation
 */
export interface MemoryCandidate {
  /** Whether the message contains something significant worth remembering */
  significant: boolean
  /** Full memory content (if significant) */
  content?: string
  /** Brief 1-sentence summary (if significant) */
  summary?: string
  /** Keywords for text-based search */
  keywords?: string[]
  /** Importance score from 0.0 to 1.0 */
  importance?: number
}

/**
 * Chat message format for summarization tasks
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Attachment metadata for description task
 */
export interface Attachment {
  id: string
  filename: string
  mimeType: string
  /** Base64 encoded data */
  data?: string
}

/**
 * Result of a cheap LLM task
 */
export interface CheapLLMTaskResult<T> {
  success: boolean
  result?: T
  error?: string
  /** Token usage for cost tracking */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Session-level cache for profiles that don't support custom temperature
 */
const profilesWithoutCustomTemp = new Set<string>()

/**
 * Gets the decrypted API key for a cheap LLM selection
 */
async function getApiKeyForSelection(
  selection: CheapLLMSelection,
  userId: string
): Promise<string | null> {
  if (selection.isLocal) {
    // Local models don't need an API key
    return ''
  }

  if (!selection.connectionProfileId) {
    return null
  }

  const repos = getRepositories()
  const profile = await repos.connections.findById(selection.connectionProfileId)
  if (!profile?.apiKeyId) {
    return null
  }

  const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
  if (!apiKey) {
    return null
  }

  return decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId)
}

/**
 * Executes a cheap LLM task with the given messages
 */
async function executeCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T
): Promise<CheapLLMTaskResult<T>> {
  try {
    const apiKey = await getApiKeyForSelection(selection, userId)
    if (apiKey === null) {
      return {
        success: false,
        error: 'No API key available for cheap LLM provider',
      }
    }

    const provider = createLLMProvider(
      selection.provider as ProviderName,
      selection.baseUrl
    )

    // Create a key for this profile to cache temperature support
    const profileKey = `${selection.provider}:${selection.modelName}`

    // Check if we already know this profile doesn't support custom temperature
    if (profilesWithoutCustomTemp.has(profileKey)) {
      const response: LLMResponse = await provider.sendMessage(
        {
          messages,
          model: selection.modelName,
          maxTokens: 1000,
        },
        apiKey
      )

      const result = parseResponse(response.content)

      return {
        success: true,
        result,
        usage: response.usage,
      }
    }

    // Try with lower temperature for more consistent outputs
    try {
      const response: LLMResponse = await provider.sendMessage(
        {
          messages,
          model: selection.modelName,
          temperature: 0.3, // Lower temperature for more consistent outputs
          maxTokens: 1000,
        },
        apiKey
      )

      const result = parseResponse(response.content)

      return {
        success: true,
        result,
        usage: response.usage,
      }
    } catch (error) {
      // If temperature is not supported, cache it and retry with default temperature
      const errorMessage = error instanceof Error ? error.message : ''
      if (errorMessage.includes('temperature') || errorMessage.includes('does not support')) {
        profilesWithoutCustomTemp.add(profileKey)

        const response: LLMResponse = await provider.sendMessage(
          {
            messages,
            model: selection.modelName,
            maxTokens: 1000,
          },
          apiKey
        )

        const result = parseResponse(response.content)

        return {
          success: true,
          result,
          usage: response.usage,
        }
      }
      throw error
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Memory extraction prompt template for user memories
 */
const USER_MEMORY_EXTRACTION_PROMPT = `You are extracting memories about a USER from their conversation with a CHARACTER.
Analyze the conversation exchange below and identify if there is something significant about the USER that should be remembered for future conversations.

Criteria for significance:
- Personal information about the USER (preferences, history, relationships, traits)
- Emotional moments or important decisions involving the USER
- Facts about the USER that should persist across conversations
- Changes in how the USER relates to or feels about the CHARACTER

IMPORTANT: Only extract memories about the USER based on what the USER says/does, not about the CHARACTER's responses or behavior.
The memory should capture something we learn about the USER from this exchange.

If significant, respond with JSON only (no markdown, no code blocks):
{
  "significant": true,
  "content": "Full memory content describing what we learned about the user",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If not significant, respond with JSON only:
{ "significant": false }

Do not include any text outside the JSON object.`

/**
 * Memory extraction prompt template for character memories
 */
const CHARACTER_MEMORY_EXTRACTION_PROMPT = `You are extracting memories about a CHARACTER from their conversation with a USER.
Analyze the conversation exchange below and identify if there is something significant about the CHARACTER that should be remembered for future conversations.

Criteria for significance:
- Personal information the CHARACTER shares about themselves (preferences, history, relationships, traits, background)
- Emotional moments or important decisions the CHARACTER experiences or reveals
- Facts about the CHARACTER that should persist across conversations
- Changes in the CHARACTER's personality, relationships, or circumstances

IMPORTANT: Only extract memories about the CHARACTER based on what the CHARACTER says/does, not about the USER's responses.
The memory should capture something we learn about the CHARACTER from this exchange.

If significant, respond with JSON only (no markdown, no code blocks):
{
  "significant": true,
  "content": "Full memory content describing what we learned about the character",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If not significant, respond with JSON only:
{ "significant": false }

Do not include any text outside the JSON object.`

/**
 * Extracts a potential memory from a message exchange
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The assistant's response
 * @param context - Additional context (character name, persona, etc.)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A memory candidate or null if nothing significant
 */
export async function extractMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  context: string,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<MemoryCandidate>> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: USER_MEMORY_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `${context}

CONVERSATION:
USER: ${userMessage}

CHARACTER: ${assistantMessage}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        return {
          significant: parsed.significant === true,
          content: parsed.content,
          summary: parsed.summary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    }
  )
}

/**
 * Extracts a potential memory about the CHARACTER from a message exchange
 *
 * @param userMessage - The user's message
 * @param assistantMessage - The character's response
 * @param characterName - The character's name for context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A memory candidate or null if nothing significant
 */
export async function extractCharacterMemoryFromMessage(
  userMessage: string,
  assistantMessage: string,
  characterName: string,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<MemoryCandidate>> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: CHARACTER_MEMORY_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}

CONVERSATION:
USER: ${userMessage}

CHARACTER: ${assistantMessage}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate => {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        return {
          significant: parsed.significant === true,
          content: parsed.content,
          summary: parsed.summary,
          keywords: parsed.keywords || [],
          importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
        }
      } catch {
        // If JSON parsing fails, assume not significant
        return { significant: false }
      }
    }
  )
}

/**
 * Chat summarization prompt template
 */
const CHAT_SUMMARY_PROMPT = `You are a summarizer. Create a concise summary of the following conversation.
Focus on key events, decisions, emotional moments, and important information shared.
Keep the summary under 200 words. Write in third person, past tense.
Respond with only the summary text, no additional formatting.`

/**
 * Summarizes a chat conversation
 *
 * @param messages - The chat messages to summarize
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A summary of the conversation
 */
export async function summarizeChat(
  messages: ChatMessage[],
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Format messages for the prompt
  const conversationText = messages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => content.trim()
  )
}

/**
 * Chat title prompt template
 */
const CHAT_TITLE_PROMPT = `Generate a short, descriptive title for this conversation.
The title should:
- Be 3-6 words maximum
- Capture the main topic or theme
- Be engaging but not clickbait

Respond with only the title, no quotes or additional text.`

/**
 * Chat title from summary prompt template
 */
const CHAT_TITLE_FROM_SUMMARY_PROMPT = `Generate a short, descriptive title for this conversation based on the summary provided.
The title should:
- Be under 60 characters
- Capture the main topic or theme of the conversation
- Be engaging but not clickbait
- Be concise and clear

Respond with only the title, no quotes or additional text.`

/**
 * Generates or updates a chat title
 *
 * @param messages - Recent chat messages
 * @param existingTitle - Current title (if any)
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A new title for the chat
 */
export async function titleChat(
  messages: ChatMessage[],
  existingTitle: string | undefined,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Take only first few messages for title generation
  const relevantMessages = messages.slice(0, 6)
  const conversationText = relevantMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  let prompt = CHAT_TITLE_PROMPT
  if (existingTitle) {
    prompt += `\n\nCurrent title: "${existingTitle}"\nUpdate only if the conversation has evolved significantly.`
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      // Clean up the title
      let title = content.trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      // Truncate if too long
      if (title.length > 50) {
        title = title.substring(0, 47) + '...'
      }
      return title
    }
  )
}

/**
 * Generates a chat title from a summary
 *
 * @param summary - The conversation summary
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A new title for the chat
 */
export async function generateTitleFromSummary(
  summary: string,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_TITLE_FROM_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: `Summary:\n${summary}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      // Clean up the title
      let title = content.trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      // Truncate if too long (60 characters max)
      if (title.length > 60) {
        title = title.substring(0, 57) + '...'
      }
      return title
    }
  )
}

/**
 * Context summary update prompt template
 */
const CONTEXT_SUMMARY_PROMPT = `You are updating a running summary of a conversation.
Integrate the new messages into the existing summary, keeping it concise and under 300 words.
Focus on maintaining continuity and capturing any new important information.
Respond with only the updated summary text.`

/**
 * Updates a running context summary with new messages
 *
 * @param currentSummary - The existing context summary
 * @param newMessages - New messages to integrate
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Updated context summary
 */
export async function updateContextSummary(
  currentSummary: string,
  newMessages: ChatMessage[],
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  const newMessagesText = newMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CONTEXT_SUMMARY_PROMPT,
    },
    {
      role: 'user',
      content: `Current summary:
${currentSummary}

New messages to integrate:
${newMessagesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => content.trim()
  )
}

/**
 * Attachment description prompt template
 */
const ATTACHMENT_DESCRIPTION_PROMPT = `Describe this file attachment briefly for memory/search purposes.
Focus on what the content shows or contains.
Keep the description under 100 words.
Respond with only the description text.`

/**
 * Generates a description for a file attachment
 * Note: Only works with providers that support vision/multimodal
 *
 * @param attachment - The attachment to describe
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A description of the attachment
 */
export async function describeAttachment(
  attachment: Attachment,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<string>> {
  // Check if we have image data
  if (!attachment.data) {
    return {
      success: false,
      error: 'No attachment data provided',
    }
  }

  // Check if the provider supports vision
  const isImage = attachment.mimeType.startsWith('image/')
  if (isImage) {
    // For images, we need a vision-capable model
    // This is a simplified check - in production you'd verify model capabilities
    const llmMessages: LLMMessage[] = [
      {
        role: 'system',
        content: ATTACHMENT_DESCRIPTION_PROMPT,
      },
      {
        role: 'user',
        content: `Please describe this image: ${attachment.filename}`,
        attachments: [
          {
            id: attachment.id,
            filepath: '',
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.data.length,
            data: attachment.data,
          },
        ],
      },
    ]

    return executeCheapLLMTask(
      selection,
      llmMessages,
      userId,
      (content: string): string => content.trim()
    )
  }

  // For non-image files, return a basic description
  return {
    success: true,
    result: `File: ${attachment.filename} (${attachment.mimeType})`,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

/**
 * Batch memory extraction from multiple message pairs
 * More efficient than calling extractMemoryFromMessage multiple times
 *
 * @param exchanges - Array of user/assistant message pairs
 * @param context - Additional context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Array of memory candidates
 */
export async function batchExtractMemories(
  exchanges: Array<{ userMessage: string; assistantMessage: string }>,
  context: string,
  selection: CheapLLMSelection,
  userId: string
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  // Format all exchanges for batch processing
  const exchangesText = exchanges
    .map((e, i) => `Exchange ${i + 1}:\nUser: ${e.userMessage}\nAssistant: ${e.assistantMessage}`)
    .join('\n\n---\n\n')

  const batchPrompt = `Analyze these conversation exchanges. For each exchange, determine if there is something significant worth remembering about the user/character.

Criteria for significance:
- Personal information shared (preferences, history, relationships, traits)
- Emotional moments or important decisions
- Facts that should persist across conversations
- Changes in character development or relationships

Respond with a JSON array of results, one for each exchange:
[
  { "significant": true/false, "content": "...", "summary": "...", "keywords": [...], "importance": 0.X },
  ...
]`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: batchPrompt,
    },
    {
      role: 'user',
      content: `Context: ${context}

${exchangesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate[] => {
      try {
        // Clean the response
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return []
        }

        return parsed.map((item: Record<string, unknown>) => ({
          significant: item.significant === true,
          content: item.content as string | undefined,
          summary: item.summary as string | undefined,
          keywords: (item.keywords as string[]) || [],
          importance: typeof item.importance === 'number' ? item.importance : 0.5,
        }))
      } catch {
        // If parsing fails, return empty array
        return []
      }
    }
  )
}
