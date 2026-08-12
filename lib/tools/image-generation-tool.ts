/**
 * Image Generation Tool Definition
 * Provides a standardized tool interface for LLMs to generate images
 * Supports OpenAI and Anthropic format conversions
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

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
 * Zod schema for the image-generation tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const imageGenerationToolInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      'A detailed description of the image to generate. Be specific about style, composition, colors, mood, lighting, and any other visual elements.\n\n**CRITICAL: Always use {{placeholders}} for people - the system expands these with physical descriptions:**\n- {{me}}, {{I}}, or {{char}} = yourself (the character/assistant)\n- {{user}} = the person you are talking to (the user character)\n- {{CharacterName}} = any character by name\n\n**When depicting BOTH yourself AND the user together, you MUST use BOTH placeholders.** Do NOT describe appearances directly - use placeholders so the system can insert the correct descriptions.\n\nGood: "{{me}} and {{user}} sitting together in a cozy café, warm lighting"\nGood: "{{char}} handing a gift to {{user}} in a garden setting"\nBad: "A woman with brown hair sitting with a man" (missing placeholders!)'
    ),
  negativePrompt: z
    .string()
    .max(1000)
    .describe('Optional description of what to avoid in the image. Example: "blurry, low quality, watermark"')
    .optional(),
  orientation: z
    .enum(['portrait', 'landscape', 'square'])
    .describe('PREFERRED way to control image shape. The system maps this onto whatever each provider supports (a concrete size, an aspect ratio, or prompt wording), so it works everywhere. "portrait" = taller than wide, "landscape" = wider than tall, "square" = 1:1. Use this instead of `size`/`aspectRatio` unless you have a specific reason not to.')
    .optional(),
  size: z
    .enum(['1024x1024', '1792x1024', '1024x1792'])
    .default('1024x1024')
    .describe('Advanced, provider-dependent: an exact pixel size honoured only by some providers (e.g. OpenAI). Most providers ignore it. Prefer `orientation`.')
    .optional(),
  style: z
    .enum(['vivid', 'natural'])
    .default('vivid')
    .describe('Image style. "vivid" for dramatic, hyper-real, detailed images with vibrant colors. "natural" for more realistic, understated, less exaggerated images.')
    .optional(),
  quality: z
    .enum(['standard', 'hd'])
    .default('standard')
    .describe('Image quality. "standard" for regular quality (faster, lower cost). "hd" produces finer details and greater consistency (slower, higher cost).')
    .optional(),
  aspectRatio: z
    .enum(['1:1', '3:4', '4:3', '9:16', '16:9'])
    .describe('Advanced, provider-dependent: an exact aspect ratio honoured only by aspect-ratio providers (e.g. Google, Grok, OpenRouter). Prefer `orientation`.')
    .optional(),
  count: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Number of images to generate. Default is 1.')
  )
    .default(1)
    .optional(),
});

/**
 * Input parameters for the image generation tool
 * These are the parameters the LLM can provide when calling the tool
 */
export type ImageGenerationToolInput = z.infer<typeof imageGenerationToolInputSchema>;

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
    parameters: zodToOpenAISchema(imageGenerationToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateImageGenerationInput(
  input: unknown
): ImageGenerationToolInput | null {
  const parsed = imageGenerationToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
