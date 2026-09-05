/**
 * Provider Interfaces — The Four Canonical Shapes
 *
 * All LLM-related calls in Quilltap pass through one of four provider shapes:
 *
 * 1. **TextProvider** — Text -> Text (completions, streaming)
 * 2. **ImageProvider** — Text -> Image (generation)
 * 3. **EmbeddingProvider** — Text -> Vector (embeddings for search/RAG)
 * 4. **ScoringProvider** — Text + Candidates -> Scores (moderation, reranking, classification)
 *
 * @module @quilltap/plugin-types/providers
 */

// Shape 1: Text -> Text
export type {
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  LLMResponse,
  StreamChunk,
  TextProvider,
} from './text';

// Shape 2: Text -> Image
export type {
  ImageOrientation,
  ImageGenParams,
  ImageLoraSpec,
  GeneratedImage,
  ImageGenResponse,
  ImageProvider,
} from './image';

// Shape 3: Text -> Vector
export type {
  EmbeddingResult,
  EmbeddingOptions,
  EmbeddingProvider,
  LocalEmbeddingProviderState,
  LocalEmbeddingProvider,
} from './embedding';

export { isLocalEmbeddingProvider } from './embedding';

// Shape 4: Text + Candidates -> Scores
export type {
  ScoringTask,
  ScoringInput,
  CategoryScore,
  ScoringResult,
  ScoringProvider,
} from './scoring';

// Common types shared across shapes
export type {
  FileAttachment,
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
} from './common';
