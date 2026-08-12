/**
 * Chat summarization, title generation, and conversation utility tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { stripCodeFences } from '@/lib/services/ai-import.service'
import { executeCheapLLMTask } from './core-execution'
import type { ChatMessage, CheapLLMTaskResult } from './types'

/**
 * Chat summarization prompt template
 */
const CHAT_SUMMARY_PROMPT = `You are a summarizer. Create a concise summary of the following conversation.
Focus on key events, decisions, emotional moments, and important information shared.
Keep the summary under 200 words. Write in third person, past tense.
Respond with only the summary text, no additional formatting.`

/**
 * Help chat title prompt template — practical, descriptive titles for support conversations
 */
const HELP_CHAT_TITLE_PROMPT = `Generate a short, practical title for this help/support conversation.
The title should:
- Be 3-10 words maximum
- Clearly describe what question was asked or what topic was discussed
- Be specific enough that someone scanning a list can find it later (e.g., "Setting up Anthropic API connection" not "Getting started")
- Focus on the user's actual question or problem, not the assistant's personality or style
- Use plain, descriptive language — no literary flair, no metaphors, no poetic phrasing
- If technical, mention the specific feature, setting, or area involved

Respond with only the title, no quotes or additional text.`

/**
 * Help chat title consideration prompt — practical evaluation for help conversations
 */
const HELP_CHAT_TITLE_CONSIDERATION_PROMPT = `You are a help chat title evaluator. You will be given:
1. The current chat title
2. A previous summary or title (if available)
3. Recent messages from the chat

Determine if the chat needs a new title. Consider:
- If the current title is generic (like "Help: [Name]" or "New Chat"), it SHOULD be replaced with a descriptive title about what the user actually asked
- If the title is already descriptive of the question/topic, only suggest a change if the main topic has shifted significantly
- A good help chat title clearly describes the question or topic so someone can find it in a list later
- Titles should be plain and practical — no literary flair, metaphors, or poetic phrasing

Respond with a JSON object:
{
  "needsNewTitle": true/false,
  "reason": "brief explanation",
  "suggestedTitle": "new title if needsNewTitle is true, otherwise null"
}

Keep suggested titles 3-10 words, under 60 characters, plain and descriptive.`

/**
 * Help chat title from summary prompt
 */
const HELP_CHAT_TITLE_FROM_SUMMARY_PROMPT = `Generate a short, practical title for this help/support conversation based on the summary provided.
The title should:
- Be 3-10 words maximum and under 60 characters
- Clearly describe what question was asked or what topic was discussed
- Be specific enough that someone scanning a list can find it later
- Use plain, descriptive language — no literary flair, no metaphors, no poetic phrasing

Respond with only the title, no quotes or additional text.`

/**
 * Chat title prompt template
 */
const CHAT_TITLE_PROMPT = `Generate a literary title for this conversation, like titling a short story.
The title should:
- Be 3-8 words maximum
- Reflect where the conversation ultimately went, not just how it started — weight the later messages more heavily
- Focus on the unique narrative flair, quirky elements, or evocative mood
- Be poetic and distinctive — unless the conversation is really about technical details, in which case mention the kind of technical work being discussed
- Avoid moralistic, ethical, or sterile phrasing — no mentions of consent, boundaries, or lessons
- Unless the conversation is really about one specific character, avoid titling it by character name

The conversation is shown with early messages truncated and recent messages in full. Title based on the overall arc, especially the recent discussion.

Respond with only the title, no quotes or additional text.`

/**
 * Chat title from summary prompt template
 */
const CHAT_TITLE_FROM_SUMMARY_PROMPT = `Generate a literary title for this conversation based on the summary provided, like titling a short story.
The title should:
- Be 3-8 words maximum and under 60 characters
- Focus on the unique narrative flair, quirky elements, or evocative mood
- Be poetic and distinctive — unless the conversation is really about technical details, in which case mention the kind of technical work being discussed
- Avoid moralistic, ethical, or sterile phrasing — no mentions of consent, boundaries, or lessons
- Unless the conversation is really about one specific character, avoid titling it by character name

Respond with only the title, no quotes or additional text.`

/**
 * Prompt for considering whether a chat title should be updated
 */
