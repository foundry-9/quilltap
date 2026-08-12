/**
 * Help Documentation Sync Service
 *
 * Reads help Markdown files from disk and upserts them into the database.
 * This replaces the build-time help bundle approach, allowing help docs
 * to be embedded at runtime using the user's chosen embedding profile.
 *
 * @module lib/help/help-doc-sync
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

const HELP_DIR = join(process.cwd(), 'help')

/**
 * Result of a help doc sync operation
 */
export interface HelpDocSyncResult {
  /** Total docs found on disk */
  totalOnDisk: number
  /** Docs created (new) */
  created: number
  /** Docs updated (content changed) */
  updated: number
  /** Docs unchanged (hash match) */
  unchanged: number
  /** Docs deleted (row in the database, file gone from disk) */
  deleted: number
  /** Docs that failed to sync */
  failed: number
  /** IDs of docs that were created or updated (need embedding) */
  changedIds: string[]
}

/**
 * Find all Markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        files.push(...findMarkdownFiles(fullPath))
      } else if (entry.endsWith('.md')) {
        files.push(fullPath)
      }
    }
  } catch (err) {
    logger.error('[HelpDocSync] Error reading directory', {
      context: 'findMarkdownFiles',
      dir,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return files
}

/**
 * List the help documents present on disk, as repository-relative paths
 * (the form stored in `help_docs.path`).
 */
function listHelpDocPathsOnDisk(): string[] {
  if (!existsSync(HELP_DIR)) {
    return []
  }

  return findMarkdownFiles(HELP_DIR).map(filePath => relative(process.cwd(), filePath))
}

/**
 * Parse YAML frontmatter from Markdown content
 */
function parseFrontmatter(content: string): { url: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { url: '', body: content }
  }

  const frontmatter = match[1]
  const urlMatch = frontmatter.match(/^url:\s*(.+)$/m)
  const url = urlMatch ? urlMatch[1].trim() : ''
  const body = content.slice(match[0].length)
  return { url, body }
}

/**
 * Extract title from Markdown content (first H1) or fallback to filename
 */
function extractTitle(content: string, filePath: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) {
    return h1Match[1].trim()
  }

  const filename = filePath.split('/').pop()?.replace('.md', '') || 'Unknown'
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Generate SHA-256 hash of content
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Sync help documentation from disk to database.
 *
 * Reads all .md files from the help/ directory, parses frontmatter,
 * and upserts into the help_docs collection. Rows whose file has been
 * deleted from disk are pruned. Returns info about which docs changed
 * (need re-embedding).
 *
 * Enqueues nothing — embedding is the caller's business, because the two
 * callers want different things: EMBEDDING_REINDEX_ALL re-embeds every doc
 * regardless of what changed, while {@link ensureHelpDocsSynced} only tops
 * up the docs that still lack an embedding.
 *
 * @returns Sync result with counts and changed doc IDs
 */
