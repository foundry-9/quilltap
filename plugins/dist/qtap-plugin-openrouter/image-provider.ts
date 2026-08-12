/**
 * OpenRouter Image Generation Provider Implementation
 *
 * Generates images via OpenRouter's chat completions API at
 * /api/v1/chat/completions with modalities: ["image", "text"].
 *
 * Response format: OpenRouter returns images in message.images[] as
 * image_url objects with base64 data URIs. The aspect ratio and image
 * size are controlled via the top-level image_config parameter.
 *
 * Model discovery uses the OpenRouter models API, checking each model's
 * output_modalities for "image" support.
 */

import { OpenRouter } from '@openrouter/sdk';
import type {
  ImageProvider,
  ImageGenParams,
  ImageGenResponse,
} from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

/**
 * Static fallback list of known image-capable models.
 * Used when API-based discovery is unavailable (no API key, network error, etc.)
 */
const FALLBACK_IMAGE_MODELS = [
  'google/gemini-2.5-flash-preview-native-image',
  'google/gemini-3-pro-image-preview',
  'openai/gpt-5-image',
  'openai/gpt-5-image-mini',
];

export class OpenRouterImageProvider implements ImageProvider {
  readonly provider = 'OPENROUTER';
  readonly supportedModels = [...FALLBACK_IMAGE_MODELS];

