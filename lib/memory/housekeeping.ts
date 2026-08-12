/**
 * Memory Housekeeping Service
 * Sprint 6: Automatic cleanup and maintenance of character memories
 *
 * Implements retention policies based on:
 * - Importance scoring (0-1)
 * - Age of memory (months since creation)
 * - Access time (months since last accessed)
 * - Memory count limits per character
 */

import { getRepositories } from '@/lib/repositories/factory'
import { Memory } from '@/lib/schemas/types'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { calculateEffectiveWeight, calculateProtectionScore } from './memory-weighting'
import { deleteMemoriesWithUnlinkBatch, occasionsAreDistinct } from './memory-gate'

import { logger } from '@/lib/logger'

/**
 * Protection score below which a memory is a deletion candidate.
 * Memories above this threshold are preserved by the housekeeping gate.
 */
const PROTECTION_THRESHOLD = 0.5

/**
 * Housekeeping options for memory cleanup
 */
export interface HousekeepingOptions {
  /** Maximum number of memories to keep (default: 1000) */
  maxMemories?: number
  /** Delete memories older than this many months if not important (default: 6) */
  maxAgeMonths?: number
  /** Delete memories not accessed in this many months (default: 6) */
  maxInactiveMonths?: number
  /** Delete memories below this importance threshold (default: 0.3) */
  minImportance?: number
  /** Merge semantically similar memories (default: false) */
  mergeSimilar?: boolean
  /** Similarity threshold for merging (default: 0.9) */
  mergeThreshold?: number
  /** Preview changes without applying (default: false) */
  dryRun?: boolean
  /** User ID for embedding operations (required for merge) */
  userId?: string
  /** Embedding profile ID */
  embeddingProfileId?: string
}

/**
 * Result of a housekeeping operation
 */
export interface HousekeepingResult {
  /** Number of memories deleted */
  deleted: number
  /** Number of memories merged */
  merged: number
  /** Number of memories kept */
  kept: number
  /** Total memories before cleanup */
  totalBefore: number
  /** Total memories after cleanup */
  totalAfter: number
  /** The effective cap used for this sweep — either the per-character
   * override, the user's global cap, or the housekeeping default. Returned
   * so callers (e.g. the outcome cache) can evaluate effectiveness
   * against a specific target size rather than re-resolving the cap. */
  capUsed: number
  /** IDs of deleted memories */
  deletedIds: string[]
  /** IDs of merged memories (source memories that were merged into others) */
  mergedIds: string[]
  /** Reasons for each deletion/merge */
  details: HousekeepingDetail[]
}

/**
 * Detail of a single housekeeping action
 */
export interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'merged' | 'kept'
  reason: string
  summary?: string
}

/**
 * Default housekeeping options based on PLAN.md retention policy
 */
const DEFAULT_OPTIONS: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>> = {
  maxMemories: 2000,
  maxAgeMonths: 6,
  maxInactiveMonths: 6,
  minImportance: 0.3,
  mergeSimilar: false,
  mergeThreshold: 0.9,
  dryRun: false,
}

/**
 * Check if a memory is protected from deletion.
 *
 * Protection is determined by a blended score that combines the LLM-derived
 * content importance (time-decayed) with observed usage evidence — reinforcement
 * count, graph degree (related-memory links), and recent access. This replaces
 * the earlier four-rule gate, which relied on raw LLM importance as a bright
 * line and effectively made 99% of memories immortal when the cheap-LLM scorer
 * clustered all its outputs in the 0.7–0.9 band.
 *
 * `source === 'MANUAL'` remains a hard override — explicit user intent is
 * treated as durable regardless of what the signals say.
 *
 * See `calculateProtectionScore` in memory-weighting.ts for the full formula.
 */
function isProtectedMemory(memory: Memory, now: Date): boolean {
  if (memory.source === 'MANUAL') {
    return true
  }
  const { score } = calculateProtectionScore(memory, undefined, now)
  return score >= PROTECTION_THRESHOLD
}

