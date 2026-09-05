/**
 * NanoGPT Embedding Provider Implementation
 *
 * Provides text embedding functionality using NanoGPT's OpenAI-compatible
 * embeddings API at POST /api/v1/embeddings. Model discovery goes through
 * the dedicated GET /api/v1/embedding-models listing, which reports each
 * model's dimensions.
 */

import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import type { EmbeddingProvider, EmbeddingResult, EmbeddingOptions } from './types';
import { NANOGPT_BASE_URL, STATIC_EMBEDDING_MODELS } from './models';

const logger = createPluginLogger('qtap-plugin-nanogpt');

export class NanoGPTEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || NANOGPT_BASE_URL;
  }

  /**
   * Generate an embedding for the given text
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'text-embedding-3-small')
   * @param apiKey The NanoGPT API key
   * @param options Optional configuration (dimensions)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    const requestPayload: Record<string, unknown> = {
      model,
      input: text,
    };

    // Only include dimensions if specified (not all models support it)
    if (options?.dimensions) {
      requestPayload.dimensions = options.dimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error?.message || response.statusText;
      logger.error('NanoGPT embedding failed', {
        context: 'NanoGPTEmbeddingProvider.generateEmbedding',
        status: response.status,
        error: errorMessage,
      });
      throw new Error(`NanoGPT embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    return {
      embedding,
      model,
      dimensions: embedding.length,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey The NanoGPT API key
   * @param options Optional configuration
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    const requestPayload: Record<string, unknown> = {
      model,
      input: texts,
    };

    if (options?.dimensions) {
      requestPayload.dimensions = options.dimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error?.message || response.statusText;
      logger.error('NanoGPT batch embedding failed', {
        context: 'NanoGPTEmbeddingProvider.generateBatchEmbeddings',
        status: response.status,
        error: errorMessage,
      });
      throw new Error(`NanoGPT batch embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const results: EmbeddingResult[] = [];

    for (const item of data.data) {
      results.push({
        embedding: item.embedding,
        model,
        dimensions: item.embedding.length,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      });
    }

    return results;
  }

  /**
   * Get available embedding models from NanoGPT's dedicated listing.
   * Falls back to the curated static ids on any failure.
   *
   * @param apiKey The NanoGPT API key
   * @returns Array of embedding model IDs
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/embedding-models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': getQuilltapUserAgent(),
        },
      });

      if (!response.ok) {
        return STATIC_EMBEDDING_MODELS.map((m) => m.id);
      }

      const data = await response.json();
      const models = Array.isArray(data.data)
        ? data.data.map((m: { id: string }) => m.id)
        : [];
      return models.length > 0 ? models : STATIC_EMBEDDING_MODELS.map((m) => m.id);
    } catch (error) {
      logger.error('Failed to fetch NanoGPT embedding models', {
        context: 'NanoGPTEmbeddingProvider.getAvailableModels',
      }, error instanceof Error ? error : undefined);
      return STATIC_EMBEDDING_MODELS.map((m) => m.id);
    }
  }

  /**
   * Check if the provider is available
   *
   * @param apiKey The API key to validate
   * @returns True if the provider is ready to use
   */
  async isAvailable(apiKey?: string): Promise<boolean> {
    if (!apiKey) {
      return false;
    }

    try {
      const models = await this.getAvailableModels(apiKey);
      return models.length > 0;
    } catch {
      return false;
    }
  }
}
