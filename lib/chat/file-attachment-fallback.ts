/**
 * File Attachment Fallback Handling
 *
 * Handles file attachments for providers that don't support them:
 * 1. Text files → Convert to inline text in message
 * 2. Images → Use image description LLM to generate description
 */

import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { providerCanTransportImages } from '@/lib/llm/image-transport'
import { buildFallbackChain } from '@/lib/llm/fallback'
import { trackActivity } from '@/lib/background-jobs/activity-registry'
import { createLLMProvider } from '@/lib/llm'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { resizeImageForProvider, canResizeImage } from '@/lib/files/image-processing'
import { getErrorMessage } from '@/lib/error-utils'

import type { ConnectionProfile } from '@/lib/schemas/types'
import { profileParams } from '@/lib/llm/cheap-llm'
import { resolveSamplingParams } from '@/lib/llm/sampling-params'
import type { FileAttachment } from '@/lib/llm/base'
import { logger } from '@/lib/logger'

/**
 * Hard ceiling on a single vision-description call. Uncensored describers can
 * be slow or degraded, and this runs inline while assembling a chat reply — a
 * stalled call would wedge the whole turn. On timeout we drop the image rather
 * than block. Generously sized: real describes finish in seconds.
 */
const IMAGE_DESCRIPTION_TIMEOUT_MS = 60_000

/** The instruction sent to the vision model. Shared with the LLM-call log. */
const IMAGE_DESCRIPTION_INSTRUCTION =
  'Please describe this image in great detail. Include all visible elements, colors, composition, mood, and any text or notable features. Be thorough and descriptive.'

/**
 * Get image description profile from repos
 */
async function getImageDescriptionProfile(
  repos: any,
  userId: string
): Promise<ConnectionProfile | null> {
  // Get chat settings
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const imageDescriptionProfileId = chatSettings?.imageDescriptionProfileId

  // If a specific image description profile is configured, use it
  if (imageDescriptionProfileId) {
    const profile = await repos.connections.findById(imageDescriptionProfileId)
    if (profile) {
      return profile
    }
  }

  // Fallback: Look for any vision-capable profile
  // Priority: profiles marked as cheap with vision support
  const availableProfiles = await repos.connections.findByUserId(userId)

  // Filter to profiles that can *actually* describe an image: the model must
  // read pictures AND its plugin must be able to send them. A NanoGPT vision
  // profile passes the first test and fails the second, and picking one as
  // the describer would produce a confident description of an image the model
  // never received (bug 91).
  const visionProfiles = availableProfiles.filter((p: ConnectionProfile) =>
    profileSupportsMimeType(p, 'image/jpeg') && providerCanTransportImages(p.provider)
  )

  if (visionProfiles.length === 0) {
    return null
  }

  // Prefer cheap profiles for cost efficiency
  const cheapVisionProfile = visionProfiles.find((p: ConnectionProfile) => p.isCheap === true)
  if (cheapVisionProfile) {
    return cheapVisionProfile
  }

  // Otherwise use the first available vision-capable profile
  return visionProfiles[0]
}

/**
 * Resolve the configured uncensored vision fallback profile, if any. Returns
 * null when no `uncensoredImageDescriptionProfileId` is configured or the
 * referenced profile no longer exists. Distinct from the primary getter: we
 * never auto-pick a fallback — the user must explicitly opt in by picking one.
 */
async function getUncensoredImageDescriptionProfile(
  repos: any,
  userId: string
): Promise<ConnectionProfile | null> {
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const id = chatSettings?.uncensoredImageDescriptionProfileId
  if (!id) return null
  const profile = await repos.connections.findById(id)
  return profile ?? null
}