/**
 * Check if a memory should be deleted based on retention policy
 */
function shouldDeleteMemory(
  memory: Memory,
  now: Date,
  options: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>>,
  isProtected: boolean
): { shouldDelete: boolean; reason: string } {
  if (isProtected) {
    return { shouldDelete: false, reason: 'protected' }
  }

  // Use reinforcedImportance for threshold checks (falls back to importance for old memories)
  const effectiveImportance = memory.reinforcedImportance ?? memory.importance
  if (effectiveImportance < options.minImportance) {
    const createdAt = new Date(memory.createdAt)
    const ageMonths = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)

    // Only delete low importance if also old
    if (ageMonths >= options.maxAgeMonths) {
      // Check if not accessed recently
      if (!memory.lastAccessedAt) {
        return {
          shouldDelete: true,
          reason: `Low importance (${(memory.importance * 100).toFixed(0)}%) and old (${ageMonths.toFixed(1)} months)`,
        }
      }

      const lastAccessed = new Date(memory.lastAccessedAt)
      const inactiveMonths = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24 * 30)

      if (inactiveMonths >= options.maxInactiveMonths) {
        return {
          shouldDelete: true,
          reason: `Low importance (${(memory.importance * 100).toFixed(0)}%), old (${ageMonths.toFixed(1)} months), and inactive (${inactiveMonths.toFixed(1)} months)`,
        }
      }
    }
  }

  return { shouldDelete: false, reason: 'within retention policy' }
}

/**
 * Run housekeeping on a character's memories
 *
 * This function cleans up old, low-importance, and duplicate memories
 * based on the configured retention policy.
 */
