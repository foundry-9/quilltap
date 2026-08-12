/**
 * Ollama Embedding Provider Implementation
 *
 * Provides text embedding functionality using Ollama's embeddings API.
 * Supports any embedding model available on the local Ollama server.
 * Note: Ollama doesn't require API keys - it uses a local server.
 *
 * Embeddings are generated via the modern `POST /api/embed` endpoint with
 * `truncate: true` (so oversize inputs are clipped rather than rejected) and an
 * explicit `num_ctx`. Ollama otherwise loads embedding models with its stock
 * 2048-token window, which silently caps how much of each input is considered
 * and makes large inputs fail outright with "input length exceeds the context
 * length". We derive `num_ctx` from the model's own reported context length
 * (capped at NUM_CTX_CEILING) so we use the model's real capacity without an
 * unbounded KV-cache.
 */

import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import type { EmbeddingProvider, EmbeddingResult, EmbeddingOptions } from './types';

const logger = createPluginLogger('qtap-plugin-ollama');

/** Hard ceiling for the context window we request from Ollama for embeddings. */
const NUM_CTX_CEILING = 16384;
/** Used when the model's real context length can't be determined from /api/show. */
const NUM_CTX_FALLBACK = 8192;

/**
 * Cache of successfully-derived num_ctx values, keyed by `${baseUrl}::${model}`.
 * Module-level so it survives the per-call provider instances the host creates.
 */
const numCtxCache = new Map<string, number>();
/**
 * In-flight /api/show resolutions, to dedupe the burst of concurrent lookups
 * that happens when many embedding jobs start at once for the same model.
 */
const numCtxInflight = new Map<string, Promise<{ numCtx: number; derived: boolean }>>();

/**
 * Validate an embedding vector returned by Ollama. Some models (notably
 * qwen3-embedding) can emit NaN/Inf components for pathological inputs; on
 * newer Ollama these fail server-side with "json: unsupported value: NaN",
 * but on lenient parses a non-finite vector can slip through. A NaN component
 * poisons cosine similarity (every comparison becomes NaN) and breaks JSON
 * serialization downstream, so reject it here with a clear, identifiable error
 * rather than persisting a corrupt vector.
 */
function assertFiniteEmbedding(embedding: unknown): asserts embedding is number[] {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('No embedding returned from Ollama');
  }
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
      throw new Error('Ollama returned a non-finite (NaN/Inf) embedding');
    }
  }
}

