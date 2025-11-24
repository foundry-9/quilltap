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
      response_format: 'b64_json',
    };

    // Add optional parameters if supported by the API
    if (params.n) requestBody.n = params.n;
    // Grok does not support size, quality, or style parameters
    // if (params.size) requestBody.size = params.size;
    // if (params.quality) requestBody.quality = params.quality;
    // if (params.style) requestBody.style = params.style;

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
      const errorText = await response.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = { message: errorText };
      }
      
      console.error('Grok API Error Details:', errorDetails);
      
      throw new Error(
        errorDetails.message || errorDetails.error?.message || `Grok API error: ${response.status} - ${JSON.stringify(errorDetails)}`
      );
    }

    const data = await response.json();

    // Grok returns data in OpenAI-compatible format
    // Handle both b64_json (preferred) and url (fallback)
    const images = await Promise.all(data.data.map(async (img: any) => {
      let b64Data = img.b64_json;
      
      if (!b64Data && img.url) {
        try {
          const imageRes = await fetch(img.url);
          if (imageRes.ok) {
            const arrayBuffer = await imageRes.arrayBuffer();
            b64Data = Buffer.from(arrayBuffer).toString('base64');
          }
        } catch (e) {
          console.error('Failed to fetch image from URL:', e);
        }
      }

      if (!b64Data) {
        throw new Error('Failed to retrieve image data from Grok response');
      }

      return {
        data: b64Data,
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      };
    }));

    return {
      images,
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
