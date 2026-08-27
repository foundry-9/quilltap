/**
 * Dangerous Content Gatekeeper Service
 *
 * Uses the cheap LLM or a dedicated moderation provider to classify content
 * for dangerous/sensitive material. If a moderation provider plugin is available
 * (e.g., OpenAI moderation endpoint) and an API key can be auto-detected from
 * existing connection profiles, it is used automatically. Otherwise, falls back
 * to the cheap LLM classification approach.
 *
 * Fail-safe: Any error returns { isDangerous: false } - never blocks the user.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/repositories/factory'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'

import { getErrorMessage } from '@/lib/error-utils'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { stripCodeFences } from '@/lib/llm/llm-json'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import { createHash } from 'node:crypto'
import { moderationProviderRegistry } from '@/lib/plugins/moderation-provider-registry'
import type { ModerationResult } from '@/lib/plugins/interfaces/moderation-provider-plugin'
import { trackActivity } from '@/lib/background-jobs/activity-registry'

const logger = createServiceLogger('DangerousContentGatekeeper')

/**
 * Result of content classification
 */
export interface DangerClassificationResult {
  /** Whether the content was classified as dangerous */
  isDangerous: boolean
  /** Overall danger score (0-1) */
  score: number
  /** Per-category breakdown */
  categories: Array<{ category: string; score: number; label: string }>
  /** Token usage for cost tracking */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** Which classifier produced this result */
  source?: 'moderation' | 'llm'
  /** Provider that performed the classification (e.g., 'OPENAI', 'OLLAMA') */
  providerName?: string
}

/**
 * Simple LRU cache for classification results by content hash
 */
const classificationCache = new Map<string, { result: DangerClassificationResult; timestamp: number }>()
const CACHE_MAX_SIZE = 200
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get a cached classification result
 */
function getCachedResult(contentHash: string): DangerClassificationResult | null {
  const cached = classificationCache.get(contentHash)
  if (!cached) return null

  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    classificationCache.delete(contentHash)
    return null
  }

  return cached.result
}

/**
 * Cache a classification result
 */
function cacheResult(contentHash: string, result: DangerClassificationResult): void {
  // Evict oldest entries if at capacity
  if (classificationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = classificationCache.keys().next().value
    if (firstKey) classificationCache.delete(firstKey)
  }

  classificationCache.set(contentHash, { result, timestamp: Date.now() })
}

/**
 * Default classification system prompt
 */
const CLASSIFICATION_SYSTEM_PROMPT = `You are a content safety classifier. Analyze the following user message and determine if it contains dangerous, sensitive, or potentially policy-violating content.

CATEGORIES TO CHECK:
- nsfw: Sexual or explicitly adult content
- violence: Graphic violence, gore, or descriptions of harm
- hate_speech: Hateful, discriminatory, or dehumanizing language
- self_harm: Content encouraging or depicting self-harm
- illegal_activity: Content describing or encouraging illegal activities
- disturbing: Deeply disturbing, shocking, or upsetting content

For each applicable category, provide a confidence score from 0.0 to 1.0.

Respond with JSON ONLY (no markdown, no explanation):
{
  "isDangerous": true/false,
  "score": 0.0-1.0,
  "categories": [
    { "category": "nsfw", "score": 0.0-1.0, "label": "Brief description" }
  ]
}

If the content is completely safe and benign, respond:
{ "isDangerous": false, "score": 0.0, "categories": [] }

Be accurate - don't over-flag normal creative writing, worldbuilding, or historical references.
Only flag content that would genuinely require an uncensored model to handle.`

/**
 * OpenAI moderation category → Concierge category mapping
 */
const MODERATION_CATEGORY_MAP: Record<string, string> = {
  'sexual': 'nsfw',
  'sexual/minors': 'nsfw',
  'violence': 'violence',
  'violence/graphic': 'violence',
  'hate': 'hate_speech',
  'hate/threatening': 'hate_speech',
  'harassment': 'hate_speech',
  'harassment/threatening': 'hate_speech',
  'self-harm': 'self_harm',
  'self-harm/intent': 'self_harm',
  'self-harm/instructions': 'self_harm',
  'illicit': 'illegal_activity',
  'illicit/violent': 'illegal_activity',
}

/**
 * Human-readable labels for Concierge categories
 */
export const CATEGORY_LABELS: Record<string, string> = {
  'nsfw': 'Sexual/NSFW content',
  'violence': 'Violence or graphic content',
  'hate_speech': 'Hate speech or harassment',
  'self_harm': 'Self-harm content',
  'illegal_activity': 'Illegal activity',
  'disturbing': 'Disturbing content',
}

/**
 * Auto-detect an API key for the moderation provider by scanning connection profiles.
 *
 * Looks for a connection profile whose provider matches the moderation provider's
 * providerName (e.g., 'OPENAI') and returns its decrypted API key.
 *
 * @returns The decrypted API key, or null if no matching profile/key is found
 */