  async generateImage(
    params: ImageGenParams,
    apiKey: string,
  ): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('OpenRouter provider requires an API key');
    }

    const model = params.model ?? FALLBACK_IMAGE_MODELS[0];

    logger.debug('Generating image via OpenRouter', {
      context: 'OpenRouterImageProvider.generateImage',
      model,
      hasAspectRatio: !!params.aspectRatio,
      hasNegativePrompt: !!params.negativePrompt,
    });

    // Build the prompt — keep it clean, use image_config for structured params
    let prompt = params.prompt;
    if (params.negativePrompt) {
      prompt += `\n\nAvoid the following in the image: ${params.negativePrompt}`;
    }
    if (params.style) {
      prompt += `\n\nUse a ${params.style} artistic style.`;
    }

    // OpenRouter image generation uses the chat completions endpoint
    // with modalities: ["image", "text"] and image_config for settings
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'user', content: prompt },
      ],
      modalities: ['image', 'text'],
    };

    // Build image_config for aspect ratio and quality/size settings
    const imageConfig: Record<string, string> = {};
    if (params.aspectRatio) {
      imageConfig.aspect_ratio = params.aspectRatio;
    }
    if (params.quality === 'hd') {
      imageConfig.image_size = '4K';
    }
    if (Object.keys(imageConfig).length > 0) {
      body.image_config = imageConfig;
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
          'X-Title': 'Quilltap',
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenRouter image generation API error', {
          context: 'OpenRouterImageProvider.generateImage',
          status: response.status,
          error: errorText,
          model,
        });
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      logger.debug('OpenRouter image generation raw response structure', {
        context: 'OpenRouterImageProvider.generateImage',
        model,
        choiceCount: data.choices?.length,
        hasImages: !!data.choices?.[0]?.message?.images,
        imageCount: data.choices?.[0]?.message?.images?.length,
        contentType: typeof data.choices?.[0]?.message?.content,
        contentIsArray: Array.isArray(data.choices?.[0]?.message?.content),
      });

      return this.parseImageResponse(data);
    } catch (error) {
      logger.error('Failed to generate image via OpenRouter', {
        context: 'OpenRouterImageProvider.generateImage',
        model,
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Parse the OpenRouter chat completion response to extract images.
   *
   * OpenRouter returns images in the message.images[] array:
   *   message.images: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }]
   *
   * Also handles fallback formats:
   * - Images in content array (multipart content)
   * - Inline data format (Gemini native passthrough)
   */
  private parseImageResponse(data: any): ImageGenResponse {
    const images: { data?: string; url?: string; mimeType?: string }[] = [];
    let textContent = '';

    const choices = data.choices || [];
    for (const choice of choices) {
      const message = choice.message;
      if (!message) continue;

      // Primary format: message.images[] array (OpenRouter documented format)
      if (Array.isArray(message.images)) {
        for (const img of message.images) {
          const url = img.image_url?.url || img.url;
          if (url) {
            this.extractImageFromUrl(url, images);
          }
        }
      }

      // Check for explicit refusal (e.g., OpenAI content policy)
      if (message.refusal) {
        textContent = message.refusal;
      }

      // Capture text content
      if (typeof message.content === 'string' && message.content) {
        textContent = message.content;
      }

      // Fallback: images embedded in content array
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'image_url' && part.image_url?.url) {
            this.extractImageFromUrl(part.image_url.url, images);
          } else if (part.type === 'text' && part.text) {
            textContent = part.text;
          }
          // Handle inline_data format (Gemini native passthrough)
          const inlineData = part.inline_data || part.inlineData;
          if (inlineData?.data) {
            images.push({
              data: inlineData.data,
              mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
            });
          }
        }
      }
    }

    if (images.length === 0) {
      logger.error('No images in OpenRouter response', {
        context: 'OpenRouterImageProvider.parseImageResponse',
        textContent: textContent.slice(0, 500),
        choiceCount: choices.length,
        messageKeys: choices[0]?.message ? Object.keys(choices[0].message) : [],
      });
      // Provide a concise error message; the model's full text goes to the log
      if (textContent) {
        const summary = textContent.length > 200
          ? textContent.slice(0, 200) + '...'
          : textContent;
        throw new Error(`Model declined to generate an image: ${summary}`);
      }
      throw new Error('No images returned from OpenRouter API');
    }

    logger.debug('Successfully parsed image response', {
      context: 'OpenRouterImageProvider.parseImageResponse',
      imageCount: images.length,
    });

    return {
      images,
      raw: data,
    };
  }

  /**
   * Extract image data from a URL (data URI or external URL)
   */
  private extractImageFromUrl(
    url: string,
    images: { data?: string; url?: string; mimeType?: string }[]
  ): void {
    const dataUriMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      images.push({
        data: dataUriMatch[2],
        mimeType: dataUriMatch[1],
      });
    } else {
      images.push({ url, mimeType: 'image/png' });
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error('OpenRouter API key validation failed for image generation', {
        context: 'OpenRouterImageProvider.validateApiKey',
      }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Get available image generation models.
   * Dynamically discovers models via the OpenRouter models API by checking
   * each model's output_modalities for "image" support.
   * Falls back to the static list if no API key is provided or the API call fails.
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    if (!apiKey) {
      logger.debug('No API key provided, returning fallback image models', {
        context: 'OpenRouterImageProvider.getAvailableModels',
      });
      return [...FALLBACK_IMAGE_MODELS];
    }

    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });

      // models.list() returns a paginated async-iterable and the model array
      // lives at page.result.data. This read was left on the pre-0.13
      // `response.data`, which is undefined on a PageIterator — so discovery
      // silently found nothing and always fell through to FALLBACK_IMAGE_MODELS.
      const pages = await client.models.list();
      const imageModels: string[] = [];

      for await (const page of pages) {
        for (const model of page.result?.data ?? []) {
          const modelAny = model as any;

          // Check output_modalities for "image" (OpenRouter's documented field)
          const outputModalities = modelAny.output_modalities || modelAny.outputModalities;
          if (Array.isArray(outputModalities) && outputModalities.includes('image')) {
            imageModels.push(model.id);
            continue;
          }

          // Fallback: check architecture.outputModality
          const outputModality = modelAny.architecture?.outputModality;
          if (typeof outputModality === 'string' && outputModality.includes('image')) {
            imageModels.push(model.id);
            continue;
          }

          // Fallback: check supported_generation_methods
          const genMethods = modelAny.supported_generation_methods;
          if (Array.isArray(genMethods) && genMethods.includes('image')) {
            imageModels.push(model.id);
            continue;
          }
        }
      }

      if (imageModels.length > 0) {
        logger.info('Discovered image generation models from OpenRouter API', {
          context: 'OpenRouterImageProvider.getAvailableModels',
          count: imageModels.length,
          models: imageModels.slice(0, 10),
        });
        return imageModels;
      }

      logger.warn('No image models found via API, using fallback list', {
        context: 'OpenRouterImageProvider.getAvailableModels',
      });
      return [...FALLBACK_IMAGE_MODELS];
    } catch (error) {
      logger.error('Failed to fetch image models from OpenRouter API, using fallback list', {
        context: 'OpenRouterImageProvider.getAvailableModels',
      }, error instanceof Error ? error : undefined);
      return [...FALLBACK_IMAGE_MODELS];
    }
  }
}
