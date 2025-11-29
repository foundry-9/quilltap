/**
 * Image Generation Tool Definition
 * Provides a standardized tool interface for LLMs to generate images
 * Supports OpenAI and Anthropic format conversions
 */

/**
 * Configuration for the image generation tool
 * Controls which features and constraints are available
 */
export interface ImageGenerationToolConfig {
  profileId: string; // The image profile to use
  allowedSizes?: string[]; // Restrict available sizes (e.g., ["1024x1024", "1792x1024"])
  allowedStyles?: string[]; // Restrict available styles (e.g., ["vivid", "natural"])
  allowedAspectRatios?: string[]; // Restrict available aspect ratios (e.g., ["1:1", "16:9"])
  maxImagesPerCall?: number; // Limit images per invocation (1-10)
  defaultQuality?: 'standard' | 'hd'; // Default quality setting
  defaultStyle?: 'vivid' | 'natural'; // Default style
}

/**
 * Input parameters for the image generation tool
 * These are the parameters the LLM can provide when calling the tool
 */
export interface ImageGenerationToolInput {
  prompt: string;
  negativePrompt?: string;
  size?: string; // e.g., "1024x1024"
  aspectRatio?: string; // e.g., "16:9" (for Google Imagen)
  style?: 'vivid' | 'natural';
  quality?: 'standard' | 'hd';
  count?: number; // Number of images (1-10)
}

/**
 * Result information for a single generated image
 */
export interface GeneratedImageResult {
  id: string; // Image ID in the system
  url: string; // URL to access the image
  filename: string; // Original filename
  revisedPrompt?: string; // Prompt as revised by the provider
  filepath?: string; // Relative path to the image file
  mimeType?: string; // MIME type of the image
  size?: number; // File size in bytes
  width?: number; // Image width in pixels
  height?: number; // Image height in pixels
  sha256?: string; // SHA256 hash of the image file
}

/**
 * Output from the image generation tool
 */