/**
 * Ollama Embedding Provider
 *
 * Wraps Ollama's embeddings API for generating text embeddings.
 * Works with local or remote Ollama servers.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
  }

  /**
   * Generate an embedding for the given text.
   *
   * Note: Ollama doesn't require an API key, but the interface requires it.
   * The apiKey parameter is ignored for Ollama. The options parameter is
   * accepted to match the EmbeddingProvider contract; `dimensions` has no
   * effect on Ollama's embedding endpoint, and num_ctx is derived internally.
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'nomic-embed-text')
   * @param apiKey Ignored for Ollama (no API key required)
   * @param options Ignored for Ollama (see note above)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string, // Ignored for Ollama
    options?: EmbeddingOptions // Ignored for Ollama (matches interface)
  ): Promise<EmbeddingResult> {
    void apiKey;
    void options;

    // Empty/whitespace-only input has no meaningful embedding and is a known
    // trigger for NaN vectors on Ollama embedding models. Reject it up front
    // with a clear, deterministic error so callers can skip rather than retry.
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty input');
    }

    const numCtx = await this.resolveNumCtx(model);

    // Modern endpoint: takes `input`, returns `embeddings` (array of vectors),
    // and honours `truncate` + `options.num_ctx`.
    const requestPayload = {
      model,
      input: text,
      truncate: true,
      options: { num_ctx: numCtx },
    };

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify(requestPayload),
    });

    // Older Ollama servers predate /api/embed — fall back to the legacy endpoint.
    if (response.status === 404) {
      logger.warn('Ollama /api/embed not found (404); falling back to legacy /api/embeddings', {
        context: 'OllamaEmbeddingProvider.generateEmbedding',
        model,
      });
      return this.generateEmbeddingLegacy(text, model);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error || response.statusText;
      logger.error('Ollama embedding failed', {
        context: 'OllamaEmbeddingProvider.generateEmbedding',
        status: response.status,
        model,
        numCtx,
        error: errorMessage,
      });
      throw new Error(`Ollama embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const embedding = Array.isArray(data.embeddings) ? data.embeddings[0] : undefined;

    assertFiniteEmbedding(embedding);

    return {
      embedding,
      model,
      dimensions: embedding.length,
    };
  }

  /**
   * Legacy embedding path for Ollama servers without /api/embed.
   *
   * The legacy endpoint does not reliably honour `truncate`, so we send the
   * minimal payload and let Ollama use whatever context it loaded with.
   */
  private async generateEmbeddingLegacy(text: string, model: string): Promise<EmbeddingResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty input');
    }
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error || response.statusText;
      logger.error('Ollama embedding failed (legacy endpoint)', {
        context: 'OllamaEmbeddingProvider.generateEmbeddingLegacy',
        status: response.status,
        model,
        error: errorMessage,
      });
      throw new Error(`Ollama embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const embedding = data.embedding;

    assertFiniteEmbedding(embedding);

    return {
      embedding,
      model,
      dimensions: embedding.length,
    };
  }

  /**
   * Resolve the context window to request for a model, derived from the model's
   * own reported context length and capped at NUM_CTX_CEILING. Cached per
   * `${baseUrl}::${model}` (successful derivations only), with concurrent
   * lookups for the same key deduped.
   */
  private async resolveNumCtx(model: string): Promise<number> {
    const key = `${this.baseUrl}::${model}`;

    const cached = numCtxCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let inflight = numCtxInflight.get(key);
    if (!inflight) {
      inflight = this.fetchModelNumCtx(model);
      numCtxInflight.set(key, inflight);
    }

    try {
      const { numCtx, derived } = await inflight;
      // Only cache values we actually derived from the model, so a transient
      // /api/show failure doesn't lock in the fallback for the process lifetime.
      if (derived) {
        numCtxCache.set(key, numCtx);
      }
      return numCtx;
    } finally {
      numCtxInflight.delete(key);
    }
  }

  /**
   * Query /api/show for the model's metadata and pull out its context length.
   * Returns `{ derived: false }` with the fallback when the call fails or the
   * model reports no context length.
   */
  private async fetchModelNumCtx(model: string): Promise<{ numCtx: number; derived: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify({ model }),
      });

      if (!response.ok) {
        logger.warn('Ollama /api/show failed; using fallback num_ctx', {
          context: 'OllamaEmbeddingProvider.fetchModelNumCtx',
          model,
          status: response.status,
          fallback: NUM_CTX_FALLBACK,
        });
        return { numCtx: NUM_CTX_FALLBACK, derived: false };
      }

      const data = await response.json();
      const modelInfo: Record<string, unknown> = (data && data.model_info) || {};

      // The context-length key is namespaced by architecture, e.g.
      // `qwen3.context_length` or `llama.context_length`, so match by suffix.
      let modelCtx: number | undefined;
      for (const [k, v] of Object.entries(modelInfo)) {
        if ((k.endsWith('.context_length') || k === 'context_length') && typeof v === 'number' && v > 0) {
          modelCtx = v;
          break;
        }
      }

      if (!modelCtx) {
        logger.warn('Ollama /api/show returned no context_length; using fallback num_ctx', {
          context: 'OllamaEmbeddingProvider.fetchModelNumCtx',
          model,
          fallback: NUM_CTX_FALLBACK,
        });
        return { numCtx: NUM_CTX_FALLBACK, derived: false };
      }

      const numCtx = Math.min(modelCtx, NUM_CTX_CEILING);
      return { numCtx, derived: true };
    } catch (error) {
      logger.warn(
        'Ollama /api/show threw; using fallback num_ctx',
        {
          context: 'OllamaEmbeddingProvider.fetchModelNumCtx',
          model,
          fallback: NUM_CTX_FALLBACK,
          // PluginLogger.warn takes (message, context) — only error() accepts a
          // third Error argument. This was passed as a third argument and
          // silently dropped, so the warning carried no cause. Fold it in.
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return { numCtx: NUM_CTX_FALLBACK, derived: false };
    }
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * Note: Ollama doesn't have a native batch API, so this processes texts sequentially.
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey Ignored for Ollama
   * @param options Ignored for Ollama (matches interface)
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (const text of texts) {
      const result = await this.generateEmbedding(text, model, apiKey, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Get available embedding models from Ollama
   *
   * @param apiKey Ignored for Ollama
   * @returns Array of model names that support embeddings
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: {
          'User-Agent': getQuilltapUserAgent(),
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      // Return all models - Ollama doesn't distinguish embedding models in the API
      // Users need to know which models support embeddings
      const models = data.models?.map((m: { name: string }) => m.name) || [];

      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', {
        context: 'OllamaEmbeddingProvider.getAvailableModels',
        baseUrl: this.baseUrl,
      }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Check if the Ollama server is available
   *
   * @returns True if the Ollama server is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: {
          'User-Agent': getQuilltapUserAgent(),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
