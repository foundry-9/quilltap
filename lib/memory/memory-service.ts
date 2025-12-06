/**
 * Memory Service
 * Sprint 4: Memory CRUD with Embedding Integration
 *
 * This service wraps memory repository operations and integrates
 * embedding generation and vector store management.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { Memory } from '@/lib/schemas/types'
import { generateEmbeddingForUser, EmbeddingError, cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getCharacterVectorStore, getVectorStoreManager } from '@/lib/embedding/vector-store'
import { logger } from '@/lib/logger'

/**
 * Options for memory creation
 */
export interface CreateMemoryOptions {
  /** Character ID to associate the memory with */
  characterId: string
  /** Memory content */
  content: string
  /** Short summary */
  summary: string
  /** Search keywords */
  keywords?: string[]
  /** Associated tags */
  tags?: string[]
  /** Importance score (0-1) */
  importance?: number
  /** Associated persona ID */
  personaId?: string | null
  /** Source chat ID */
  chatId?: string | null
  /** How the memory was created */
  source?: 'AUTO' | 'MANUAL'
  /** Source message ID for auto-created memories */
  sourceMessageId?: string | null
}

/**
 * Options for memory operations
 */
export interface MemoryServiceOptions {
  /** User ID for API access (required for embedding) */
  userId: string
  /** Specific embedding profile ID to use */
  embeddingProfileId?: string
  /** Skip embedding generation (for batch operations or testing) */
  skipEmbedding?: boolean
}

/**
 * Result of a semantic memory search
 */
export interface SemanticSearchResult {
  /** The matching memory */
  memory: Memory
  /** Similarity score (0-1) */
  score: number
  /** Whether embedding was used for search */
  usedEmbedding: boolean
}

/**
 * Create a memory with optional embedding generation
 *
 * This is the primary function for creating memories. It:
 * 1. Creates the memory in the repository
 * 2. Generates an embedding if a profile is configured
 * 3. Adds the embedding to the vector store
 * 4. Updates the memory with the embedding
 */
