/**
 * Context and memory compression tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { executeCheapLLMTask } from './core-execution'
import type {
  ChatMessage,
  CheapLLMTaskResult,
  CompressionResult,
  UncensoredFallbackOptions,
} from './types'

/**
 * Context compression prompt template for conversation history
 * Uses dynamic {{userName}} and {{characterName}} placeholders
 */
const MESSAGE_COMPRESSION_PROMPT = `You are a context compression assistant. Your job is to read a conversation between {{userName}} and {{characterName}}, and compress the older messages into a concise summary that preserves critical information while drastically reducing token count.

**What to PRESERVE:**
- Decisions made and conclusions reached
- Active projects, tasks, and goals
- Technical details that affect ongoing work (file paths, configurations, error messages, code solutions)
- Emotional or personal context that affects how {{characterName}} should engage
- Unresolved questions or threads
- Key facts about preferences, workflow, or situation

**What to DROP:**
- Exact wording of back-and-forth exchanges
- Redundant tool calls and their full results (keep only the outcome)
- Superseded information (if a bug was fixed, you don't need the original broken behavior)
- Conversational pleasantries and filler
- Verbose code snippets (summarize what was changed/fixed)
- Tangential side topics that have concluded

**Output Format:**
Provide a structured summary in plain text using these sections:

### Current Context
[One paragraph: What is being worked on? What is the immediate goal or task?]

### Recent Decisions & Outcomes
[Bullet list: What was decided, fixed, or accomplished in the older messages?]

### Active Threads
[Bullet list: What topics, questions, or tasks are still in progress or unresolved?]

### User State & Preferences
[One paragraph: Any important context about the user's situation, emotional state, preferences, or constraints.]

### Technical Details
[Bullet list or short paragraphs: File paths, commands, configurations, error messages, or code changes that may be referenced again.]

**Target length:** {{targetTokens}} tokens.`

/**
 * System prompt compression prompt template
 */
const SYSTEM_PROMPT_COMPRESSION_PROMPT = `You are a system prompt compression assistant. Compress the following character system prompt to approximately {{targetTokens}} tokens while preserving:

1. Core identity and personality traits
2. Essential behavioral guidelines
3. Key relationship dynamics
4. Important constraints or rules

You may drop:
- Verbose examples
- Detailed formatting rules
- Redundant explanations
- Lengthy background details

Output only the compressed system prompt text, no additional commentary.`

/**
 * Memory compression prompt template
 * Uses dynamic {{characterName}} and {{targetTokens}} placeholders
 */
const MEMORY_COMPRESSION_PROMPT = `You are a memory compression assistant. You are given a set of recalled memories belonging to {{characterName}}. Your job is to compress them into a shorter form that preserves the most important information while fitting within a token budget.

**What to PRESERVE (in priority order):**
- Key relationships and who people are to {{characterName}}
- Emotional bonds, promises, and trust dynamics
- Unresolved situations or ongoing commitments
- Important facts about the world, setting, and locations
- Preferences, habits, and personality-defining moments
- Decisions {{characterName}} made and why
- Dates attached to events — keep the date with the event it dates

**What to DROP:**
- Redundant entries that say the same thing in different words
- Minor details that don't affect future interactions

**Output Format:**
Produce a single block of condensed memory notes as a bulleted list. Each bullet should be one key fact or relationship. Do not add commentary or headers.

**Target length:** {{targetTokens}} tokens.`

// ============================================================================
// Shared helpers
// ============================================================================

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

/** Shared CompressionResult parser — trims content and estimates compressed tokens. */
function parseCompressionResult(originalTokens: number): (content: string) => CompressionResult {
  return (content: string): CompressionResult => {
    const compressedText = content.trim()
    const compressedTokens = estimateTokens(compressedText)
    return { compressedText, originalTokens, compressedTokens }
  }
}

interface RunCompressionArgs {
  systemPrompt: string
  userContent: string
  originalTokens: number
  taskType: string
  selection: CheapLLMSelection
  userId: string
  chatId?: string
  uncensoredFallback?: UncensoredFallbackOptions
}

