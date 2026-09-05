/**
 * Z.AI Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports CogView-4 and GLM-Image via POST /paas/v4/images/generations.
 * Z.AI's image endpoint mirrors OpenAI's shape closely enough that the
 * OpenAI SDK works for requests; responses include URLs valid for 30 days.
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type { ImageProvider as ImageProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import { IMAGE_GEN_MODEL_PATTERN } from './models';

const logger = createPluginLogger('qtap-plugin-z-ai');

const SUPPORTED_MODELS = ['cogview-4-250304', 'glm-image'];

export class ZAIImageProvider implements ImageProviderBase {
  readonly provider = 'Z_AI';
  readonly supportedModels = SUPPORTED_MODELS;

  private baseUrl = 'https://api.z.ai/api/paas/v4';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Z.AI provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    const model = params.model ?? 'cogview-4-250304';

    const requestParams: Images.ImageGenerateParams = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
    };

    if (params.size) {
      requestParams.size = params.size as Images.ImageGenerateParams['size'];
    } else if (model === 'glm-image') {
      requestParams.size = '1280x1280' as Images.ImageGenerateParams['size'];
    } else {
      requestParams.size = '1024x1024' as Images.ImageGenerateParams['size'];
    }

    if (params.quality) {
      requestParams.quality = params.quality as Images.ImageGenerateParams['quality'];
    }

    const response = await client.images.generate(requestParams);

    if (!('data' in response) || !response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from Z.AI Images API', {
        context: 'ZAIImageProvider.generateImage',
      });
      throw new Error('Invalid response from Z.AI Images API');
    }

    // Z.AI returns URLs (valid ~30 days), not base64 — but every Quilltap
    // consumer (chat handler, avatar/background jobs) reads only base64
    // `data`/`b64Json`. Download each image here so the response is usable.
    const images = await Promise.all(
      response.data.map(async (img: { b64_json?: string; url?: string; revised_prompt?: string }) => {
        let data = img.b64_json;
        let mimeType = 'image/png';
        if (!data && img.url) {
          const imageResponse = await fetch(img.url);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download Z.AI image: HTTP ${imageResponse.status}`);
          }
          const contentType = imageResponse.headers.get('content-type');
          if (contentType && contentType.startsWith('image/')) {
            mimeType = contentType.split(';')[0];
          }
          data = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        }
        if (!data) {
          throw new Error('Z.AI image entry carried neither base64 data nor a URL');
        }
        return {
          data,
          url: img.url,
          mimeType,
          revisedPrompt: img.revised_prompt,
        };
      })
    );

    return {
      images,
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) return false;
    // Defer to the text provider's validation to avoid a paid image call.
    // Callers typically validate once via the text provider.
    return true;
  }

  /**
   * List image-generation models.
   *
   * Without an API key this is the curated static list. With a key, Z.AI's
   * /models endpoint is queried and filtered to the image-generation families
   * (cogview-*, glm-image*) via IMAGE_GEN_MODEL_PATTERN — the exact inverse
   * of the text provider's filter, so the two lists can never overlap. The
   * endpoint under-reports (the text side unions with a static catalog for
   * the same reason), so the documented image models are unioned in rather
   * than trusted to appear. Throws on transport failure so the caller can
   * fall back to `supportedModels` and label the list as built-in.
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    if (!apiKey) {
      return [...this.supportedModels];
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });
    const response = await client.models.list();
    const merged = new Set<string>(
      response.data.map((m) => m.id).filter((id) => IMAGE_GEN_MODEL_PATTERN.test(id))
    );
    for (const id of SUPPORTED_MODELS) merged.add(id);

    const imageModels = Array.from(merged).sort();
    logger.debug('Discovered Z.AI image-generation models', {
      context: 'ZAIImageProvider.getAvailableModels',
      count: imageModels.length,
    });
    return imageModels;
  }
}
