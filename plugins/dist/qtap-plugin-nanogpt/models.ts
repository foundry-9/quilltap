/**
 * Static NanoGPT model catalogs.
 *
 * NanoGPT is a pay-as-you-go gateway routing to 600+ chat models, 200+ image
 * models, and two dozen embedding models, so these lists are deliberately
 * curated fallbacks rather than a mirror of the catalog. The live endpoints
 * (`/api/v1/models`, `/api/v1/image-models`, `/api/v1/embedding-models`) are
 * always preferred; the statics keep the pickers working when NanoGPT is
 * unreachable and guarantee the flagship names appear even if the live list
 * omits one.
 *
 * The `auto-model*` ids are NanoGPT's own routing meta-models and are the
 * most stable ids the service offers — provider-prefixed ids come and go with
 * upstream releases.
 */

import type { ModelInfo, EmbeddingModelInfo } from './types';

/**
 * NanoGPT's OpenAI-compatible gateway root. The single source of truth: the
 * chat, image, and embedding providers all import it from here, so the three
 * cannot drift apart.
 */
export const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

export const STATIC_MODELS: ModelInfo[] = [
  {
    id: 'auto-model',
    name: 'Auto Model (NanoGPT routing)',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'auto-model-basic',
    name: 'Auto Model — Basic',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'auto-model-premium',
    name: 'Auto Model — Premium',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2 (via NanoGPT)',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 Mini (via NanoGPT)',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'openai/gpt-5-nano',
    name: 'GPT-5 Nano (via NanoGPT)',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5 (via NanoGPT)',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsImages: false,
    supportsTools: true,
  },
  // NanoGPT's `:thinking` model-id suffix selects a model's reasoning
  // variant, which reasons without being asked. `thinksByDefault` tells the
  // host so, keeping the multi-character `[Name]` prefill off such a profile
  // (bug 85's lesson). Only catalogued ids get this habit — an uncatalogued
  // `X:thinking` pick relies on the profile's explicit Reasoning Effort
  // option instead, which always outranks the habit.
  {
    id: 'anthropic/claude-sonnet-5:thinking',
    name: 'Claude Sonnet 5 — Thinking (via NanoGPT)',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsImages: false,
    supportsTools: true,
    supportsThinking: true,
    thinksByDefault: true,
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview (via NanoGPT)',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsImages: false,
    supportsTools: true,
  },
  {
    id: 'moonshotai/kimi-k3',
    name: 'Kimi K3 (via NanoGPT)',
    contextWindow: 262144,
    maxOutputTokens: 32768,
    supportsImages: false,
    supportsTools: true,
  },
];

export const STATIC_MODEL_IDS: string[] = STATIC_MODELS.map((m) => m.id);

/**
 * Curated image-generation model ids. The image provider unions these with
 * the live `/api/v1/image-models` listing; `hidream` is also NanoGPT's own
 * server-side default when a request omits the model.
 */
export const STATIC_IMAGE_MODEL_IDS: string[] = [
  'hidream',
  'flux-2-flash',
  'flux-2-dev',
  'flux-2-pro',
  'recraft-v3',
  'gpt-image-1.5',
];

/**
 * Curated embedding models with their published dimensions, mirrored from
 * NanoGPT's `/api/v1/embedding-models` listing.
 */
export const STATIC_EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: 'text-embedding-3-small',
    name: 'Text Embedding 3 Small',
    dimensions: 1536,
    description: 'OpenAI, routed through NanoGPT. Cost-effective default; supports dimension reduction.',
  },
  {
    id: 'text-embedding-3-large',
    name: 'Text Embedding 3 Large',
    dimensions: 3072,
    description: 'OpenAI, routed through NanoGPT. Highest accuracy; supports dimension reduction.',
  },
  {
    id: 'BAAI/bge-m3',
    name: 'BGE-M3',
    dimensions: 1024,
    description: 'Multilingual BAAI model with an 8K-token input window.',
  },
  {
    id: 'jina-embeddings-v3',
    name: 'Jina Embeddings v3',
    dimensions: 1024,
    description: 'Multilingual Jina model with an 8K-token input window.',
  },
  {
    id: 'Qwen/Qwen3-Embedding-0.6B',
    name: 'Qwen3 Embedding 0.6B',
    dimensions: 1024,
    description: 'Compact Qwen3 embedder with an 8K-token input window.',
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    name: 'Qwen3 Embedding 8B',
    dimensions: 4096,
    description: 'Large Qwen3 embedder with a 32K-token input window.',
  },
  {
    id: 'gemini-embedding-001',
    name: 'Gemini Embedding 001',
    dimensions: 3072,
    description: 'Google embedding model routed through NanoGPT.',
  },
];