export interface ImageGenerationToolOutput {
  success: boolean;
  images?: GeneratedImageResult[];
  error?: string;
  message?: string;
  provider?: string;
  model?: string;
  expandedPrompt?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const imageGenerationToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'Generate an image based on a text description. Use this when the user requests an image, illustration, artwork, visual content, or any visual material. Provide detailed descriptions of style, composition, colors, and mood for best results.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'A detailed description of the image to generate. Be specific about style, composition, colors, mood, lighting, and any other visual elements. IMPORTANT: You can use {{placeholders}} to reference characters and personas - use {{CharacterName}} for any character, {{PersonaName}} for any persona, or {{me}}/{{I}} to refer to yourself (the character you are playing). The system will automatically expand these with physical descriptions. Examples: "{{me}} in a forest clearing at sunset", "{{Alice}} and {{me}} having coffee together", "A serene mountain landscape with snow-capped peaks"',
          minLength: 1,
          maxLength: 4000,
        },
        negativePrompt: {
          type: 'string',
          description:
            'Optional description of what to avoid in the image. Example: "blurry, low quality, watermark"',
          maxLength: 1000,
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '1792x1024', '1024x1792'],
          description:
            'Image dimensions. Use 1024x1024 for square, 1792x1024 for landscape, 1024x1792 for portrait.',
          default: '1024x1024',
        },
        style: {
          type: 'string',
          enum: ['vivid', 'natural'],
          description:
            'Image style. "vivid" for dramatic, hyper-real, detailed images with vibrant colors. "natural" for more realistic, understated, less exaggerated images.',
          default: 'vivid',
        },
        quality: {
          type: 'string',
          enum: ['standard', 'hd'],
          description:
            'Image quality. "standard" for regular quality (faster, lower cost). "hd" produces finer details and greater consistency (slower, higher cost).',
          default: 'standard',
        },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
          description:
            'Aspect ratio for image generation. Only used for providers that support aspect ratios (e.g., Google Imagen). Examples: 1:1 (square), 16:9 (landscape), 9:16 (portrait).',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Number of images to generate. Default is 1.',
          default: 1,
        },
      },
      required: ['prompt'],
    },
  },
};

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicImageGenerationToolDefinition = {
  name: 'generate_image',
  description:
    'Generate an image based on a text description. Use this when the user requests an image, illustration, artwork, visual content, or any visual material. Provide detailed descriptions of style, composition, colors, and mood for best results.',
  input_schema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description:
          'A detailed description of the image to generate. Be specific about style, composition, colors, mood, lighting, and any other visual elements. IMPORTANT: You can use {{placeholders}} to reference characters and personas - use {{CharacterName}} for any character, {{PersonaName}} for any persona, or {{me}}/{{I}} to refer to yourself (the character you are playing). The system will automatically expand these with physical descriptions. Examples: "{{me}} in a forest clearing at sunset", "{{Alice}} and {{me}} having coffee together", "A serene mountain landscape with snow-capped peaks"',
        minLength: 1,
        maxLength: 4000,
      },
      negativePrompt: {
        type: 'string',
        description:
          'Optional description of what to avoid in the image. Example: "blurry, low quality, watermark"',
        maxLength: 1000,
      },
      size: {
        type: 'string',
        enum: ['1024x1024', '1792x1024', '1024x1792'],
        description:
          'Image dimensions. Use 1024x1024 for square, 1792x1024 for landscape, 1024x1792 for portrait.',
        default: '1024x1024',
      },
      style: {
        type: 'string',
        enum: ['vivid', 'natural'],
        description:
          'Image style. "vivid" for dramatic, hyper-real, detailed images with vibrant colors. "natural" for more realistic, understated, less exaggerated images.',
        default: 'vivid',
      },
      quality: {
        type: 'string',
        enum: ['standard', 'hd'],
        description:
          'Image quality. "standard" for regular quality (faster, lower cost). "hd" produces finer details and greater consistency (slower, higher cost).',
        default: 'standard',
      },
      aspectRatio: {
        type: 'string',
        enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description:
          'Aspect ratio for image generation. Only used for providers that support aspect ratios (e.g., Google Imagen). Examples: 1:1 (square), 16:9 (landscape), 9:16 (portrait).',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Number of images to generate. Default is 1.',
        default: 1,
      },
    },
    required: ['prompt'],
  },
};

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIImageGenerationTool() {
  return imageGenerationToolDefinition;
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicImageGenerationTool() {
  return anthropicImageGenerationToolDefinition;
}

/**
 * Helper to validate tool input parameters
 */
export function validateImageGenerationInput(
  input: unknown
): input is ImageGenerationToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // prompt is required
  if (typeof obj.prompt !== 'string' || obj.prompt.trim().length === 0) {
    return false;
  }

  // Optional string fields
  if (obj.negativePrompt !== undefined && typeof obj.negativePrompt !== 'string') {
    return false;
  }

  // Optional enum fields
  if (obj.size !== undefined && !['1024x1024', '1792x1024', '1024x1792'].includes(String(obj.size))) {
    return false;
  }

  if (obj.style !== undefined && !['vivid', 'natural'].includes(String(obj.style))) {
    return false;
  }

  if (obj.quality !== undefined && !['standard', 'hd'].includes(String(obj.quality))) {
    return false;
  }

  if (
    obj.aspectRatio !== undefined &&
    !['1:1', '3:4', '4:3', '9:16', '16:9'].includes(String(obj.aspectRatio))
  ) {
    return false;
  }

  // Optional number fields
  if (obj.count !== undefined) {
    const count = Number(obj.count);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      return false;
    }
  }

  return true;
}

/**
 * Helper to get provider-specific allowed values
 */
export function getProviderConstraints(provider: string) {
  switch (provider) {
    case 'OPENAI':
      return {
        sizes: ['1024x1024', '1792x1024', '1024x1792'],
        styles: ['vivid', 'natural'],
        qualities: ['standard', 'hd'],
        aspectRatios: undefined, // OpenAI uses sizes, not aspect ratios
        maxImages: 10,
      };

    case 'GROK':
      return {
        sizes: undefined, // Grok doesn't support custom sizes
        styles: undefined,
        qualities: undefined,
        aspectRatios: undefined,
        maxImages: 10,
      };

    case 'GOOGLE_IMAGEN':
      return {
        sizes: undefined, // Google uses aspect ratios
        styles: undefined,
        qualities: undefined,
        aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        maxImages: 10,
      };

    default:
      return null;
  }
}
