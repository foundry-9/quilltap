/**
 * Model Context Window Data
 * Sprint 5: Context Management
 *
 * Provides context window size information for LLM models.
 * Used by the context manager to determine how many tokens
 * can be included in a request.
 */

import { Provider } from '@/lib/schemas/types'
import { FALLBACK_PRICING, ModelPricing } from './pricing'

/**
 * Default context window sizes by provider when model is unknown
 * These are conservative defaults to ensure we don't exceed limits
 */
const DEFAULT_CONTEXT_BY_PROVIDER: Record<Provider, number> = {
  ANTHROPIC: 200000,      // Claude models have 200k context
  OPENAI: 128000,         // GPT-4o has 128k, older models have less
  GOOGLE: 1000000,        // Gemini 1.5/2.0 has 1M context
  GROK: 131072,           // Grok-2 has 128k context
  OLLAMA: 8192,           // Default for local models (varies widely)
  OPENROUTER: 128000,     // Depends on model, use conservative default
  OPENAI_COMPATIBLE: 8192, // Unknown, use very conservative
  GAB_AI: 32000,          // Gab AI has 32k context
}

/**
 * Model-specific context limits that may differ from fallback pricing
 * Add entries here for models that need specific overrides
 */
const MODEL_CONTEXT_OVERRIDES: Record<string, number> = {
  // Ollama models - context varies by model and system memory
  'llama3.2:3b': 131072,
  'llama3.1:8b': 131072,
  'llama3.1:70b': 131072,
  'mistral:7b': 32768,
  'mixtral:8x7b': 32768,
  'codellama:7b': 16384,
  'phi3:mini': 4096,
  'qwen2:7b': 32768,

  // OpenRouter specific models
  'anthropic/claude-3-opus': 200000,
  'anthropic/claude-3-sonnet': 200000,
  'anthropic/claude-3-haiku': 200000,
  'openai/gpt-4-turbo': 128000,
  'openai/gpt-4': 8192,
  'google/gemini-pro': 1000000,

  // Older OpenAI models
  'gpt-4-0613': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo-16k': 16385,
}

/**
 * Get context window size for a model
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @returns Context window size in tokens
 */
export function getModelContextLimit(
  provider: Provider,
  modelName: string
): number {
  // First check for explicit overrides
  const override = MODEL_CONTEXT_OVERRIDES[modelName]
  if (override) {
    return override
  }

  // Check model with provider prefix for OpenRouter
  const prefixedModel = `${provider.toLowerCase()}/${modelName}`
  const prefixedOverride = MODEL_CONTEXT_OVERRIDES[prefixedModel]
  if (prefixedOverride) {
    return prefixedOverride
  }

  // Check fallback pricing data
  const providerPricing = FALLBACK_PRICING[provider]
  if (providerPricing) {
    const modelPricing = providerPricing.find(
      (m: ModelPricing) =>
        m.modelId === modelName ||
        m.modelId.includes(modelName) ||
        modelName.includes(m.modelId)
    )
    if (modelPricing?.contextLength) {
      return modelPricing.contextLength
    }
  }

  // Fall back to provider default
  return DEFAULT_CONTEXT_BY_PROVIDER[provider] || 8192
}

/**
 * Get safe context limit (with buffer for response)
 * Returns the amount we can use for input (prompt + history)
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @param maxResponseTokens Maximum tokens to reserve for response
 * @returns Safe input context limit in tokens
 */
export function getSafeInputLimit(
  provider: Provider,
  modelName: string,
  maxResponseTokens: number = 4096
): number {
  const totalLimit = getModelContextLimit(provider, modelName)

  // Reserve tokens for response and add 10% safety buffer
  const safetyBuffer = Math.ceil(totalLimit * 0.10)
  const safeLimit = totalLimit - maxResponseTokens - safetyBuffer

  // Ensure we have at least some room for input
  return Math.max(1000, safeLimit)
}

/**
 * Check if a model supports extended context
 * (> 32k tokens)
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @returns true if model has > 32k context
 */
export function hasExtendedContext(
  provider: Provider,
  modelName: string
): boolean {
  return getModelContextLimit(provider, modelName) > 32768
}

/**
 * Get recommended context allocation for different purposes
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @returns Object with recommended token allocations
 */
export function getRecommendedContextAllocation(
  provider: Provider,
  modelName: string
): {
  totalLimit: number
  systemPrompt: number
  memories: number
  conversationSummary: number
  recentMessages: number
  responseReserve: number
} {
  const totalLimit = getModelContextLimit(provider, modelName)

  // Scale allocations based on total context size
  if (totalLimit >= 200000) {
    // Large context models (Claude, Gemini)
    return {
      totalLimit,
      systemPrompt: 4000,           // ~2% for system prompt
      memories: 8000,               // ~4% for relevant memories
      conversationSummary: 4000,    // ~2% for conversation summary
      recentMessages: totalLimit * 0.6, // 60% for recent messages
      responseReserve: 8192,        // Reserve for response
    }
  } else if (totalLimit >= 100000) {
    // Medium-large context (GPT-4o)
    return {
      totalLimit,
      systemPrompt: 3000,
      memories: 6000,
      conversationSummary: 3000,
      recentMessages: totalLimit * 0.55,
      responseReserve: 4096,
    }
  } else if (totalLimit >= 32000) {
    // Medium context
    return {
      totalLimit,
      systemPrompt: 2000,
      memories: 4000,
      conversationSummary: 2000,
      recentMessages: totalLimit * 0.5,
      responseReserve: 4096,
    }
  } else {
    // Small context (< 32k)
    return {
      totalLimit,
      systemPrompt: 1000,
      memories: 2000,
      conversationSummary: 1000,
      recentMessages: totalLimit * 0.4,
      responseReserve: 2048,
    }
  }
}

/**
 * Determine if conversation needs summarization
 * based on message count and token usage
 *
 * @param messageCount Number of messages in conversation
 * @param estimatedTokens Estimated tokens used by messages
 * @param contextLimit Total context limit
 * @returns true if summarization is recommended
 */
export function shouldSummarizeConversation(
  messageCount: number,
  estimatedTokens: number,
  contextLimit: number
): boolean {
  // Summarize if we're using more than 60% of context
  const usagePercent = (estimatedTokens / contextLimit) * 100

  if (usagePercent > 60) {
    return true
  }

  // Or if we have more than 50 messages
  if (messageCount > 50) {
    return true
  }

  return false
}

/**
 * Calculate how many recent messages to keep in full
 * based on context constraints
 *
 * @param availableTokens Tokens available for recent messages
 * @param averageMessageTokens Average tokens per message
 * @returns Number of recent messages to keep
 */
export function calculateRecentMessageCount(
  availableTokens: number,
  averageMessageTokens: number = 150
): number {
  const count = Math.floor(availableTokens / averageMessageTokens)
  // Keep at least 4 messages (2 exchanges) and cap at 100
  return Math.max(4, Math.min(100, count))
}