/**
 * Check if a file attachment needs fallback processing.
 *
 * Two questions have to answer yes before raw bytes are worth sending, and
 * bug 91 was asking only the first:
 *
 *  1. **Does the model read this?** — `profileSupportsMimeType`, which for
 *     images is the operator's per-profile `supportsImageUpload` tick.
 *  2. **Can the plugin put it on the wire?** — `providerCanTransportImages`.
 *     NanoGPT, DeepSeek and OpenAI-Compatible all inherit a base that marks
 *     every attachment failed, so the answer is no however vision-capable the
 *     routed model happens to be.
 *
 * When (1) says yes and (2) says no, the old predicate returned `false`, which
 * suppressed the describer *and* left the bytes for a plugin that discarded
 * them: the model got nothing, and nothing said so. Now that combination
 * routes to the describe-fallback, which is exactly what it's for.
 */
export function needsFallbackProcessing(
  profile: ConnectionProfile,
  mimeType: string
): boolean {
  if (!profileSupportsMimeType(profile, mimeType)) return true
  if (mimeType.startsWith('image/') && !providerCanTransportImages(profile.provider)) {
    logger.info('[Attachment] Profile claims image support but its plugin cannot transport images; routing to describe-fallback', {
      profileId: profile.id,
      provider: profile.provider,
      modelName: profile.modelName,
    })
    return true
  }
  return false
}

/**
 * Check if a MIME type is a text file
 */
export function isTextFile(mimeType: string): boolean {
  return mimeType.startsWith('text/') ||
         mimeType === 'application/json' ||
         mimeType === 'application/xml'
}

/**
 * Check if a MIME type is an image
 */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/**
 * Result of processing a file attachment fallback
 */
export interface FallbackResult {
  type: 'text' | 'image_description' | 'unsupported'
  textContent?: string
  imageDescription?: string
  processingMetadata?: {
    usedImageDescriptionLLM?: boolean
    /** True when the uncensored fallback profile produced the description. */
    usedUncensoredFallback?: boolean
    /**
     * Who was asked and how each one failed, in order, when the primary
     * describer did not answer. Present only when at least one stand-in was
     * tried; the first entry is always the primary itself.
     */
    fallbackAttemptTrail?: string[]
    /** True when a persisted description/generation-prompt was reused (no vision call). */
    reusedPersistedDescription?: boolean
    descriptionProfileId?: string
    descriptionProvider?: string
    descriptionModel?: string
    originalFilename: string
    originalMimeType: string
  }
  error?: string
}

/**
 * Decode text content from base64 data
 * @param data - Base64 encoded file data
 * @returns Decoded text content
 */
