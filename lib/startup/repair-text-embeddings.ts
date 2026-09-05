/**
 * Startup Auto-Repair: Convert TEXT Embeddings to Float32 BLOBs
 *
 * During development hot-reloads, the SQLiteCollection's blobColumns set can
 * lose its registration, causing embeddings to be written as JSON text instead
 * of compact Float32 BLOBs. This repair runs on every startup and converts any
 * TEXT embeddings back to BLOBs across every table that stores an embedding:
 * `vector_entries`, `memories`, `help_docs`, and `conversation_chunks`.
 *
 * This is idempotent and fast when there's nothing to fix (a single COUNT query
 * per table).
 *
 * Two legacy TEXT shapes are handled (see `parseLegacyEmbeddingText`): a JSON
 * array and the index-keyed object left by `JSON.stringify(Float32Array)`
 * (`{"0":..,"1":..}`). The older repair only handled the array shape and nulled
 * the object shape on stall — silent data loss for embeddings that were in fact
 * recoverable. Both shapes now convert losslessly to BLOB.
 *
 * Memory-bounded: pages through TEXT rows in batches of PAGE_SIZE rather than
 * materializing the entire result set with .all(). A 1536- or 4096-dimension
 * embedding stored as JSON text is ~30 KB; 32 k such rows in one .all() will
 * push the heap past 1 GB before V8 string overhead and easily OOM on large
 * instances. Each iteration's WHERE filter re-targets the remaining TEXT
 * rows — once a row has been converted to BLOB, it falls out of the page.
 */

import { logger } from '@/lib/logger'
import { embeddingToBlob, parseLegacyEmbeddingText } from '@/lib/embedding/float32-conversion'

interface RepairResult {
  vectorEntriesRepaired: number
  memoriesRepaired: number
  helpDocsRepaired: number
  helpDocChunksRepaired: number
  conversationChunksRepaired: number
  durationMs: number
}

const PAGE_SIZE = 500

/** Tables that store a Float32-BLOB `embedding` column, with a progress noun. */
const EMBEDDING_TABLES: ReadonlyArray<{ table: string; unit: string }> = [
  { table: 'vector_entries', unit: 'vector entries' },
  { table: 'memories', unit: 'memories' },
  { table: 'help_docs', unit: 'help docs' },
  { table: 'help_doc_chunks', unit: 'help doc sections' },
  { table: 'conversation_chunks', unit: 'conversation chunks' },
]

interface StartupProgressLike {
  setCurrent: (label: string, opts: { detail: string }) => void
  setSubProgress: (tiers: Array<{ current: number; total: number; unit: string }> | null) => void
}

/**
 * Convert legacy TEXT embeddings in one table to Float32 BLOBs, paging so the
 * whole table is never materialized. Empty embeddings become NULL; rows that
 * can't be parsed after repeated stalls are nulled so they don't re-trip the
 * repair on every restart. `db` is the raw better-sqlite3 handle; the table
 * names come from the trusted EMBEDDING_TABLES list (no injection surface).
 */