const CHAT_TITLE_CONSIDERATION_PROMPT = `You are a chat title evaluator. You will be given:
1. The current chat title
2. A previous summary or title (if available)
3. Recent messages from the chat

Determine if the chat needs a new title. Consider:
- If the current title is generic (like "Chat with [Name]" or "New Chat"), it SHOULD be replaced with a literary title based on what the conversation is actually about
- If the title is already descriptive, only suggest a change if the main topic has shifted significantly
- A good title is like titling a short story: it captures the unique narrative flair, quirky elements, or evocative mood in a few words
- Titles should be poetic and distinctive, not moralistic or sterile — avoid mentions of consent, boundaries, or lessons. Exception: if the conversation is really about technical details, the title should mention the kind of technical work being discussed
- Unless the conversation is really about one specific character, avoid titling it by character name

Respond with a JSON object:
{
  "needsNewTitle": true/false,
  "reason": "brief explanation",
  "suggestedTitle": "new title if needsNewTitle is true, otherwise null"
}

Keep suggested titles 3-8 words, under 60 characters, poetic and distinctive (or technically descriptive if the conversation is about technical work).`

/**
 * Context summary update prompt template
 */
const CONTEXT_SUMMARY_PROMPT = `You are updating a running summary of a conversation.
Integrate the new messages into the existing summary, keeping it concise and under 300 words.
Focus on maintaining continuity and capturing any new important information.
Respond with only the updated summary text.`

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
  userId: string,
  chatId?: string
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
    (content: string): string => content.trim(),
    'summarize-chat',
    chatId
  )
}

/**
 * Strips tool call artifacts from assistant message content so that title
 * generation focuses on the actual conversation, not tool machinery.
 *
 * Handles patterns like:
 * - `[Tool call made]` markers
 * - `[Tool Result: toolName ...]` blocks with embedded JSON
 * - Leading/trailing raw JSON fragments from tool responses
 *
 * @returns Cleaned content, or null if no meaningful conversational text remains
 */
export function stripToolArtifacts(content: string): string | null {
  // Quick exit: if no tool markers or leading JSON, return as-is
  if (
    !content.includes('[Tool') &&
    !content.includes('"toolName"') &&
    !/^\s*[{[\],}]/.test(content)
  ) {
    return content
  }

  let cleaned = content

  // Remove [Tool call made] markers
  cleaned = cleaned.replace(/\[Tool call made\]/g, '')

  // Remove [Tool Result: ...] blocks (tool name + JSON content within brackets)
  cleaned = cleaned.replace(/\[Tool Result:[^\]]*\]/g, '')

  // Filter out lines that look like JSON rather than conversation
  const lines = cleaned.split('\n')
  const conversationalLines = lines.filter(line => {
    const t = line.trim()
    if (!t) return false
    // Skip lines that start with JSON structural characters
    if (/^[{}\[\],:]/.test(t)) return false
    // Skip lines that look like JSON key-value pairs
    if (/^"[^"]*"\s*:/.test(t)) return false
    return true
  })

  cleaned = conversationalLines.join('\n').trim()

  // If very little conversational text remains, skip this message entirely
  if (cleaned.length < 20) {
    return null
  }

  return cleaned
}

/**
 * Extracts only the visible conversational messages (what appears in chat bubbles)
 * from a message-like array. This is the standard filter for any cheap LLM task
 * that judges content (titles, summaries, backgrounds, compression, etc.).
 *
 * Filters:
 * - If `type` field present, skips non-'message' entries (system events, context-summaries)
 * - Skips any role that isn't USER or ASSISTANT (filters TOOL and SYSTEM messages)
 * - Applies `stripToolArtifacts()` to assistant messages; skips if null returned
 * - Case-insensitive role matching (handles both 'USER' and 'user')
 *
 * @param messages - Any message-like array (ChatEvents, MessageEvents, etc.)
 * @returns Clean ChatMessage[] with only user/assistant conversational text
 */
export function extractVisibleConversation(
  messages: Array<{ type?: string; role?: string; content?: string }>
): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const m of messages) {
    // Skip non-message entries (system events, context-summary events, etc.)
    if (m.type !== undefined && m.type !== 'message') continue

    // Skip entries without content (e.g., context-summary events)
    if (!m.content) continue

    // Only include USER and ASSISTANT roles
    const role = (m.role || '').toUpperCase()
    if (role !== 'USER' && role !== 'ASSISTANT') continue

    const lowerRole = role.toLowerCase() as 'user' | 'assistant'

    if (lowerRole === 'assistant') {
      const cleaned = stripToolArtifacts(m.content)
      if (!cleaned) continue
      result.push({ role: lowerRole, content: cleaned })
    } else {
      result.push({ role: lowerRole, content: m.content })
    }
  }

  return result
}

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
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // Use up to 100 messages, weighted toward the end of the conversation.
  // Older messages are truncated aggressively; recent messages get full text.
  const capped = messages.slice(-100)
  const recentThreshold = Math.max(0, capped.length - 10)
  const conversationText = capped
    .map((m, i) => {
      const label = m.role.toUpperCase()
      // Last 10 messages: full text (up to 500 chars)
      // Older messages: truncated to 150 chars
      const limit = i >= recentThreshold ? 500 : 150
      const text = m.content.length > limit
        ? m.content.substring(0, limit) + '...'
        : m.content
      return `${label}: ${text}`
    })
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
    },
    'title-chat',
    chatId
  )
}

