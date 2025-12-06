/**
 * Image Generation Tool Execution Handler
 * Handles execution of image generation tool calls from LLMs
 */

import { createHash } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { uploadFile as uploadS3File } from '@/lib/s3/operations';
import { buildS3Key } from '@/lib/s3/client';
import { decryptApiKey } from '@/lib/encryption';
import type { FileCategory, FileSource } from '@/lib/json-store/schemas/types';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import {
  ImageGenerationToolInput,
  ImageGenerationToolOutput,
  GeneratedImageResult,
  validateImageGenerationInput,
} from '@/lib/tools/image-generation-tool';
import { preparePromptExpansion } from '@/lib/image-gen/prompt-expansion';
import { craftImagePrompt } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';

/**
 * Execution context for image generation tool
 */
export interface ImageToolExecutionContext {
  userId: string;
  profileId: string;
  chatId?: string;
  /** ID of the participant calling the tool (for resolving {{me}}) */
  callingParticipantId?: string;
}

/**
 * Error class for image generation failures
 */
export class ImageGenerationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Save generated image to storage and database
 */
async function saveGeneratedImage(
  imageData: string, // Base64-encoded image data
  mimeType: string,
  userId: string,
  chatId: string | undefined, // Now used to tag the image with the chat
  metadata: {
    prompt: string;
    revisedPrompt?: string;
    model: string;
    provider: string;
  }
): Promise<GeneratedImageResult> {
  try {
    // Decode base64 to buffer
    const buffer = Buffer.from(imageData, 'base64');
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Generate original filename
    const ext = mimeType.split('/')[1] || 'png';
    const originalFilename = `generated_${Date.now()}.${ext}`;

    // Build linkedTo array
    const linkedTo = chatId ? [chatId] : [];

    const repos = getRepositories();
    const category: FileCategory = 'IMAGE';

    // Generate a new file ID
    const fileId = crypto.randomUUID();

    // Upload to S3
    const s3Key = buildS3Key(userId, fileId, originalFilename, category);
    await uploadS3File(s3Key, buffer, mimeType, {
      userId,
      fileId,
      category,
      filename: originalFilename,
      sha256,
    });
    logger.debug('Uploaded generated image to S3', { fileId, s3Key, size: buffer.length });

    // Create metadata in repository
    const fileEntry = await repos.files.create({
      userId,
      sha256,
      originalFilename,
      mimeType,
      size: buffer.length,
      width: null,
      height: null,
      linkedTo,
      source: 'GENERATED' as FileSource,
      category,
      generationPrompt: metadata.prompt,
      generationModel: metadata.model,
      generationRevisedPrompt: metadata.revisedPrompt || null,
      description: null,
      tags: chatId ? [chatId] : [],
      s3Key,
    });

    // Always use API route for S3-backed files
    const filepath = `/api/files/${fileEntry.id}`;

    return {
      id: fileEntry.id,
      url: `/api/images/${fileEntry.id}`,
      filename: fileEntry.originalFilename,
      revisedPrompt: metadata.revisedPrompt,
      filepath,
      mimeType: fileEntry.mimeType,
      size: fileEntry.size,
      width: fileEntry.width ?? undefined,
      height: fileEntry.height ?? undefined,
      sha256: fileEntry.sha256,
    };
  } catch (error) {
    throw new ImageGenerationError(
      'STORAGE_ERROR',
      'Failed to save generated image',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Merge tool input with profile defaults
 */
function mergeParameters(
  input: ImageGenerationToolInput,
  profileDefaults: Record<string, unknown> = {},
  model?: string // Model should be passed separately from profile
): {
  prompt: string;
  negativePrompt?: string;
  model: string;
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  seed?: number;
  guidanceScale?: number;
  steps?: number;
} {
  return {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt || (profileDefaults.negativePrompt as string | undefined),
    model: model || (profileDefaults.model as string) || 'dall-e-3', // Model from parameter, profile defaults, or default to dall-e-3
    n: input.count ?? (profileDefaults.n as number | undefined) ?? 1,
    size: input.size || (profileDefaults.size as string | undefined),
    aspectRatio: input.aspectRatio || (profileDefaults.aspectRatio as string | undefined),
    quality: input.quality ||
      (profileDefaults.quality as 'standard' | 'hd' | undefined),
    style: input.style ||
      (profileDefaults.style as 'vivid' | 'natural' | undefined),
    seed: profileDefaults.seed as number | undefined,
    guidanceScale: profileDefaults.guidanceScale as number | undefined,
    steps: profileDefaults.steps as number | undefined,
  };
}

/**
 * Validate and load image profile with error handling
 */
async function loadAndValidateProfile(
  profileId: string,
  userId: string
): Promise<{ success: boolean; profile?: any; output?: ImageGenerationToolOutput }> {
  try {
    const repos = getRepositories();
    const imageProfile = await repos.imageProfiles.findById(profileId);

    if (!imageProfile || imageProfile.userId !== userId) {
      return {
        success: false,
        output: {
          success: false,
          error: 'Image profile not found or not authorized',
          message: `Image profile "${profileId}" does not exist or you do not have access to it`,
        },
      };
    }

    // Get the API key if profile has one
    let apiKey = null;
    if (imageProfile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyById(imageProfile.apiKeyId);
    }

    if (!apiKey?.ciphertext) {
      return {
        success: false,
        output: {
          success: false,
          error: 'No API key configured',
          message: `Image profile "${imageProfile.name}" does not have a valid API key configured`,
        },
      };
    }

    return { success: true, profile: { ...imageProfile, apiKey } };
  } catch (error) {
    throw new ImageGenerationError(
      'DATABASE_ERROR',
      'Failed to load image profile',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Generate images using the provider
 */
async function generateImagesWithProvider(
  toolInput: ImageGenerationToolInput,
  imageProfile: any,
  userId: string,
  chatId?: string
): Promise<GeneratedImageResult[]> {
  const provider = createImageProvider(imageProfile.provider);

  // Decrypt the API key
  let decryptedKey: string;
  try {
    decryptedKey = decryptApiKey(
      imageProfile.apiKey.ciphertext,
      imageProfile.apiKey.iv,
      imageProfile.apiKey.authTag,
      imageProfile.userId
    );
  } catch (error) {
    logger.error('Failed to decrypt API key:', {}, error as Error);
    throw new ImageGenerationError(
      'ENCRYPTION_ERROR',
      'Failed to decrypt API key',
      error instanceof Error ? error.message : String(error)
    );
  }

  // Merge parameters (profile defaults + user input)
  const mergedParams = mergeParameters(
    toolInput,
    imageProfile.parameters as Record<string, unknown>,
    imageProfile.modelName
  );

  logger.info('[Image Generation] Sending to Provider:', {
    provider: imageProfile.provider,
    model: imageProfile.modelName,
    prompt: mergedParams.prompt,
    otherParams: {
      n: mergedParams.n,
      size: mergedParams.size,
      quality: mergedParams.quality,
      style: mergedParams.style,
    },
  })

  // Generate images
  let generationResponse;
  try {
    generationResponse = await provider.generateImage(mergedParams, decryptedKey);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Image generation failed:', { errorMessage }, error as Error);
    throw new ImageGenerationError(
      'PROVIDER_ERROR',
      `Image generation failed: ${errorMessage}`,
      error
    );
  }

  // Save images and create database records
  try {
    return await Promise.all(
      generationResponse.images.map((img) =>
        saveGeneratedImage(img.data, img.mimeType, userId, chatId, {
          prompt: toolInput.prompt,
          revisedPrompt: img.revisedPrompt,
          model: imageProfile.modelName,
          provider: imageProfile.provider,
        })
      )
    );
  } catch (error) {
    logger.error('Failed to save images:', {}, error as Error);
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    throw new ImageGenerationError(
      'STORAGE_ERROR',
      'Failed to save generated images',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Expand prompt with character/persona placeholders using cheap LLM
 */
async function expandPromptWithDescriptions(
  originalPrompt: string,
  userId: string,
  provider: string,
  chatId?: string,
  callingParticipantId?: string
): Promise<{ expandedPrompt: string; wasExpanded: boolean }> {
  try {
    // Map ImageProvider string to the enum type
    const imageProvider = provider as 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN';

    // Prepare expansion context
    const expansionContext = await preparePromptExpansion(
      originalPrompt,
      userId,
      imageProvider,
      chatId,
      callingParticipantId
    );

    // If no placeholders found, return original
    if (!expansionContext.hasPlaceholders || !expansionContext.placeholders) {
      return {
        expandedPrompt: originalPrompt,
        wasExpanded: false,
      };
    }

    // Get cheap LLM selection
    const repos = getRepositories();
    const allProfiles = await repos.connections.findByUserId(userId);
    const cheapLLMConfig = DEFAULT_CHEAP_LLM_CONFIG;

    // For now, use a simple default profile selection
    // In production, you might want to pass the current connection profile
    const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];

    if (!defaultProfile) {
      // No profiles available, return original prompt
      return {
        expandedPrompt: originalPrompt,
        wasExpanded: false,
      };
    }

    const cheapLLMSelection = getCheapLLMProvider(
      defaultProfile,
      cheapLLMConfig,
      allProfiles,
      false // ollamaAvailable - could be detected
    );

    // Craft the image prompt using cheap LLM
    logger.info('[Image Generation] Cheap LLM Input:', {
      originalPrompt: expansionContext.originalPrompt,
      placeholderCount: expansionContext.placeholders?.length,
      provider: expansionContext.provider,
    })

    const craftResult = await craftImagePrompt(
      {
        originalPrompt: expansionContext.originalPrompt,
        placeholders: expansionContext.placeholders,
        targetLength: expansionContext.targetLength,
        provider: expansionContext.provider,
      },
      cheapLLMSelection,
      userId
    );

    logger.info('[Image Generation] Cheap LLM Output:', {
      success: craftResult.success,
      expandedPrompt: craftResult.result,
    })

    if (craftResult.success && craftResult.result) {
      return {
        expandedPrompt: craftResult.result,
        wasExpanded: true,
      };
    }

    // If crafting failed, fall back to simple substitution using the longest available description
    let fallbackPrompt = originalPrompt;
    for (const placeholder of expansionContext.placeholders) {
      const description =
        placeholder.tiers.complete ||
        placeholder.tiers.long ||
        placeholder.tiers.medium ||
        placeholder.tiers.short ||
        placeholder.name;

      fallbackPrompt = fallbackPrompt.replace(placeholder.placeholder, description);
    }

    return {
      expandedPrompt: fallbackPrompt,
      wasExpanded: true,
    };
  } catch (error) {
    logger.error('Prompt expansion failed:', {}, error as Error);
    // On error, return original prompt
    return {
      expandedPrompt: originalPrompt,
      wasExpanded: false,
    };
  }
}

/**
 * Execute the image generation tool
 */
export async function executeImageGenerationTool(
  input: unknown,
  context: ImageToolExecutionContext
): Promise<ImageGenerationToolOutput> {
  let imageProfile: any = null;

  try {
    // 1. Validate input
    if (!validateImageGenerationInput(input)) {
      return {
        success: false,
        error: 'Invalid input: prompt is required and must be a non-empty string',
        message: 'Image generation tool received invalid parameters',
      };
    }

    const toolInput = input as unknown as ImageGenerationToolInput;

    // 2. Load and validate profile
    const profileResult = await loadAndValidateProfile(context.profileId, context.userId);
    if (!profileResult.success) {
      return profileResult.output as ImageGenerationToolOutput;
    }

    imageProfile = profileResult.profile;

    // 3. Validate provider
    try {
      createImageProvider(imageProfile.provider);
    } catch (e) {
      return {
        success: false,
        error: 'Unknown provider',
        message: `Image provider "${imageProfile.provider}" is not supported`,
        provider: imageProfile.provider,
        model: imageProfile.modelName,
      };
    }

    // 4. Expand prompt with character/persona descriptions if needed
    let expandedPrompt = toolInput.prompt;
    try {
      const expandResult = await expandPromptWithDescriptions(
        toolInput.prompt,
        context.userId,
        imageProfile.provider,
        context.chatId,
        context.callingParticipantId
      );
      expandedPrompt = expandResult.expandedPrompt;
    } catch (error) {
      // If expansion fails, just use the original prompt
      logger.warn('Prompt expansion failed, using original prompt:', { errorMessage: error instanceof Error ? error.message : String(error) });
      expandedPrompt = toolInput.prompt;
    }

    // Update the tool input with the expanded prompt
    const finalInput = {
      ...toolInput,
      prompt: expandedPrompt,
    };

    logger.info('[Image Generation] Final Input to Provider:', {
      originalPrompt: toolInput.prompt,
      expandedPrompt: expandedPrompt,
      wasExpanded: expandedPrompt !== toolInput.prompt,
    })

    // 5. Generate images
    const savedImages = await generateImagesWithProvider(
      finalInput,
      imageProfile,
      context.userId,
      context.chatId
    );

    // 6. Return success response
    return {
      success: true,
      images: savedImages,
      message: `Successfully generated ${savedImages.length} image(s) using ${imageProfile.modelName}`,
      provider: imageProfile.provider,
      model: imageProfile.modelName,
      expandedPrompt: expandedPrompt,
    };
  } catch (error) {
    logger.error('Image generation tool error:', {}, error as Error);

    // Include provider and model in error response if profile was loaded
    const errorResponse: ImageGenerationToolOutput = {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: `An unexpected error occurred`,
    };

    if (imageProfile) {
      errorResponse.provider = imageProfile.provider;
      errorResponse.model = imageProfile.modelName;
    }

    if (error instanceof ImageGenerationError) {
      errorResponse.error = error.code;
      errorResponse.message = error.message;
      return errorResponse;
    }

    // Unexpected error
    const errorMessage = error instanceof Error ? error.message : String(error);
    errorResponse.message = `An unexpected error occurred: ${errorMessage}`;
    return errorResponse;
  }
}

/**
 * Validate that a profile can be used for image generation
 */
export async function validateImageProfile(
  profileId: string,
  userId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const repos = getRepositories();
    const profile = await repos.imageProfiles.findById(profileId);

    if (!profile || profile.userId !== userId) {
      return {
        valid: false,
        error: 'Profile not found or not authorized',
      };
    }

    // Get the API key if profile has one
    let apiKey = null;
    if (profile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyById(profile.apiKeyId);
    }

    if (!apiKey?.ciphertext) {
      return {
        valid: false,
        error: 'Profile does not have a valid API key',
      };
    }

    // Verify provider exists
    try {
      createImageProvider(profile.provider);
    } catch {
      return {
        valid: false,
        error: `Provider "${profile.provider}" is not supported`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * Get default image profile for user
 */
export async function getDefaultImageProfile(userId: string) {
  try {
    const repos = getRepositories();
    const profile = await repos.imageProfiles.findDefault(userId);

    if (!profile) {
      return null;
    }

    // Enrich with API key info
    let apiKey = null;
    if (profile.apiKeyId) {
      const key = await repos.connections.findApiKeyById(profile.apiKeyId);
      if (key) {
        apiKey = {
          id: key.id,
          provider: key.provider,
          label: key.label,
        };
      }
    }

    return { ...profile, apiKey };
  } catch {
    // Database error - return null for missing profile
    return null;
  }
}
