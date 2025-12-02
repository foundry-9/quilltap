/**
 * Grok Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports: grok-2-image
 * API: POST /v1/images/generations (compatible with OpenAI SDK)
 */

import OpenAI from 'openai';
import type { ImageGenProvider as ImageGenProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class GrokImageProvider implements ImageGenProviderBase {
  readonly provider = 'GROK';
  readonly supportedModels = ['grok-2-image'];

  private baseUrl = 'https://api.x.ai/v1';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Grok image generation started', {
      context: 'GrokImageProvider.generateImage',
      model: params.model,
      promptLength: params.prompt.length,
      n: params.n ?? 1,
    });

    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    const response = await client.images.generate({
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    });

    if (!response.data || !Array.isArray(response.data)) {
      logger.error('Invalid response from Grok Images API', { context: 'GrokImageProvider.generateImage' });
      throw new Error('Invalid response from Grok Images API');
    }

    logger.debug('Image generation completed', {
      context: 'GrokImageProvider.generateImage',
      imageCount: response.data.length,
    });

    return {
      images: response.data.map((img) => ({
        data: img.b64_json || img.url || '',
        mimeType: 'image/jpeg',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating Grok API key for image generation', { context: 'GrokImageProvider.validateApiKey' });
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      await client.models.list();
      logger.debug('Grok API key validation successful', { context: 'GrokImageProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('Grok API key validation failed for image generation', { context: 'GrokImageProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    logger.debug('Getting available Grok image models', { context: 'GrokImageProvider.getAvailableModels' });
    return this.supportedModels;
  }
}
