/**
 * Token Counting Utilities
 * Sprint 5: Context Management
 *
 * Provides token counting for various LLM providers.
 * Uses character-based estimation with provider-specific multipliers
 * since we avoid adding tiktoken dependency for simplicity.
 *
 * NOTE: Registered plugins provide charsPerToken via the provider registry.
 * The hardcoded CHARS_PER_TOKEN is kept as a fallback for unknown providers
 * and backward compatibility.
 */

import { Provider } from '@/lib/schemas/types'
import { getCharsPerToken as getCharsPerTokenFromRegistry } from '@/lib/plugins/provider-registry'

/**
 * Provider-specific tokens per character multipliers (fallback)
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
  // Default fallback
  default: 3.5,
}

/**
 * Get characters per token for a provider
 * First checks the plugin registry, falls back to hardcoded values
 *
 * @param provider The LLM provider
 * @returns Characters per token ratio
 */
function getProviderCharsPerToken(provider: Provider): number {
  // First try the plugin registry
  const registryValue = getCharsPerTokenFromRegistry(provider)
  // If registry returns default (3.5), also check hardcoded for provider-specific values
  if (registryValue !== 3.5) {
    return registryValue
  }

  // Fall back to hardcoded values
  return CHARS_PER_TOKEN[provider] || CHARS_PER_TOKEN.default
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
    ? getProviderCharsPerToken(provider)
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
 * Estimate the tokens a tool/function-definition list occupies in a request.
 *
 * Tool schemas never appear in the message array, but every provider serializes
 * them into the same payload the context window measures — a dozen tools with
 * fleshed-out parameter descriptions is thousands of tokens. Counting only
 * messages therefore understates the payload by exactly the amount that matters
 * most on a small window, where the tool block can outweigh the conversation.
 *
 * The shape is provider-specific (`{type, function:{...}}` for OpenAI-style,
 * flat `{name, input_schema}` for Anthropic-style), so this measures the
 * serialized form rather than reaching into either layout.
 *
 * @param tools Tool definitions as they will be sent
 * @param provider Optional provider for more accurate estimation
 * @returns Estimated token count including per-tool framing overhead
 */
export function countToolSchemaTokens(
  tools: readonly unknown[] | null | undefined,
  provider?: Provider
): number {
  if (!tools || tools.length === 0) return 0

  // Per-tool framing (delimiters, name/description separators) beyond the
  // serialized JSON itself.
  const TOOL_OVERHEAD = 4

  let serialized: string
  try {
    serialized = JSON.stringify(tools)
  } catch {
    // A non-serializable definition can't be measured; don't let an estimate
    // take down a turn that would otherwise succeed.
    return 0
  }

  return estimateTokens(serialized, provider) + tools.length * TOOL_OVERHEAD
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
    ? getProviderCharsPerToken(provider)
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
