/**
 * Auto-Configure Service
 *
 * Uses web search and LLM analysis to automatically determine optimal
 * settings for a connection profile based on the provider and model name.
 *
 * Flow:
 * 1. Run parallel web searches for model specs and recommended settings
 * 2. Send search results to the default (high-capability) LLM for analysis
 * 3. If the response doesn't parse, send to a cheap LLM for JSON cleanup
 * 4. Validate and return the structured result
 *
 * @module services/auto-configure
 */

import { executeWebSearchTool, formatWebSearchResults } from '@/lib/tools/handlers/web-search-handler'
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { createLLMProvider } from '@/lib/llm'
import { parseLLMJson } from '@/lib/llm/llm-json'
import { getCheapLLMProvider, profileParams } from '@/lib/llm/cheap-llm'
import { MODEL_CLASSES, isValidModelClassName } from '@/lib/llm/model-classes'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { logger } from '@/lib/logger'
import type { LLMMessage } from '@/lib/llm/base'
import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * Result of auto-configuration analysis
 */
export interface AutoConfigureResult {
  /** Maximum context window size in tokens */
  maxContext: number
  /** Maximum output/completion tokens */
  maxTokens: number
  /** Recommended temperature setting (0-2) */
  temperature: number
  /** Recommended top_p / nucleus sampling setting (0-1) */
  topP: number
  /** Whether this model is known to be uncensored / unmoderated */
  isDangerousCompatible: boolean
  /** Recommended model class tier name */
  modelClass: string
  /** Source URLs used for the analysis */
  searchSources: string[]
}

/**
 * Build the system prompt for the analysis LLM
 */
function buildSystemPrompt(): string {
  return `You are an AI model specifications analyst. Given web search results about an LLM model, you extract precise technical specifications and recommend optimal settings.

You MUST respond with a single JSON object and nothing else. No markdown, no explanation, no code fences. Just the raw JSON object.

The JSON object must have exactly these fields:
{
  "maxContext": <number - maximum context window in tokens>,
  "maxTokens": <number - maximum output/completion tokens>,
  "temperature": <number - recommended temperature between 0 and 2, optimized for creative writing and roleplay>,
  "topP": <number - recommended top_p between 0 and 1, optimized for creative writing and roleplay>,
  "isDangerousCompatible": <boolean - true if the model is known to be uncensored, unmoderated, or explicitly designed without content filters>,
  "modelClass": <string - one of: "Compact", "Standard", "Extended", "Deep">
}

For modelClass, use these tier definitions to classify the model:
${MODEL_CLASSES.map(mc => `- ${mc.name} (Tier ${mc.tier}): maxContext <= ${mc.maxContext.toLocaleString()}, maxOutput <= ${mc.maxOutput.toLocaleString()}, quality ${mc.quality}`).join('\n')}

Choose the tier whose context and output limits best fit the model's actual capabilities. If between tiers, round up.

For temperature and topP, optimize for creative writing, storytelling, and roleplay — the primary use case is an AI writing assistant. Prefer settings that produce varied, engaging prose without being incoherent.

If you cannot determine a value from the search results, use reasonable defaults based on common knowledge of the model.`
}

/**
 * Build the user prompt with search results
 */
function buildUserPrompt(
  provider: string,
  modelName: string,
  specsSearchResults: string,
  settingsSearchResults: string
): string {
  return `Analyze the following model and determine its optimal configuration:

Provider: ${provider}
Model: ${modelName}

## Search Results: Model Specifications
${specsSearchResults}

## Search Results: Recommended Settings
${settingsSearchResults}

Respond with the JSON object only.`
}

/**
 * Validate and clamp the auto-configure result to safe ranges
 */
function validateResult(raw: Record<string, unknown>): AutoConfigureResult {
  const maxContext = Math.max(1, Math.round(Number(raw.maxContext) || 4096))
  const maxTokens = Math.max(1, Math.round(Number(raw.maxTokens) || 4096))
  const temperature = Math.min(2, Math.max(0, Number(raw.temperature) || 0.7))
  const topP = Math.min(1, Math.max(0, Number(raw.topP) || 1))
  const isDangerousCompatible = Boolean(raw.isDangerousCompatible)

  let modelClass = String(raw.modelClass || 'Standard')
  if (!isValidModelClassName(modelClass)) {
    modelClass = 'Standard'
  }

  return { maxContext, maxTokens, temperature, topP, isDangerousCompatible, modelClass, searchSources: [] }
}

/**
 * Get the decrypted API key for a connection profile.
 * Returns '' for OLLAMA (no key needed).
 */
async function getApiKey(profile: ConnectionProfile, userId: string): Promise<string> {
  if (profile.provider === 'OLLAMA') {
    return ''
  }
  if (!profile.apiKeyId) {
    throw new Error(`Profile "${profile.name}" has no API key configured`)
  }
  const repos = getUserRepositories(userId)
  const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
  if (!apiKey) {
    throw new Error(`Could not retrieve API key for profile "${profile.name}"`)
  }
  return apiKey.key_value
}

