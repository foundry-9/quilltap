/**
 * Base class for image generation providers
 * Implements a unified interface for different image generation APIs
 */

export interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  model: string;
  n?: number; // Number of images
  size?: string; // e.g., "1024x1024"
  aspectRatio?: string; // e.g., "16:9" (for providers that use this instead of size)
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  seed?: number;
  guidanceScale?: number; // CFG scale for diffusion models
  steps?: number; // Inference steps for diffusion models
}

export interface GeneratedImage {
  data: string; // Base64-encoded image data
  mimeType: string;
  revisedPrompt?: string; // Some providers revise the prompt
  seed?: number; // Seed used for generation
}

export interface ImageGenResponse {
  images: GeneratedImage[];
  raw: unknown; // Provider-specific raw response
}

export abstract class ImageGenProvider {
  abstract readonly provider: string;
  abstract readonly supportedModels: string[];

  abstract generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse>;

  abstract validateApiKey(apiKey: string): Promise<boolean>;

  abstract getAvailableModels(apiKey?: string): Promise<string[]>;
}