export async function createMemoryWithEmbedding(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<Memory> {
  const repos = getRepositories()

  // Create the memory first (without embedding)
  const memory = await repos.memories.create({
    characterId: data.characterId,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords || [],
    tags: data.tags || [],
    importance: data.importance ?? 0.5,
    personaId: data.personaId || null,
    chatId: data.chatId || null,
    source: data.source || 'MANUAL',
    sourceMessageId: data.sourceMessageId || null,
  })

  // Skip embedding if requested
  if (options.skipEmbedding) {
    return memory
  }

  // Try to generate and store embedding
  try {
    const embeddingResult = await generateEmbeddingForUser(
      // Use summary + content for a more complete embedding
      `${data.summary}\n\n${data.content}`,
      options.userId,
      options.embeddingProfileId
    )

    // Update memory with embedding
    const updatedMemory = await repos.memories.updateForCharacter(
      data.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    )

    // Add to vector store
    const vectorStore = await getCharacterVectorStore(data.characterId)
    await vectorStore.addVector(memory.id, embeddingResult.embedding, {
      memoryId: memory.id,
      characterId: data.characterId,
      content: data.summary,
    })
    await vectorStore.save()

    return updatedMemory || memory
  } catch (error) {
    // Log but don't fail - memory is still created, just without embedding
    if (error instanceof EmbeddingError) {
      logger.warn(`[Memory] Embedding generation failed for memory ${memory.id}: ${error.message}`, { characterId: data.characterId, userId: options.userId })
    } else {
      logger.warn(`[Memory] Unexpected error generating embedding for memory ${memory.id}`, { characterId: data.characterId, userId: options.userId, error: String(error) })
    }
    return memory
  }
}

/**
 * Update a memory and regenerate its embedding if content changed
 */
export async function updateMemoryWithEmbedding(
  characterId: string,
  memoryId: string,
  data: Partial<Memory>,
  options: MemoryServiceOptions
): Promise<Memory | null> {
  const repos = getRepositories()

  // Get the existing memory
  const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
  if (!existingMemory) {
    return null
  }

  // Check if content changed (requires re-embedding)
  const contentChanged =
    (data.content && data.content !== existingMemory.content) ||
    (data.summary && data.summary !== existingMemory.summary)

  // Update the memory
  const updatedMemory = await repos.memories.updateForCharacter(characterId, memoryId, data)
  if (!updatedMemory) {
    return null
  }

  // Regenerate embedding if content changed
  if (contentChanged && !options.skipEmbedding) {
    try {
      const embeddingResult = await generateEmbeddingForUser(
        `${updatedMemory.summary}\n\n${updatedMemory.content}`,
        options.userId,
        options.embeddingProfileId
      )

      // Update memory with new embedding
      const memoryWithEmbedding = await repos.memories.updateForCharacter(
        characterId,
        memoryId,
        { embedding: embeddingResult.embedding }
      )

      // Update vector store
      const vectorStore = await getCharacterVectorStore(characterId)
      if (vectorStore.hasVector(memoryId)) {
        await vectorStore.updateVector(memoryId, embeddingResult.embedding)
      } else {
        await vectorStore.addVector(memoryId, embeddingResult.embedding, {
          memoryId,
          characterId,
          content: updatedMemory.summary,
        })
      }
      await vectorStore.save()

      return memoryWithEmbedding || updatedMemory
    } catch (error) {
      logger.warn(`[Memory] Failed to regenerate embedding for memory ${memoryId}`, { characterId, memoryId, userId: options.userId, error: String(error) })
    }
  }

  return updatedMemory
}

/**
 * Delete a memory and remove its vector
 */
export async function deleteMemoryWithVector(
  characterId: string,
  memoryId: string
): Promise<boolean> {
  const repos = getRepositories()

  // Delete from repository
  const deleted = await repos.memories.deleteForCharacter(characterId, memoryId)
  if (!deleted) {
    return false
  }

  // Remove from vector store
  try {
    const vectorStore = await getCharacterVectorStore(characterId)
    await vectorStore.removeVector(memoryId)
    await vectorStore.save()
  } catch (error) {
    logger.warn(`[Memory] Failed to remove vector for memory ${memoryId}`, { characterId, memoryId, error: String(error) })
  }

  return true
}

/**
 * Search memories using semantic similarity
 *
 * Falls back to text-based search if embedding is not available.
 */
export async function searchMemoriesSemantic(
  characterId: string,
  query: string,
  options: MemoryServiceOptions & {
    limit?: number
    minScore?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL'
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20
  const minScore = options.minScore || 0.0

  // Try semantic search first
  try {
    const embeddingResult = await generateEmbeddingForUser(
      query,
      options.userId,
      options.embeddingProfileId
    )

    const vectorStore = await getCharacterVectorStore(characterId)

    // Search vectors
    const vectorResults = vectorStore.search(
      embeddingResult.embedding,
      limit * 2 // Get more results to filter
    )

    if (vectorResults.length > 0) {
      // Get full memory data for results
      const memories = await repos.memories.findByCharacterId(characterId)
      const memoryMap = new Map(memories.map(m => [m.id, m]))

      let results: SemanticSearchResult[] = vectorResults
        .filter(vr => vr.score >= minScore)
        .map(vr => ({
          memory: memoryMap.get(vr.id)!,
          score: vr.score,
          usedEmbedding: true,
        }))
        .filter(r => r.memory) // Filter out any missing memories

      // Apply additional filters
      if (options.minImportance !== undefined) {
        results = results.filter(r => r.memory.importance >= options.minImportance!)
      }
      if (options.source) {
        results = results.filter(r => r.memory.source === options.source)
      }

      return results.slice(0, limit)
    }
  } catch (error) {
    logger.warn(`[Memory] Semantic search failed, falling back to text search`, { characterId, query: query.substring(0, 100), userId: options.userId, error: String(error) })
  }

  // Fallback to text-based search
  return searchMemoriesText(characterId, query, options)
}

/**
 * Text-based memory search (fallback when embeddings unavailable)
 */
async function searchMemoriesText(
  characterId: string,
  query: string,
  options: {
    limit?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL'
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20

  let memories = await repos.memories.searchByContent(characterId, query)

  // Apply filters
  if (options.minImportance !== undefined) {
    memories = memories.filter(m => m.importance >= options.minImportance!)
  }
  if (options.source) {
    memories = memories.filter(m => m.source === options.source)
  }

  // Score based on text matching
  const queryLower = query.toLowerCase()
  const results: SemanticSearchResult[] = memories.map(memory => {
    let score = 0
    const contentLower = memory.content.toLowerCase()
    const summaryLower = memory.summary.toLowerCase()

    // Exact match in summary is highest score
    if (summaryLower.includes(queryLower)) {
      score += 0.5
    }
    // Match in content
    if (contentLower.includes(queryLower)) {
      score += 0.3
    }
    // Keyword matches
    const queryWords = queryLower.split(/\s+/)
    const matchingKeywords = memory.keywords.filter(kw =>
      queryWords.some(qw => kw.toLowerCase().includes(qw))
    )
    score += 0.2 * (matchingKeywords.length / Math.max(memory.keywords.length, 1))

    return {
      memory,
      score: Math.min(score, 1.0),
      usedEmbedding: false,
    }
  })

  // Sort by score and limit
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Find semantically similar memories for duplicate detection
 */
export async function findSimilarMemories(
  characterId: string,
  content: string,
  summary: string,
  options: MemoryServiceOptions & {
    threshold?: number
  }
): Promise<{ memory: Memory; similarity: number }[]> {
  const threshold = options.threshold || 0.85

  try {
    const embeddingResult = await generateEmbeddingForUser(
      `${summary}\n\n${content}`,
      options.userId,
      options.embeddingProfileId
    )

    const vectorStore = await getCharacterVectorStore(characterId)
    const results = vectorStore.search(embeddingResult.embedding, 10)

    // Get full memory data
    const repos = getRepositories()
    const memories = await repos.memories.findByCharacterId(characterId)
    const memoryMap = new Map(memories.map(m => [m.id, m]))

    return results
      .filter(r => r.score >= threshold)
      .map(r => ({
        memory: memoryMap.get(r.id)!,
        similarity: r.score,
      }))
      .filter(r => r.memory)
  } catch (error) {
    logger.warn(`[Memory] Semantic similarity check failed`, { characterId, threshold: options.threshold, userId: options.userId, error: String(error) })
    return []
  }
}

/**
 * Generate embeddings for memories that don't have them yet
 *
 * Useful for backfilling existing memories or after enabling embeddings.
 */
export async function generateMissingEmbeddings(
  characterId: string,
  options: MemoryServiceOptions & {
    batchSize?: number
    onProgress?: (processed: number, total: number, current: Memory) => void
  }
): Promise<{ processed: number; failed: number; skipped: number }> {
  const repos = getRepositories()
  const batchSize = options.batchSize || 10

  // Get all memories without embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithoutEmbeddings = memories.filter(
    m => !m.embedding || m.embedding.length === 0
  )

  let processed = 0
  let failed = 0
  let skipped = 0

  const vectorStore = await getCharacterVectorStore(characterId)

  for (const memory of memoriesWithoutEmbeddings) {
    try {
      options.onProgress?.(processed + failed + skipped, memoriesWithoutEmbeddings.length, memory)

      const embeddingResult = await generateEmbeddingForUser(
        `${memory.summary}\n\n${memory.content}`,
        options.userId,
        options.embeddingProfileId
      )

      // Update memory with embedding
      await repos.memories.updateForCharacter(characterId, memory.id, {
        embedding: embeddingResult.embedding,
      })

      // Add to vector store
      await vectorStore.addVector(memory.id, embeddingResult.embedding, {
        memoryId: memory.id,
        characterId,
        content: memory.summary,
      })

      processed++

      // Save periodically
      if (processed % batchSize === 0) {
        await vectorStore.save()
      }
    } catch (error) {
      logger.warn(`[Memory] Failed to generate embedding for memory ${memory.id}`, { characterId, memoryId: memory.id, userId: options.userId, error: String(error) })
      failed++
    }
  }

  // Final save
  await vectorStore.save()

  return { processed, failed, skipped }
}

/**
 * Rebuild the vector index for a character from scratch
 *
 * Useful if the vector store becomes corrupted or out of sync.
 */
export async function rebuildVectorIndex(
  characterId: string,
  options: MemoryServiceOptions & {
    onProgress?: (processed: number, total: number) => void
  }
): Promise<{ indexed: number; failed: number }> {
  const repos = getRepositories()
  const manager = getVectorStoreManager()

  // Delete existing index
  await manager.deleteStore(characterId)

  // Get fresh store
  const vectorStore = await manager.getStore(characterId)

  // Get all memories with embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithEmbeddings = memories.filter(
    m => m.embedding && m.embedding.length > 0
  )

  let indexed = 0
  let failed = 0

  for (const memory of memoriesWithEmbeddings) {
    try {
      options.onProgress?.(indexed + failed, memoriesWithEmbeddings.length)

      await vectorStore.addVector(memory.id, memory.embedding!, {
        memoryId: memory.id,
        characterId,
        content: memory.summary,
      })
      indexed++
    } catch (error) {
      logger.warn(`[Memory] Failed to index memory ${memory.id}`, { characterId, memoryId: memory.id, error: String(error) })
      failed++
    }
  }

  await vectorStore.save()

  return { indexed, failed }
}
