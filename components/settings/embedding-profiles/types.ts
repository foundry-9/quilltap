/**
 * Type definitions for embedding profiles
 */

export type EmbeddingProvider = 'OPENAI' | 'OLLAMA' | 'OPENROUTER' | 'NANOGPT' | 'BUILTIN'

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface EmbeddingModel {
  id: string
  name: string
  dimensions?: number
  description?: string
  /** Whether this model is installed on the server (from dynamic fetch) */
  installed?: boolean
}

/**
 * Vocabulary stats for BUILTIN TF-IDF profiles
 */
export interface VocabularyStats {
  vocabularySize: number
  avgDocLength: number
  includeBigrams: boolean
  fittedAt: string
}

/**
 * Embedding status stats for a profile
 */
export interface EmbeddingStatusStats {
  pending: number
  embedded: number
  failed: number
  total: number
}

export interface EmbeddingProfile {
  id: string
  name: string
  provider: EmbeddingProvider
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  dimensions?: number
  /** Matryoshka slice target — vectors longer than this are truncated before storage. */
  truncateToDimensions?: number | null
  /** Whether stored embeddings are L2-normalised (default true). */
  normalizeL2?: boolean
  isDefault: boolean
  apiKey?: ApiKey | null
  /** Vocabulary stats for BUILTIN profiles */
  vocabularyStats?: VocabularyStats | null
  /** Embedding status stats */
  embeddingStats?: EmbeddingStatusStats | null
}

export interface EmbeddingProfileFormData {
  name: string
  provider: EmbeddingProvider
  apiKeyId: string
  baseUrl: string
  modelName: string
  dimensions: string
  truncateToDimensions: string
  normalizeL2: boolean
  isDefault: boolean
}

/**
 * Map provider names to qt-badge-provider-* CSS classes
 */
export const PROVIDER_BADGE_CLASSES: Record<string, string> = {
  OPENAI: 'qt-badge-provider-openai',
  OLLAMA: 'qt-badge-provider-ollama',
  OPENROUTER: 'qt-badge-provider-openrouter',
  NANOGPT: 'qt-badge-provider-nanogpt',
  BUILTIN: 'qt-badge-provider-builtin',
}

/**
 * @deprecated Use PROVIDER_BADGE_CLASSES instead
 */
export const PROVIDER_COLORS = PROVIDER_BADGE_CLASSES
