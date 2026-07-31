/**
 * OpenRouter Embedding Provider Implementation
 *
 * Provides text embedding functionality using OpenRouter's embeddings API.
 * Supports multiple embedding models from various providers via unified API.
 */

import { OpenRouter } from '@openrouter/sdk';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** The model used */
  model: string;
  /** Number of dimensions */
  dimensions: number;
  /** Token usage information */
  usage?: {
    promptTokens: number;
    totalTokens: number;
    cost?: number;
  };
}

/**
 * OpenRouter Embedding Provider
 *
 * Wraps OpenRouter's embeddings API for generating text embeddings.
 * Supports multiple embedding models including OpenAI, Cohere, Voyage, etc.
 */
export class OpenRouterEmbeddingProvider {
  /**
   * Generate an embedding for the given text
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'openai/text-embedding-3-small')
   * @param apiKey The OpenRouter API key
   * @param options Optional configuration (dimensions, encoding format)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string,
    options?: {
      dimensions?: number;
    }
  ): Promise<EmbeddingResult> {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
    });

    const response = await client.embeddings.generate({
      requestBody: {
        input: text,
        model,
        dimensions: options?.dimensions,
      },
    });

    // Handle case where response is a string (error case)
    if (typeof response === 'string') {
      throw new Error(`OpenRouter returned an error: ${response}`);
    }

    // Handle both float array and base64 encoded responses
    const embeddingData = response.data[0]?.embedding;
    if (!embeddingData) {
      throw new Error('No embedding returned from OpenRouter');
    }

    // If embedding is base64 encoded string, decode it
    let embedding: number[];
    if (typeof embeddingData === 'string') {
      // Base64 encoded float array - decode it
      const buffer = Buffer.from(embeddingData, 'base64');
      embedding = Array.from(
        new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
      );
    } else {
      embedding = embeddingData;
    }
    return {
      embedding,
      model: response.model,
      dimensions: embedding.length,
      usage: response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            totalTokens: response.usage.totalTokens,
            cost: response.usage.cost,
          }
        : undefined,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey The OpenRouter API key
   * @param options Optional configuration
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string,
    options?: {
      dimensions?: number;
    }
  ): Promise<EmbeddingResult[]> {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
    });

    const response = await client.embeddings.generate({
      requestBody: {
        input: texts,
        model,
        dimensions: options?.dimensions,
      },
    });

    // Handle case where response is a string (error case)
    if (typeof response === 'string') {
      throw new Error(`OpenRouter returned an error: ${response}`);
    }

    const results: EmbeddingResult[] = [];

    for (const data of response.data) {
      const embeddingData = data.embedding;
      if (!embeddingData) {
        continue;
      }

      let embedding: number[];
      if (typeof embeddingData === 'string') {
        const buffer = Buffer.from(embeddingData, 'base64');
        embedding = Array.from(
          new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
        );
      } else {
        embedding = embeddingData;
      }

      results.push({
        embedding,
        model: response.model,
        dimensions: embedding.length,
        usage: response.usage
          ? {
              promptTokens: response.usage.promptTokens,
              totalTokens: response.usage.totalTokens,
              cost: response.usage.cost,
            }
          : undefined,
      });
    }
    return results;
  }

  /**
   * Get available embedding models from OpenRouter
   *
   * @param apiKey The OpenRouter API key
   * @returns Array of model IDs
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || 'http://localhost:3000',
        appTitle: getQuilltapUserAgent(),
      });

      // embeddings.listModels() returns a paginated async-iterable and the
      // model array lives at page.result.data. This read was left on the
      // pre-0.13 `response.data`, which is undefined on a PageIterator — so it
      // silently resolved to an empty list on every call.
      const pages = await client.embeddings.listModels();
      const models: string[] = [];
      for await (const page of pages) {
        for (const m of page.result?.data ?? []) {
          models.push(m.id);
        }
      }
      return models;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenRouter embedding models',
        { context: 'OpenRouterEmbeddingProvider.getAvailableModels' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }
}