/**
 * Pick candidate profiles for auto-configure analysis, ordered by preference.
 *
 * Order:
 * 1. The default profile (respects the user's choice).
 * 2. For each other provider, its highest-`modelClass` profile.
 *
 * Profiles without an API key are skipped unless they are OLLAMA.
 */
function pickAutoConfigureCandidates(
  allProfiles: ConnectionProfile[],
  defaultProfile: ConnectionProfile
): ConnectionProfile[] {
  const tierRank = (name: string | null | undefined): number => {
    if (!name) return -1
    const mc = MODEL_CLASSES.find(c => c.name === name)
    return mc ? mc.quality : -1
  }

  const eligible = allProfiles.filter(p => p.provider === 'OLLAMA' || !!p.apiKeyId)

  // Highest-tier profile per provider (excluding the default's provider, which the default already represents).
  const bestByProvider = new Map<string, ConnectionProfile>()
  for (const p of eligible) {
    if (p.provider === defaultProfile.provider) continue
    const current = bestByProvider.get(p.provider)
    if (!current || tierRank(p.modelClass) > tierRank(current.modelClass)) {
      bestByProvider.set(p.provider, p)
    }
  }

  const others = Array.from(bestByProvider.values()).sort(
    (a, b) => tierRank(b.modelClass) - tierRank(a.modelClass)
  )

  return [defaultProfile, ...others]
}

/**
 * Attempt to clean up a malformed LLM response using a cheap LLM
 */
async function cleanupWithCheapLLM(
  rawResponse: string,
  currentProfile: ConnectionProfile,
  allProfiles: ConnectionProfile[],
  userId: string
): Promise<AutoConfigureResult> {
  logger.info('[Auto-Configure] Primary parse failed, attempting cheap LLM cleanup', {
    responsePreview: rawResponse.substring(0, 200),
  })

  const cheapSelection = getCheapLLMProvider(currentProfile, undefined, allProfiles)
  const cheapProvider = await createLLMProvider(cheapSelection.provider, cheapSelection.baseUrl)

  let cheapApiKey = ''
  if (!cheapSelection.isLocal && cheapSelection.connectionProfileId) {
    const repos = getUserRepositories(userId)
    const cheapProfile = await repos.connections.findById(cheapSelection.connectionProfileId)
    if (cheapProfile?.apiKeyId) {
      const key = await repos.connections.findApiKeyById(cheapProfile.apiKeyId)
      if (key) cheapApiKey = key.key_value
    }
  }

  const cleanupMessages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a JSON repair assistant. Extract and return ONLY a valid JSON object from the following text. The JSON must have these fields: maxContext (number), maxTokens (number), temperature (number), topP (number), isDangerousCompatible (boolean), modelClass (string). Return the JSON object only, no markdown or explanation.',
    },
    {
      role: 'user',
      content: rawResponse,
    },
  ]

  const cleanupStartedAt = Date.now()
  const cleanupResponse = await cheapProvider.sendMessage(
    { messages: cleanupMessages, model: cheapSelection.modelName, temperature: 0.1, maxTokens: 500, profileParameters: cheapSelection.profileParameters },
    cheapApiKey
  )
  const cleanupDurationMs = Date.now() - cleanupStartedAt

  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: cheapSelection.provider,
    modelName: cheapSelection.modelName,
    connectionProfileId: cheapSelection.connectionProfileId ?? null,
    request: {
      messages: cleanupMessages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.1,
      maxTokens: 500,
    },
    response: { content: cleanupResponse.content },
    usage: cleanupResponse.usage,
    durationMs: cleanupDurationMs,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log cheap LLM cleanup call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  const parsed = parseLLMJson<Record<string, unknown>>(cleanupResponse.content)
  return validateResult(parsed)
}

/**
 * Run the analysis LLM call against a single profile and parse the result.
 * Falls back to cheap-LLM JSON cleanup on parse failure. Throws on any failure.
 */
