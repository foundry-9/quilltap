/**
 * Message Selector
 *
 * Selects recent messages to fit within token budget.
 * Supports both single-character and multi-character message formats.
 */

import type { Provider } from '@/lib/schemas/types'
import { estimateTokens } from '@/lib/tokens/token-counter'

/**
 * Extended message type with optional participant info
 */
export interface SelectableMessage {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  name?: string
  participantId?: string | null
}

/**
 * Result of selecting recent messages
 */
export interface MessageSelectionResult {
  messages: SelectableMessage[]
  tokenCount: number
  truncated: boolean
}

/**
 * Select recent messages to fit within token budget
 * Supports both single-character and multi-character message formats
 */
export function selectRecentMessages(
  messages: SelectableMessage[],
  maxTokens: number,
  provider: Provider
): MessageSelectionResult {
  if (messages.length === 0) {
    return { messages: [], tokenCount: 0, truncated: false }
  }

  const selectedMessages: SelectableMessage[] = []
  let totalTokens = 0
  let truncated = false

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    // Account for potential name prefix in token count
    const nameOverhead = msg.name ? estimateTokens(`[${msg.name}] `, provider) : 0
    const msgTokens = estimateTokens(msg.content, provider) + nameOverhead + 4 // +4 for message overhead

    if (totalTokens + msgTokens > maxTokens) {
      truncated = true
      break
    }

    // Preserve all fields including id, name and participantId. `id` is the
    // source chat_messages row — the attachment anchor needs it to tell the
    // user's own turn from a staff whisper wearing role=user (bug 95).
    selectedMessages.unshift({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
      participantId: msg.participantId,
    })
    totalTokens += msgTokens
  }

  // Ensure we have at least the last message if possible
  if (selectedMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    selectedMessages.push({
      role: lastMsg.role,
      content: lastMsg.content,
      thoughtSignature: lastMsg.thoughtSignature,
      name: lastMsg.name,
      participantId: lastMsg.participantId,
    })
    const nameOverhead = lastMsg.name ? estimateTokens(`[${lastMsg.name}] `, provider) : 0
    totalTokens = estimateTokens(lastMsg.content, provider) + nameOverhead + 4
    truncated = true
  }

  return {
    messages: selectedMessages,
    tokenCount: totalTokens,
    truncated,
  }
}
