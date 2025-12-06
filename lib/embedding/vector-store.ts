/**
 * Vector Store
 * Sprint 4: Vector Database Integration
 *
 * In-memory vector store with MongoDB persistence for semantic search.
 * Uses cosine similarity for nearest neighbor search.
 *
 * Design decisions:
 * - Per-character vector indices for isolation and efficient loading
 * - In-memory search with persistence (suitable for <1000 memories per character)
 * - Cosine similarity for text embedding comparison
 * - MongoDB is the required backend
 */

import { cosineSimilarity } from './embedding-service'
import { getMongoVectorIndicesRepository } from '@/lib/mongodb/repositories/vector-indices.repository'
import { logger } from '@/lib/logger'

/**
 * Metadata associated with a vector entry
 */
export interface VectorMetadata {
  /** Memory ID this vector belongs to */
  memoryId: string
  /** Character ID for filtering */
  characterId: string
  /** Text content for debugging/display */
  content?: string
  /** Additional metadata */
  [key: string]: unknown
}

/**
 * A single entry in the vector store
 */
export interface VectorEntry {
  /** Unique identifier (typically the memory ID) */
  id: string
  /** The embedding vector */
  embedding: number[]
  /** Associated metadata */
  metadata: VectorMetadata
  /** When this entry was created */
  createdAt: string
}

/**
 * Result of a vector search
 */
export interface VectorSearchResult {
  /** The matched entry ID */
  id: string
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number
  /** Associated metadata */
  metadata: VectorMetadata
}

/**
 * Interface for vector store implementations
 */
export interface ICharacterVectorStore {
  load(): Promise<void>
  save(): Promise<void>
  addVector(id: string, embedding: number[], metadata: VectorMetadata): Promise<void>
  removeVector(id: string): Promise<boolean>
  updateVector(id: string, embedding: number[]): Promise<boolean>
  hasVector(id: string): boolean
  readonly size: number
  getDimensions(): number | null
  search(queryEmbedding: number[], limit?: number, filter?: (metadata: VectorMetadata) => boolean): VectorSearchResult[]
  getAllEntries(): VectorEntry[]
  clear(): void
}

/**
 * MongoDB-backed vector store for a single character
 * Uses in-memory storage with MongoDB persistence
 */
export class CharacterVectorStore implements ICharacterVectorStore {
  private entries: Map<string, VectorEntry> = new Map()
  private dimensions: number | null = null
  private dirty: boolean = false
  private createdAt: string = new Date().toISOString()

  constructor(private readonly characterId: string) {}