async function analyzeWithProfile(
  profile: ConnectionProfile,
  messages: LLMMessage[],
  userId: string,
  allProfiles: ConnectionProfile[]
): Promise<AutoConfigureResult> {
  const apiKey = await getApiKey(profile, userId)
  const llmProvider = await createLLMProvider(profile.provider, profile.baseUrl ?? undefined)

  const startedAt = Date.now()
  const response = await llmProvider.sendMessage(
    { messages, model: profile.modelName, temperature: 0.2, maxTokens: 1000, profileParameters: profileParams(profile) },
    apiKey
  )
  const durationMs = Date.now() - startedAt

  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: profile.provider,
    modelName: profile.modelName,
    connectionProfileId: profile.id,
    request: {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.2,
      maxTokens: 1000,
    },
    response: { content: response.content },
    usage: response.usage,
    durationMs,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log LLM call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  try {
    const parsed = parseLLMJson<Record<string, unknown>>(response.content)
    return validateResult(parsed)
  } catch (primaryError) {
    return await cleanupWithCheapLLM(response.content, profile, allProfiles, userId).catch(cleanupError => {
      logger.warn('[Auto-Configure] Primary and cleanup parsing both failed for profile', {
        profileId: profile.id,
        provider: profile.provider,
        modelName: profile.modelName,
        primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
      throw new Error(
        `Failed to parse response from ${profile.provider}: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
      )
    })
  }
}

/**
 * Auto-configure a connection profile by searching for model specifications
 * and using an LLM to analyze the results.
 *
 * @param provider - The LLM provider name (e.g., 'ANTHROPIC', 'OPENAI')
 * @param modelName - The model identifier (e.g., 'claude-sonnet-4-5-20250929')
 * @param userId - The authenticated user's ID
 * @returns Recommended settings for the connection profile
 */
export async function autoConfigureProfile(
  provider: string,
  modelName: string,
  userId: string
): Promise<AutoConfigureResult> {
  logger.info('[Auto-Configure] Starting auto-configuration', { provider, modelName, userId })

  // Verify web search is available
  if (!isWebSearchConfigured()) {
    throw new Error('Web search is not configured. Please add a search provider API key in Settings to use Auto-Configure.')
  }

  const repos = getUserRepositories(userId)

  // Find the default (high-capability) profile for analysis
  const defaultProfile = await repos.connections.findDefault()
  if (!defaultProfile) {
    throw new Error('No default connection profile configured. Please set a default profile before using Auto-Configure.')
  }

  // Run two web searches in parallel
  const searchContext = { userId }
  const [specsSearch, settingsSearch] = await Promise.all([
    executeWebSearchTool(
      { query: `${provider} ${modelName} maximum context window output tokens specifications`, maxResults: 5 },
      searchContext
    ),
    executeWebSearchTool(
      { query: `${provider} ${modelName} recommended temperature top_p settings creative writing`, maxResults: 5 },
      searchContext
    ),
  ])

  // Collect source URLs for attribution
  const searchSources: string[] = []
  if (specsSearch.success && specsSearch.results) {
    searchSources.push(...specsSearch.results.map(r => r.url).filter(Boolean))
  }
  if (settingsSearch.success && settingsSearch.results) {
    searchSources.push(...settingsSearch.results.map(r => r.url).filter(Boolean))
  }

  // Format search results for the prompt
  const specsFormatted = specsSearch.success && specsSearch.results
    ? formatWebSearchResults(specsSearch.results)
    : 'No search results found for model specifications.'
  const settingsFormatted = settingsSearch.success && settingsSearch.results
    ? formatWebSearchResults(settingsSearch.results)
    : 'No search results found for recommended settings.'

  // Build the analysis prompt
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(provider, modelName, specsFormatted, settingsFormatted)

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  // Build the ordered list of candidate profiles to try. Fall back through
  // other providers when the current one fails (quota, auth, network, etc.).
  const allProfiles = await repos.connections.findAll()
  const candidates = pickAutoConfigureCandidates(allProfiles, defaultProfile)

  let result: AutoConfigureResult | undefined
  const attempts: Array<{ provider: string; modelName: string; error: string }> = []

  for (const candidate of candidates) {
    try {
      logger.info('[Auto-Configure] Attempting analysis', {
        provider: candidate.provider,
        modelName: candidate.modelName,
        isDefault: candidate.id === defaultProfile.id,
      })
      result = await analyzeWithProfile(candidate, messages, userId, allProfiles)
      if (candidate.id !== defaultProfile.id) {
        logger.info('[Auto-Configure] Default profile failed, succeeded with fallback', {
          fallbackProvider: candidate.provider,
          fallbackModel: candidate.modelName,
        })
      }
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      attempts.push({ provider: candidate.provider, modelName: candidate.modelName, error: message })
      logger.warn('[Auto-Configure] Candidate failed, trying next', {
        provider: candidate.provider,
        modelName: candidate.modelName,
        error: message,
      })
    }
  }

  if (!result) {
    const summary = attempts.map(a => `${a.provider} (${a.modelName}): ${a.error}`).join('; ')
    throw new Error(`Auto-configure failed on all ${attempts.length} candidate provider(s). ${summary}`)
  }

  result.searchSources = searchSources

  logger.info('[Auto-Configure] Auto-configuration complete', {
    provider,
    modelName,
    result: {
      maxContext: result.maxContext,
      maxTokens: result.maxTokens,
      temperature: result.temperature,
      topP: result.topP,
      modelClass: result.modelClass,
      isDangerousCompatible: result.isDangerousCompatible,
    },
  })

  return result
}
