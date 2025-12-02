/**
 * Google Image Generation Provider Implementation for Quilltap Plugin
 *
 * Supports Imagen models through Google's Generative AI API
 */

import type { ImageGenProvider as ImageGenProviderBase, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class GoogleImagenProvider implements ImageGenProviderBase {
  readonly provider = 'GOOGLE';
  readonly supportedModels = [
    'imagen-4',
    'imagen-4-fast',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image-preview',
  ];

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Google Imagen generation started', {
      context: 'GoogleImagenProvider.generateImage',
      model: params.model,
      promptLength: params.prompt.length,
    });

    const model = params.model ?? 'imagen-4';
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = `${baseUrl}/models/${model}:predict`;

    const requestBody: Record<string, unknown> = {
      instances: [
        {
          prompt: params.prompt,
        },
      ],
      parameters: {
        sampleCount: params.n ?? 1,
      },
    };

    // Add optional parameters
    if (params.aspectRatio) {
      (requestBody.parameters as Record<string, unknown>).aspectRatio = params.aspectRatio;
    }

    // Seed parameter is provider-specific, access via type assertion
    const extendedParams = params as ImageGenParams & { seed?: number };
    if (extendedParams.seed !== undefined) {
      (requestBody.parameters as Record<string, unknown>).seed = extendedParams.seed;
    }

    logger.debug('Sending request to Google Imagen API', {
      context: 'GoogleImagenProvider.generateImage',
      endpoint,
      sampleCount: (requestBody.parameters as Record<string, unknown>).sampleCount,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Google Imagen API error', {
        context: 'GoogleImagenProvider.generateImage',
        status: response.status,
        errorMessage: error.error?.message,
      });
      throw new Error(error.error?.message || `Google Imagen API error: ${response.status}`);
    }

    const data = await response.json();

    logger.debug('Image generation completed', {
      context: 'GoogleImagenProvider.generateImage',
      imageCount: data.predictions?.length ?? 0,
    });

    return {
      images: (data.predictions ?? []).map((pred: any) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || 'image/png',
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating Google API key for image generation', { context: 'GoogleImagenProvider.validateApiKey' });

      // Validate the API key by calling the models list endpoint
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });

      const isValid = response.ok;
      logger.debug('Google API key validation result', { context: 'GoogleImagenProvider.validateApiKey', isValid });
      return isValid;
    } catch (error) {
      logger.error('Google API key validation failed for image generation', {
        context: 'GoogleImagenProvider.validateApiKey',
      }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    logger.debug('Getting available Google image models', { context: 'GoogleImagenProvider.getAvailableModels' });
    return this.supportedModels;
  }
}