async function autoDetectModerationApiKey(
  providerName: string,
  userId: string
): Promise<string | null> {
  try {
    const repos = getRepositories()
    const profiles = await repos.connections.findByUserId(userId)

    // Find first profile matching the moderation provider name
    const matchingProfile = profiles.find(p => p.provider === providerName)
    if (!matchingProfile?.apiKeyId) {
      return null
    }

    const apiKey = await repos.connections.findApiKeyByIdAndUserId(matchingProfile.apiKeyId, userId)
    if (!apiKey) {
      return null
    }

    return apiKey.key_value
  } catch (error) {
    logger.warn('[Gatekeeper] Failed to auto-detect moderation API key', {
      providerName,
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Convert a ModerationResult from a moderation provider into a DangerClassificationResult.
 *
 * Maps provider-specific categories (e.g., OpenAI's 'sexual', 'hate', 'violence')
 * to Concierge categories (nsfw, hate_speech, violence, etc.), taking the highest
 * score when multiple provider categories map to the same Concierge category.
 */
export function mapModerationResult(
  moderationResult: ModerationResult,
  threshold: number
): DangerClassificationResult {
  // Aggregate scores by Concierge category (take max score per category)
  const categoryScores = new Map<string, number>()

  for (const cat of moderationResult.categories) {
    const mappedCategory = MODERATION_CATEGORY_MAP[cat.category] || cat.category
    const existing = categoryScores.get(mappedCategory) || 0
    if (cat.score > existing) {
      categoryScores.set(mappedCategory, cat.score)
    }
  }

  // Build category array — only include categories with meaningful scores.
  // OpenAI returns tiny nonzero scores (e.g. 0.0001) for irrelevant categories,
  // so we filter to categories that are either explicitly flagged by the provider
  // or have a score above a minimum relevance floor.
  const RELEVANCE_FLOOR = 0.01
  const categories: Array<{ category: string; score: number; label: string }> = []
  for (const [category, score] of categoryScores.entries()) {
    if (score >= RELEVANCE_FLOOR) {
      categories.push({
        category,
        score,
        label: CATEGORY_LABELS[category] || category,
      })
    }
  }

  // Calculate overall score from relevant categories only
  const maxScore = categories.length > 0
    ? Math.max(...categories.map(c => c.score))
    : 0

  return {
    isDangerous: moderationResult.flagged || maxScore >= threshold,
    score: maxScore,
    categories,
  }
}

/**
 * Classify content using a dedicated moderation provider plugin.
 *
 * @returns Classification result, or null if moderation provider is not available
 */
async function classifyWithModerationProvider(
  content: string,
  userId: string,
  settings: DangerousContentSettings,
  chatId?: string
): Promise<DangerClassificationResult | null> {
  // Check if a moderation provider is registered
  const provider = moderationProviderRegistry.getDefaultProvider()
  if (!provider) {
    logger.warn(
      '[Gatekeeper] No moderation provider registered; falling back to LLM classification',
      {
        chatId,
        registryInitialized: moderationProviderRegistry.isInitialized(),
        providerCount: moderationProviderRegistry.getAllProviders().length,
      }
    )
    return null
  }

  // Auto-detect an API key from connection profiles
  const apiKey = await autoDetectModerationApiKey(provider.metadata.providerName, userId)
  if (!apiKey) {
    logger.warn(
      '[Gatekeeper] No API key for moderation provider; falling back to LLM classification',
      {
        chatId,
        providerName: provider.metadata.providerName,
      }
    )
    return null
  }

  // Call the moderation provider
  const moderationStartedAt = Date.now()
  const moderationResult = await provider.moderate(content, apiKey)
  const moderationDurationMs = Date.now() - moderationStartedAt

  // Map to our classification result format
  const result = mapModerationResult(moderationResult, settings.threshold)
  result.source = 'moderation'
  result.providerName = provider.metadata.providerName

  // Log the moderation call for Inspector visibility (fire and forget)
  logLLMCall({
    userId,
    type: 'DANGER_CLASSIFICATION',
    chatId,
    provider: provider.metadata.providerName,
    modelName: 'moderation',
    request: {
      messages: [{ role: 'user', content }],
    },
    response: {
      content: JSON.stringify({
        flagged: moderationResult.flagged,
        categories: moderationResult.categories,
      }),
    },
    durationMs: moderationDurationMs,
  }).catch(err => {
    logger.warn('[Gatekeeper] Failed to log moderation provider call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('[Gatekeeper] Content classified via moderation provider', {
    chatId,
    provider: provider.metadata.providerName,
    isDangerous: result.isDangerous,
    score: result.score,
    categoryCount: result.categories.length,
    categories: result.categories.map(c => c.category),
  })

  return result
}

/**
 * Classify content for dangerous/sensitive material.
 *
 * Attempts to use a dedicated moderation provider first (e.g., OpenAI moderation
 * endpoint, which is free). If no moderation provider is available or no API key
 * can be auto-detected, falls back to the cheap LLM classification approach.
 *
 * @param content - The text content to classify
 * @param cheapLLMSelection - The cheap LLM provider selection (fallback)
 * @param userId - The user ID for API key retrieval
 * @param settings - The dangerous content settings
 * @param chatId - Optional chat ID for logging
 * @returns Classification result (fail-safe: returns not dangerous on any error)
 */
export async function classifyContent(
  content: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  settings: DangerousContentSettings,
  chatId?: string
): Promise<DangerClassificationResult> {
  // Every Concierge classification — the per-message one in the send path, the
  // chat-level job, the ones the image pipelines run — lights the "Dgr" chip
  // for as long as it takes. Re-entrant by kind, so the classification job's
  // own row is not double-counted.
  return trackActivity('danger', () =>
    runClassification(content, cheapLLMSelection, userId, settings, chatId)
  )
}

async function runClassification(
  content: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  settings: DangerousContentSettings,
  chatId?: string
): Promise<DangerClassificationResult> {
  const safeFallback: DangerClassificationResult = {
    isDangerous: false,
    score: 0,
    categories: [],
  }

  try {
    // Check cache first
    const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 16)
    const cached = getCachedResult(contentHash)
    if (cached) {
      return cached
    }

    // Try moderation provider first (free, purpose-built, no token cost)
    const moderationResult = await classifyWithModerationProvider(
      content, userId, settings, chatId
    )
    if (moderationResult) {
      cacheResult(contentHash, moderationResult)
      return moderationResult
    }

    // Fall back to cheap LLM classification
    // Get API key
    const apiKey = await getApiKeyForCheapLLMSelection(cheapLLMSelection, userId)
    if (apiKey === null) {
      logger.warn('[Gatekeeper] No API key available for classification, failing safe')
      return safeFallback
    }

    // Build classification prompt
    let systemPrompt = CLASSIFICATION_SYSTEM_PROMPT
    if (settings.customClassificationPrompt) {
      systemPrompt += `\n\nADDITIONAL INSTRUCTIONS:\n${settings.customClassificationPrompt}`
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Classify the following content:\n\n${content}` },
    ]

    // Create provider and send message
    const provider = await createLLMProvider(
      cheapLLMSelection.provider,
      cheapLLMSelection.baseUrl
    )

    const classificationStartedAt = Date.now()
    const response = await provider.sendMessage(
      {
        messages,
        model: cheapLLMSelection.modelName,
        temperature: 0.1, // Low temperature for consistent classification
        maxTokens: 500,
        // Forward the cheap profile's provider params (e.g. DeepSeek thinking
        // mode) so a "reasoning off" setting takes effect and the classifier
        // doesn't burn its budget thinking and return empty content.
        profileParameters: cheapLLMSelection.profileParameters,
      },
      apiKey
    )
    const classificationDurationMs = Date.now() - classificationStartedAt

    // Log the classification call (fire and forget)
    logLLMCall({
      userId,
      type: 'DANGER_CLASSIFICATION',
      chatId,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
      connectionProfileId: cheapLLMSelection.connectionProfileId ?? null,
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.1,
        maxTokens: 500,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
      durationMs: classificationDurationMs,
    }).catch(err => {
      logger.warn('[Gatekeeper] Failed to log classification call', {
        error: err instanceof Error ? err.message : String(err),
      })
    })

    // Parse the response
    const result = parseClassificationResponse(response.content, settings.threshold)
    result.usage = response.usage
    result.source = 'llm'
    result.providerName = cheapLLMSelection.provider

    // Cache the result
    cacheResult(contentHash, result)

    logger.info('[Gatekeeper] Content classified via Cheap LLM', {
      chatId,
      isDangerous: result.isDangerous,
      score: result.score,
      categoryCount: result.categories.length,
      categories: result.categories.map(c => c.category),
    })

    return result
  } catch (error) {
    logger.error('[Gatekeeper] Classification failed, failing safe', {
      chatId,
      error: getErrorMessage(error),
    })
    return safeFallback
  }
}

/**
 * Parse the LLM's classification response
 */
export function parseClassificationResponse(
  responseContent: string,
  threshold: number
): DangerClassificationResult {
  try {
    const cleanContent = stripCodeFences(responseContent)
    const parsed = JSON.parse(cleanContent)

    const overallScore = typeof parsed.score === 'number' ? parsed.score : 0
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.map((c: Record<string, unknown>) => ({
          category: String(c.category || 'unknown'),
          score: typeof c.score === 'number' ? c.score : 0,
          label: String(c.label || ''),
        }))
      : []

    // Determine danger from multiple signals:
    // 1. Overall score meets threshold
    // 2. Any individual category score meets threshold
    // 3. The LLM explicitly said isDangerous: true
    const maxCategoryScore = categories.length > 0
      ? Math.max(...categories.map((c: { score: number }) => c.score))
      : 0
    const effectiveScore = Math.max(overallScore, maxCategoryScore)
    const llmSaysDangerous = parsed.isDangerous === true

    return {
      isDangerous: effectiveScore >= threshold || llmSaysDangerous,
      score: effectiveScore,
      categories,
    }
  } catch {
    // JSON parsing failed - fail safe
    return {
      isDangerous: false,
      score: 0,
      categories: [],
    }
  }
}