  /**
   * Load the vector index from MongoDB
   */
  async load(): Promise<void> {
    try {
      logger.debug('Loading vector index from MongoDB', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
      })

      const repo = getMongoVectorIndicesRepository()
      const index = await repo.findByCharacterId(this.characterId)

      this.entries.clear()
      if (index) {
        for (const entry of index.entries) {
          this.entries.set(entry.id, entry)
        }
        this.dimensions = index.dimensions
        this.createdAt = index.createdAt
      } else {
        this.dimensions = null
      }
      this.dirty = false

      logger.debug('Vector index loaded from MongoDB', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
        entryCount: this.entries.size,
      })
    } catch (error) {
      logger.error('Error loading vector index from MongoDB', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Start fresh on error
      this.entries.clear()
      this.dimensions = null
      this.dirty = false
    }
  }

  /**
   * Save the vector index to MongoDB
   */
  async save(): Promise<void> {
    if (!this.dirty && this.entries.size === 0) {
      return // Nothing to save
    }

    try {
      logger.debug('Saving vector index to MongoDB', {
        context: 'CharacterVectorStore.save',
        characterId: this.characterId,
        entryCount: this.entries.size,
      })

      const repo = getMongoVectorIndicesRepository()
      const now = new Date().toISOString()

      await repo.save(this.characterId, {
        characterId: this.characterId,
        version: 1,
        dimensions: this.dimensions || 0,
        entries: Array.from(this.entries.values()),
        createdAt: this.createdAt,
        updatedAt: now,
      })

      this.dirty = false

      logger.debug('Vector index saved to MongoDB', {
        context: 'CharacterVectorStore.save',
        characterId: this.characterId,
      })
    } catch (error) {
      logger.error('Error saving vector index to MongoDB', {
        context: 'CharacterVectorStore.save',
        characterId: this.characterId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Add a vector to the store
   */
  async addVector(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void> {
    // Validate dimensions
    if (this.dimensions !== null && embedding.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      )
    }

    if (this.dimensions === null) {
      this.dimensions = embedding.length
    }

    const entry: VectorEntry = {
      id,
      embedding,
      metadata,
      createdAt: new Date().toISOString(),
    }

    this.entries.set(id, entry)
    this.dirty = true
  }

  /**
   * Remove a vector from the store
   */
  async removeVector(id: string): Promise<boolean> {
    const deleted = this.entries.delete(id)
    if (deleted) {
      this.dirty = true
    }
    return deleted
  }

  /**
   * Update a vector's embedding
   */
  async updateVector(id: string, embedding: number[]): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry) {
      return false
    }

    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      )
    }

    entry.embedding = embedding
    this.dirty = true
    return true
  }

  /**
   * Check if a vector exists
   */
  hasVector(id: string): boolean {
    return this.entries.has(id)
  }

  /**
   * Get the number of vectors stored
   */
  get size(): number {
    return this.entries.size
  }

  /**
   * Get the embedding dimensions
   */
  getDimensions(): number | null {
    return this.dimensions
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  search(
    queryEmbedding: number[],
    limit: number = 10,
    filter?: (metadata: VectorMetadata) => boolean
  ): VectorSearchResult[] {
    if (this.entries.size === 0) {
      return []
    }

    // Validate query dimensions
    if (this.dimensions !== null && queryEmbedding.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${queryEmbedding.length}`
      )
    }

    const results: VectorSearchResult[] = []

    for (const entry of this.entries.values()) {
      // Apply filter if provided
      if (filter && !filter(entry.metadata)) {
        continue
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding)
      results.push({
        id: entry.id,
        score,
        metadata: entry.metadata,
      })
    }

    // Sort by score (descending) and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get all entries (for debugging/export)
   */
  getAllEntries(): VectorEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear()
    this.dimensions = null
    this.dirty = true
  }
}

/**
 * Global vector store manager
 * Handles loading and caching of per-character vector stores
 * Uses MongoDB backend exclusively
 */
export class VectorStoreManager {
  private stores: Map<string, ICharacterVectorStore> = new Map()

  constructor() {
    logger.debug('VectorStoreManager initialized', {
      context: 'VectorStoreManager',
      backend: 'mongodb',
    })
  }

  /**
   * Get or create a vector store for a character
   */
  async getStore(characterId: string): Promise<ICharacterVectorStore> {
    let store = this.stores.get(characterId)

    if (!store) {
      store = new CharacterVectorStore(characterId)
      await store.load()
      this.stores.set(characterId, store)
    }

    return store
  }

  /**
   * Save all dirty stores
   */
  async saveAll(): Promise<void> {
    const savePromises: Promise<void>[] = []

    for (const store of this.stores.values()) {
      savePromises.push(store.save())
    }

    await Promise.all(savePromises)
  }

  /**
   * Save a specific character's store
   */
  async saveStore(characterId: string): Promise<void> {
    const store = this.stores.get(characterId)
    if (store) {
      await store.save()
    }
  }

  /**
   * Remove a character's store from cache (doesn't delete from storage)
   */
  unloadStore(characterId: string): boolean {
    return this.stores.delete(characterId)
  }

  /**
   * Delete a character's vector index entirely
   */
  async deleteStore(characterId: string): Promise<boolean> {
    this.stores.delete(characterId)

    const repo = getMongoVectorIndicesRepository()
    return repo.delete(characterId)
  }

  /**
   * Get stats about loaded stores
   */
  getStats(): { loadedStores: number; totalVectors: number } {
    let totalVectors = 0
    for (const store of this.stores.values()) {
      totalVectors += store.size
    }

    return {
      loadedStores: this.stores.size,
      totalVectors,
    }
  }
}

// Singleton instance
let vectorStoreManager: VectorStoreManager | null = null

/**
 * Get the global vector store manager instance
 */
export function getVectorStoreManager(): VectorStoreManager {
  if (!vectorStoreManager) {
    vectorStoreManager = new VectorStoreManager()
  }
  return vectorStoreManager
}

/**
 * Convenience function to get a character's vector store
 */
export async function getCharacterVectorStore(
  characterId: string
): Promise<ICharacterVectorStore> {
  const manager = getVectorStoreManager()
  return manager.getStore(characterId)
}
