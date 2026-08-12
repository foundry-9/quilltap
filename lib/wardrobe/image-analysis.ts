/**
 * Wardrobe Image Analysis
 *
 * Analyzes an uploaded image using a vision-capable LLM to propose
 * wardrobe items (clothing, accessories) that can be added to a character's
 * wardrobe. Finds a suitable vision provider from the user's configured
 * connection profiles, following the same pattern as file-attachment-fallback.ts.
 *
 * @module wardrobe/image-analysis
 */

import { createLLMProvider } from '@/lib/llm'
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { logger } from '@/lib/logger'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

const moduleLogger = logger.child({ module: 'wardrobe-image-analysis' })

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single proposed wardrobe item from image analysis
 */
export interface ProposedWardrobeItem {
  title: string
  description: string
  types: WardrobeItemType[]
  appropriateness: string
}

/**
 * Result of analyzing an image for wardrobe items
 */
export interface ImageAnalysisResult {
  proposedItems: ProposedWardrobeItem[]
  provider: string
  model: string
}

/**
 * Parameters for image analysis
 */
export interface ImageAnalysisParams {
  /** Base64-encoded image data */
  image: string
  /** MIME type of the image */
  mimeType: string
  /** Optional user guidance text */
  guidance?: string
}

// ============================================================================
// VISION PROVIDER RESOLUTION
// ============================================================================

/**
 * Find a vision-capable connection profile for image analysis.
 * Uses the same resolution strategy as file-attachment-fallback.ts:
 * 1. Check for a configured imageDescriptionProfileId in chat settings
 * 2. Fall back to any vision-capable profile (prefer cheap ones)
 */
async function findVisionProfile(
  repos: RepositoryContainer,
  userId: string
): Promise<ConnectionProfile | null> {
  // Check if user has a dedicated image description profile configured
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const imageDescriptionProfileId = chatSettings?.imageDescriptionProfileId

  if (imageDescriptionProfileId) {
    const profile = await repos.connections.findById(imageDescriptionProfileId)
    if (profile && profileSupportsMimeType(profile, 'image/jpeg')) {
      moduleLogger.debug('[Wardrobe Image Analysis] Using configured image description profile', {
        profileId: profile.id,
        provider: profile.provider,
        model: profile.modelName,
      })
      return profile
    }
  }

  // Fall back to any vision-capable profile
  const availableProfiles = await repos.connections.findAll()

  const visionProfiles = availableProfiles.filter((p: ConnectionProfile) =>
    profileSupportsMimeType(p, 'image/jpeg')
  )

  if (visionProfiles.length === 0) {
    moduleLogger.warn('[Wardrobe Image Analysis] No vision-capable profiles found')
    return null
  }

  // Prefer non-cheap profiles for better quality analysis (unlike fallback which prefers cheap)
  // But still use cheap if that's all that's available
  const nonCheapVisionProfile = visionProfiles.find((p: ConnectionProfile) => !p.isCheap)
  const selectedProfile = nonCheapVisionProfile || visionProfiles[0]

  moduleLogger.debug('[Wardrobe Image Analysis] Using vision-capable profile', {
    profileId: selectedProfile.id,
    provider: selectedProfile.provider,
    model: selectedProfile.modelName,
    isCheap: selectedProfile.isCheap,
  })

  return selectedProfile
}

// ============================================================================
// PROMPT CONSTRUCTION
// ============================================================================

const SYSTEM_PROMPT = `You are a fashion and costume analyst. Your task is to identify distinct clothing items and accessories visible in the provided image and describe each one in detail.

For each item you identify:
1. Give it a concise, evocative title (e.g., "Emerald Silk Evening Gown", "Worn Leather Ankle Boots")
2. Write a detailed description capturing texture, fit, color, material, and notable details. Use vivid, descriptive language — not clinical catalog copy.
3. Classify it into one or more slot types: "top", "bottom", "footwear", "accessories"
   - Items that span multiple slots (e.g., a dress covering top + bottom, a jumpsuit) should include all applicable types
4. Suggest appropriateness tags (e.g., "formal", "casual", "combat", "intimate", "evening", "everyday") based on the visual context

Return your analysis as a JSON object with this exact structure:
{
  "items": [
    {
      "title": "Item Title",
      "description": "Detailed description of the item...",
      "types": ["top"],
      "appropriateness": "casual, everyday"
    }
  ]
}

Important rules:
- Focus ONLY on clothing and accessories. Do not describe people, backgrounds, or non-wearable objects.
- Each distinct garment or accessory should be its own item.
- Valid types are ONLY: "top", "bottom", "footwear", "accessories"
- If you cannot identify any clothing items, return {"items": []}
- Return ONLY the JSON object, no additional text or markdown.`

