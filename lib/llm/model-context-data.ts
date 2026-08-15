/**
 * Model Context Window Data
 * Sprint 5: Context Management
 *
 * Provides context window size information for LLM models.
 * Used by the context manager to determine how many tokens
 * can be included in a request.
 *
 * NOTE: Registered plugins provide defaultContextWindow and model info
 * via the provider registry. The hardcoded DEFAULT_CONTEXT_BY_PROVIDER
 * is kept as a fallback for unknown providers and backward compatibility.
 */

import { Provider } from '@/lib/schemas/types'
import { FALLBACK_PRICING, ModelPricing } from './pricing'
import { getDefaultContextWindow, getProvider } from '@/lib/plugins/provider-registry'
import { getModelClass } from './model-classes'

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

  // Try to get context from plugin's model info
  const plugin = getProvider(provider)
  if (plugin?.getModelInfo) {
    const models = plugin.getModelInfo()
    const modelInfo = models.find(
      m => m.id === modelName ||
        m.id.includes(modelName) ||
        modelName.includes(m.id)
    )
    if (modelInfo?.contextWindow) {
      return modelInfo.contextWindow
    }
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

  // Try plugin's default context window
  const registryDefault = getDefaultContextWindow(provider)
  if (registryDefault !== 8192) {
    // Registry returned a non-default value
    return registryDefault
  }

  // Fall back to hardcoded provider default
  return DEFAULT_CONTEXT_BY_PROVIDER[provider] || 8192
}

/**
 * Minimal profile shape needed to resolve a context window. Kept structural so
 * callers can pass a full `ConnectionProfile` or any subset carrying the field.
 */
export interface ContextWindowSource {
  maxContext?: number | null
}

/**
 * Resolve the effective context window for a request.
 *
 * **This is the single source of truth for "how big is this model's window".**
 * The profile's user-set Max Context wins over any table lookup: the tables are
 * keyed by model name and go stale the moment someone points Ollama or an
 * OpenAI-compatible endpoint at a model the table has never heard of, at which
 * point `getModelContextLimit` silently returns a conservative provider default
 * (8192 for OLLAMA / OPENAI_COMPATIBLE). Budgeting a 64k model as 8k truncates
 * conversation history on every turn and reports nothing but a vague
 * "conversation is getting long" warning.
 *
 * Callers that hold a profile must route through here rather than calling
 * `getModelContextLimit` directly, or the budget and the compression trigger
 * end up working from two different windows.
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @param profile Connection profile whose `maxContext` overrides the lookup
 * @returns Context window size in tokens
 */
export function resolveContextWindow(
  provider: Provider,
  modelName: string,
  profile?: ContextWindowSource | null
): number {
  if (profile?.maxContext != null && profile.maxContext > 0) {
    return profile.maxContext
  }

  return getModelContextLimit(provider, modelName)
}

/**
 * Fraction of the context window held back beyond the response reserve, to
 * absorb the gap between our character-based token estimates and the model's
 * real tokenizer.
 */
export const CONTEXT_SAFETY_MARGIN_RATIO = 0.10

/**
 * The ceiling the outgoing payload must fit under: window, less the response
 * reserve, less the safety margin.
 *
 * **Everything that packs the payload and everything that validates it must use
 * this same number.** They used not to: the context builder filled to
 * `totalLimit − responseReserve` while the pre-send check warned above
 * `totalLimit − responseReserve − 10%`, so the builder always aimed past the
 * line the validator drew and a full context reported an overage it had been
 * told to produce.
 *
 * @param totalLimit The model's context window
 * @param responseReserve Tokens held back for the response
 * @returns Safe input limit in tokens (floored at 1000)
 */
export function computeSafeInputLimit(totalLimit: number, responseReserve: number): number {
  const safetyMargin = Math.ceil(totalLimit * CONTEXT_SAFETY_MARGIN_RATIO)

  // Ensure we have at least some room for input
  return Math.max(1000, totalLimit - responseReserve - safetyMargin)
}

/**
 * Get safe context limit (with buffer for response)
 * Returns the amount we can use for input (prompt + history)
 *
 * @param provider The LLM provider
 * @param modelName The model name/identifier
 * @param maxResponseTokens Maximum tokens to reserve for response
 * @param profile Connection profile whose `maxContext` overrides the lookup
 * @returns Safe input context limit in tokens
 */
