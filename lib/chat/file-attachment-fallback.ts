/**
 * File Attachment Fallback Handling
 *
 * Handles file attachments for providers that don't support them:
 * 1. Text files → Convert to inline text in message
 * 2. Images → Use image description LLM to generate description
 */

import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'
import type { ConnectionProfile } from '@/lib/json-store/schemas/types'
import type { FileAttachment } from '@/lib/llm/base'
import { join } from 'path'
import { readFile } from 'fs/promises'

/**
 * Get image description profile from repos
 */
async function getImageDescriptionProfile(
  repos: any,
  userId: string
): Promise<ConnectionProfile | null> {
  // Get chat settings
  const chatSettings = await repos.users.getChatSettings(userId)
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

  // Filter to vision-capable profiles only
  const visionProfiles = availableProfiles.filter((p: ConnectionProfile) =>
    profileSupportsMimeType(p, 'image/jpeg')
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
 * Check if a file attachment needs fallback processing
 */
export function needsFallbackProcessing(
  profile: ConnectionProfile,
  mimeType: string
): boolean {
  return !profileSupportsMimeType(profile, mimeType)
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
    descriptionProfileId?: string
    descriptionProvider?: string
    descriptionModel?: string
    originalFilename: string
    originalMimeType: string
  }
  error?: string
}

/**
 * Read text content from a file
 * @param filepath - Relative path from public/ directory (e.g., 'uploads/chat-files/chatId/filename.md')
 */
async function readTextFile(filepath: string): Promise<string> {
  try {
    // Construct full path: filepath is relative to public/ directory
    const fullPath = join(process.cwd(), 'public', filepath)
    const content = await readFile(fullPath, 'utf-8')
    return content
  } catch (error) {
    throw new Error(`Failed to read text file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Convert text file to inline message content
 */
export async function convertTextFileToInline(
  file: { filepath: string; filename: string; mimeType: string }
): Promise<FallbackResult> {
  try {
    const content = await readTextFile(file.filepath)

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
 * Generate image description using image description LLM
 */
export async function generateImageDescription(
  file: FileAttachment,
  repos: any,
  userId: string
): Promise<FallbackResult> {
  try {
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

    // Check if profile supports images
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

    // Get API key for image description profile
    let apiKeyValue: string | null = null
    if (imageDescProfile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(imageDescProfile.apiKeyId)
      if (apiKey) {
        apiKeyValue = decryptApiKey(
          apiKey.ciphertext,
          apiKey.iv,
          apiKey.authTag,
          userId
        )
      }
    }

    // Create provider instance
    const provider = createLLMProvider(
      imageDescProfile.provider as any,
      imageDescProfile.baseUrl || undefined
    )

    // Get parameters from profile, with sensible defaults for description task
    const modelParams = imageDescProfile.parameters as Record<string, unknown>
    const temperature = typeof modelParams.temperature === 'number' ? modelParams.temperature : 0.7
    let maxTokens = typeof modelParams.max_tokens === 'number' ? modelParams.max_tokens : 1000
    const topP = typeof modelParams.top_p === 'number' ? modelParams.top_p : undefined

    // Detect reasoning models (o1, o3, gpt-5) which need more tokens
    // They use internal reasoning tokens that don't appear in output
    const isReasoningModel = imageDescProfile.modelName.toLowerCase().match(/o1|o3|gpt-5|reasoning/)
    if (isReasoningModel && maxTokens < 4000) {
      console.warn('[Image Fallback] Reasoning model detected, increasing maxTokens from', maxTokens, 'to 4000')
      maxTokens = 4000
    }

    // Build message parameters - only include supported parameters
    const messageParams: any = {
      model: imageDescProfile.modelName,
      messages: [
        {
          role: 'user',
          content: 'Please describe this image in great detail. Include all visible elements, colors, composition, mood, and any text or notable features. Be thorough and descriptive.',
          attachments: [file],
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

    // Send message to cheap LLM asking for description
    const response = await provider.sendMessage(messageParams, apiKeyValue || '')

    // Check for empty or invalid responses
    const trimmedContent = response.content.trim()

    if (trimmedContent.length === 0) {
      console.error('[Image Fallback] Empty response from image description LLM')
      console.error('[Image Fallback] Provider:', imageDescProfile.provider, 'Model:', imageDescProfile.modelName)
      console.error('[Image Fallback] Image:', file.filename, 'MIME:', file.mimeType)
      console.error('[Image Fallback] Response metadata:', JSON.stringify(response, null, 2))

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

    // Check if the response looks like an error message
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
      console.warn('[Image Fallback] Suspicious response from image description LLM:', response.content)
      console.warn('[Image Fallback] Provider:', imageDescProfile.provider, 'Model:', imageDescProfile.modelName)

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

    console.log('[Image Fallback] Successfully generated description for:', file.filename)
    console.log('[Image Fallback] Description length:', trimmedContent.length, 'characters')

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
    console.error('[Image Fallback] Error generating description:', error)
    return {
      type: 'unsupported',
      error: `Failed to generate image description: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingMetadata: {
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
      },
    }
  }
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
    return await convertTextFileToInline(file)
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