function decodeTextFromBase64(data: string): string {
  try {
    // Decode base64 to UTF-8 string
    return Buffer.from(data, 'base64').toString('utf-8')
  } catch (error) {
    throw new Error(`Failed to decode text file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Convert text file to inline message content
 * @param file - File metadata
 * @param base64Data - Base64 encoded file data (already loaded from S3)
 */
export async function convertTextFileToInline(
  file: { filepath: string; filename: string; mimeType: string },
  base64Data: string
): Promise<FallbackResult> {
  try {
    const content = decodeTextFromBase64(base64Data)

    // Format the text with a header
    const textContent = `[User attached text file: ${file.filename}]\n\n${content}\n\n[End of attached file]`

    return {
      type: 'text',
      textContent,
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  } catch (error) {
    logger.error('[Text Fallback] Failed to convert text file', {
      filename: file.filename,
      mimeType: file.mimeType,
    }, error instanceof Error ? error : new Error(String(error)))

    return {
      type: 'unsupported',
      error: `Failed to process text file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  }
}

/**
 * Run one describe attempt against a specific vision profile. Pure helper:
 * does not consult chat settings or pick a profile. Caller is responsible for
 * deciding whether to retry against a fallback profile.
 */
async function describeImageWithProfile(
  file: FileAttachment,
  imageDescProfile: ConnectionProfile,
  repos: any,
  userId: string
): Promise<FallbackResult> {
  const describeStart = Date.now()
  try {
    // Check if profile supports images. Both halves matter — see
    // needsFallbackProcessing. A describer whose plugin drops the bytes would
    // answer from the prompt alone and invent a picture.
    if (!profileSupportsMimeType(imageDescProfile, file.mimeType)) {
      return {
        type: 'unsupported',
        error: `Image description profile (${imageDescProfile.provider} ${imageDescProfile.modelName}) does not support image files`,
        processingMetadata: {
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
          descriptionProfileId: imageDescProfile.id,
          descriptionProvider: imageDescProfile.provider,
          descriptionModel: imageDescProfile.modelName,
        },
      }
    }

    // The provider list in the message below names every entry in
    // PROVIDER_ATTACHMENT_CAPABILITIES (lib/llm/attachment-support.ts) that
    // carries an image/* MIME type — keep it in step with that map. Bug 97 was
    // this sentence recommending OpenRouter in the same breath as refusing an
    // OpenRouter profile, because the plugin's own declaration disagreed with
    // the map; __tests__/unit/lib/llm/image-transport.test.ts now holds the two
    // sources together.
    if (!providerCanTransportImages(imageDescProfile.provider)) {
      return {
        type: 'unsupported',
        error: `Image description profile (${imageDescProfile.provider} ${imageDescProfile.modelName}) cannot send images — the ${imageDescProfile.provider} plugin does not forward image attachments. Pick a describer on a provider that does (OpenAI, Anthropic, Google, Grok, OpenRouter, NanoGPT, Z.AI).`,
        processingMetadata: {
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
          descriptionProfileId: imageDescProfile.id,
          descriptionProvider: imageDescProfile.provider,
          descriptionModel: imageDescProfile.modelName,
        },
      }
    }

    // Get API key for image description profile (verify ownership)
    let apiKeyValue: string | null = null
    if (imageDescProfile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageDescProfile.apiKeyId, userId)
      if (apiKey) {
        apiKeyValue = apiKey.key_value
      }
    }

    // Create provider instance
    const provider = await createLLMProvider(
      imageDescProfile.provider as any,
      imageDescProfile.baseUrl || undefined
    )

    // Get parameters from profile, with sensible defaults for description task
    const modelParams = profileParams(imageDescProfile) ?? {}
    const sampling = resolveSamplingParams(modelParams)
    const temperature = sampling.temperature ?? 0.7
    let maxTokens = sampling.maxTokens ?? 1000
    const topP = sampling.topP

    // Detect reasoning models (o1, o3, gpt-5) which need more tokens
    // They use internal reasoning tokens that don't appear in output
    const isReasoningModel = imageDescProfile.modelName.toLowerCase().match(/o1|o3|gpt-5|reasoning/)
    if (isReasoningModel && maxTokens < 4000) {
      logger.warn('[Image Fallback] Reasoning model detected, increasing maxTokens from ' + maxTokens + ' to 4000')
      maxTokens = 4000
    }

    // Cap the payload to the *description* provider's limits. The attachment
    // was sized for the responding model (often a non-vision provider with
    // different limits); handing a large base64 image to the vision provider is
    // a meaningful chunk of this call's latency. resizeImageForProvider is a
    // no-op when the image already fits.
    let attachmentForLLM = file
    if (file.data && canResizeImage(file.mimeType)) {
      try {
        const resized = await resizeImageForProvider({
          provider: imageDescProfile.provider,
          buffer: Buffer.from(file.data, 'base64'),
          mimeType: file.mimeType,
          filename: file.filename,
        })
        if (resized.wasResized) {
          attachmentForLLM = {
            ...file,
            data: resized.buffer.toString('base64'),
            mimeType: resized.mimeType,
            size: resized.finalSize,
          }
        }
      } catch (err) {
        logger.warn('[Image Fallback] Resize for description provider failed; sending original', {
          filename: file.filename,
          error: getErrorMessage(err),
        })
      }
    }

    // Build message parameters - only include supported parameters
    const messageParams: any = {
      model: imageDescProfile.modelName,
      messages: [
        {
          role: 'user',
          content: IMAGE_DESCRIPTION_INSTRUCTION,
          attachments: [attachmentForLLM],
        },
      ],
    }

    // Only add optional parameters if they have valid values
    if (temperature !== undefined) {
      messageParams.temperature = temperature
    }
    if (maxTokens !== undefined && maxTokens > 0) {
      messageParams.maxTokens = maxTokens
    }
    if (topP !== undefined) {
      messageParams.topP = topP
    }
    // Forward the profile's provider params (e.g. DeepSeek thinking mode) so a
    // "reasoning off" setting on the image-description profile takes effect.
    if (modelParams && typeof modelParams === 'object') {
      messageParams.profileParameters = modelParams
    }

    // Send message to vision-capable LLM asking for description, under a hard
    // timeout so a slow/degraded describer can never wedge the inline reply.
    let timer: ReturnType<typeof setTimeout> | undefined
    let response
    try {
      response = await Promise.race([
        provider.sendMessage(messageParams, apiKeyValue || ''),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Image description timed out after ${IMAGE_DESCRIPTION_TIMEOUT_MS}ms`)),
            IMAGE_DESCRIPTION_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }

    // Record the call in llm_logs like every other model call, so its latency
    // and token usage are diagnosable (this path was previously invisible).
    // Logging must never break description generation, so it's best-effort.
    try {
      await logLLMCall({
        userId,
        type: 'IMAGE_DESCRIPTION',
        provider: imageDescProfile.provider,
        modelName: imageDescProfile.modelName,
        request: {
          messages: [{
            role: 'user',
            content: IMAGE_DESCRIPTION_INSTRUCTION,
            attachments: [{ filename: file.filename, mimeType: attachmentForLLM.mimeType }],
          }],
          temperature,
          maxTokens,
        },
        response: {
          content: response.content ?? '',
          finishReason: response.finishReason ?? null,
        },
        usage: response.usage,
        durationMs: Date.now() - describeStart,
      })
    } catch (logErr) {
      logger.warn('[Image Fallback] Failed to record IMAGE_DESCRIPTION llm log', {
        error: getErrorMessage(logErr),
      })
    }

    // Check for empty or invalid responses
    const trimmedContent = response.content.trim()

    if (trimmedContent.length === 0) {
      logger.error('[Image Fallback] Empty response from image description LLM', {
        provider: imageDescProfile.provider,
        model: imageDescProfile.modelName,
        filename: file.filename,
        mimeType: file.mimeType,
        responseMetadata: JSON.stringify(response, null, 2)
      })

      // Check if this is a reasoning model that hit the token limit
      if (response.finishReason === 'length' && isReasoningModel) {
        return {
          type: 'unsupported',
          error: `Image description failed - ${imageDescProfile.modelName} is a reasoning model that used all ${response.usage?.completionTokens || maxTokens} tokens for internal reasoning and didn't output a description. Reasoning models are expensive and slow for this task. Switch to gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash instead.`,
          processingMetadata: {
            originalFilename: file.filename,
            originalMimeType: file.mimeType,
            descriptionProfileId: imageDescProfile.id,
            descriptionProvider: imageDescProfile.provider,
            descriptionModel: imageDescProfile.modelName,
          },
        }
      }

      // Generic empty response error
      return {
        type: 'unsupported',
        error: `Image could not be processed - ${imageDescProfile.provider} ${imageDescProfile.modelName} returned empty response. The model may not support vision. Try using gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash as your image description profile.`,
        processingMetadata: {
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
          descriptionProfileId: imageDescProfile.id,
          descriptionProvider: imageDescProfile.provider,
          descriptionModel: imageDescProfile.modelName,
        },
      }
    }

    // Check if the response looks like an error message or a refusal
    const contentLower = trimmedContent.toLowerCase()
    if (
      contentLower.includes('error') ||
      contentLower.includes('cannot') ||
      contentLower.includes('unable to') ||
      contentLower.includes('failed to') ||
      contentLower.includes('not support') ||
      contentLower.includes('invalid') ||
      trimmedContent.length < 20 // Very short responses are suspicious
    ) {
      // Response might be an error, log it and return unsupported
      logger.warn('[Image Fallback] Suspicious response from image description LLM', {
        content: response.content,
        provider: imageDescProfile.provider,
        model: imageDescProfile.modelName
      })

      return {
        type: 'unsupported',
        error: `The image description profile responded with: "${trimmedContent.substring(0, 100)}...". This appears to be an error rather than an image description. The model may not support images or there's a parameter mismatch. Try using gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash.`,
        processingMetadata: {
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
          descriptionProfileId: imageDescProfile.id,
          descriptionProvider: imageDescProfile.provider,
          descriptionModel: imageDescProfile.modelName,
        },
      }
    }

    logger.info('[Image Fallback] Successfully generated description', {
      filename: file.filename,
      descriptionLength: trimmedContent.length,
      profileId: imageDescProfile.id,
    })

    return {
      type: 'image_description',
      imageDescription: response.content,
      processingMetadata: {
        usedImageDescriptionLLM: true,
        descriptionProfileId: imageDescProfile.id,
        descriptionProvider: imageDescProfile.provider,
        descriptionModel: imageDescProfile.modelName,
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  } catch (error) {
    logger.error('[Image Fallback] Error generating description:', {}, error instanceof Error ? error : new Error(String(error)))
    // Log the failed/timed-out call too, so timeouts are visible in llm_logs.
    try {
      await logLLMCall({
        userId,
        type: 'IMAGE_DESCRIPTION',
        provider: imageDescProfile.provider,
        modelName: imageDescProfile.modelName,
        request: { messages: [{ role: 'user', content: IMAGE_DESCRIPTION_INSTRUCTION }] },
        response: { content: '', error: getErrorMessage(error) },
        durationMs: Date.now() - describeStart,
      })
    } catch {
      // Logging must never mask the original failure.
    }
    return {
      type: 'unsupported',
      error: `Failed to generate image description: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
        descriptionProfileId: imageDescProfile.id,
        descriptionProvider: imageDescProfile.provider,
        descriptionModel: imageDescProfile.modelName,
      },
    }
  }
}

/**
 * Generate image description using the configured vision profile, with an
 * automatic fallback to `uncensoredImageDescriptionProfileId` when the primary
 * refuses or returns an unusable response. The fallback only runs when the
 * user has explicitly configured one — there's no auto-pick at the fallback
 * layer.
 */
export async function generateImageDescription(
  file: FileAttachment,
  repos: any,
  userId: string
): Promise<FallbackResult> {
  // Reading an image with a vision model is image work — it lights "Img" for
  // as long as the call takes, the same as generating one. The persisted-
  // description shortcut below returns fast enough not to register as a blip.
  return trackActivity('image', () => runGenerateImageDescription(file, repos, userId))
}

async function runGenerateImageDescription(
  file: FileAttachment,
  repos: any,
  userId: string
): Promise<FallbackResult> {
  // Reuse a persisted description before spending a (slow, uncensored) vision
  // call. Images Quilltap generated already carry the exact prompt that made
  // them — the most faithful description available, and free — so we prefer
  // that. User uploads may have been auto-described earlier (FileEntry.description).
  // Either way, this takes the vision call off the inline reply path entirely.
  try {
    const entry = file.id ? await repos.files.findById(file.id) : null
    const reused =
      entry?.generationRevisedPrompt?.trim() ||
      entry?.generationPrompt?.trim() ||
      entry?.description?.trim()
    if (reused) {
      logger.info('[Image Fallback] Reusing persisted description (no vision call)', {
        fileId: file.id,
        source: entry?.generationRevisedPrompt?.trim()
          ? 'generation-revised-prompt'
          : entry?.generationPrompt?.trim()
            ? 'generation-prompt'
            : 'stored-description',
        descriptionLength: reused.length,
      })
      return {
        type: 'image_description',
        imageDescription: reused,
        processingMetadata: {
          usedImageDescriptionLLM: false,
          reusedPersistedDescription: true,
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
        },
      }
    }
  } catch (err) {
    logger.warn('[Image Fallback] Persisted-description lookup failed; falling back to vision', {
      fileId: file.id,
      error: getErrorMessage(err),
    })
  }

  // Get image description profile
  const imageDescProfile = await getImageDescriptionProfile(repos, userId)

  if (!imageDescProfile) {
    return {
      type: 'unsupported',
      error: 'No image description profile available. Configure one in Settings → Chat Settings → Image Description Profile',
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  }

  const primaryResult = await describeImageWithProfile(file, imageDescProfile, repos, userId)
  if (primaryResult.type === 'image_description') {
    return primaryResult
  }

  // The describer failed. Three escapes, in this order:
  //
  //   1. the primary's own fallback chain — an *availability* answer;
  //   2. the configured uncensored describer — a *content* answer, and the
  //      long-standing escape hatch for a refusal;
  //   3. that profile's own chain, run dangerous so a tier pick stays cleared.
  //
  // The chain comes first because it is cheaper to be right about: a describer
  // that is rate-limited or misconfigured is not a content problem, and
  // spending the uncensored profile on it wastes the one escape that can
  // actually answer a refusal.
  const attemptTrail: string[] = [
    `${imageDescProfile.name}: ${primaryResult.error ?? 'failed'}`,
  ]

  const chainResult = await describeViaFallbackChain(
    file, imageDescProfile, repos, userId,
    { dangerous: false, alreadyTried: [imageDescProfile.id] },
    attemptTrail
  )
  if (chainResult) return chainResult

  // Primary and its understudies failed/refused. If an uncensored fallback is
  // configured and it's a *different* profile, give it a shot.
  const fallbackProfile = await getUncensoredImageDescriptionProfile(repos, userId)
  if (!fallbackProfile || fallbackProfile.id === imageDescProfile.id) {
    return withAttemptTrail(primaryResult, attemptTrail)
  }

  logger.info('[Image Fallback] Primary profile failed, retrying with uncensored fallback', {
    primaryProfileId: imageDescProfile.id,
    fallbackProfileId: fallbackProfile.id,
    primaryError: primaryResult.error,
    chainAttempts: attemptTrail.length - 1,
  })

  const fallbackResult = await describeImageWithProfile(file, fallbackProfile, repos, userId)
  if (fallbackResult.type === 'image_description') {
    return {
      ...fallbackResult,
      processingMetadata: fallbackResult.processingMetadata
        ? {
            ...fallbackResult.processingMetadata,
            usedUncensoredFallback: true,
            fallbackAttemptTrail: attemptTrail,
          }
        : undefined,
    }
  }

  attemptTrail.push(`${fallbackProfile.name}: ${fallbackResult.error ?? 'failed'}`)

  // The uncensored describer is a connection profile like any other and
  // carries its own understudy. Its chain runs dangerous — whatever refused
  // the primary would refuse a mainstream stand-in too.
  const uncensoredChainResult = await describeViaFallbackChain(
    file, fallbackProfile, repos, userId,
    { dangerous: true, alreadyTried: [imageDescProfile.id, fallbackProfile.id] },
    attemptTrail
  )
  if (uncensoredChainResult) {
    return {
      ...uncensoredChainResult,
      processingMetadata: uncensoredChainResult.processingMetadata
        ? { ...uncensoredChainResult.processingMetadata, usedUncensoredFallback: true }
        : undefined,
    }
  }

  // Everything failed — return the primary's error since that's what the user
  // configured first, but annotate what else was tried.
  return {
    ...primaryResult,
    error: `${primaryResult.error ?? 'Primary failed'} (uncensored fallback also failed: ${fallbackResult.error ?? 'unknown'})`,
    processingMetadata: primaryResult.processingMetadata
      ? { ...primaryResult.processingMetadata, fallbackAttemptTrail: attemptTrail }
      : undefined,
  }
}

/** Attach the attempt trail to a result without disturbing anything else on it. */
function withAttemptTrail(result: FallbackResult, attemptTrail: string[]): FallbackResult {
  if (attemptTrail.length <= 1 || !result.processingMetadata) return result
  return {
    ...result,
    processingMetadata: { ...result.processingMetadata, fallbackAttemptTrail: attemptTrail },
  }
}

/**
 * Walk a describer profile's fallback chain, returning the first description
 * that comes back — or null when nobody could produce one.
 *
 * `needsVision: true` is the load-bearing flag: a stand-in must both accept
 * image uploads (`supportsImageUpload`) and have a plugin that actually puts
 * the bytes on the wire (`providerCanTransportImages`). A describer that
 * silently drops the image would answer from the prompt alone and invent a
 * picture — which is worse than failing.
 */
async function describeViaFallbackChain(
  file: FileAttachment,
  primary: ConnectionProfile,
  repos: any,
  userId: string,
  opts: { dangerous: boolean; alreadyTried: string[] },
  attemptTrail: string[]
): Promise<FallbackResult | null> {
  let chain
  try {
    chain = await buildFallbackChain(primary, repos, {
      userId,
      purpose: 'vision',
      dangerous: opts.dangerous,
      needsVision: true,
      needsTools: false,
      alreadyTried: opts.alreadyTried,
    })
  } catch (err) {
    logger.warn('[Image Fallback] Could not build a fallback chain for the describer', {
      primaryProfileId: primary.id,
      error: getErrorMessage(err),
    })
    return null
  }

  for (const candidate of chain) {
    if (candidate.profile.id === primary.id) continue

    logger.info('[Image Fallback] Trying a describer stand-in', {
      primaryProfileId: primary.id,
      standInProfileId: candidate.profile.id,
      standInName: candidate.profile.name,
      standInProvider: candidate.profile.provider,
      kind: candidate.kind,
      dangerous: opts.dangerous,
    })

    const result = await describeImageWithProfile(file, candidate.profile, repos, userId)
    if (result.type === 'image_description') {
      logger.info('[Image Fallback] Describer stand-in answered', {
        standInProfileId: candidate.profile.id,
        standInName: candidate.profile.name,
        kind: candidate.kind,
      })
      return {
        ...result,
        processingMetadata: result.processingMetadata
          ? { ...result.processingMetadata, fallbackAttemptTrail: attemptTrail }
          : undefined,
      }
    }

    attemptTrail.push(`${candidate.profile.name}: ${result.error ?? 'failed'}`)
  }

  return null
}

/**
 * Process file attachment with fallback
 */
export async function processFileAttachmentFallback(
  file: { id: string; filepath: string; filename: string; mimeType: string; size: number },
  fileAttachment: FileAttachment,
  profile: ConnectionProfile,
  repos: any,
  userId: string
): Promise<FallbackResult> {
  // Check if file needs fallback processing
  if (!needsFallbackProcessing(profile, file.mimeType)) {
    // No fallback needed - provider supports this file type
    return {
      type: 'unsupported',
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  }

  // Handle text files
  if (isTextFile(file.mimeType)) {
    // Use the already-loaded base64 data from fileAttachment
    if (!fileAttachment.data) {
      return {
        type: 'unsupported',
        error: 'Text file data was not loaded - file may be missing or inaccessible',
        processingMetadata: {
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
        },
      }
    }
    return await convertTextFileToInline(file, fileAttachment.data)
  }

  // Handle images
  if (isImageFile(file.mimeType)) {
    return await generateImageDescription(fileAttachment, repos, userId)
  }

  // Unsupported file type
  return {
    type: 'unsupported',
    error: `File type ${file.mimeType} is not supported by provider ${profile.provider} and no fallback is available`,
    processingMetadata: {
      originalFilename: file.filename,
      originalMimeType: file.mimeType,
    },
  }
}

/**
 * Format fallback result as message content prefix
 */
export function formatFallbackAsMessagePrefix(result: FallbackResult): string {
  if (result.type === 'text' && result.textContent) {
    return result.textContent + '\n\n'
  }

  if (result.type === 'image_description' && result.imageDescription) {
    return `[Image: ${result.processingMetadata?.originalFilename || 'Unknown'}]\n\nImage Description (generated by AI):\n${result.imageDescription}\n\n`
  }

  if (result.type === 'unsupported' && result.error) {
    const filename = result.processingMetadata?.originalFilename || 'Unknown file'
    return `⚠️ Attachment Processing Failed: ${filename}\n${result.error}\n\n`
  }

  return ''
}
