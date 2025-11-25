/**
 * Google Imagen Image Generation Provider
 * Supports: imagen-4.0-generate-001, imagen-3.0-generate-002, imagen-3.0-fast-generate-001
 * API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict
 */

import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class GoogleImagenProvider extends ImageGenProvider {
  readonly provider = 'GOOGLE_IMAGEN';
  readonly supportedModels = [
    'imagen-4.0-generate-001', // Latest Imagen 4
    'imagen-3.0-generate-002', // Imagen 3
    'imagen-3.0-fast-generate-001', // Imagen 3 Fast
  ];

  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  async generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse> {
    const model = params.model ?? 'imagen-4.0-generate-001';
    const endpoint = `${this.baseUrl}/models/${model}:predict`;

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
      (requestBody.parameters as Record<string, unknown>).aspectRatio =
        params.aspectRatio;
    }
    if (params.negativePrompt) {
      (requestBody.parameters as Record<string, unknown>).negativePrompt =
        params.negativePrompt;
    }
    if (params.seed !== undefined) {
      (requestBody.parameters as Record<string, unknown>).seed = params.seed;
    }

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
      throw new Error(
        error.error?.message || `Google Imagen API error: ${response.status}`
      );
    }

    const data = await response.json();

    return {
      images: data.predictions.map((pred: any) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || 'image/png',
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Validate the API key by calling the models list endpoint with the x-goog-api-key header
      const response = await fetch(
        `${this.baseUrl}/models`,
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': apiKey,
          },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
