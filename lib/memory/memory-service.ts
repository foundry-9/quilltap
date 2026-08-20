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
import {
  applyLiteralBoost,
  containsLiteralPhrase,
  getLiteralPhrase,
} from '@/lib/embedding/literal-boost'
import { getCharacterVectorStore, getVectorStoreManager } from '@/lib/embedding/vector-store'
import { logger } from '@/lib/logger'
import {
  runMemoryGate,
  reinforceMemory,
  linkRelatedMemories,
  calculateReinforcedImportance,
  deleteMemoryWithUnlink,
  deleteMemoriesWithUnlinkBatch,
  extractNovelDetails,
} from './memory-gate'
import {
  calculateEffectiveWeight,
  computeRankingBlend,
  defaultMinCosineForProvider,
} from './memory-weighting'
import { combineRecallMultipliers, RELATED_EXPANSION, type RecallContext } from './recall-tags'
import { buildMemoryEmbeddingText, resolveWhenPhrase, type EpisodicAnchorView } from './episodic'
import { shouldSkipWatermarkSweep } from './housekeeping-outcome-cache'
import type { MemoryGateOutcome } from './memory-gate'
import { resolveAboutCharacterId } from './about-character-resolution'
export type { MemoryGateOutcome } from './memory-gate'

/** Fraction of the per-character cap at which auto-housekeeping engages. */
const HOUSEKEEPING_WATERMARK = 0.9

/**
 * Minimum gap between watermark-triggered housekeeping sweeps for a single
 * character, enforced durably via the background-jobs table so it survives
 * restarts and holds across the forked-child job pool. Prevents a room sitting
 * at its cap from kicking off an (often expensive) sweep on every turn. The
 * daily scheduled sweep is unaffected.
 */
const WATERMARK_SWEEP_THROTTLE_MS = 15 * 60 * 1000 // 15 minutes

/**
 * If auto-housekeeping is enabled for this user and the character has reached
 * the watermark fraction of its cap, enqueue a housekeeping job for that
 * character. The enqueue helper dedupes against in-flight jobs, so calling
 * this after every insert is safe even during high-frequency extraction.
 *
 * Never throws — a failure here must not block the memory write that just
 * succeeded.
 */
