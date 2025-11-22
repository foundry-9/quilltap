/**
 * OpenAI Image Generation Provider
 * Supports: gpt-image-1, dall-e-3, dall-e-2
 * API: POST /v1/images/generations
 */

import OpenAI from 'openai';
import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class OpenAIImageProvider extends ImageGenProvider {
  readonly provider = 'OPENAI';
  readonly supportedModels = ['gpt-image-1', 'dall-e-3', 'dall-e-2'];

  async generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse> {
    const client = new OpenAI({ apiKey });

    // gpt-image-1 has different parameter support than DALL-E models
    const isGptImage = params.model === 'gpt-image-1';

    const requestParams: any = {
      model: params.model,
      prompt: params.prompt,
      n: params.n ?? 1,
    };

    // gpt-image-1 returns URL by default, DALL-E models can use b64_json
    if (!isGptImage) {
      requestParams.response_format = 'b64_json';
    }

    // Size handling differs between models
    if (params.size) {
      requestParams.size = params.size;
    } else {
      requestParams.size = '1024x1024';
    }

    // quality and style are DALL-E 3 specific parameters
    if (!isGptImage) {
      requestParams.quality = params.quality ?? 'standard';
      requestParams.style = params.style ?? 'vivid';
    }

    const response = await client.images.generate(requestParams);

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response from OpenAI Images API');
    }

    return {
      images: response.data.map((img) => ({
        // gpt-image-1 returns urls, DALL-E models return b64_json
        data: img.b64_json || img.url || '',
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