function repairTableTextEmbeddings(
  db: any,
  table: string,
  unit: string,
  startupProgress: StartupProgressLike
): number {
  const textCount = db.prepare(
    `SELECT COUNT(*) as count FROM ${table} WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
  ).get() as { count: number }

  if (textCount.count === 0) return 0

  logger.info(`Repairing TEXT embeddings in ${table}`, {
    context: 'startup.repair-text-embeddings',
    table,
    count: textCount.count,
  })

  startupProgress.setCurrent('subsystem:embedding-repair:start', {
    detail: `${textCount.count} ${unit} rows`,
  })

  const selectPage = db.prepare(
    `SELECT id, embedding FROM ${table}
     WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'
     LIMIT ${PAGE_SIZE}`
  )
  const updateStmt = db.prepare(`UPDATE ${table} SET embedding = ? WHERE id = ?`)

  let repaired = 0

  const applyPage = db.transaction((batch: { id: string; embedding: string }[]) => {
    for (const row of batch) {
      const embedding = parseLegacyEmbeddingText(row.embedding)
      if (embedding === undefined) {
        // Unparseable — leave for the stall handler below.
        continue
      }
      if (embedding.length > 0) {
        updateStmt.run(embeddingToBlob(embedding), row.id)
      } else {
        updateStmt.run(null, row.id)
      }
      repaired++
    }
  })

  // Page until no TEXT rows remain. UPDATEs in applyPage flip rows out of the
  // WHERE filter, so progress is guaranteed as long as at least one row
  // converts each iteration.
  let stalledIterations = 0
  while (true) {
    const page = selectPage.all() as { id: string; embedding: string }[]
    if (page.length === 0) break
    const before = repaired
    applyPage(page)
    const converted = repaired - before
    startupProgress.setSubProgress([{ current: repaired, total: textCount.count, unit }])
    if (converted === 0) {
      // No row in this page could be parsed — break to avoid an infinite loop.
      stalledIterations++
      if (stalledIterations >= 2) {
        logger.warn(`Stopping ${table} repair — page of unparseable rows`, {
          context: 'startup.repair-text-embeddings',
          table,
          remaining: page.length,
        })
        // Nudge the remaining unparseable rows to NULL so they don't re-trip
        // the repair on every restart. Index lookups treat them as missing
        // embeddings, same as never-embedded rows.
        const nullify = db.prepare(`UPDATE ${table} SET embedding = NULL WHERE id = ?`)
        const nullifyBatch = db.transaction((ids: string[]) => {
          for (const id of ids) nullify.run(id)
        })
        nullifyBatch(page.map(r => r.id))
        break
      }
    } else {
      stalledIterations = 0
    }
  }

  return repaired
}

/**
 * Repair any TEXT embeddings found in the embedding-bearing tables.
 * Converts them to Float32 BLOBs for proper dimension handling and storage
 * efficiency.
 *
 * Safe to call on every startup — returns immediately if no TEXT embeddings
 * exist. Non-fatal: never throws into the startup path.
 */
export async function repairTextEmbeddings(): Promise<RepairResult> {
  const startTime = Date.now()
  const counts: Record<string, number> = {}

  const buildResult = (): RepairResult => ({
    vectorEntriesRepaired: counts['vector_entries'] ?? 0,
    memoriesRepaired: counts['memories'] ?? 0,
    helpDocsRepaired: counts['help_docs'] ?? 0,
    helpDocChunksRepaired: counts['help_doc_chunks'] ?? 0,
    conversationChunksRepaired: counts['conversation_chunks'] ?? 0,
    durationMs: Date.now() - startTime,
  })

  try {
    // Dynamic import to avoid circular dependencies during startup
    const { getDatabaseAsync } = await import('@/lib/database/manager')
    const { SQLiteBackend } = await import('@/lib/database/backends/sqlite/backend')
    const { startupProgress } = await import('@/lib/startup/progress')

    const backend = await getDatabaseAsync()
    if (!(backend instanceof SQLiteBackend)) {
      return buildResult()
    }

    // Access the raw SQLite database for direct queries
    const db = (backend as any).db
    if (!db) {
      return buildResult()
    }

    const tableExists = (name: string): boolean => {
      try {
        const row = db.prepare(
          `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`
        ).get(name) as { count: number }
        return row.count > 0
      } catch {
        return false
      }
    }

    for (const { table, unit } of EMBEDDING_TABLES) {
      if (tableExists(table)) {
        counts[table] = repairTableTextEmbeddings(db, table, unit, startupProgress)
      }
    }

    const totalRepaired = Object.values(counts).reduce((sum, n) => sum + n, 0)

    if (totalRepaired > 0) {
      const result = buildResult()
      logger.info('TEXT embedding repair complete', {
        context: 'startup.repair-text-embeddings',
        ...result,
      })
      startupProgress.publish({
        rawLabel: 'subsystem:embedding-repair:complete',
        detail: EMBEDDING_TABLES
          .filter(({ table }) => (counts[table] ?? 0) > 0)
          .map(({ table, unit }) => `${counts[table]} ${unit}`)
          .join(', '),
      })
      startupProgress.setSubProgress(null)
    }

    return buildResult()
  } catch (error) {
    logger.error('TEXT embedding repair failed', {
      context: 'startup.repair-text-embeddings',
      error: error instanceof Error ? error.message : String(error),
      ...buildResult(),
    })
    // Non-fatal — don't block startup
    return buildResult()
  }
}