/**
 * Generates a title for a help chat — practical, descriptive, not literary
 * Should be called after the first Q&A interchange
 */
export async function titleHelpChat(
  messages: ChatMessage[],
  existingTitle: string | undefined,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // For help chats, we use fewer messages since titles should fire early
  const capped = messages.slice(-20)
  const conversationText = capped
    .map(m => {
      const label = m.role.toUpperCase()
      const text = m.content.length > 500
        ? m.content.substring(0, 500) + '...'
        : m.content
      return `${label}: ${text}`
    })
    .join('\n\n')

  let prompt = HELP_CHAT_TITLE_PROMPT
  if (existingTitle && !existingTitle.startsWith('Help:')) {
    prompt += `\n\nCurrent title: "${existingTitle}"\nUpdate only if the conversation topic has shifted significantly.`
  }

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: conversationText },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let title = content.trim()
      title = title.replace(/^["']|["']$/g, '')
      if (title.length > 60) {
        title = title.substring(0, 57) + '...'
      }
      return title
    },
    'title-chat',
    chatId
  )
}

/**
 * Evaluates whether a help chat needs a new title
 */
export async function considerHelpChatTitleUpdate(
  currentTitle: string,
  recentMessages: ChatMessage[],
  existingSummaryOrTitle: string | null,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<{ needsNewTitle: boolean; reason: string; suggestedTitle: string | null }>> {
  const conversationText = recentMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`)
    .join('\n\n')

  const contextInfo = existingSummaryOrTitle
    ? `Previous context: ${existingSummaryOrTitle}`
    : 'No previous context'

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: HELP_CHAT_TITLE_CONSIDERATION_PROMPT },
    { role: 'user', content: `Current Title: "${currentTitle}"\n\n${contextInfo}\n\nRecent Messages:\n${conversationText}` },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): { needsNewTitle: boolean; reason: string; suggestedTitle: string | null } => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)

        let suggestedTitle = parsed.suggestedTitle
        if (suggestedTitle && typeof suggestedTitle === 'string') {
          suggestedTitle = suggestedTitle.trim().replace(/^["']/, '').replace(/["']$/, '')
          if (suggestedTitle.length > 60) {
            suggestedTitle = suggestedTitle.substring(0, 57) + '...'
          }
        }

        return {
          needsNewTitle: parsed.needsNewTitle === true,
          reason: parsed.reason || 'No reason provided',
          suggestedTitle: suggestedTitle || null,
        }
      } catch {
        return {
          needsNewTitle: false,
          reason: 'Failed to parse response',
          suggestedTitle: null,
        }
      }
    },
    'consider-title-update',
    chatId
  )
}

/**
 * Generates a help chat title from a summary — practical, not literary
 */
export async function generateHelpChatTitleFromSummary(
  summary: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: HELP_CHAT_TITLE_FROM_SUMMARY_PROMPT },
    { role: 'user', content: `Summary:\n${summary}` },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let title = content.trim()
      title = title.replace(/^["']|["']$/g, '')
      if (title.length > 60) {
        title = title.substring(0, 57) + '...'
      }
      return title
    },
    'title-from-summary',
    chatId
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
  userId: string,
  chatId?: string
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
    },
    'title-from-summary',
    chatId
  )
}

/**
 * Evaluates whether a chat needs a new title based on recent messages
 * This is a lighter-weight check than full summarization
 *
 * @param currentTitle - The current chat title
 * @param recentMessages - Recent messages (just the new ones since last check)
 * @param existingSummaryOrTitle - Previous summary or title for context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Whether title needs updating and suggested new title
 */
export async function considerTitleUpdate(
  currentTitle: string,
  recentMessages: ChatMessage[],
  existingSummaryOrTitle: string | null,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<{ needsNewTitle: boolean; reason: string; suggestedTitle: string | null }>> {
  // Format recent messages
  const conversationText = recentMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`) // Truncate long messages
    .join('\n\n')

  const contextInfo = existingSummaryOrTitle
    ? `Previous context: ${existingSummaryOrTitle}`
    : 'No previous context'

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: CHAT_TITLE_CONSIDERATION_PROMPT,
    },
    {
      role: 'user',
      content: `Current Title: "${currentTitle}"\n\n${contextInfo}\n\nRecent Messages:\n${conversationText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): { needsNewTitle: boolean; reason: string; suggestedTitle: string | null } => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)

        let suggestedTitle = parsed.suggestedTitle
        if (suggestedTitle && typeof suggestedTitle === 'string') {
          // Clean up the title
          suggestedTitle = suggestedTitle.trim().replace(/^["']/, '').replace(/["']$/, '')
          // Truncate if too long
          if (suggestedTitle.length > 60) {
            suggestedTitle = suggestedTitle.substring(0, 57) + '...'
          }
        }

        return {
          needsNewTitle: parsed.needsNewTitle === true,
          reason: parsed.reason || 'No reason provided',
          suggestedTitle: suggestedTitle || null,
        }
      } catch {
        // If JSON parsing fails, assume no update needed
        return {
          needsNewTitle: false,
          reason: 'Failed to parse response',
          suggestedTitle: null,
        }
      }
    },
    'consider-title-update',
    chatId
  )
}

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
  userId: string,
  chatId?: string
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
    (content: string): string => content.trim(),
    'update-context-summary',
    chatId
  )
}

/**
 * Rolling-window fold prompt. The model is told it is *editing* a prior
 * summary by folding in the next batch of turns, with explicit
 * carry-forward / drop / add verbs per section. The carry-forward framing
 * conserves prior content and keeps drift bounded across many folds.
 */
const FOLD_SUMMARY_PROMPT = `You are updating an existing summary of an ongoing roleplay conversation.

The summary tracks five sections:

- Active threads: what is currently in motion. Carry forward anything still unresolved. Drop threads that have closed. Add new ones from the new turns.
- Resolved decisions: things now locked. Carry forward all prior entries — these don't unresolve. Add anything new the characters have committed to.
- Emotional state: where the room is right now, not the journey. Replace the prior Emotional state entirely with the current state.
- Open questions: unanswered things in the air. Drop any the new turns answered. Carry forward the rest. Add new ones.
- Timeline: dated one-liners of specific things that HAPPENED — visits, outings, arrivals, purchases, incidents. Format each line as "- YYYY-MM-DD (narrative: 'in-story time', only if the story runs on its own timeline): what happened, naming place and participants". Dates come from the timestamps on the new turns. APPEND-ONLY: carry forward every prior Timeline line unchanged and add new lines at the bottom. Cap at ~30 lines — when over, merge the OLDEST lines into coarser one-liners (never drop the dates). Standing facts, moods, and decisions do not belong here — only events.

Rewrite the five sections in plain prose (the Timeline as its dated list). Be concise. Don't transcribe — synthesize. Use character names, not roles. Output only the five sections under their labels; no preamble, no closing remarks.`

export interface FoldSummaryInput {
  /** The previous running summary, or null when this is the first fold. */
  priorSummary: string | null
  /**
   * New conversation turns to fold into the running summary. When a turn
   * carries `createdAt`, its date is rendered inline so the Timeline section
   * can date events from the transcript instead of guessing.
   */
  newTurns: Array<ChatMessage & { createdAt?: string | null }>
}

/**
 * Fold a batch of new turns into the running summary. Frames the call as an
 * update task with a four-section structure (Active threads / Resolved
 * decisions / Emotional state / Open questions). Used by the rolling-window
 * summarization cadence in `lib/chat/context-summary.ts`.
 */
export async function foldChatSummary(
  input: FoldSummaryInput,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
): Promise<CheapLLMTaskResult<string>> {
  const newTurnsText = input.newTurns
    .map(m => {
      const stamp = m.createdAt ? `[${m.createdAt.slice(0, 10)}] ` : ''
      return `${stamp}${m.role.toUpperCase()}: ${m.content}`
    })
    .join('\n\n')

  const priorSummaryBlock = input.priorSummary && input.priorSummary.trim().length > 0
    ? input.priorSummary.trim()
    : '(none — this is the first fold)'

  const userContent = `# Prior summary
${priorSummaryBlock}

# New turns to fold in
${newTurnsText}`

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: FOLD_SUMMARY_PROMPT },
    { role: 'user', content: userContent },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => content.trim(),
    'fold-chat-summary',
    chatId,
  )
}
