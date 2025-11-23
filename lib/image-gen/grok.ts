/**
 * xAI Grok Image Generation Provider
 * Supports: grok-2-image
 * API: POST /v1/images/generations (compatible with OpenAI SDK)
 */

import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class GrokImageProvider extends ImageGenProvider {
  readonly provider = 'GROK';
  readonly supportedModels = ['grok-2-image'];

  private baseUrl = 'https://api.x.ai/v1';

  async generateImage(
    params: ImageGenParams,
    apiKey: string
  ): Promise<ImageGenResponse> {
    const endpoint = `${this.baseUrl}/images/generations`;

    const requestBody: Record<string, unknown> = {
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
    };

    // Add optional parameters if supported by the API
    if (params.n) requestBody.n = params.n;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.message || `Grok API error: ${response.status}`
      );
    }

    const data = await response.json();

    // Grok returns data in OpenAI-compatible format
    return {
      images: data.data.map((img: any) => ({
        data: img.b64_json,
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Use a lightweight endpoint to validate the key
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