export async function runHousekeeping(
  characterId: string,
  options: HousekeepingOptions = {}
): Promise<HousekeepingResult> {
  const repos = getRepositories()
  const now = new Date()

  // Merge options with defaults
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  // Load memories in pages so a character with tens of thousands of entries
  // doesn't block the event loop on a single synchronous Zod-validated read.
  // Each page is ~1 encrypted SELECT + ~N row-validations; yielding between
  // pages lets HTTP, heartbeats, and other jobs make progress. Batch size 250
  // keeps each synchronous chunk small enough (~50–150 ms of Zod work) that
  // Next.js dev-server request handling doesn't starve during a sweep.
  const LOAD_BATCH_SIZE = 250
  const memories: Memory[] = []
  for await (const batch of repos.memories.findByCharacterIdInBatches(characterId, LOAD_BATCH_SIZE)) {
    for (const memory of batch) memories.push(memory)
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  const totalBefore = memories.length

  const result: HousekeepingResult = {
    deleted: 0,
    merged: 0,
    kept: 0,
    totalBefore,
    totalAfter: totalBefore,
    capUsed: opts.maxMemories,
    deletedIds: [],
    mergedIds: [],
    details: [],
  }

  if (memories.length === 0) {
    return result
  }

  // Sort memories by importance (descending) then by creation date (ascending)
  // This ensures we keep the most important and newest memories
  const sortedMemories = [...memories].sort((a, b) => {
    if (b.importance !== a.importance) {
      return b.importance - a.importance
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const deleteSet = new Set<string>()
  const memoriesToMerge: { sourceId: string; targetId: string }[] = []
  const mergeSourceSet = new Set<string>()
  // Protection is expensive to compute (blended multi-signal score).
  // Cache pass-1 results so the cap-enforcement pass can reuse them.
  const protectedMap = new Map<string, boolean>()

  // Yield to the event loop every YIELD_INTERVAL items in the two big loops so
  // a 19k-memory character doesn't block HTTP and other jobs.
  const YIELD_INTERVAL = 500
  const yieldTick = () => new Promise<void>(resolve => setImmediate(resolve))

  // First pass: identify memories to delete based on retention policy
  for (let i = 0; i < sortedMemories.length; i++) {
    const memory = sortedMemories[i]
    const isProtected = isProtectedMemory(memory, now)
    protectedMap.set(memory.id, isProtected)

    const { shouldDelete, reason } = shouldDeleteMemory(memory, now, opts, isProtected)

    if (shouldDelete) {
      deleteSet.add(memory.id)
      result.details.push({
        memoryId: memory.id,
        action: 'deleted',
        reason,
        summary: memory.summary,
      })
    } else {
      result.details.push({
        memoryId: memory.id,
        action: 'kept',
        reason,
        summary: memory.summary,
      })
    }

    if ((i + 1) % YIELD_INTERVAL === 0) {
      await yieldTick()
    }
  }

  // Second pass: check for duplicates/similar memories if merge is enabled
  // Uses already-stored embeddings from the vector store — no API calls needed.
  if (opts.mergeSimilar) {
    const remainingMemories = sortedMemories.filter(m => !deleteSet.has(m.id))
    const memoryMap = new Map(remainingMemories.map(m => [m.id, m]))

    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      const entryById = new Map(vectorStore.getAllEntries().map(e => [e.id, e]))
      const storeDimensions = vectorStore.getDimensions()
      let nonconformingSkipped = 0

      for (let i = 0; i < remainingMemories.length; i++) {
        const memory = remainingMemories[i]

        if (deleteSet.has(memory.id)) {
          continue
        }

        const entry = entryById.get(memory.id)
        if (!entry) {
          continue
        }

        // A stored vector from a previous embedding profile can't be compared
        // against the index (and would warn on every search call). It's dead
        // weight until the reindex re-embeds it — skip quietly here.
        if (storeDimensions !== null && entry.embedding.length !== storeDimensions) {
          nonconformingSkipped++
          continue
        }

        const searchResults = vectorStore.search(entry.embedding, 10)

        for (const match of searchResults) {
          if (match.id === memory.id) continue
          if (match.score < opts.mergeThreshold) continue
          if (deleteSet.has(match.id)) continue
          if (mergeSourceSet.has(match.id)) continue

          const matchMemory = memoryMap.get(match.id)
          if (!matchMemory) continue

          // Episodic date guard (mirrors the write-side memory gate): two
          // memories of the same activity on occasions > 7 days apart are
          // distinct events — never merge them, however similar the prose.
          if (occasionsAreDistinct(memory.occurredAt, matchMemory.occurredAt)) continue

          const keepCurrent =
            memory.importance > matchMemory.importance ||
            (memory.importance === matchMemory.importance &&
              new Date(memory.createdAt) > new Date(matchMemory.createdAt))

          if (keepCurrent) {
            memoriesToMerge.push({
              sourceId: matchMemory.id,
              targetId: memory.id,
            })
            mergeSourceSet.add(matchMemory.id)
            deleteSet.add(matchMemory.id)
            result.details.push({
              memoryId: matchMemory.id,
              action: 'merged',
              reason: `Similar to memory ${memory.id} (${(match.score * 100).toFixed(0)}% similarity)`,
              summary: matchMemory.summary,
            })
          } else {
            memoriesToMerge.push({
              sourceId: memory.id,
              targetId: matchMemory.id,
            })
            mergeSourceSet.add(memory.id)
            deleteSet.add(memory.id)
            result.details.push({
              memoryId: memory.id,
              action: 'merged',
              reason: `Similar to memory ${matchMemory.id} (${(match.score * 100).toFixed(0)}% similarity)`,
              summary: memory.summary,
            })
            break
          }
        }

        if ((i + 1) % YIELD_INTERVAL === 0) {
          await yieldTick()
        }
      }

      if (nonconformingSkipped > 0) {
        logger.info('[Housekeeping] Skipped non-conforming vectors in merge pass — awaiting re-embed', {
          characterId,
          nonconformingSkipped,
          storeDimensions,
        })
      }
    } catch (error) {
      logger.warn('[Housekeeping] Failed to run similarity merge pass', { characterId, error: String(error) })
    }
  }

  // Third pass: enforce hard cap if still over limit.
  //
  // If every remaining memory is protected, the deletion loop below would
  // skip every candidate and score + sort 19k entries for nothing. Do a
  // cheap pre-check first: when no unprotected-and-undeleted memory exists,
  // skip the entire scoring pass.
  const remainingAfterDeletion = memories.filter(m => !deleteSet.has(m.id))
  const hasDeletionCandidate =
    remainingAfterDeletion.length > opts.maxMemories &&
    remainingAfterDeletion.some(m => !(protectedMap.get(m.id) ?? isProtectedMemory(m, now)))
  if (hasDeletionCandidate) {
    const scoredMemories = remainingAfterDeletion.map(m => {
      const { effectiveWeight } = calculateEffectiveWeight(m, undefined, now)
      return { memory: m, score: effectiveWeight }
    })

    scoredMemories.sort((a, b) => b.score - a.score)

    const excessCount = remainingAfterDeletion.length - opts.maxMemories
    let deletedForLimit = 0
    let iterations = 0

    for (let i = scoredMemories.length - 1; i >= 0 && deletedForLimit < excessCount; i--) {
      const { memory } = scoredMemories[i]

      if (deleteSet.has(memory.id)) continue
      // Reuse protection result from pass 1 instead of recomputing.
      const isProtected = protectedMap.get(memory.id) ?? isProtectedMemory(memory, now)
      if (isProtected) continue

      deleteSet.add(memory.id)
      result.details.push({
        memoryId: memory.id,
        action: 'deleted',
        reason: `Exceeded memory limit (${opts.maxMemories})`,
        summary: memory.summary,
      })
      deletedForLimit++
      iterations++

      if (iterations % YIELD_INTERVAL === 0) {
        await yieldTick()
      }
    }
  }

  const deletedIds = Array.from(deleteSet)

  if (!opts.dryRun && deletedIds.length > 0) {
    const deletedCount = await deleteMemoriesWithUnlinkBatch(deletedIds)

    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const id of deletedIds) {
        await vectorStore.removeVector(id)
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn(`[Housekeeping] Failed to clean up vector store`, { characterId, error: String(error) })
    }

    result.deleted = deletedCount
    result.merged = memoriesToMerge.length
    result.deletedIds = deletedIds
    result.mergedIds = memoriesToMerge.map(m => m.sourceId)
  } else if (opts.dryRun) {
    result.deleted = deletedIds.length
    result.merged = memoriesToMerge.length
    result.deletedIds = deletedIds
    result.mergedIds = memoriesToMerge.map(m => m.sourceId)
  }

  result.kept = totalBefore - deletedIds.length
  result.totalAfter = result.kept

  return result
}

/**
 * Get housekeeping statistics for a character without making changes
 */
export async function getHousekeepingPreview(
  characterId: string,
  options: HousekeepingOptions = {}
): Promise<HousekeepingResult> {
  return runHousekeeping(characterId, { ...options, dryRun: true })
}

/**
 * Check if housekeeping is needed for a character
 *
 * Returns true if:
 * - Memory count exceeds 80% of the limit
 * - There are memories matching deletion criteria
 */
export async function needsHousekeeping(
  characterId: string,
  options: Omit<HousekeepingOptions, 'dryRun'> = {}
): Promise<boolean> {
  const repos = getRepositories()
  const maxMemories = options.maxMemories ?? DEFAULT_OPTIONS.maxMemories

  // Quick check: memory count
  const count = await repos.memories.countByCharacterId(characterId)
  if (count >= maxMemories * 0.8) {
    return true
  }

  // More thorough check: preview housekeeping
  if (count > 0) {
    const preview = await getHousekeepingPreview(characterId, options)
    return preview.deleted > 0
  }

  return false
}