export function getSafeInputLimit(
  provider: Provider,
  modelName: string,
  maxResponseTokens: number = 4096,
  profile?: ContextWindowSource | null
): number {
  return computeSafeInputLimit(
    resolveContextWindow(provider, modelName, profile),
    maxResponseTokens
  )
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
 * @param profile Connection profile whose `maxContext` overrides the lookup
 * @returns Object with recommended token allocations
 */
export function getRecommendedContextAllocation(
  provider: Provider,
  modelName: string,
  profile?: ContextWindowSource | null
): {
  totalLimit: number
  systemPrompt: number
  memories: number
  knowledge: number
  conversationSummary: number
  recentMessages: number
  responseReserve: number
  safetyMargin: number
  safeInputLimit: number
} {
  const totalLimit = resolveContextWindow(provider, modelName, profile)

  // Scale allocations as percentages of total context, with minimum floors.
  // System prompt gets up to 20%: a fleshed-out character (description,
  // personality, scenarios, system prompts, multi-character context,
  // wardrobe, tool instructions, status reminders, mentioned-characters
  // dossier) routinely runs 4–10k tokens, and the previous 5%/1000-floor
  // budget caused recently-appended sections to be lopped off the end.
  const systemPrompt = Math.max(4000, Math.floor(totalLimit * 0.20))
  const memories = Math.max(2000, Math.floor(totalLimit * 0.04))
  // Knowledge: per-turn recall of relevant files from the responding
  // character's vault Knowledge/ folder. Floor of 800 fits roughly one full
  // inline file (≤500-token body + frontmatter + framing) or several
  // pointer entries; 2% of total context lets larger windows scale up.
  const knowledge = Math.max(800, Math.floor(totalLimit * 0.02))
  const conversationSummary = Math.max(1000, Math.floor(totalLimit * 0.02))
  const responseReserve = totalLimit >= 200000 ? 8192
    : totalLimit >= 100000 ? 4096
    : totalLimit >= 32000 ? 4096
    : 2048
  const recentMessages = totalLimit >= 200000 ? totalLimit * 0.6
    : totalLimit >= 100000 ? totalLimit * 0.55
    : totalLimit >= 32000 ? totalLimit * 0.5
    : totalLimit * 0.4

  return {
    totalLimit,
    systemPrompt,
    memories,
    knowledge,
    conversationSummary,
    recentMessages,
    responseReserve,
    safetyMargin: Math.ceil(totalLimit * CONTEXT_SAFETY_MARGIN_RATIO),
    safeInputLimit: computeSafeInputLimit(totalLimit, responseReserve),
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

  // Or if we have more than 20 messages
  if (messageCount > 20) {
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

// ============================================================================
// BUDGET-DRIVEN CONTEXT COMPRESSION
// ============================================================================

/** Budget ratio: conversation history should not exceed 50% of max_available */
export const CONTEXT_HISTORY_BUDGET_RATIO = 0.50

/** Budget ratio: recalled memories should not exceed 20% of max_available */
export const MEMORY_BUDGET_RATIO = 0.20

/** Default max context window when no profile/model info is available */
export const DEFAULT_MAX_CONTEXT = 128000

/** Default max output tokens when no profile/model info is available */
export const DEFAULT_MAX_TOKENS = 8000

/** Minimum floor for max_available to prevent degenerate cases */
const MIN_MAX_AVAILABLE = 4096

/**
 * Resolve the effective maxTokens (max output) for a connection profile.
 *
 * Resolution order:
 * 1. Profile's top-level maxTokens field (explicit user override for budget calculation)
 * 2. Model class maxOutput (from profile's modelClass tier)
 * 3. Default: 8000
 *
 * NOTE: We intentionally do NOT read from parameters.max_tokens / parameters.maxTokens.
 * That value is the per-request generation cap (often set to the model's maximum, e.g. 128K),
 * not a realistic output expectation. Using it would produce nonsensical budgets
 * (e.g., 200K context - 2*128K = negative).
 */
export function resolveMaxTokens(profile: {
  maxTokens?: number | null
  modelClass?: string | null
  parameters?: Record<string, unknown>
}): number {
  // 1. Explicit profile override (top-level field set specifically for budget calculation)
  if (profile.maxTokens != null && profile.maxTokens > 0) {
    return profile.maxTokens
  }

  // 2. Model class
  if (profile.modelClass) {
    const mc = getModelClass(profile.modelClass)
    if (mc) {
      return mc.maxOutput
    }
  }

  // 4. Default
  return DEFAULT_MAX_TOKENS
}

/**
 * Calculate the maximum available tokens for a prompt (max_available).
 *
 * Formula: max_available = maxContext - (2 * maxTokens)
 *
 * The 2x multiplier reserves space for both the response and a safety buffer
 * (e.g., extended thinking, tool call overhead).
 *
 * @returns maxAvailable (floored at MIN_MAX_AVAILABLE), plus the resolved maxContext and maxTokens
 */
export function calculateMaxAvailable(
  provider: Provider,
  modelName: string,
  profile: {
    maxContext?: number | null
    maxTokens?: number | null
    modelClass?: string | null
    parameters?: Record<string, unknown>
  }
): { maxAvailable: number; maxContext: number; maxTokens: number } {
  // Resolve maxContext: profile override -> model lookup -> default
  const maxContext = resolveContextWindow(provider, modelName, profile) || DEFAULT_MAX_CONTEXT

  // Resolve maxTokens
  const maxTokens = resolveMaxTokens(profile)

  // Cap maxTokens so it never consumes more than 20% of maxContext
  // Model classes and parameters often set maxOutput to the model's absolute ceiling
  // (e.g., 128K on a 200K model), which would make maxAvailable negative.
  // The 2x multiplier already provides generous headroom for response + overhead.
  const cappedMaxTokens = Math.min(maxTokens, Math.floor(maxContext * 0.20))

  // Calculate available budget
  const maxAvailable = Math.max(maxContext - (2 * cappedMaxTokens), MIN_MAX_AVAILABLE)

  return { maxAvailable, maxContext, maxTokens: cappedMaxTokens }
}
