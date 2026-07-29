/**
 * Embedding dimension reconciliation (startup self-heal)
 *
 * There is exactly one embedding standard per instance: the vectors the
 * default embedding profile produces. This pass runs on every boot and makes
 * the stored corpus conform to it, across every embedding-bearing store:
 *
 *   - memories               (main DB — re-embedded via reindex)
 *   - vector_entries         (main DB — non-conforming rows DELETED here;
 *                             they are derived data, already invisible to
 *                             vector search, and the memory re-embed
 *                             recreates them)
 *   - vector_indices         (main DB — meta `dimensions` snapped to target)
 *   - conversation_chunks    (main DB — live chats re-embedded; STALE chats'
 *                             non-conforming embeddings NULLed to the
 *                             cold-tier state the stale sweep produces, so
 *                             the Salon reopen path re-embeds on demand)
 *   - help_docs              (main DB — re-embedded via reindex)
 *   - doc_mount_chunks       (mount index DB — enabled mounts re-embedded)
 *
 * How this state arises: historically, switching WHICH profile was the
 * default did not trigger a re-embed (only editing an already-default
 * profile's provider/model did), so a TF-IDF-era corpus could survive under
 * a neural default indefinitely — stored 258-d vectors silently skipped by
 * every cosine scan, and warned about on every housekeeping pass. The
 * profile routes now trigger the reindex at switch time; this pass is the
 * recurring safety net for corpora already in that state, for kills mid-
 * reindex, and for any future writer that slips a non-conforming vector in.
 *
 * Cheap when clean: one COUNT per table (format-aware SQL on the blob
 * header), no rows hydrated. When non-conforming vectors ARE found, the
 * repair work is enqueued as a `mismatched-dim` EMBEDDING_REINDEX_ALL rather
 * than run inline, so a big backlog can't block the loading screen. Rows
 * marked FAILED for the default profile are excluded from the "needs work"
 * count — they are deterministic failures and would otherwise re-enqueue a
 * reindex on every boot with no progress.
 *
 * Skipped entirely for BUILTIN (TF-IDF) defaults: their dimension is the
 * fitted vocabulary size, which the refit pipeline owns.
 *
 * Runs in the parent (the sole DB writer), like the other startup self-heals.
 *
 * @module startup/reconcile-embedding-dimensions
 */

import type { Database as DatabaseType } from 'better-sqlite3'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { EMBEDDING_DIM_SQL } from '@/lib/embedding/float32-conversion'

const logger = createServiceLogger('Startup:EmbeddingDimReconcile')

export interface EmbeddingDimensionReconcileResult {
  /** Target dimension enforced, or null when the pass was skipped. */
  targetDimensions: number | null
  /** Why the pass was skipped, if it was. */
  skippedReason: 'no-profile' | 'builtin-profile' | 'no-fixed-dim' | 'db-unavailable' | null
  /** Non-conforming vector_entries rows deleted. */
  vectorEntriesDeleted: number
  /** vector_indices meta rows whose dimensions were snapped to target. */
  vectorIndexMetaFixed: number
  /** Stale-chat conversation chunks whose non-conforming embeddings were NULLed. */
  staleChunkEmbeddingsCleared: number
  /** Recoverable non-conforming rows found, per table. */
  mismatched: {
    memories: number
    conversationChunks: number
    helpDocs: number
    mountChunks: number
  }
  /** Whether a mismatched-dim reindex was enqueued. */
  reindexEnqueued: boolean
}

const EMPTY_RESULT: Omit<EmbeddingDimensionReconcileResult, 'targetDimensions' | 'skippedReason'> = {
  vectorEntriesDeleted: 0,
  vectorIndexMetaFixed: 0,
  staleChunkEmbeddingsCleared: 0,
  mismatched: { memories: 0, conversationChunks: 0, helpDocs: 0, mountChunks: 0 },
  reindexEnqueued: false,
}

/** WHERE fragment: embedding present and not at the target dimension. */
const NONCONFORMING = `embedding IS NOT NULL AND ${EMBEDDING_DIM_SQL} != ?`

/**
 * Exclusion fragment for rows already marked FAILED for the default profile —
 * deterministic failures (oversize, over-context) that must not keep
 * re-triggering reindexes. `?` binds entityType then profileId.
 */
