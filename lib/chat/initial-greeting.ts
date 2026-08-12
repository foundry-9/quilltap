// Initial Greeting Helper
// Generates a first message for a chat when no scripted greeting exists

import { createLLMProvider } from '@/lib/llm'
import { buildCharacterCacheKey } from '@/lib/llm/cache-key'
import { logger } from '@/lib/logger'
import { logLLMCall } from '@/lib/services/llm-logging.service'

export interface ParticipantMemoryForGreeting {
  aboutCharacterName: string
  summary: string
}

export interface ProjectContextForGreeting {
  name: string
  description?: string | null
  instructions?: string | null
}

export type GreetingRequest = {
  systemPrompt: string
  characterName: string
  provider: string
  modelName: string
  apiKey?: string
  baseUrl?: string | null
  temperature?: number
  maxTokens?: number
  topP?: number
  /** The character profile's raw parameters, forwarded to the provider so
   *  per-model settings (e.g. DeepSeek thinking mode) take effect. */
  profileParameters?: Record<string, unknown>
  /** Memories about other participants in the chat */
  participantMemories?: ParticipantMemoryForGreeting[]
  /** Project context if chat is in a project */
  projectContext?: ProjectContextForGreeting | null
  /** Pre-rendered "### Recent Conversations" block (from memory-recap) */
  recentConversationsBlock?: string
  /** For llm_logs */
  userId?: string
  chatId?: string
  characterId?: string
}

/**
 * Build the context section for project and memories to include in the system prompt
 */
function buildContextSection(
  projectContext?: ProjectContextForGreeting | null,
  participantMemories?: ParticipantMemoryForGreeting[],
  recentConversationsBlock?: string
): string {
  const sections: string[] = []

  // Add project context if present
  if (projectContext) {
    const projectParts: string[] = [`## Project Context: ${projectContext.name}`]
    if (projectContext.description) {
      projectParts.push(projectContext.description)
    }
    if (projectContext.instructions) {
      projectParts.push(`### Project Instructions\n${projectContext.instructions}`)
    }
    sections.push(projectParts.join('\n'))
  }

  // Add participant memories if present
  if (participantMemories && participantMemories.length > 0) {
    const memoryParts: string[] = ['## What You Remember About Other Participants']

    // Group memories by character name
    const memoryByCharacter = new Map<string, string[]>()
    for (const memory of participantMemories) {
      const existing = memoryByCharacter.get(memory.aboutCharacterName) || []
      existing.push(memory.summary)
      memoryByCharacter.set(memory.aboutCharacterName, existing)
    }

    for (const [characterName, summaries] of memoryByCharacter) {
      memoryParts.push(`\nAbout ${characterName}:`)
      for (const summary of summaries) {
        memoryParts.push(`- ${summary}`)
      }
    }

    sections.push(memoryParts.join('\n'))
  }

  // Sibling to "What You Remember" — surfaces summaries of prior chats with this character
  if (recentConversationsBlock) {
    sections.push(recentConversationsBlock)
  }

  return sections.join('\n\n')
}

export interface GreetingResult {
  content: string
  /** True when the LLM consumed tokens but returned empty content — likely a content filter */
  contentFilterDetected: boolean
}

/**
 * Ask the configured LLM to produce a short greeting that fits the character.
 */
export async function generateGreetingMessage({
  systemPrompt,
  characterName,
  provider,
  modelName,
  apiKey,
  baseUrl,
  temperature,
  maxTokens,
  topP,
  profileParameters,
  participantMemories,
  projectContext,
  recentConversationsBlock,
  userId,
  chatId,
  characterId,
}: GreetingRequest): Promise<GreetingResult> {
  const providerClient = await createLLMProvider(provider, baseUrl || undefined)

  // Build enhanced system prompt with context sections
  const contextSection = buildContextSection(projectContext, participantMemories, recentConversationsBlock)
  const basePromptWithContext = contextSection
    ? `${systemPrompt}\n\n${contextSection}`
    : systemPrompt

  const augmentedSystemPrompt = `${basePromptWithContext}\n\nYou are starting a brand new conversation. Before the user says anything, open with a concise greeting that fits ${characterName}'s established voice. Keep it to one or two sentences.`

  const messages = [
    { role: 'system' as const, content: augmentedSystemPrompt },
    {
      role: 'user' as const,
      content: 'The chat is beginning now. Greet the user immediately in-character and invite them to engage.',
    },
  ]

  // Consume the provider's streaming endpoint so the greeting uses the same
  // path as normal chat replies. The chunks are concatenated server-side;
  // streaming them to the UI is a planned follow-up (see CHANGELOG v2.9.x).
  const startTime = Date.now()
  let accumulated = ''
  let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  let streamError: Error | undefined
  try {
    for await (const chunk of providerClient.streamMessage(
      {
        messages,
        model: modelName,
        temperature,
        maxTokens,
        topP,
        cacheKey: buildCharacterCacheKey(characterId),
        profileParameters,
      },
      apiKey ?? ''
    )) {
      if (chunk.content) {
        accumulated += chunk.content
      }
      if (chunk.usage) {
        finalUsage = {
          promptTokens: chunk.usage.promptTokens ?? 0,
          completionTokens: chunk.usage.completionTokens ?? 0,
          totalTokens: chunk.usage.totalTokens ?? 0,
        }
      }
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err))
    throw err
  } finally {
    const durationMs = Date.now() - startTime
    if (userId) {
      logLLMCall({
        userId,
        type: 'CHAT_MESSAGE',
        chatId,
        characterId,
        provider,
        modelName,
        request: {
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        },
        response: {
          content: accumulated,
          ...(streamError ? { error: streamError.message } : {}),
        },
        usage: finalUsage,
        durationMs,
      }).catch(err => {
        logger.warn('[Greeting Generation] Failed to log LLM call', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  const trimmedContent = accumulated.trim()
  const contentFilterDetected = !trimmedContent && !!finalUsage && finalUsage.completionTokens > 0

  if (contentFilterDetected) {
    logger.warn('[Greeting Generation] LLM returned empty content despite consuming tokens - likely content filter hit', {
      context: 'initial-greeting',
      provider,
      model: modelName,
      characterName,
      promptTokens: finalUsage!.promptTokens,
      completionTokens: finalUsage!.completionTokens,
      hadProjectContext: !!projectContext,
      memoryCount: participantMemories?.length || 0,
    })
  } else if (!trimmedContent) {
    logger.warn('[Greeting Generation] LLM returned empty content', {
      context: 'initial-greeting',
      provider,
      model: modelName,
      characterName,
      hadProjectContext: !!projectContext,
      memoryCount: participantMemories?.length || 0,
    })
  }

  return { content: trimmedContent, contentFilterDetected }
}
