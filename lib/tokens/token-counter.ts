/**
 * Token Counting Utilities
 * Sprint 5: Context Management
 *
 * Provides token counting for various LLM providers.
 * Uses character-based estimation with provider-specific multipliers
 * since we avoid adding tiktoken dependency for simplicity.
 */

import { Provider } from '@/lib/json-store/schemas/types'

/**
 * Provider-specific tokens per character multipliers
 * These are conservative estimates (slightly over-counting to ensure safety)
 *
 * Different tokenizers produce different token counts:
 * - OpenAI GPT uses tiktoken (cl100k_base)
 * - Anthropic uses their own tokenizer
 * - Google uses SentencePiece
 *
 * Average English text is roughly 4 characters per token, but we use
 * more conservative estimates to avoid exceeding context limits.
 */
const CHARS_PER_TOKEN: Record<Provider | 'default', number> = {
  // OpenAI models: ~4 chars per token on average
  OPENAI: 3.5,
  // Anthropic: similar to OpenAI
  ANTHROPIC: 3.5,
  // Google: slightly more efficient tokenizer
  GOOGLE: 3.8,
  // Grok: similar to OpenAI
  GROK: 3.5,
  // Ollama: depends on model, use conservative estimate
  OLLAMA: 3.5,
  // OpenRouter: varies by model, use conservative
  OPENROUTER: 3.5,
  // OpenAI Compatible: assume OpenAI-like
  OPENAI_COMPATIBLE: 3.5,
  // Gab AI: unknown, use conservative
  GAB_AI: 3.5,
  // Default fallback
  default: 3.5,
}

/**
 * Safety buffer percentage for token estimates
 * We add this buffer to ensure we never exceed context limits
 */
const SAFETY_BUFFER_PERCENT = 0.05 // 5% buffer

/**
 * Estimate token count for a given text
 * Uses character-based estimation with provider-specific multipliers
 *
 * @param text The text to count tokens for
 * @param provider Optional provider for more accurate estimation
 * @returns Estimated token count (conservative estimate)
 */
export function estimateTokens(text: string, provider?: Provider): number {
  if (!text) return 0

  const charsPerToken = provider
    ? CHARS_PER_TOKEN[provider] || CHARS_PER_TOKEN.default
    : CHARS_PER_TOKEN.default

  // Calculate base estimate
  const baseEstimate = Math.ceil(text.length / charsPerToken)

  // Add safety buffer
  return Math.ceil(baseEstimate * (1 + SAFETY_BUFFER_PERCENT))
}

/**
 * Count tokens for a message object
 * Accounts for role markers and formatting overhead
 *
 * @param message Message with role and content
 * @param provider Optional provider for more accurate estimation
 * @returns Estimated token count including overhead
 */
export function countMessageTokens(
  message: { role: string; content: string },
  provider?: Provider
): number {
  // Each message has overhead for role markers, formatting, etc.
  // OpenAI documents ~4 tokens per message overhead
  const MESSAGE_OVERHEAD = 4

  const contentTokens = estimateTokens(message.content, provider)

  // Add overhead for role (system, user, assistant) - typically 1-2 tokens
  const roleTokens = estimateTokens(message.role, provider)

  return contentTokens + roleTokens + MESSAGE_OVERHEAD
}

/**
 * Count tokens for an array of messages
 *
 * @param messages Array of messages
 * @param provider Optional provider for more accurate estimation
 * @returns Total estimated token count
 */
export function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  provider?: Provider
): number {
  if (!messages || messages.length === 0) return 0

  // Conversation overhead (start/end markers, etc.)
  const CONVERSATION_OVERHEAD = 3

  const messageTokens = messages.reduce(
    (total, msg) => total + countMessageTokens(msg, provider),
    0
  )

  return messageTokens + CONVERSATION_OVERHEAD
}

/**
 * Calculate how many tokens are available for response
 * given a context limit and used tokens
 *
 * @param contextLimit Total context window size
 * @param usedTokens Tokens already used
 * @param minResponseTokens Minimum tokens to reserve for response
 * @returns Available tokens for response
 */
export function calculateAvailableResponseTokens(
  contextLimit: number,
  usedTokens: number,
  minResponseTokens: number = 1000
): number {
  const available = contextLimit - usedTokens
  return Math.max(minResponseTokens, available)
}

/**
 * Quick estimation for UI display purposes
 * Less accurate but faster for real-time feedback
 *
 * @param text Text to estimate
 * @returns Quick token estimate
 */
export function quickEstimateTokens(text: string): number {
  if (!text) return 0
  // Simple estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}

/**
 * Format token count for display
 *
 * @param tokens Token count
 * @returns Formatted string (e.g., "1.5k", "125k")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return tokens.toString()
}

/**
 * Check if text exceeds a token limit
 *
 * @param text Text to check
 * @param limit Token limit
 * @param provider Optional provider for more accurate estimation
 * @returns true if text exceeds limit
 */
export function exceedsTokenLimit(
  text: string,
  limit: number,
  provider?: Provider
): boolean {
  return estimateTokens(text, provider) > limit
}

/**
 * Truncate text to fit within a token limit
 * Preserves as much content as possible while staying under limit
 *
 * @param text Text to truncate
 * @param maxTokens Maximum tokens allowed
 * @param provider Optional provider for estimation
 * @param suffix Optional suffix to add (e.g., "...")
 * @returns Truncated text
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  provider?: Provider,
  suffix: string = '...'
): string {
  if (!text) return ''

  const currentTokens = estimateTokens(text, provider)
  if (currentTokens <= maxTokens) {
    return text
  }

  const charsPerToken = provider
    ? CHARS_PER_TOKEN[provider] || CHARS_PER_TOKEN.default
    : CHARS_PER_TOKEN.default

  // Calculate approximate character limit
  const suffixTokens = estimateTokens(suffix, provider)
  const availableTokens = maxTokens - suffixTokens
  const maxChars = Math.floor(availableTokens * charsPerToken * 0.95) // 5% safety margin

  if (maxChars <= 0) {
    return suffix
  }

  // Try to truncate at a word boundary
  let truncated = text.slice(0, maxChars)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > maxChars * 0.8) {
    truncated = truncated.slice(0, lastSpace)
  }

  return truncated + suffix
}

/**
 * Calculate percentage of context used
 *
 * @param usedTokens Tokens currently used
 * @param contextLimit Total context window size
 * @returns Percentage (0-100)
 */
export function getContextUsagePercent(
  usedTokens: number,
  contextLimit: number
): number {
  if (contextLimit <= 0) return 100
  return Math.min(100, Math.round((usedTokens / contextLimit) * 100))
}

/**
 * Get warning level based on context usage
 *
 * @param usedTokens Tokens currently used
 * @param contextLimit Total context window size
 * @returns Warning level: 'ok' | 'warning' | 'critical'
 */
export function getContextWarningLevel(
  usedTokens: number,
  contextLimit: number
): 'ok' | 'warning' | 'critical' {
  const percent = getContextUsagePercent(usedTokens, contextLimit)

  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'ok'
}