const NOT_FAILED = (table: string) => `NOT EXISTS (
  SELECT 1 FROM "embedding_status" es
  WHERE es."entityType" = ?
    AND es."entityId" = "${table}"."id"
    AND es."profileId" = ?
    AND es."status" = 'FAILED'
)`

function countNonconforming(
  db: DatabaseType,
  table: string,
  targetDim: number,
  entityType: string,
  profileId: string,
  opts: { includeNull?: boolean } = {},
): number {
  // For memories and help docs a NULL embedding is also non-conforming —
  // nothing else re-embeds it. Conversation chunks are NOT counted when NULL
  // (that is the deliberate cold-tier state, healed on reopen), and mount
  // chunks' NULLs belong to the mount scan pipeline.
  const where = opts.includeNull ? `(embedding IS NULL OR ${NONCONFORMING})` : NONCONFORMING
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where} AND ${NOT_FAILED(table)}`)
    .get(targetDim, entityType, profileId) as { n: number }
  return row.n
}

function tableExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return Boolean(row)
}

/**
 * Reconcile every stored embedding against the default profile's dimension.
 * Never throws into the startup path.
 */
export async function reconcileEmbeddingDimensions(): Promise<EmbeddingDimensionReconcileResult> {
  try {
    return await runReconcile()
  } catch (error) {
    logger.error('Embedding dimension reconcile failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { targetDimensions: null, skippedReason: null, ...EMPTY_RESULT }
  }
}

async function runReconcile(): Promise<EmbeddingDimensionReconcileResult> {
  const { getRawDatabase } = await import('@/lib/database/backends/sqlite/client')
  const db = getRawDatabase()
  if (!db) {
    return { targetDimensions: null, skippedReason: 'db-unavailable', ...EMPTY_RESULT }
  }

  // Resolve the default profile straight off the row — this runs before some
  // subsystems are up, and all we need are four columns.
  const profile = db
    .prepare(
      `SELECT id, userId, provider, dimensions, truncateToDimensions
       FROM embedding_profiles WHERE isDefault = 1 LIMIT 1`,
    )
    .get() as
    | {
        id: string
        userId: string
        provider: string
        dimensions: number | null
        truncateToDimensions: number | null
      }
    | undefined

  if (!profile) {
    return { targetDimensions: null, skippedReason: 'no-profile', ...EMPTY_RESULT }
  }
  if (profile.provider === 'BUILTIN') {
    return { targetDimensions: null, skippedReason: 'builtin-profile', ...EMPTY_RESULT }
  }

  const targetDim = profile.truncateToDimensions ?? profile.dimensions
  if (!targetDim || targetDim <= 0) {
    logger.warn('Default embedding profile has no fixed dimension; cannot enforce conformance', {
      profileId: profile.id,
      provider: profile.provider,
    })
    return { targetDimensions: null, skippedReason: 'no-fixed-dim', ...EMPTY_RESULT }
  }

  const result: EmbeddingDimensionReconcileResult = {
    targetDimensions: targetDim,
    skippedReason: null,
    ...EMPTY_RESULT,
    mismatched: { ...EMPTY_RESULT.mismatched },
  }

  // ---- vector_entries: delete non-conforming rows outright. They are pure
  // derived data (the memory row keeps the source text), every search path
  // already skips them by length, and the memory re-embed recreates them.
  if (tableExists(db, 'vector_entries')) {
    const del = db
      .prepare(`DELETE FROM "vector_entries" WHERE ${NONCONFORMING}`)
      .run(targetDim)
    result.vectorEntriesDeleted = del.changes
  }

  // ---- vector_indices: snap meta dimensions to the standard so freshly
  // re-embedded vectors are accepted and search validates against the truth.
  if (tableExists(db, 'vector_indices')) {
    const fix = db
      .prepare(`UPDATE "vector_indices" SET dimensions = ? WHERE dimensions != ?`)
      .run(targetDim, targetDim)
    result.vectorIndexMetaFixed = fix.changes
  }

  if (result.vectorEntriesDeleted > 0 || result.vectorIndexMetaFixed > 0) {
    // Drop cached in-memory stores so the next search loads the cleaned rows.
    const { getVectorStoreManager } = await import('@/lib/embedding/vector-store')
    getVectorStoreManager().unloadAll()
  }

  // ---- conversation_chunks on STALE chats: converge to the cold-tier state
  // (NULL embedding) instead of paying to re-embed chats nobody is reading.
  // The Salon reopen path re-embeds on demand; the render reconcile and the
  // reindex handler both already exclude stale chats, so a NULLed stale chunk
  // re-triggers nothing.
  if (tableExists(db, 'conversation_chunks') && tableExists(db, 'chats')) {
    result.staleChunkEmbeddingsCleared = await clearStaleChatNonconformingChunks(db, targetDim)
  }

  // ---- Count what still needs re-embedding (recoverable rows only).
  if (tableExists(db, 'memories')) {
    // characterId guard mirrors the reindex fan-out (it enumerates characters
    // from memories.characterId) — a row it can't reach must not re-trigger
    // the sweep every boot.
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM "memories"
         WHERE (embedding IS NULL OR ${NONCONFORMING})
           AND "characterId" IS NOT NULL
           AND ${NOT_FAILED('memories')}`,
      )
      .get(targetDim, 'MEMORY', profile.id) as { n: number }
    result.mismatched.memories = row.n
  }
  if (tableExists(db, 'conversation_chunks') && tableExists(db, 'chats')) {
    // Restricted to chunks whose chat still exists AND is not stale: the
    // reindex handler only walks live chats, so counting anything else would
    // re-enqueue a sweep on every boot that can never make progress.
    result.mismatched.conversationChunks = await countNonconformingLiveChunks(db, targetDim, profile.id)
  }
  if (tableExists(db, 'help_docs')) {
    result.mismatched.helpDocs = countNonconforming(
      db, 'help_docs', targetDim, 'HELP_DOC', profile.id, { includeNull: true },
    )
  }
  result.mismatched.mountChunks = await countNonconformingMountChunks(db, targetDim, profile.id)

  const totalMismatched =
    result.mismatched.memories +
    result.mismatched.conversationChunks +
    result.mismatched.helpDocs +
    result.mismatched.mountChunks

  if (totalMismatched > 0) {
    result.reindexEnqueued = await enqueueMismatchedReindex(profile.userId, profile.id)
  }

  const touchedAnything =
    totalMismatched > 0 ||
    result.vectorEntriesDeleted > 0 ||
    result.vectorIndexMetaFixed > 0 ||
    result.staleChunkEmbeddingsCleared > 0

  if (touchedAnything) {
    logger.info('Embedding dimension reconcile found non-conforming vectors', {
      profileId: profile.id,
      targetDimensions: targetDim,
      vectorEntriesDeleted: result.vectorEntriesDeleted,
      vectorIndexMetaFixed: result.vectorIndexMetaFixed,
      staleChunkEmbeddingsCleared: result.staleChunkEmbeddingsCleared,
      ...result.mismatched,
      reindexEnqueued: result.reindexEnqueued,
    })
  } else {
    logger.debug('Embedding dimension reconcile: corpus conforms', {
      profileId: profile.id,
      targetDimensions: targetDim,
    })
  }

  return result
}