function buildUserPrompt(guidance?: string): string {
  let prompt = 'Analyze this image and identify all visible clothing items and accessories.'

  if (guidance) {
    prompt += `\n\nAdditional guidance from the user: ${guidance}`
  }

  return prompt
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

const VALID_TYPES = new Set<string>(['top', 'bottom', 'footwear', 'accessories'])

/**
 * Parse and validate the LLM's JSON response into ProposedWardrobeItem[]
 */
function parseAnalysisResponse(content: string): ProposedWardrobeItem[] {
  // Strip markdown code fences if present
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    moduleLogger.error('[Wardrobe Image Analysis] Failed to parse LLM response as JSON', {
      contentPreview: content.substring(0, 200),
    })
    throw new Error('The AI returned an invalid response. Please try again.')
  }

  // Validate structure
  if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  const items = (parsed as { items: unknown[] }).items
  if (!Array.isArray(items)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  // Validate and normalize each item
  return items
    .filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      if (typeof (item as Record<string, unknown>).title !== 'string') return false
      if (typeof (item as Record<string, unknown>).description !== 'string') return false
      return true
    })
    .map((item) => {
      // Normalize types to only valid values
      const rawTypes = Array.isArray(item.types) ? item.types : []
      const validatedTypes = rawTypes.filter(
        (t): t is WardrobeItemType => typeof t === 'string' && VALID_TYPES.has(t)
      )

      return {
        title: String(item.title).trim(),
        description: String(item.description).trim(),
        types: validatedTypes.length > 0 ? validatedTypes : ['accessories' as WardrobeItemType],
        appropriateness: typeof item.appropriateness === 'string'
          ? String(item.appropriateness).trim()
          : '',
      }
    })
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze an image to propose wardrobe items using a vision-capable LLM.
 *
 * @param params - Image data, MIME type, and optional guidance
 * @param repos - Repository container for data access
 * @param userId - The user's ID for profile/key resolution
 * @returns Proposed wardrobe items or throws an error
 */
export async function analyzeImageForWardrobeItems(
  params: ImageAnalysisParams,
  repos: RepositoryContainer,
  userId: string
): Promise<ImageAnalysisResult> {
  moduleLogger.debug('[Wardrobe Image Analysis] Starting analysis', {
    mimeType: params.mimeType,
    imageSize: params.image.length,
    hasGuidance: !!params.guidance,
  })

  // 1. Find a vision-capable profile
  const profile = await findVisionProfile(repos, userId)
  if (!profile) {
    throw new Error(
      'No vision-capable provider is configured. This feature requires a provider that supports ' +
      'image analysis (e.g., Anthropic Claude, OpenAI GPT-4o, Google Gemini). ' +
      'Configure one in your provider settings, or set an Image Description Profile in Chat settings.'
    )
  }

  // 2. Get API key
  let apiKeyValue = ''
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
    if (apiKey) {
      apiKeyValue = apiKey.key_value
    }
  }

  if (!apiKeyValue && profile.provider !== 'OLLAMA') {
    throw new Error(
      `API key not found for provider ${profile.provider}. Check your connection profile settings.`
    )
  }

  // 3. Create provider and send message
  const provider = await createLLMProvider(
    profile.provider as any,
    profile.baseUrl || undefined
  )

  const userContent = buildUserPrompt(params.guidance)

  const startTime = Date.now()

  moduleLogger.debug('[Wardrobe Image Analysis] Sending image to LLM', {
    provider: profile.provider,
    model: profile.modelName,
    userContentLength: userContent.length,
  })

  try {
    const response = await provider.sendMessage(
      {
        model: profile.modelName,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userContent,
            attachments: [
              {
                id: 'wardrobe-analysis-image',
                filename: `analysis.${params.mimeType.split('/')[1] || 'jpg'}`,
                mimeType: params.mimeType,
                size: Math.ceil(params.image.length * 0.75), // Approximate decoded size
                data: params.image,
              },
            ],
          },
        ],
        maxTokens: 4000,
        temperature: 0.5,
        // Forward the profile's provider params (e.g. DeepSeek thinking mode)
        // so a "reasoning off" setting on the analysis profile takes effect.
        profileParameters: profile.parameters && typeof profile.parameters === 'object'
          ? (profile.parameters as Record<string, unknown>)
          : undefined,
      },
      apiKeyValue
    )

    const durationMs = Date.now() - startTime

    moduleLogger.debug('[Wardrobe Image Analysis] LLM response received', {
      provider: profile.provider,
      model: profile.modelName,
      contentLength: response.content.length,
      durationMs,
      usage: response.usage,
    })

    // Log the LLM call
    logLLMCall({
      userId,
      type: 'WARDROBE_IMAGE_ANALYSIS',
      provider: profile.provider,
      modelName: profile.modelName,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent, attachments: [{ type: 'image', mimeType: params.mimeType }] },
        ],
        temperature: 0.5,
        maxTokens: 4000,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      moduleLogger.warn('[Wardrobe Image Analysis] Failed to log LLM call', {
        error: err instanceof Error ? err.message : String(err),
      })
    })

    // 4. Parse the response
    const proposedItems = parseAnalysisResponse(response.content)

    moduleLogger.info('[Wardrobe Image Analysis] Analysis complete', {
      itemCount: proposedItems.length,
      provider: profile.provider,
      model: profile.modelName,
      durationMs,
    })

    return {
      proposedItems,
      provider: profile.provider,
      model: profile.modelName,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime

    moduleLogger.error('[Wardrobe Image Analysis] LLM call failed', {
      provider: profile.provider,
      model: profile.modelName,
      durationMs,
    }, error instanceof Error ? error : new Error(String(error)))

    // Re-throw with user-friendly message if it's not already one
    if (error instanceof Error && error.message.includes('The AI returned')) {
      throw error
    }
    throw new Error(
      `Image analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'Please try again or use a different provider.'
    )
  }
}
