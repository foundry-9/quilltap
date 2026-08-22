/**
 * NanoGPT Image Generation Provider Implementation for Quilltap Plugin
 *
 * Uses NanoGPT's OpenAI-compatible images route at
 * POST /api/v1/images/generations, which defaults to base64 responses
 * (`response_format: "b64_json"`) — exactly what Quilltap's consumers read.
 * Model discovery goes through GET /api/v1/image-models, a dedicated listing
 * with per-model capability flags.
 */

import OpenAI from 'openai';
import type { Images } from 'openai/resources';
import type { ImageProvider as ImageProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import { STATIC_IMAGE_MODEL_IDS } from './models';

const logger = createPluginLogger('qtap-plugin-nanogpt');

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

interface NanoGPTImageModelEntry {
  id: string;
  capabilities?: {
    image_generation?: boolean;
  };
}

export class NanoGPTImageProvider implements ImageProviderBase {
  readonly provider = 'NANOGPT';
  readonly supportedModels = STATIC_IMAGE_MODEL_IDS;

  private baseUrl = NANOGPT_BASE_URL;

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('NanoGPT provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
    });

    // hidream is NanoGPT's own server-side default; make it explicit.
    const model = params.model ?? 'hidream';

    const requestParams: Images.ImageGenerateParams = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      // NanoGPT defaults to b64_json already; pin it so a future default
      // change upstream cannot silently hand us URLs.
      response_format: 'b64_json',
    };

    if (params.size) {
      requestParams.size = params.size as Images.ImageGenerateParams['size'];
    }

    if (params.seed !== undefined) {
      (requestParams as unknown as Record<string, unknown>).seed = params.seed;
    }

    const response = await client.images.generate(requestParams);

    if (!('data' in response) || !response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from NanoGPT Images API', {
        context: 'NanoGPTImageProvider.generateImage',
      });
      throw new Error('Invalid response from NanoGPT Images API');
    }

    // b64_json is the requested format, but NanoGPT documents that either
    // field can appear (URL generation and base64 fall back to each other),
    // so handle both: download URL-only entries into base64, which is the
    // only form Quilltap's consumers read.
    const images = await Promise.all(
      response.data.map(async (img: { b64_json?: string; url?: string; revised_prompt?: string }) => {
        let data = img.b64_json;
        let mimeType = 'image/png';
        if (!data && img.url) {
          const imageResponse = await fetch(img.url);
          if (!imageResponse.ok) {
            throw new Error(`Failed to download NanoGPT image: HTTP ${imageResponse.status}`);
          }
          const contentType = imageResponse.headers.get('content-type');
          if (contentType && contentType.startsWith('image/')) {
            mimeType = contentType.split(';')[0];
          }
          data = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        }
        if (!data) {
          throw new Error('NanoGPT image entry carried neither base64 data nor a URL');
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
   * Without an API key this is the curated static list. With a key, NanoGPT's
   * dedicated /image-models listing is queried and filtered to entries whose
   * capability flags say they generate images (the listing also carries
   * edit-only and upscale-only entries). The curated ids are unioned in so
   * the documented flagships always appear. Throws on transport failure so
   * the caller can fall back to `supportedModels` and label the list as
   * built-in.
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    if (!apiKey) {
      return [...this.supportedModels];
    }

    const response = await fetch(`${this.baseUrl}/image-models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
    });
    if (!response.ok) {
      throw new Error(`NanoGPT image-model listing failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { data?: NanoGPTImageModelEntry[] };
    const entries = Array.isArray(payload.data) ? payload.data : [];
    const merged = new Set<string>(
      entries
        .filter((m) => m.capabilities?.image_generation === true)
        .map((m) => m.id)
    );
    for (const id of STATIC_IMAGE_MODEL_IDS) merged.add(id);

    const imageModels = Array.from(merged).sort();
    logger.debug('Discovered NanoGPT image-generation models', {
      context: 'NanoGPTImageProvider.getAvailableModels',
      count: imageModels.length,
    });
    return imageModels;
  }
}