/**
 * Count non-conforming conversation chunks that the reindex handler can
 * actually reach: the chat must still exist (orphaned chunks would otherwise
 * re-trigger a futile reindex on every boot). Stale chats' non-conforming
 * chunks were already NULLed by {@link clearStaleChatNonconformingChunks},
 * so they no longer match here.
 */
async function countNonconformingLiveChunks(
  db: DatabaseType,
  targetDim: number,
  profileId: string,
): Promise<number> {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM "conversation_chunks"
       WHERE ${NONCONFORMING}
         AND "chatId" IN (SELECT "id" FROM "chats")
         AND ${NOT_FAILED('conversation_chunks')}`,
    )
    .get(targetDim, 'CONVERSATION_CHUNK', profileId) as { n: number }
  return row.n
}

/**
 * NULL non-conforming chunk embeddings on stale chats. Staleness is decided
 * by the same shared gate the maintenance sweeps use (`isStale`), evaluated
 * per candidate chat — only chats that actually hold a non-conforming chunk
 * are examined, so this is a no-op scan on a conforming corpus.
 */
async function clearStaleChatNonconformingChunks(
  db: DatabaseType,
  targetDim: number,
): Promise<number> {
  const candidateChatIds = (
    db
      .prepare(
        `SELECT DISTINCT "chatId" AS chatId FROM "conversation_chunks"
         WHERE "chatId" IS NOT NULL AND ${NONCONFORMING}`,
      )
      .all(targetDim) as Array<{ chatId: string }>
  ).map((r) => r.chatId)

  if (candidateChatIds.length === 0) return 0

  const chatStmt = db.prepare(`SELECT "id" AS id, "updatedAt" AS updatedAt FROM "chats" WHERE "id" = ?`)
  const candidateChats = candidateChatIds
    .map((id) => chatStmt.get(id) as { id: string; updatedAt: string | null } | undefined)
    .filter((c): c is { id: string; updatedAt: string | null } => Boolean(c))

  const { getRepositories } = await import('@/lib/repositories/factory')
  const { isStale } = await import('@/lib/background-jobs/maintenance/collapse-stale-chat-assets')
  const { resolveStaleChatDays, retentionCutoff } = await import(
    '@/lib/background-jobs/maintenance/retention-constants'
  )

  const repos = getRepositories()
  const cutoffMs = retentionCutoff(await resolveStaleChatDays()).getTime()

  const clearStmt = db.prepare(
    `UPDATE "conversation_chunks" SET embedding = NULL WHERE "chatId" = ? AND ${NONCONFORMING}`,
  )

  let cleared = 0
  for (const chat of candidateChats) {
    if (await isStale({ id: chat.id, updatedAt: chat.updatedAt ?? '' }, cutoffMs, repos)) {
      cleared += clearStmt.run(chat.id, targetDim).changes
    }
  }
  return cleared
}

/**
 * Count non-conforming chunks in the mount index DB, limited to ENABLED
 * mount points (mount point config lives in the main DB; chunks live in the
 * separate mount-index DB, so no cross-DB JOIN — ids are carried over).
 */
async function countNonconformingMountChunks(
  mainDb: DatabaseType,
  targetDim: number,
  profileId: string,
): Promise<number> {
  try {
    if (!tableExists(mainDb, 'doc_mount_points')) return 0
    const enabledIds = (
      mainDb.prepare(`SELECT id FROM doc_mount_points WHERE enabled = 1`).all() as Array<{
        id: string
      }>
    ).map((r) => r.id)
    if (enabledIds.length === 0) return 0

    const { getRawMountIndexDatabase } = await import(
      '@/lib/database/backends/sqlite/mount-index-client'
    )
    const mountDb = getRawMountIndexDatabase()
    if (!mountDb || !tableExists(mountDb, 'doc_mount_chunks')) return 0

    // FAILED-status rows live in the main DB, so pull that exclusion set out
    // and apply it in memory (it is small: only deterministic failures).
    const failedIds = new Set(
      (
        mainDb
          .prepare(
            `SELECT entityId FROM embedding_status
             WHERE entityType = 'MOUNT_CHUNK' AND profileId = ? AND status = 'FAILED'`,
          )
          .all(profileId) as Array<{ entityId: string }>
      ).map((r) => r.entityId),
    )

    const placeholders = enabledIds.map(() => '?').join(', ')
    const rows = mountDb
      .prepare(
        `SELECT id FROM "doc_mount_chunks"
         WHERE ${NONCONFORMING} AND "mountPointId" IN (${placeholders})`,
      )
      .all(targetDim, ...enabledIds) as Array<{ id: string }>

    return rows.filter((r) => !failedIds.has(r.id)).length
  } catch (error) {
    logger.warn('Mount-chunk dimension check skipped', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * Enqueue a mismatched-dim EMBEDDING_REINDEX_ALL, deduping against one
 * already pending/processing so repeated boots while a backlog drains cannot
 * stack duplicate sweeps.
 */
async function enqueueMismatchedReindex(userId: string, profileId: string): Promise<boolean> {
  const { getRepositories } = await import('@/lib/repositories/factory')
  const { enqueueEmbeddingReindexAll } = await import('@/lib/background-jobs/queue-service')

  const repos = getRepositories()
  const recent = await repos.backgroundJobs.findRecentByType('EMBEDDING_REINDEX_ALL', 10)
  const alreadyQueued = recent.some(
    (job) => job.status === 'PENDING' || job.status === 'PROCESSING',
  )
  if (alreadyQueued) {
    logger.info('Mismatched-dim reindex already queued; not enqueueing another')
    return false
  }

  await enqueueEmbeddingReindexAll(userId, { profileId, scope: 'mismatched-dim' })
  return true
}
