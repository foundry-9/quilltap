/**
 * Re-apply Embedding Profile
 *
 * Walks every embedding-bearing table in the system and rewrites stored
 * Float32 BLOBs to match the active embedding profile's storage policy
 * (Matryoshka truncation + L2 normalisation).
 *
 * For Matryoshka-trained models like Qwen3-Embedding the first N components
 * of an embedding are themselves a valid embedding at dimension N — so a
 * change from 4096d to 1024d is a pure-local slice-and-renormalise on every
 * stored vector, no provider call needed.
 *
 * Tables walked (mirrors `normalize-embeddings-unit-vectors-v1`):
 *   - memories                 (main DB)
 *   - vector_entries           (main DB)
 *   - conversation_chunks      (main DB)
 *   - help_docs                (main DB)
 *   - doc_mount_chunks         (mount index DB)
 *
 * Rules:
 *   - Vectors longer than the target are sliced and renormalised.
 *   - Vectors already at target length are left alone (idempotent).
 *   - Vectors shorter than the target cannot grow without re-embedding —
 *     the runner refuses up front when it detects the corpus is wider than
 *     the requested target. Callers should fall back to the existing
 *     reindex flow in that case.
 *
 * @module lib/embedding/reapply-profile
 */

import fs from 'fs'
import path from 'path'
import Database, { Database as DatabaseType } from 'better-sqlite3'
import { logger } from '@/lib/logger'
import { getRawDatabase } from '@/lib/database/backends/sqlite/client'
import { getMountIndexDatabasePath, getSQLiteDatabasePath } from '@/lib/paths'
import { invalidateAll as invalidateMountChunkCacheAll } from '@/lib/mount-index/mount-chunk-cache'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import { blobToFloat32, float32ToBlob, EMBEDDING_DIM_SQL } from '@/lib/embedding/float32-conversion'
import { tableExists } from '@/lib/database/backends/sqlite/introspection'
import type { EmbeddingProfile } from '@/lib/schemas/types'

const FLUSH_BATCH = 500
const ZERO_MAG = 1e-10

const MAIN_DB_TABLES = ['memories', 'vector_entries', 'conversation_chunks', 'help_docs'] as const

function requireMainDatabase(): DatabaseType {
  const db = getRawDatabase()
  if (!db) {
    throw new Error('Main SQLite database is not initialized; cannot re-apply embedding profile.')
  }
  return db
}

/**
 * Per-table outcome from a re-apply pass.
 */
export interface TableReapplyResult {
  table: string
  /** Rows that were rewritten (sliced + renormalised). */
  truncated: number
  /** Rows already at target length — left untouched. */
  alreadyAtTarget: number
  /** Rows shorter than the target — cannot grow, left untouched. */
  shorterThanTarget: number
  /** Rows whose truncated magnitude was below ZERO_MAG (degenerate); skipped. */
  degenerate: number
}

/**
 * Aggregate report from `reapplyEmbeddingProfile`.
 */
export interface ReapplyEmbeddingProfileResult {
  profileId: string
  targetDimensions: number
  perTable: TableReapplyResult[]
  totalTruncated: number
  durationMs: number
  backupPath: string | null
  mountBackupPath: string | null
}

/**
 * In-place slice + L2-normalise. Returns the pre-normalisation magnitude so
 * callers can detect degenerate (near-zero) vectors.
 */
function sliceAndNormalize(
  src: Float32Array,
  targetDim: number,
  normalize: boolean,
): { dst: Float32Array; magnitude: number } {
  const dst = new Float32Array(targetDim)
  let sumSq = 0
  for (let i = 0; i < targetDim; i++) {
    const v = src[i]
    dst[i] = v
    sumSq += v * v
  }
  const magnitude = Math.sqrt(sumSq)
  if (normalize && magnitude >= ZERO_MAG) {
    const inv = 1 / magnitude
    for (let i = 0; i < targetDim; i++) dst[i] *= inv
  }
  return { dst, magnitude }
}

/**
 * Open the mount index DB directly. Mirrors the helper in
 * normalize-embeddings-unit-vectors-v1.
 */
function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath()
  if (!fs.existsSync(dbPath)) return null
  const db = new Database(dbPath)
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex')
      db.pragma(`key = "x'${keyHex}'"`)
    }
    db.pragma('busy_timeout = 5000')
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    throw error
  }
}