async function maybeEnqueueHousekeeping(characterId: string, userId: string): Promise<void> {
  try {
    const repos = getRepositories()
    const chatSettings = await repos.chatSettings.findByUserId(userId)
    const autoSettings = chatSettings?.autoHousekeepingSettings
    if (!autoSettings?.enabled) {
      return
    }

    const cap =
      autoSettings.perCharacterCapOverrides?.[characterId] ??
      autoSettings.perCharacterCap ??
      2000

    const count = await repos.memories.countByCharacterId(characterId)
    if (count < Math.floor(cap * HOUSEKEEPING_WATERMARK)) {
      return
    }

    // When the previous sweep for this character deleted nothing, it's very
    // likely the next watermark-triggered sweep will also delete nothing —
    // the protection score just said everything was worth keeping, and
    // ~6 extra memories per chat turn won't flip that verdict. Running the
    // sweep anyway burns 10–15 minutes of main-thread time for no benefit
    // and blocks the next chat turn's context build. Back off for an hour.
    if (shouldSkipWatermarkSweep(characterId)) {
      return
    }

    // Durable cross-process / post-restart throttle. The in-memory cache above
    // is process-local, but watermark enqueues fire from forked job children
    // (memory extraction) while sweeps complete in *other* children — so that
    // signal is frequently invisible across the pool, and it's wiped on every
    // restart. The result is a storm of redundant (often expensive, because
    // mergeSimilar compares embeddings) sweeps when a room sits right at its
    // cap. Back it with a DB floor: if a sweep for this character already
    // completed or is running within the throttle window, don't pile on
    // another. The daily scheduled sweep still handles deep cleaning.
    const recentHousekeeping = await repos.backgroundJobs.findRecentByType(
      'MEMORY_HOUSEKEEPING',
      50,
    )
    const nowMs = Date.now()
    const throttledByRecentSweep = recentHousekeeping.some(j => {
      const jobCharId = (j.payload as Record<string, unknown> | undefined)?.characterId
      if (jobCharId !== characterId) return false
      if (j.status !== 'COMPLETED' && j.status !== 'PROCESSING') return false
      const ts = j.updatedAt ? new Date(j.updatedAt).getTime() : 0
      return nowMs - ts < WATERMARK_SWEEP_THROTTLE_MS
    })
    if (throttledByRecentSweep) {
      logger.debug('[Housekeeping] Skipping watermark sweep — recent sweep within throttle window', {
        characterId,
        throttleMs: WATERMARK_SWEEP_THROTTLE_MS,
      })
      return
    }

    const { enqueueMemoryHousekeeping } = await import('@/lib/background-jobs/queue-service')
    await enqueueMemoryHousekeeping(userId, {
      characterId,
      reason: 'watermark',
    })
  } catch (error) {
    logger.warn('[Housekeeping] Failed watermark check after insert (non-fatal)', {
      userId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * If the caller supplied an aboutCharacterId that points to someone other
 * than the holder, verify that character's name or aliases actually appears
 * in the memory text. If not, collapse aboutCharacterId to the holder so the
 * memory is recorded as self-referential. Manual creations and inter-character
 * memories where the subject is named in the text pass through unchanged.
 */
async function applyNamePresenceCheck(data: CreateMemoryOptions): Promise<CreateMemoryOptions> {
  const proposed = data.aboutCharacterId
  if (!proposed || proposed === data.characterId) {
    return data
  }
  // Only second-guess AUTO-extracted attributions; MANUAL memories carry the
  // user's deliberate choice of about-target and should pass through unchanged.
  if (data.source && data.source !== 'AUTO') {
    return data
  }
  try {
    const repos = getRepositories()
    const [aboutChar, holderChar] = await Promise.all([
      repos.characters.findById(proposed),
      repos.characters.findById(data.characterId),
    ])
    const text = `${data.summary || ''}\n${data.content || ''}`
    const resolution = resolveAboutCharacterId({
      holderCharacterId: data.characterId,
      holderCharacter: holderChar ? { name: holderChar.name, aliases: holderChar.aliases } : null,
      proposedAboutCharacterId: proposed,
      proposedAboutCharacter: aboutChar
        ? { name: aboutChar.name, aliases: aboutChar.aliases, controlledBy: aboutChar.controlledBy }
        : null,
      text,
    })
    if (resolution.flipped) {
      return { ...data, aboutCharacterId: data.characterId }
    }
    return data
  } catch (error) {
    // Never block a memory write on the safety-net lookup
    logger.warn('[Memory] Name-presence check failed; using proposed aboutCharacterId unchanged', {
      holderCharacterId: data.characterId,
      proposedAboutCharacterId: proposed,
      error: error instanceof Error ? error.message : String(error),
    })
    return data
  }
}

/** Cap on regex-derived fallback entities so noise can't flood the column. */
const FALLBACK_ANCHOR_MAX_ENTITIES = 6

/**
 * Episodic safety net for AUTO-extracted memories: when the extractor omitted
 * `entities` and/or `occurredAt`, derive them deterministically from the memory
 * text via the same date/proper-noun regexes reinforcement uses
 * ({@link extractNovelDetails}), resolving any captured date phrase against the
 * source-message timestamp (or the write clock). Fills gaps only — a
 * caller-supplied anchor always wins — and MANUAL memories pass through
 * untouched (they carry the user's deliberate choices).
 */
function applyEpisodicFallbackAnchors(data: CreateMemoryOptions): CreateMemoryOptions {
  if (data.source && data.source !== 'AUTO') return data
  const needEntities = !data.entities || data.entities.length === 0
  const needOccurredAt = !data.occurredAt
  if (!needEntities && !needOccurredAt) return data

  try {
    const details = extractNovelDetails(data.content || '', '')
    const next = { ...data }

    if (needOccurredAt) {
      const anchorIso = data.sourceMessageTimestamp ?? new Date().toISOString()
      for (const detail of details) {
        const resolved = resolveWhenPhrase(detail, anchorIso)
        if (resolved) {
          next.occurredAt = resolved
          break
        }
      }
    }

    if (needEntities) {
      // Proper-noun-shaped details only (skip the date/number/measure captures).
      const entities = details
        .filter(d => /^[A-Z]/.test(d) && !/\d/.test(d))
        .slice(0, FALLBACK_ANCHOR_MAX_ENTITIES)
      if (entities.length > 0) {
        next.entities = entities
      }
    }

    return next
  } catch {
    // Deterministic fallback must never block a write.
    return data
  }
}

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
  /** Character ID this memory is about (for inter-character memories) */
  aboutCharacterId?: string | null
  /** Source chat ID */
  chatId?: string | null
  /**
   * Project the source chat belongs to, when any. Persisted on the memory so
   * recall-time scope (`scope: narrow`) comparisons have a rename-proof,
   * collision-proof key. Null for project-less chats and manual entries.
   */
  projectId?: string | null
  /** How the memory was created */
  source?: 'AUTO' | 'MANUAL'
  /** Source message ID for auto-created memories */
  sourceMessageId?: string | null
  /** Override createdAt/updatedAt with source message timestamp (for batch extraction) */
  sourceMessageTimestamp?: string
  /**
   * Provenance of the conversational moment that produced this memory (4.6
   * Private Character Rooms). 'user_present' for chats with a user opener,
   * 'autonomous_room' for autonomous character-to-character chats, 'manual'
   * for memories created outside the extraction path. Null is treated as
   * legacy (pre-4.6) and left unset.
   */
  witnessedContext?: 'user_present' | 'autonomous_room' | 'manual' | null
  // ── Episodic spine ─────────────────────────────────────────────────────────
  /** ISO wall-clock EVENT time (not the write clock). Callers stamp it from
   * the source turn's message timestamp; retold events resolve their `when`
   * phrase server-side before reaching here. */
  occurredAt?: string | null
  /** Free-text in-story time, for chats on a fictional timeline. */
  narrativeTime?: string | null
  /** Proper nouns of the episode (places, people, named things). */
  entities?: string[]
  /** Declared memory kind. Defaults to 'semantic'. */
  kind?: 'semantic' | 'episodic'
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
  /** Skip the Memory Gate check (force-insert without similarity check) */
  skipGate?: boolean
}

/**
 * A query and the vector actually embedded for it. Handed back through
 * `captureQueryEmbedding` so one turn's embedding can serve more than one
 * search (memories, then the character's vault conversation summaries).
 */
export interface SearchQueryEmbedding {
  /** The exact text that was embedded — pass it verbatim to the reusing search. */
  query: string
  /** Unit-length vector for `query`, from the caller's embedding profile. */
  embedding: Float32Array
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
  /** Effective weight combining importance with time decay (0-1), floored for
   * housekeeping protection. Used for diagnostics, NOT for ranking. */
  effectiveWeight?: number
  /** No-floor ranking weight (baseImportance × time decay). This is what the
   * retrieval blend uses so a stale "important" memory decays out of recall —
   * see {@link computeRankingBlend}. */
  rawWeight?: number
  /**
   * Recall-context adjustment record — present only when a `recallContext` was
   * supplied to `searchMemoriesSemantic`. Lets the injector show *why* a memory
   * ranked where it did and lets tests assert on the post-adjustment ordering.
   */
  recallAdjustment?: {
    /** Combined, clamped multiplier applied to the blended score. */
    multiplier: number
    /** Short labels for the adjustments that fired (e.g. `narrow✓`, `past↓`). */
    fired: string[]
    /** Blended ranking score (see computeRankingBlend) before the multiplier. */
    blendedBefore: number
    /** Blended score after the multiplier (the value actually sorted on). */
    blendedAfter: number
  }
}

/**
 * Create a memory with optional embedding generation
 *
 * This is the primary function for creating memories. It:
 * 1. Runs the Memory Gate to check for duplicates/related memories (unless skipGate)
 * 2. Based on gate decision: REINFORCE, INSERT_RELATED, INSERT, SKIP_NEAR_DUPLICATE,
 *    or SKIP_EMBEDDING_FAILED
 * 3. Generates embedding and adds to vector store
 *
 * Returns the resulting memory — for SKIP_NEAR_DUPLICATE this is the existing
 * memory the candidate collapsed into. Returns null on SKIP_EMBEDDING_FAILED
 * (no row was written because generating an embedding for dedup failed).
 */
export async function createMemoryWithEmbedding(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<Memory | null> {
  const outcome = await createMemoryWithGate(data, options)
  return outcome.memory
}

/**
 * Create a memory with gate decision info.
 *
 * Returns full gate outcome (action taken, novel details, related IDs)
 * for callers that need gate action info (e.g., memory-processor).
 */
export async function createMemoryWithGate(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<MemoryGateOutcome> {
  const repos = getRepositories()

  // Name-presence safety net: if the caller proposes a non-self aboutCharacterId
  // but that character's name (or aliases, or generic user aliases for user-
  // controlled characters) doesn't appear in the memory text, the LLM almost
  // certainly mis-attributed. Collapse to a self-reference on the holder.
  data = await applyNamePresenceCheck(data)

  // Episodic safety net: run the deterministic date/proper-noun regexes on
  // FIRST WRITE (not just reinforce) so entities/occurredAt get populated even
  // when the extractor model omits them. Only fills gaps — never overrides a
  // caller-supplied anchor.
  data = applyEpisodicFallbackAnchors(data)

  const anchors: EpisodicAnchorView = {
    occurredAt: data.occurredAt ?? null,
    narrativeTime: data.narrativeTime ?? null,
    entities: data.entities ?? [],
  }

  // If gate or embedding is skipped, use the direct creation flow
  if (options.skipGate || options.skipEmbedding) {
    const memory = await createMemoryDirect(data, options)
    return { memory, action: 'SKIP_GATE' }
  }

  // Run the Memory Gate — generate embedding first, then decide. The
  // candidate's episodic anchors ride along so (a) the gate embedding carries
  // the anchor line and (b) the >7-day date guard can split distinct occasions.
  const gateResult = await runMemoryGate(
    data.characterId,
    data.content,
    data.summary,
    data.keywords || [],
    options.userId,
    options.embeddingProfileId,
    anchors
  )


  const { decision, embedding } = gateResult

  switch (decision.action) {
    case 'SKIP_NEAR_DUPLICATE': {
      // Candidate is essentially identical to an existing memory; do not write
      // a new row and do not reinforce — just absorb the observation silently.
      return {
        memory: decision.existingMemory,
        action: 'SKIP_NEAR_DUPLICATE',
        similarity: decision.similarity,
      }
    }

    case 'SKIP_EMBEDDING_FAILED': {
      // Embedding generation failed after retry; do not insert a row without
      // an embedding (that would be invisible to every future gate check).
      return {
        memory: null,
        action: 'SKIP_EMBEDDING_FAILED',
        reason: decision.reason,
      }
    }

    case 'REINFORCE': {
      // Boost the existing memory instead of creating a new row. The
      // candidate's anchors ride along so a retelling that supplies better
      // when/where anchors than the original capture can upgrade the row.
      const { memory: reinforced, novelDetails } = await reinforceMemory(
        decision.existingMemory,
        data.content,
        data.summary,
        options.userId,
        options.embeddingProfileId,
        anchors
      )
      return {
        memory: reinforced,
        action: 'REINFORCE',
        novelDetails,
      }
    }

    case 'INSERT_RELATED': {
      // Create new memory, then bidirectionally link
      const memory = await createMemoryDirectWithEmbedding(data, options, embedding)
      const linkedIds = await linkRelatedMemories(
        memory.id,
        data.characterId,
        decision.relatedMemories
      )
      // Return the POST-LINK row. `createMemoryDirectWithEmbedding` persisted the
      // memory with `relatedMemoryIds: []`, then `linkRelatedMemories` wrote
      // `linkedIds` onto that row — but the in-memory `memory` object still holds
      // the stale empty array. Downstream callers that union `memory.relatedMemoryIds`
      // (the fold-episode pass) would otherwise start from [] and clobber the
      // gate's links (Bug 26). Reflect the persisted state here.
      // Fire-and-forget watermark check. Never awaited — never blocks the write.
      void maybeEnqueueHousekeeping(data.characterId, options.userId)
      return {
        memory: { ...memory, relatedMemoryIds: linkedIds },
        action: 'INSERT_RELATED',
        relatedMemoryIds: linkedIds,
      }
    }

    case 'INSERT':
    default: {
      // Straightforward insert with pre-computed embedding
      const memory = await createMemoryDirectWithEmbedding(data, options, embedding)
      void maybeEnqueueHousekeeping(data.characterId, options.userId)
      return { memory, action: 'INSERT' }
    }
  }
}

/**
 * Direct memory creation without gate (original flow).
 * Used when skipGate or skipEmbedding is true.
 */
async function createMemoryDirect(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<Memory> {
  const repos = getRepositories()
  const importance = data.importance ?? 0.5

  // Build create options for timestamp override (batch extraction)
  const createOpts = data.sourceMessageTimestamp
    ? { createdAt: data.sourceMessageTimestamp, updatedAt: data.sourceMessageTimestamp }
    : undefined

  const memory = await repos.memories.create({
    characterId: data.characterId,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords || [],
    tags: data.tags || [],
    importance,
    aboutCharacterId: data.aboutCharacterId || null,
    chatId: data.chatId || null,
    projectId: data.projectId ?? null,
    source: data.source || 'MANUAL',
    sourceMessageId: data.sourceMessageId || null,
    witnessedContext: data.witnessedContext ?? null,
    occurredAt: data.occurredAt ?? null,
    narrativeTime: data.narrativeTime ?? null,
    entities: data.entities ?? [],
    kind: data.kind ?? 'semantic',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
  }, createOpts)

  if (options.skipEmbedding) {
    return memory
  }

  // Generate embedding (anchor line included so the vector carries when/where)
  try {
    const embeddingResult = await generateEmbeddingForUser(
      buildMemoryEmbeddingText(data.summary, data.content, data),
      options.userId,
      options.embeddingProfileId,
      { priority: 'background' }
    )

    const updatedMemory = await repos.memories.updateForCharacter(
      data.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    )

    const vectorStore = await getCharacterVectorStore(data.characterId)
    await vectorStore.addVector(memory.id, embeddingResult.embedding, {
      memoryId: memory.id,
      characterId: data.characterId,
    })
    await vectorStore.save()

    return updatedMemory || memory
  } catch (error) {
    if (error instanceof EmbeddingError) {
      logger.warn(`[Memory] Embedding generation failed for memory ${memory.id}: ${error.message}`, { characterId: data.characterId, userId: options.userId })
    } else {
      logger.warn(`[Memory] Unexpected error generating embedding for memory ${memory.id}`, { characterId: data.characterId, userId: options.userId, error: String(error) })
    }
    return memory
  }
}

/**
 * Create a memory and store a pre-computed embedding (from gate).
 * Avoids regenerating the embedding when the gate already computed it.
 */
async function createMemoryDirectWithEmbedding(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions,
  embedding: Float32Array | null
): Promise<Memory> {
  const repos = getRepositories()
  const importance = data.importance ?? 0.5

  // Build create options for timestamp override (batch extraction)
  const createOpts = data.sourceMessageTimestamp
    ? { createdAt: data.sourceMessageTimestamp, updatedAt: data.sourceMessageTimestamp }
    : undefined

  const memory = await repos.memories.create({
    characterId: data.characterId,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords || [],
    tags: data.tags || [],
    importance,
    aboutCharacterId: data.aboutCharacterId || null,
    chatId: data.chatId || null,
    projectId: data.projectId ?? null,
    source: data.source || 'MANUAL',
    sourceMessageId: data.sourceMessageId || null,
    witnessedContext: data.witnessedContext ?? null,
    occurredAt: data.occurredAt ?? null,
    narrativeTime: data.narrativeTime ?? null,
    entities: data.entities ?? [],
    kind: data.kind ?? 'semantic',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
  }, createOpts)

  if (embedding) {
    // Use the pre-computed embedding from the gate
    const updatedMemory = await repos.memories.updateForCharacter(
      data.characterId,
      memory.id,
      { embedding }
    )

    const vectorStore = await getCharacterVectorStore(data.characterId)
    await vectorStore.addVector(memory.id, embedding, {
      memoryId: memory.id,
      characterId: data.characterId,
    })
    await vectorStore.save()

    return updatedMemory || memory
  }

  return memory
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

  // Check if content changed (requires re-embedding). Anchor-field changes
  // count too — the anchor line is part of the embedded text.
  const contentChanged =
    (data.content && data.content !== existingMemory.content) ||
    (data.summary && data.summary !== existingMemory.summary) ||
    (data.occurredAt !== undefined && data.occurredAt !== existingMemory.occurredAt) ||
    (data.narrativeTime !== undefined && data.narrativeTime !== existingMemory.narrativeTime) ||
    (data.entities !== undefined &&
      JSON.stringify(data.entities) !== JSON.stringify(existingMemory.entities ?? []))

  // Update the memory
  const updatedMemory = await repos.memories.updateForCharacter(characterId, memoryId, data)
  if (!updatedMemory) {
    return null
  }

  // Regenerate embedding if content changed
  if (contentChanged && !options.skipEmbedding) {
    try {
      const embeddingResult = await generateEmbeddingForUser(
        buildMemoryEmbeddingText(updatedMemory.summary, updatedMemory.content, updatedMemory),
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

  // Confirm ownership before going through the chokepoint, which is
  // characterId-agnostic.
  const existing = await repos.memories.findById(memoryId)
  if (!existing || existing.characterId !== characterId) {
    return false
  }

  const deleted = await deleteMemoryWithUnlink(memoryId)
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
 * One-time-per-key throttle for the embedding dimension-mismatch warning. When a
 * character's stored vector index was built with a different embedding profile
 * than the one now searching, vector search silently returns nothing and we fall
 * back to text search — a badly degraded relevance path. We surface this loudly
 * (warn level, actionable) but only once per (character, dimension pair) so it is
 * not buried under per-turn spam. Keyed by `${characterId}:${stored}->${query}`.
 */
const dimensionMismatchWarned = new Set<string>()

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
    /**
     * When true and the trimmed query is ≥ LITERAL_BOOST_MIN_PHRASE_LENGTH,
     * memories whose content or summary contains the query verbatim
     * (case-insensitive) are unioned into the vector-store top-K candidate
     * pool — their embeddings are explicitly scored against the query if
     * they weren't already in the pool — and their cosine score is boosted
     * halfway to 1.0 BEFORE the importance/recency blend. Used by the
     * unified `search` tool; per-turn injectors leave this off.
     */
    applyLiteralPhraseBoost?: boolean
    /**
     * Per-turn recall context. When supplied, the targeting tags
     * (`temporal`/`scope`/`context`) and `projectId` carried on each candidate
     * are read back and turned into bounded, clamped multipliers applied to the
     * final blended score *after* the ranking blend is computed (see
     * `lib/memory/recall-tags.ts`). Absent → ranking is byte-identical to the
     * historical behavior. The `search` tool and tests leave this off.
     */
    recallContext?: RecallContext
    /**
     * Restrict results to memories the searching character holds *about* this
     * other character (`memory.aboutCharacterId === aboutCharacterId`). Used by
     * the per-turn inter-character recall to fill the "relevant about them" half
     * alongside the importance/recency half. Absent → no inter-character filter.
     */
    aboutCharacterId?: string
    /**
     * Event-time window (episodic recall). Two-stage on the injector path
     * (a `recallContext` is present): candidates are filtered to the window
     * first; if fewer than `limit` survive, fall back to the unfiltered pool
     * with window hits taking the bounded ×`occurredWithinWindow` boost in
     * the multiplier loop — never fewer results than an unwindowed search.
     * Without a `recallContext` (tool path), this is a plain hard filter.
     */
    occurredWithin?: { from: string; to: string } | null
    /**
     * Entity strings (place/person/thing names) unioned into the candidate
     * pool via the literal `searchByContent` path, so a verbatim place name
     * cannot be sliced off by the cosine floor. Injector-path companion to
     * `applyLiteralPhraseBoost` (which stays tool-only).
     */
    entityAnchors?: readonly string[]
    /**
     * Additional embedding probes (retrospective turns only): each is
     * embedded, its vector-store pool unioned with the main query's, and each
     * memory keeps its max cosine across probes. Capped to 2 extras.
     */
    extraProbes?: readonly string[]
    /**
     * Called with the main query's vector the moment it is embedded (never for
     * the `extraProbes`, and never on the text-search fallback). Lets a caller
     * reuse the turn's one embedding for a companion search — the per-turn
     * conversation-summary list in `lib/chat/context-manager.ts` — rather than
     * paying for a second call on the same sentence. A callback that throws is
     * caught and logged; the search itself carries on.
     */
    captureQueryEmbedding?: (captured: SearchQueryEmbedding) => void
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20
  // The relevance floor is resolved per embedding profile *after* the query is
  // embedded (neural vs TF-IDF cosines distribute very differently). An explicit
  // caller-supplied floor always wins; `undefined` → the provider default. Note
  // we use `??` not `||` so an explicit `0` (caller wants no floor) is honored.
  const explicitMinScore = options.minScore

  // Timing markers — left in at debug level so we can see which stage of a
  // semantic search is slow on big-corpus characters without having to
  // re-instrument after every performance change.
  const t0 = performance.now()

  // Try semantic search first
  try {
    const embeddingResult = await generateEmbeddingForUser(
      query,
      options.userId,
      options.embeddingProfileId
    )
    const tEmbed = performance.now()

    // Hand the caller the vector we just paid for, so a companion search in the
    // same turn (the per-turn conversation-summary list) can reuse it instead of
    // embedding the same sentence twice. Reported before the dimension guard
    // below: a vector that doesn't match THIS character's memory index may still
    // match the vault's document index, which is built separately.
    if (options.captureQueryEmbedding) {
      try {
        options.captureQueryEmbedding({ query, embedding: embeddingResult.embedding })
      } catch (captureError) {
        // A companion search's bookkeeping must never cost the caller its
        // memories — swallow and carry on with the search itself.
        logger.warn('[Memory] captureQueryEmbedding callback threw; ignoring', {
          characterId,
          error: captureError instanceof Error ? captureError.message : String(captureError),
        })
      }
    }

    // Relevance floor on the raw cosine, applied before the importance/recency
    // blend so a low-cosine memory can't be smuggled into recall by its weight.
    // Profile-aware: a single global floor would silently break either the
    // neural or the TF-IDF scale.
    const minScore = explicitMinScore ?? defaultMinCosineForProvider(embeddingResult.provider)

    const vectorStore = await getCharacterVectorStore(characterId)
    const storedDimensions = vectorStore.getDimensions()

    // Check for dimension mismatch before searching — if the search embedding
    // profile differs from the one used to build the index, vector search will
    // return nothing. Fall back to text search immediately rather than silently
    // returning empty results.
    if (storedDimensions !== null && embeddingResult.embedding.length !== storedDimensions) {
      const warnKey = `${characterId}:${storedDimensions}->${embeddingResult.embedding.length}`
      if (!dimensionMismatchWarned.has(warnKey)) {
        dimensionMismatchWarned.add(warnKey)
        // Surfaced once per (character, dimension pair): this is a degraded
        // relevance state, not a normal fallback. Memory recall is running on
        // keyword text search, NOT embeddings — reindex this character's
        // embeddings or switch back to the profile the index was built with.
        logger.warn('[Memory] Embedding dimension mismatch — recall is degraded to TEXT search (embeddings ignored). Reindex this character or restore the matching embedding profile.', {
          characterId,
          query: query.substring(0, 100),
          storedDimensions,
          queryDimensions: embeddingResult.embedding.length,
          userId: options.userId,
          embeddingProfileId: options.embeddingProfileId ?? 'default',
          provider: embeddingResult.provider,
        })
      }
      return searchMemoriesText(characterId, query, options)
    }

    // Search vectors
    let vectorResults = vectorStore.search(
      embeddingResult.embedding,
      limit * 3 // Get more results to filter
    )

    // Multi-probe union (retrospective turns): embed each extra probe, union
    // its top-K pool with the main query's, keep each memory's max cosine.
    // Bounded cost (≤ 2 extra embeddings), gated to the turns that need it.
    const extraProbes = (options.extraProbes ?? [])
      .map(p => p?.trim())
      .filter((p): p is string => !!p && p.length > 0)
      .slice(0, 2)
    if (extraProbes.length > 0) {
      const byId = new Map(vectorResults.map(vr => [vr.id, vr]))
      for (const probe of extraProbes) {
        try {
          const probeResult = await generateEmbeddingForUser(
            probe,
            options.userId,
            options.embeddingProfileId
          )
          if (probeResult.embedding.length !== embeddingResult.embedding.length) continue
          for (const vr of vectorStore.search(probeResult.embedding, limit * 3)) {
            const existing = byId.get(vr.id)
            if (!existing || vr.score > existing.score) {
              byId.set(vr.id, vr)
            }
          }
        } catch (probeError) {
          logger.debug('[Memory] Extra probe embedding failed; skipping probe', {
            characterId,
            probe: probe.substring(0, 80),
            error: probeError instanceof Error ? probeError.message : String(probeError),
          })
        }
      }
      vectorResults = [...byId.values()]
    }
    const tVector = performance.now()

    // Hybrid step: union literal text hits into the candidate pool.
    // searchByContent runs case-insensitive regex match against
    // content+summary, so this captures all direct hits regardless of where
    // they ranked in the vector top-K — a buried exact match cannot stay
    // buried because the vector store's candidate cap excluded it. Two
    // sources of literal phrases: the whole query (tool path,
    // `applyLiteralPhraseBoost`) and the turn's entity anchors (injector
    // path) — a verbatim place name must not be sliced off by the cosine floor.
    const literalPhrase = options.applyLiteralPhraseBoost
      ? getLiteralPhrase(query)
      : null
    const anchorPhrases: string[] = []
    if (literalPhrase) {
      anchorPhrases.push(query.trim())
    }
    for (const entity of (options.entityAnchors ?? []).slice(0, 3)) {
      const trimmed = entity?.trim()
      if (trimmed && trimmed.length >= 2) {
        anchorPhrases.push(trimmed)
      }
    }
    const literalHitIds = new Set<string>()
    let augmentedVectorResults = vectorResults

    if (anchorPhrases.length > 0) {
      const directHitMemories: Memory[] = []
      const directSeen = new Set<string>()
      for (const phrase of anchorPhrases) {
        const hits = await repos.memories.searchByContent(characterId, phrase)
        for (const m of hits) {
          literalHitIds.add(m.id)
          if (!directSeen.has(m.id)) {
            directSeen.add(m.id)
            directHitMemories.push(m)
          }
        }
      }
      const inVectorPool = new Set(vectorResults.map(vr => vr.id))
      const missingDirectHits = directHitMemories.filter(
        m => !inVectorPool.has(m.id),
      )
      if (missingDirectHits.length > 0) {
        const extras: typeof vectorResults = []
        for (const memory of missingDirectHits) {
          if (
            memory.embedding &&
            memory.embedding.length === embeddingResult.embedding.length
          ) {
            const score = cosineSimilarity(embeddingResult.embedding, memory.embedding)
            extras.push({
              id: memory.id,
              score,
              metadata: { memoryId: memory.id, characterId },
            })
          }
        }
        if (extras.length > 0) {
          augmentedVectorResults = [...vectorResults, ...extras]
        }
      }
    }

    if (augmentedVectorResults.length > 0) {
      // Hydrate only the matched memories. The previous version called
      // findByCharacterId here, which decrypted and Zod-validated the whole
      // corpus (20k+ rows on heavy characters) just to pluck ~60 hits out of
      // a Map. The Memory Gate read path already uses this shape — see
      // lib/memory/memory-gate.ts findByIds(matchedIds).
      const matchedIds = augmentedVectorResults.map(vr => vr.id)
      const memories = await repos.memories.findByIds(matchedIds)
      const memoryMap = new Map(memories.map(m => [m.id, m]))

      let results: SemanticSearchResult[] = augmentedVectorResults
        .map(vr => {
          const memory = memoryMap.get(vr.id)
          if (!memory) return null
          // Boost the cosine score (BEFORE the importance/recency blend) for
          // any memory that scored a literal-phrase hit. We re-check the body
          // here on top of literalHitIds so memories already in the vector
          // pool also get the boost without an extra DB roundtrip.
          const literalHit = literalPhrase
            ? literalHitIds.has(memory.id) ||
              containsLiteralPhrase(memory.content, literalPhrase) ||
              containsLiteralPhrase(memory.summary, literalPhrase)
            : false
          const cosineScore = literalHit ? applyLiteralBoost(vr.score) : vr.score
          const { effectiveWeight, rawWeight } = calculateEffectiveWeight(memory)
          return {
            memory,
            score: cosineScore,
            usedEmbedding: true,
            effectiveWeight,
            rawWeight,
          } as SemanticSearchResult
        })
        .filter((r): r is SemanticSearchResult => r !== null)
        .filter(r => r.score >= minScore)

      // Apply additional filters
      if (options.minImportance !== undefined) {
        results = results.filter(r => r.memory.importance >= options.minImportance!)
      }
      if (options.source) {
        results = results.filter(r => r.memory.source === options.source)
      }
      if (options.aboutCharacterId) {
        results = results.filter(r => r.memory.aboutCharacterId === options.aboutCharacterId)
      }

      // Event-time window (episodic recall) — two-stage on the injector path:
      // filter to the window first; if fewer than `limit` survive, fall back
      // to the unfiltered pool and let window hits take the bounded
      // ×occurredWithinWindow boost inside the one multiplier loop instead.
      // Never fewer results than an unwindowed search. Tool path (no
      // recallContext): a plain hard filter — the caller asked for a window.
      let effectiveRecallContext = options.recallContext
      if (options.occurredWithin) {
        const from = Date.parse(options.occurredWithin.from)
        const to = Date.parse(options.occurredWithin.to)
        if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
          const inWindow = (r: SemanticSearchResult): boolean => {
            const t = Date.parse(r.memory.occurredAt ?? r.memory.createdAt)
            return Number.isFinite(t) && t >= from && t <= to
          }
          const windowHits = results.filter(inWindow)
          if (!options.recallContext) {
            results = windowHits
          } else if (windowHits.length >= limit) {
            results = windowHits
          } else {
            effectiveRecallContext = {
              ...options.recallContext,
              occurredWithin: options.occurredWithin,
            }
          }
        }
      }

      // Blended ranking key (see computeRankingBlend: RELEVANCE·cosine +
      // PRIORITY·rawWeight). The blend itself is never modified — when a
      // recallContext is supplied, the targeting-tag adjustments are bounded,
      // clamped multipliers applied to this blended score *after* it is
      // computed (see lib/memory/recall-tags.ts), so semantic relevance and
      // recency keep their relative footing and each adjustment is auditable
      // in isolation. No recallContext → the exact historical sort,
      // byte-for-byte.
      if (effectiveRecallContext) {
        const recallContext = effectiveRecallContext
        const adjusted: SemanticSearchResult[] = []
        for (const r of results) {
          const blendedBefore = computeRankingBlend(r.score, r.rawWeight ?? 0)
          const adj = combineRecallMultipliers(r.memory, recallContext)
          if (adj.exclude) {
            continue
          }
          const blendedAfter = blendedBefore * adj.multiplier
          r.recallAdjustment = { multiplier: adj.multiplier, fired: adj.fired, blendedBefore, blendedAfter }
          adjusted.push(r)
        }
        adjusted.sort(
          (a, b) => (b.recallAdjustment?.blendedAfter ?? 0) - (a.recallAdjustment?.blendedAfter ?? 0),
        )

        // Item 5 — one-hop related-memory expansion. After the top hits are
        // ranked, pull each top hit's strongly-linked neighbors in as low-cost
        // extra candidates (capped), score them against the same query embedding,
        // run them through the same blend + multipliers, and re-rank the union.
        // This catches the memory that's relevant by association but didn't clear
        // the embedding threshold directly — the classic RAG miss. Only runs when
        // the caller opts in via recallContext, since it costs one extra batched
        // hydration.
        if (recallContext.expandRelated) {
          const expanded = await expandRelatedMemories(
            adjusted,
            limit,
            embeddingResult.embedding,
            recallContext,
            { minImportance: options.minImportance, source: options.source },
            characterId,
          )
          results = expanded
        } else {
          results = adjusted
        }
      } else {
        results.sort((a, b) => {
          const finalScoreA = computeRankingBlend(a.score, a.rawWeight ?? 0)
          const finalScoreB = computeRankingBlend(b.score, b.rawWeight ?? 0)
          return finalScoreB - finalScoreA
        })
      }

      const tDone = performance.now()

      const finalResults = results.slice(0, limit)
      bumpAccessTimes(characterId, finalResults.map(r => r.memory.id))
      return finalResults
    }
  } catch (error) {
    logger.warn(`[Memory] Semantic search failed, falling back to text search`, { characterId, query: query.substring(0, 100), userId: options.userId, error: String(error) })
  }

  // Fallback to text-based search
  const textResults = await searchMemoriesText(characterId, query, options)
  bumpAccessTimes(characterId, textResults.map(r => r.memory.id))
  return textResults
}

/**
 * Item 5 — one-hop related-memory expansion.
 *
 * Given the already-ranked candidate pool (`ranked`, sorted by post-adjustment
 * blended score), pull the strongly-linked neighbors of the top hits in as extra
 * candidates, score them against the same query embedding, run them through the
 * same blend + recall multipliers, union them with the pool, and re-rank.
 *
 * Bounded on every axis so a corpus-heavy character can't balloon the candidate
 * set: only the top `limit` hits seed neighbors, at most {@link RELATED_EXPANSION}
 * `.maxPerHit` per seed and `.maxTotal` overall. Neighbors already in the pool are
 * skipped; neighbors without a dimension-matching embedding can't be cosine-scored
 * and are skipped; the same `minImportance`/`source` filters and cross-project
 * exclusion that gate the main pool apply here too. `minScore` is intentionally
 * NOT re-applied — a low-cosine neighbor relevant purely by association is the
 * whole point of expansion.
 */
async function expandRelatedMemories(
  ranked: SemanticSearchResult[],
  limit: number,
  queryEmbedding: ArrayLike<number>,
  recallContext: RecallContext,
  filters: { minImportance?: number; source?: 'AUTO' | 'MANUAL' },
  characterId: string,
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const inPool = new Set(ranked.map(r => r.memory.id))

  // Collect capped neighbor ids from the top hits only.
  const neighborIds: string[] = []
  const neighborSet = new Set<string>()
  for (const seed of ranked.slice(0, limit)) {
    let pulledFromSeed = 0
    for (const neighborId of seed.memory.relatedMemoryIds ?? []) {
      if (neighborIds.length >= RELATED_EXPANSION.maxTotal) break
      if (pulledFromSeed >= RELATED_EXPANSION.maxPerHit) break
      if (inPool.has(neighborId) || neighborSet.has(neighborId)) continue
      neighborSet.add(neighborId)
      neighborIds.push(neighborId)
      pulledFromSeed++
    }
    if (neighborIds.length >= RELATED_EXPANSION.maxTotal) break
  }

  if (neighborIds.length === 0) {
    return ranked
  }

  const neighbors = await repos.memories.findByIds(neighborIds)
  const survivors: SemanticSearchResult[] = []
  for (const memory of neighbors) {
    // Character-scope + filter guards mirror the main pool.
    if (memory.characterId !== characterId) continue
    if (filters.minImportance !== undefined && memory.importance < filters.minImportance) continue
    if (filters.source && memory.source !== filters.source) continue
    if (!memory.embedding || memory.embedding.length !== queryEmbedding.length) continue

    const cosineScore = cosineSimilarity(queryEmbedding, memory.embedding)
    const { effectiveWeight, rawWeight } = calculateEffectiveWeight(memory)
    const blendedBefore = computeRankingBlend(cosineScore, rawWeight ?? 0)
    const adj = combineRecallMultipliers(memory, recallContext)
    if (adj.exclude) continue
    const blendedAfter = blendedBefore * adj.multiplier
    survivors.push({
      memory,
      score: cosineScore,
      usedEmbedding: true,
      effectiveWeight,
      rawWeight,
      recallAdjustment: { multiplier: adj.multiplier, fired: [...adj.fired, 'related↗'], blendedBefore, blendedAfter },
    })
  }

  if (survivors.length === 0) {
    return ranked
  }

  const union = [...ranked, ...survivors]
  union.sort(
    (a, b) => (b.recallAdjustment?.blendedAfter ?? 0) - (a.recallAdjustment?.blendedAfter ?? 0),
  )
  return union
}

/**
 * Fire-and-forget bulk update of lastAccessedAt for memories returned from a
 * retrieval path. The recent-access component of the blended protection score
 * is otherwise starved of signal — on a 17k-memory corpus we were seeing 13
 * rows with a non-null lastAccessedAt because only the Memories API route
 * called updateAccessTime, and the chat context path never did.
 *
 * Character-scoped bulk update so a stale id list cannot affect other
 * characters. Errors are swallowed at warn level — a missed access bump
 * shouldn't fail a chat turn.
 */
function bumpAccessTimes(characterId: string, memoryIds: string[]): void {
  if (memoryIds.length === 0) return
  const repos = getRepositories()
  repos.memories.updateAccessTimeBulk(characterId, memoryIds).catch(err => {
    logger.warn('[Memory] Failed to bump lastAccessedAt for retrieved memories', {
      characterId,
      count: memoryIds.length,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

/**
 * Text-based memory search (fallback when embeddings unavailable)
 *
 * Searches for the full query phrase first, then broadens to individual
 * significant words if the full phrase doesn't match enough results.
 * This is critical when this function is the fallback for a failed
 * semantic search (e.g. dimension mismatch).
 */
async function searchMemoriesText(
  characterId: string,
  query: string,
  options: {
    limit?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL'
    aboutCharacterId?: string
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20

  // Try full-phrase search first
  let memories = await repos.memories.searchByContent(characterId, query)

  // If full-phrase search returned too few results, broaden to per-word search.
  // Filter out common stop words to keep results relevant.
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'that', 'this', 'these',
    'those', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    'not', 'no', 'nor', 'if', 'then', 'than', 'so', 'as', 'about',
    'from', 'into', 'up', 'out', 'off', 'over', 'under', 'again',
    'before', 'after', 'between', 'through',
  ])

  if (memories.length < limit) {
    const queryWords = query.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))

    if (queryWords.length > 0) {
      const existingIds = new Set(memories.map(m => m.id))

      // Search for each significant word individually
      for (const word of queryWords) {
        const wordResults = await repos.memories.searchByContent(characterId, word)
        for (const mem of wordResults) {
          if (!existingIds.has(mem.id)) {
            existingIds.add(mem.id)
            memories.push(mem)
          }
        }
      }
    }
  }

  // Apply filters
  if (options.minImportance !== undefined) {
    memories = memories.filter(m => m.importance >= options.minImportance!)
  }
  if (options.source) {
    memories = memories.filter(m => m.source === options.source)
  }
  if (options.aboutCharacterId) {
    memories = memories.filter(m => m.aboutCharacterId === options.aboutCharacterId)
  }

  // Score based on text matching
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  const results: SemanticSearchResult[] = memories.map(memory => {
    let score = 0
    const contentLower = memory.content.toLowerCase()
    const summaryLower = memory.summary.toLowerCase()

    // Exact full-phrase match in summary is highest score
    if (summaryLower.includes(queryLower)) {
      score += 0.4
    }
    // Exact full-phrase match in content
    if (contentLower.includes(queryLower)) {
      score += 0.3
    }

    // Per-word matching in content and summary
    if (queryWords.length > 0) {
      const contentWordMatches = queryWords.filter(w => contentLower.includes(w)).length
      const summaryWordMatches = queryWords.filter(w => summaryLower.includes(w)).length
      // Score based on proportion of query words matched
      score += 0.2 * (contentWordMatches / queryWords.length)
      score += 0.1 * (summaryWordMatches / queryWords.length)
    }

    // Keyword matches
    const matchingKeywords = memory.keywords.filter(kw =>
      queryWords.some(qw => kw.toLowerCase().includes(qw))
    )
    score += 0.1 * (matchingKeywords.length / Math.max(memory.keywords.length, 1))

    const { effectiveWeight, rawWeight } = calculateEffectiveWeight(memory)

    return {
      memory,
      score: Math.min(score, 1.0),
      usedEmbedding: false,
      effectiveWeight,
      rawWeight,
    }
  })

  // Filter out zero-score results (no words matched at all)
  const scoredResults = results.filter(r => r.score > 0)

  // Combine text score with the decaying ranking weight for final ordering.
  scoredResults.sort((a, b) => {
    const finalScoreA = computeRankingBlend(a.score, a.rawWeight ?? 0)
    const finalScoreB = computeRankingBlend(b.score, b.rawWeight ?? 0)
    return finalScoreB - finalScoreA
  })

  return scoredResults.slice(0, limit)
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
        buildMemoryEmbeddingText(memory.summary, memory.content, memory),
        options.userId,
        options.embeddingProfileId,
        { priority: 'background' }
      )

      // Update memory with embedding
      await repos.memories.updateForCharacter(characterId, memory.id, {
        embedding: embeddingResult.embedding,
      })

      // Add to vector store
      await vectorStore.addVector(memory.id, embeddingResult.embedding, {
        memoryId: memory.id,
        characterId,
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

/**
 * Delete all memories for a source message with vector store cleanup.
 * Handles multi-character case where one message may have memories for multiple characters.
 *
 * @param sourceMessageId The source message ID
 * @returns Object with count of deleted memories and removed vectors
 */
export async function deleteMemoriesBySourceMessageWithVectors(
  sourceMessageId: string
): Promise<{ deleted: number; vectorsRemoved: number }> {
  const repos = getRepositories()

  // First, find all memories to get character IDs for vector cleanup
  const memories = await repos.memories.findBySourceMessageId(sourceMessageId)

  if (memories.length === 0) {

    return { deleted: 0, vectorsRemoved: 0 }
  }

  // Group memories by character for efficient vector store operations
  const memoryIdsByCharacter = new Map<string, string[]>()
  for (const memory of memories) {
    const existing = memoryIdsByCharacter.get(memory.characterId) || []
    existing.push(memory.id)
    memoryIdsByCharacter.set(memory.characterId, existing)
  }

  // Remove vectors from each character's store
  let vectorsRemoved = 0
  for (const [characterId, memoryIds] of memoryIdsByCharacter) {
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const memoryId of memoryIds) {
        const removed = vectorStore.hasVector(memoryId)
        if (removed) {
          await vectorStore.removeVector(memoryId)
          vectorsRemoved++
        }
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn('[Memory] Failed to remove vectors for character', {
        characterId,
        memoryCount: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Delete the memories through the chokepoint so neighbours' relatedMemoryIds
  // get scrubbed before the rows go away.
  const allMemoryIds = memories.map(m => m.id)
  const deleted = await deleteMemoriesWithUnlinkBatch(allMemoryIds)

  logger.info('[Memory] Cascade deleted memories for source message', {
    sourceMessageId,
    deleted,
    vectorsRemoved,
    characterCount: memoryIdsByCharacter.size,
  })

  return { deleted, vectorsRemoved }
}

/**
 * Delete all memories for multiple source messages (swipe group) with vector cleanup.
 *
 * @param sourceMessageIds Array of source message IDs
 * @returns Object with count of deleted memories and removed vectors
 */
export async function deleteMemoriesBySourceMessagesWithVectors(
  sourceMessageIds: string[]
): Promise<{ deleted: number; vectorsRemoved: number }> {
  if (sourceMessageIds.length === 0) {
    return { deleted: 0, vectorsRemoved: 0 }
  }

  const repos = getRepositories()

  // Gather every memory across the whole swipe group up front, so the chokepoint
  // scan only sweeps the relatedMemoryIds column once for the entire batch.
  const allMemories: Memory[] = []
  for (const sourceMessageId of sourceMessageIds) {
    const slice = await repos.memories.findBySourceMessageId(sourceMessageId)
    allMemories.push(...slice)
  }
  if (allMemories.length === 0) {
    return { deleted: 0, vectorsRemoved: 0 }
  }

  const memoryIdsByCharacter = new Map<string, string[]>()
  for (const memory of allMemories) {
    const existing = memoryIdsByCharacter.get(memory.characterId) || []
    existing.push(memory.id)
    memoryIdsByCharacter.set(memory.characterId, existing)
  }

  let vectorsRemoved = 0
  for (const [characterId, memoryIds] of memoryIdsByCharacter) {
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const memoryId of memoryIds) {
        if (vectorStore.hasVector(memoryId)) {
          await vectorStore.removeVector(memoryId)
          vectorsRemoved++
        }
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn('[Memory] Failed to remove vectors for character during swipe-group cascade', {
        characterId,
        memoryCount: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const totalDeleted = await deleteMemoriesWithUnlinkBatch(allMemories.map(m => m.id))

  logger.info('[Memory] Bulk cascade deleted memories for swipe group', {
    messageCount: sourceMessageIds.length,
    totalDeleted,
    totalVectorsRemoved: vectorsRemoved,
  })

  return { deleted: totalDeleted, vectorsRemoved }
}

/**
 * Delete every memory tied to the given chat (across all characters) and
 * remove their entries from each character's vector store.
 *
 * Used by the DELETE /api/v1/memories?chatId= route and by the
 * MEMORY_REGENERATE_CHAT job when wiping a chat's auto-extracted memories
 * before re-running extraction from scratch.
 */
export async function deleteMemoriesByChatIdWithVectors(
  chatId: string,
): Promise<{ deleted: number; vectorsRemoved: number; characterCount: number }> {
  const repos = getRepositories()

  const memories = await repos.memories.findByChatId(chatId)
  if (memories.length === 0) {
    return { deleted: 0, vectorsRemoved: 0, characterCount: 0 }
  }

  const memoryIdsByCharacter = new Map<string, string[]>()
  for (const memory of memories) {
    const existing = memoryIdsByCharacter.get(memory.characterId) || []
    existing.push(memory.id)
    memoryIdsByCharacter.set(memory.characterId, existing)
  }

  let vectorsRemoved = 0
  for (const [characterId, memoryIds] of memoryIdsByCharacter) {
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const memoryId of memoryIds) {
        if (vectorStore.hasVector(memoryId)) {
          await vectorStore.removeVector(memoryId)
          vectorsRemoved++
        }
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn('[Memory] Failed to remove vectors for character during chat wipe', {
        characterId,
        memoryCount: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const allMemoryIds = memories.map(m => m.id)
  const deleted = await deleteMemoriesWithUnlinkBatch(allMemoryIds)

  logger.info('[Memory] Cascade deleted memories for chat', {
    chatId,
    deleted,
    vectorsRemoved,
    characterCount: memoryIdsByCharacter.size,
  })

  return { deleted, vectorsRemoved, characterCount: memoryIdsByCharacter.size }
}