export async function syncHelpDocs(): Promise<HelpDocSyncResult> {
  const result: HelpDocSyncResult = {
    totalOnDisk: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
    changedIds: [],
  }

  if (!existsSync(HELP_DIR)) {
    logger.warn('[HelpDocSync] Help directory not found', {
      context: 'syncHelpDocs',
      helpDir: HELP_DIR,
    })
    return result
  }

  const files = findMarkdownFiles(HELP_DIR)
  result.totalOnDisk = files.length

  if (files.length === 0) {
    logger.info('[HelpDocSync] No Markdown files found in help directory', {
      context: 'syncHelpDocs',
    })
    return result
  }

  const repos = getRepositories()

  // One read of the table, indexed by path. The prune below needs every row
  // anyway, and it doubles as the per-file lookup — the alternative is a
  // findByPath per file, which is ~115 queries on every sync.
  const existingDocs = await repos.helpDocs.findAll()
  const existingByPath = new Map(existingDocs.map(doc => [doc.path, doc]))
  const pathsOnDisk = new Set<string>()

  for (const filePath of files) {
    try {
      const relPath = relative(process.cwd(), filePath)
      const rawContent = readFileSync(filePath, 'utf-8').trim()

      if (!rawContent) {
        continue
      }

      pathsOnDisk.add(relPath)

      const contentHash = hashContent(rawContent)
      const { url, body } = parseFrontmatter(rawContent)
      const title = extractTitle(body, relPath)

      const existing = existingByPath.get(relPath)

      if (existing && existing.contentHash === contentHash) {
        result.unchanged++
        continue
      }

      // Upsert the doc (preserves embedding field — we clear it separately below)
      const doc = await repos.helpDocs.upsertByPath(relPath, {
        title,
        path: relPath,
        url,
        content: body,
        contentHash,
      })

      // Content changed — clear the old embedding so it gets re-generated
      if (existing) {
        await repos.helpDocs.clearAllEmbeddingsForDoc(doc.id)
        result.updated++
      } else {
        result.created++
      }

      result.changedIds.push(doc.id)
    } catch (error) {
      result.failed++
      logger.error('[HelpDocSync] Failed to sync file', {
        context: 'syncHelpDocs',
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Refuse the destructive prune when NOTHING on disk parsed to usable content
  // yet the table is populated. `pathsOnDisk` holds exactly the docs that
  // survived the `if (!rawContent) continue` guard above — i.e. every file with
  // usable (non-whitespace) content. The `files.length === 0` early return only
  // covers a literally empty directory; a directory whose only `.md` is
  // whitespace-only slips past it (`totalOnDisk 1`) but produces no usable
  // content, and the prune below would then delete every row (measured:
  // `deleted 3, rows left 0`). An all-empty help set on disk against a
  // populated table is suspicious — an interrupted checkout, a half-written
  // file — not an instruction to wipe the Guide. Skip the prune and leave the
  // rows in place; the next healthy sync reconciles them.
  if (pathsOnDisk.size === 0 && existingDocs.length > 0) {
    logger.warn(
      '[HelpDocSync] No help docs on disk have usable content but the table is populated — skipping the destructive prune',
      {
        context: 'syncHelpDocs',
        totalOnDisk: result.totalOnDisk,
        existingRows: existingDocs.length,
      },
    )
  } else {
    // Prune rows whose file is gone from disk. Only reached once we know the
    // help directory exists and produced at least one file with usable content,
    // so a missing/unreadable/blank help/ can never empty the table.
    for (const doc of existingDocs) {
      if (pathsOnDisk.has(doc.path)) {
        continue
      }

      try {
        await repos.helpDocs.delete(doc.id)
        await repos.embeddingStatus.deleteByEntity('HELP_DOC', doc.id)
        result.deleted++
      } catch (error) {
        result.failed++
        logger.error('[HelpDocSync] Failed to prune deleted help doc', {
          context: 'syncHelpDocs',
          docId: doc.id,
          path: doc.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  logger.info('[HelpDocSync] Sync completed', {
    context: 'syncHelpDocs',
    ...result,
    changedIds: result.changedIds.length,
  })

  return result
}

/**
 * Ensure help docs are synced (lazy initialization).
 *
 * Syncs when the help_docs collection is empty, and when the set of Markdown
 * files on disk no longer matches the set of rows — otherwise a doc added
 * after the first sync would never reach the database, since this is the only
 * sync trigger outside a full embedding reindex. Detecting divergence costs a
 * directory scan, not a read of every file; syncHelpDocs() itself skips
 * unchanged docs by content hash.
 *
 * Edits to an already-synced doc are still picked up only by the next
 * syncHelpDocs() call — a file's content is never read here. For a full
 * re-sync, call it directly.
 */
let syncPromise: Promise<HelpDocSyncResult> | null = null

export async function ensureHelpDocsSynced(): Promise<void> {
  const repos = getRepositories()
  const existing = await repos.helpDocs.findAll()

  if (existing.length > 0 && !helpDocsDivergeFromDisk(existing)) {
    return
  }

  // Prevent concurrent syncs
  if (!syncPromise) {
    syncPromise = syncHelpDocs().finally(() => {
      syncPromise = null
    })
  }

  await syncPromise
  await enqueueMissingHelpDocEmbeddings()
}

/**
 * Whether the help documents on disk and the rows in the database have parted
 * ways in either direction — a file with no row, or a row whose file is gone.
 *
 * Both directions come out of the same directory listing, and both need the
 * same fix: syncHelpDocs() creates the missing rows and prunes the stale ones.
 * Ignoring the deleted direction would leave the prune unreachable, since a
 * deletion alone would never trigger a sync.
 */
function helpDocsDivergeFromDisk(existing: { path: string }[]): boolean {
  const syncedPaths = new Set(existing.map(doc => doc.path))
  const pathsOnDisk = listHelpDocPathsOnDisk()
  const onDisk = new Set(pathsOnDisk)

  const unsynced = pathsOnDisk.filter(path => !syncedPaths.has(path))
  const deleted = [...syncedPaths].filter(path => !onDisk.has(path))

  if (unsynced.length > 0 || deleted.length > 0) {
    logger.info('[HelpDocSync] Help docs on disk diverge from the database', {
      context: 'ensureHelpDocsSynced',
      unsyncedCount: unsynced.length,
      unsynced,
      deletedCount: deleted.length,
      deleted,
    })
  }

  return unsynced.length > 0 || deleted.length > 0
}

/**
 * Enqueue embedding jobs for help docs that have no embedding — newly synced
 * docs, docs whose content changed (the sync clears their stale embedding),
 * and any left unembedded by an earlier failure. Without this a new doc lands
 * in the Guide but stays invisible to `help_search` until a full reindex.
 *
 * Per-entity dedup in enqueueEmbeddingGenerate keeps this from duplicating
 * jobs an EMBEDDING_REINDEX_ALL has already queued.
 */
async function enqueueMissingHelpDocEmbeddings(): Promise<void> {
  try {
    const repos = getRepositories()
    const needEmbedding = await repos.helpDocs.findAllNeedingEmbedding()

    if (needEmbedding.length === 0) {
      return
    }

    const profiles = await repos.embeddingProfiles.findAll()
    const defaultProfile = profiles.find(p => p.isDefault) || profiles[0]
    if (!defaultProfile) {
      logger.debug('[HelpDocSync] Help docs need embedding but no embedding profile is configured', {
        context: 'enqueueMissingHelpDocEmbeddings',
        needEmbedding: needEmbedding.length,
      })
      return
    }

    const users = await repos.users.findAll()
    const userId = users[0]?.id
    if (!userId) {
      return
    }

    const { enqueueEmbeddingGenerate } = await import('@/lib/background-jobs/queue-service')

    let enqueued = 0
    for (const doc of needEmbedding) {
      const { isNew } = await enqueueEmbeddingGenerate(userId, {
        entityType: 'HELP_DOC',
        entityId: doc.id,
        profileId: defaultProfile.id,
      })
      if (isNew) enqueued++
    }

    logger.info('[HelpDocSync] Enqueued help doc embeddings', {
      context: 'enqueueMissingHelpDocEmbeddings',
      enqueued,
      needEmbedding: needEmbedding.length,
    })
  } catch (error) {
    // Embedding top-up is best-effort: the docs are already in the database
    // and listable in the Guide, which is the caller's actual dependency.
    logger.error('[HelpDocSync] Failed to enqueue help doc embeddings', {
      context: 'enqueueMissingHelpDocEmbeddings',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
