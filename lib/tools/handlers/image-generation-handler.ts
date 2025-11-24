/**
 * Image Generation Tool Execution Handler
 * Handles execution of image generation tool calls from LLMs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/json-store/repositories';
import { decryptApiKey } from '@/lib/encryption';
import { getImageGenProvider } from '@/lib/image-gen/factory';
import {
  ImageGenerationToolInput,
  ImageGenerationToolOutput,
  GeneratedImageResult,
  validateImageGenerationInput,
} from '@/lib/tools/image-generation-tool';

/**
 * Execution context for image generation tool
 */
export interface ImageToolExecutionContext {
  userId: string;
  profileId: string;
  chatId?: string;
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
  chatId: string | undefined,
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

    // Generate filename
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `${userId}_${Date.now()}_${randomUUID()}.${ext}`;

    // Create user-specific directory for generated images
    const userDir = join(process.cwd(), 'public', 'uploads', 'generated', userId);
    await mkdir(userDir, { recursive: true });

    // Save file
    const filepath = join('uploads', 'generated', userId, filename);
    const fullPath = join(process.cwd(), 'public', filepath);

    await writeFile(fullPath, buffer);

    // Create database record using JsonStore
    const repos = getRepositories();

    // Generate SHA256 hash for the image
    const crypto = await import('node:crypto');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const image = await repos.images.create({
      sha256,
      type: 'image',
      userId,
      filename,
      relativePath: filepath,
      mimeType,
      size: buffer.length,
      source: 'generated',
      generationPrompt: metadata.prompt,
      generationModel: metadata.model,
      chatId: chatId || null,
      tags: [],
    });

    return {
      id: image.id,
      url: `/api/images/${image.id}`,
      filename,
      revisedPrompt: metadata.revisedPrompt,
      filepath,
      mimeType,
      size: buffer.length,
      width: image.width ?? undefined,
      height: image.height ?? undefined,
      sha256,
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
  const provider = getImageGenProvider(imageProfile.provider);

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
    console.error('Failed to decrypt API key:', error);
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

  // Generate images
  let generationResponse;
  try {
    generationResponse = await provider.generateImage(mergedParams, decryptedKey);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Image generation failed:', errorMessage);
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
    console.error('Failed to save images:', error);
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
 * Execute the image generation tool
 */
export async function executeImageGenerationTool(
  input: unknown,
  context: ImageToolExecutionContext
): Promise<ImageGenerationToolOutput> {
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

    const imageProfile = profileResult.profile;

    // 3. Validate provider
    try {
      getImageGenProvider(imageProfile.provider);
    } catch (e) {
      return {
        success: false,
        error: 'Unknown provider',
        message: `Image provider "${imageProfile.provider}" is not supported`,
      };
    }

    // 4. Generate images
    const savedImages = await generateImagesWithProvider(
      toolInput,
      imageProfile,
      context.userId,
      context.chatId
    );

    // 5. Return success response
    return {
      success: true,
      images: savedImages,
      message: `Successfully generated ${savedImages.length} image(s) using ${imageProfile.modelName}`,
      provider: imageProfile.provider,
      model: imageProfile.modelName,
    };
  } catch (error) {
    console.error('Image generation tool error:', error);

    if (error instanceof ImageGenerationError) {
      return {
        success: false,
        error: error.code,
        message: error.message,
      };
    }

    // Unexpected error
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: `An unexpected error occurred: ${errorMessage}`,
    };
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
      getImageGenProvider(profile.provider);
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