/**
 * Shared execution wrapper: builds the two LLMMessages, calls
 * `executeCheapLLMTask` with the standard CompressionResult parser, and
 * returns the result. All three public compression functions delegate here.
 */
function runCompression(args: RunCompressionArgs): Promise<CheapLLMTaskResult<CompressionResult>> {
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: args.systemPrompt },
    { role: 'user', content: args.userContent },
  ]

  return executeCheapLLMTask(
    args.selection,
    llmMessages,
    args.userId,
    parseCompressionResult(args.originalTokens),
    args.taskType,
    args.chatId,
    undefined,
    args.uncensoredFallback,
    4000
  )
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compresses older conversation history into a structured summary
 *
 * @param messages - Messages to compress (typically messages 1 through N-windowSize)
 * @param characterName - The character's name for context
 * @param userName - The user's name for context
 * @param targetTokens - Target token count for the compressed output
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The compressed conversation history
 */
export async function compressConversationHistory(
  messages: ChatMessage[],
  characterName: string,
  userName: string,
  targetTokens: number,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string
): Promise<CheapLLMTaskResult<CompressionResult>> {
  // Format messages for compression
  const conversationText = messages
    .map(m => {
      const speaker = m.role === 'user' ? userName : m.role === 'assistant' ? characterName : 'System'
      return `${speaker}: ${m.content}`
    })
    .join('\n\n')

  const systemPrompt = MESSAGE_COMPRESSION_PROMPT
    .replace(/\{\{userName\}\}/g, userName)
    .replace(/\{\{characterName\}\}/g, characterName)
    .replace(/\{\{targetTokens\}\}/g, String(targetTokens))

  return runCompression({
    systemPrompt,
    userContent: `Compress the following conversation history:\n\n${conversationText}`,
    originalTokens: estimateTokens(conversationText),
    taskType: 'compress-conversation-history',
    selection,
    userId,
    chatId,
    uncensoredFallback,
  })
}

/**
 * Compresses a system prompt to a target token count
 *
 * @param systemPrompt - The full system prompt to compress
 * @param targetTokens - Target token count for the compressed output
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The compressed system prompt
 */
export async function compressSystemPrompt(
  systemPrompt: string,
  targetTokens: number,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string
): Promise<CheapLLMTaskResult<CompressionResult>> {
  const prompt = SYSTEM_PROMPT_COMPRESSION_PROMPT
    .replace(/\{\{targetTokens\}\}/g, String(targetTokens))

  return runCompression({
    systemPrompt: prompt,
    userContent: `Compress this system prompt:\n\n${systemPrompt}`,
    originalTokens: estimateTokens(systemPrompt),
    taskType: 'compress-system-prompt',
    selection,
    userId,
    chatId,
    uncensoredFallback,
  })
}

/**
 * Compresses recalled memories into a shorter form to fit within budget
 *
 * @param formattedMemoryText - The already-formatted memory text to compress
 * @param characterName - The character whose memories these are
 * @param targetTokens - Target token count for the compressed output
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param uncensoredFallback - Optional uncensored fallback for dangerous chats
 * @param chatId - Optional chat ID for LLM call logging
 * @returns The compressed memories
 */
export async function compressMemories(
  formattedMemoryText: string,
  characterName: string,
  targetTokens: number,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string
): Promise<CheapLLMTaskResult<CompressionResult>> {
  const systemPrompt = MEMORY_COMPRESSION_PROMPT
    .replace(/\{\{characterName\}\}/g, characterName)
    .replace(/\{\{targetTokens\}\}/g, String(targetTokens))

  return runCompression({
    systemPrompt,
    userContent: `Compress the following recalled memories:\n\n${formattedMemoryText}`,
    originalTokens: estimateTokens(formattedMemoryText),
    taskType: 'compress-memories',
    selection,
    userId,
    chatId,
    uncensoredFallback,
  })
}