/**
 * Hot-copy a DB file via `VACUUM INTO`. Produces a fully-consistent backup
 * with the same SQLCipher encryption applied (the destination inherits the
 * source's key context). The destination must not already exist — SQLite
 * will refuse to overwrite.
 */
function vacuumIntoBackup(db: DatabaseType, srcPath: string): string {
  const dir = path.dirname(srcPath)
  const base = path.basename(srcPath, '.db')
  const stamp = new Date().toISOString().split('T')[0]
  const dst = path.join(dir, `${base}.bak-pre-truncation-${stamp}.db`)

  if (fs.existsSync(dst)) {
    // If a backup from earlier today exists, suffix with a timestamp so we
    // never overwrite a prior safety net.
    const epoch = Date.now()
    const dstStamped = path.join(dir, `${base}.bak-pre-truncation-${stamp}-${epoch}.db`)
    db.exec(`VACUUM INTO '${dstStamped.replace(/'/g, "''")}'`)
    return dstStamped
  }

  db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`)
  return dst
}

/**
 * Walk one table and rewrite any embedding BLOBs longer than `targetDim`.
 * Reads + computes outside the transaction, runs only UPDATEs inside.
 */
function reapplyTable(
  db: DatabaseType,
  table: string,
  targetDim: number,
  normalize: boolean,
): TableReapplyResult {
  const result: TableReapplyResult = {
    table,
    truncated: 0,
    alreadyAtTarget: 0,
    shorterThanTarget: 0,
    degenerate: 0,
  }

  const rows = db
    .prepare(`SELECT id, embedding FROM "${table}" WHERE embedding IS NOT NULL`)
    .all() as { id: string; embedding: Buffer | string | null }[]

  const update = db.prepare(`UPDATE "${table}" SET embedding = ? WHERE id = ?`)
  const writeMany = db.transaction((items: { id: string; blob: Buffer }[]) => {
    for (const item of items) update.run(item.blob, item.id)
  })

  const batch: { id: string; blob: Buffer }[] = []

  for (const row of rows) {
    if (!row.embedding || typeof row.embedding === 'string') continue
    const buf = row.embedding
    // Dimensions must come from the decoded vector, not the byte length —
    // blobs may be legacy raw Float32 OR the self-describing quantized format
    // (different bytes-per-dimension).
    const src = blobToFloat32(buf)
    if (src.length === targetDim) {
      result.alreadyAtTarget++
      continue
    }
    if (src.length < targetDim) {
      result.shorterThanTarget++
      continue
    }

    const { dst, magnitude } = sliceAndNormalize(src, targetDim, normalize)

    if (magnitude < ZERO_MAG) {
      result.degenerate++
      continue
    }

    batch.push({ id: row.id, blob: float32ToBlob(dst) })
    if (batch.length >= FLUSH_BATCH) {
      writeMany(batch)
      result.truncated += batch.length
      batch.length = 0
    }
  }
  if (batch.length > 0) {
    writeMany(batch)
    result.truncated += batch.length
  }

  return result
}

/**
 * Inspect every relevant table and return the maximum embedding dimension
 * found anywhere (format-aware: legacy Float32 and quantized blobs coexist).
 * Lets the caller short-circuit if the corpus is already smaller than the
 * requested target.
 */
function maxStoredDimension(): number {
  let max = 0

  const main = requireMainDatabase()
  for (const table of MAIN_DB_TABLES) {
    if (!tableExists(main, table)) continue
    const row = main
      .prepare(
        `SELECT MAX(${EMBEDDING_DIM_SQL}) AS maxDim FROM "${table}" WHERE embedding IS NOT NULL`,
      )
      .get() as { maxDim: number | null }
    if (row?.maxDim && row.maxDim > max) {
      max = row.maxDim
    }
  }

  const mount = openMountIndexDb()
  if (mount) {
    try {
      if (tableExists(mount, 'doc_mount_chunks')) {
        const row = mount
          .prepare(
            `SELECT MAX(${EMBEDDING_DIM_SQL}) AS maxDim FROM doc_mount_chunks WHERE embedding IS NOT NULL`,
          )
          .get() as { maxDim: number | null }
        if (row?.maxDim && row.maxDim > max) {
          max = row.maxDim
        }
      }
    } finally {
      try {
        mount.close()
      } catch {
        /* ignore */
      }
    }
  }

  return max
}

/**
 * Re-apply the supplied profile's storage policy across every embedding-
 * bearing table. Takes a `VACUUM INTO` backup of each affected DB before any
 * writes, runs the rewrite per table in a single transaction, then VACUUMs
 * the source DBs to reclaim freed space.
 *
 * Throws if the profile lacks a `truncateToDimensions` setting, or if the
 * corpus contains vectors *shorter* than the target (which would require
 * re-embedding, not slicing).
 */
export async function reapplyEmbeddingProfile(
  profile: EmbeddingProfile,
): Promise<ReapplyEmbeddingProfileResult> {
  const startTime = Date.now()

  const targetDim = profile.truncateToDimensions
  if (!targetDim || targetDim <= 0) {
    throw new Error(
      `Embedding profile ${profile.id} has no truncateToDimensions set — nothing to re-apply.`,
    )
  }

  const normalize = profile.normalizeL2 !== false

  const observedMax = maxStoredDimension()
  if (observedMax === 0) {
    logger.info('[ReapplyProfile] No stored embeddings found; nothing to do', {
      profileId: profile.id,
      targetDim,
    })
    return {
      profileId: profile.id,
      targetDimensions: targetDim,
      perTable: [],
      totalTruncated: 0,
      durationMs: Date.now() - startTime,
      backupPath: null,
      mountBackupPath: null,
    }
  }

  if (observedMax < targetDim) {
    throw new Error(
      `Stored corpus has ${observedMax}-d vectors but profile requests ${targetDim}-d. ` +
        `Vectors cannot grow without re-embedding — use the reindex flow instead.`,
    )
  }

  logger.info('[ReapplyProfile] Starting truncation pass', {
    profileId: profile.id,
    targetDim,
    normalize,
    observedMax,
  })

  // Backup each DB BEFORE opening any write transaction.
  const main = requireMainDatabase()
  const mainPath = getSQLiteDatabasePath()

  let backupPath: string | null = null
  try {
    backupPath = vacuumIntoBackup(main, mainPath)
    logger.info('[ReapplyProfile] Main DB backed up', { backupPath })
  } catch (err) {
    logger.error('[ReapplyProfile] Main DB backup failed — aborting', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  // Walk main DB tables.
  const perTable: TableReapplyResult[] = []
  for (const table of MAIN_DB_TABLES) {
    if (!tableExists(main, table)) continue
    const result = reapplyTable(main, table, targetDim, normalize)
    perTable.push(result)
    logger.info(`[ReapplyProfile] ${table}`, result)
  }

  // VACUUM main DB to reclaim space.
  try {
    main.exec('VACUUM')
  } catch (err) {
    logger.warn('[ReapplyProfile] VACUUM on main DB failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Walk mount index DB.
  let mountBackupPath: string | null = null
  const mount = openMountIndexDb()
  if (mount) {
    try {
      if (tableExists(mount, 'doc_mount_chunks')) {
        try {
          mountBackupPath = vacuumIntoBackup(mount, getMountIndexDatabasePath())
          logger.info('[ReapplyProfile] Mount index DB backed up', { mountBackupPath })
        } catch (err) {
          logger.error('[ReapplyProfile] Mount index DB backup failed — aborting', {
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }

        const result = reapplyTable(mount, 'doc_mount_chunks', targetDim, normalize)
        perTable.push(result)
        logger.info('[ReapplyProfile] doc_mount_chunks', result)

        try {
          mount.exec('VACUUM')
        } catch (err) {
          logger.warn('[ReapplyProfile] VACUUM on mount DB failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } finally {
      try {
        mount.close()
      } catch {
        /* ignore */
      }
    }
  }

  // Invalidate any in-memory caches that hold stale (now-truncated) vectors.
  try {
    invalidateMountChunkCacheAll()
  } catch (err) {
    logger.warn('[ReapplyProfile] Failed to invalidate mount-chunk cache', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    getVectorStoreManager().unloadAll()
  } catch (err) {
    logger.warn('[ReapplyProfile] Failed to unload vector stores', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const totalTruncated = perTable.reduce((sum, r) => sum + r.truncated, 0)
  const durationMs = Date.now() - startTime

  logger.info('[ReapplyProfile] Completed', {
    profileId: profile.id,
    targetDim,
    totalTruncated,
    durationMs,
    backupPath,
    mountBackupPath,
  })

  return {
    profileId: profile.id,
    targetDimensions: targetDim,
    perTable,
    totalTruncated,
    durationMs,
    backupPath,
    mountBackupPath,
  }
}
