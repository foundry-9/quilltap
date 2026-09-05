/**
 * Document Mount Text Search
 *
 * Keyword (substring) search across every enabled document store — file names,
 * relative paths, and extracted chunk text — for the global search bar's
 * **Documents** chip. The deliberate sibling of `document-search.ts`, which
 * does the same job semantically over embeddings; this one is the plain
 * `LIKE` scan the search bar's other branches all are.
 *
 * Scope notes:
 * - Character vaults are ordinary mount points and ARE searched — except the
 *   vaults of archived characters, which are tombstones (see
 *   `getArchivedCharacterVaultMountPointIds`).
 * - Documents flagged `character_read: false` ARE included. This is a human
 *   operator's surface, mirroring `includeBlocked: true` on the operator's
 *   semantic-search endpoint; that flag gates *characters*, not the user.
 * - Only file types Document Mode can open are searched (see
 *   `EDITABLE_TEXT_FILE_TYPES`), so every result is clickable.
 *
 * @module mount-index/document-text-search
 */

import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { buildDocStoreRefResolver } from '@/lib/doc-edit/uri-producers'
import { getArchivedCharacterVaultMountPointIds } from './character-vault'

const logger = createServiceLogger('DocumentTextSearch')

/** Documents returned by default; also the ceiling the route paginates over. */
const DEFAULT_LIMIT = 100

/**
 * Rows each SQL scan may match before it short-circuits. Generous enough that
 * ranking still has something to choose between, small enough that a large
 * instance never streams its whole corpus through JS.
 */
const SCAN_CAP = 200

/** Characters of chunk text shown around a content match. */
const SNIPPET_LENGTH = 200

/**
 * Where the query matched, and how strongly — mirrors the search route's
 * `getMatchPriority` ordering: 0 an exact file name, 1 a name/path substring,
 * 2 a hit inside the document's text.
 */
export type DocumentTextMatchField = 'fileName' | 'relativePath' | 'content'

export interface DocumentTextSearchResult {
  /** The `doc_mount_file_links` row id — document identity, one result per link. */
  linkId: string
  mountPointId: string
  mountPointName: string
  /** Addressable store reference: the name, or the UUID when it's ambiguous/reserved. */
  mountPointRef: string
  storeType: 'documents' | 'character'
  relativePath: string
  fileName: string
  matchedField: DocumentTextMatchField
  /** The matched text the caller renders; for a name-only hit, the path itself. */
  matchedValue: string
  snippet: string
  matchPriority: 0 | 1 | 2
  updatedAt: string
}

export interface DocumentTextSearchOptions {
  /** Maximum documents to return (default {@link DEFAULT_LIMIT}). */
  limit?: number
  /** Stores to leave out on top of the archived-vault exclusion. */
  excludeMountPointIds?: string[]
}

/**
 * Trim a chunk to a readable window centred on the match, prefixed with the
 * chunk's heading context when it has one. Same visual treatment as the search
 * route's message snippets.
 */
function buildContentSnippet(
  content: string,
  query: string,
  headingContext: string | null
): string {
  const matchIndex = content.toLowerCase().indexOf(query.toLowerCase())
  const lead = Math.max(0, Math.floor((SNIPPET_LENGTH - query.length) / 3))
  const start = matchIndex === -1 ? 0 : Math.max(0, matchIndex - lead)
  const end = Math.min(content.length, start + SNIPPET_LENGTH)

  let snippet = content.slice(start, end).trim()
  if (start > 0) snippet = `...${snippet}`
  if (end < content.length) snippet = `${snippet}...`
  return headingContext ? `${headingContext} — ${snippet}` : snippet
}

/**
 * Search every enabled document store for `query`.
 *
 * File-name / path hits shadow content hits for the same document — one result
 * per document, best match wins — and results are ranked by match priority then
 * recency. `totalCount` is the number of distinct documents matched (bounded by
 * the scan cap); `results` is that list sliced to `limit`.
 */
export async function searchDocumentText(
  query: string,
  opts: DocumentTextSearchOptions = {}
): Promise<{ results: DocumentTextSearchResult[]; totalCount: number }> {
  const startedAt = Date.now()
  const limit = opts.limit ?? DEFAULT_LIMIT
  const trimmed = query.trim()
  if (trimmed.length === 0) {
    return { results: [], totalCount: 0 }
  }

  const repos = getRepositories()
  const enabled = await repos.docMountPoints.findEnabled()

  const excluded = new Set(opts.excludeMountPointIds ?? [])
  let archivedVaultsExcluded = 0
  try {
    for (const id of await getArchivedCharacterVaultMountPointIds()) {
      excluded.add(id)
      archivedVaultsExcluded++
    }
  } catch (error) {
    // Fail CLOSED: if we can't tell which vaults belong to archived
    // characters, drop every character vault rather than risk surfacing a
    // tombstone's contents. Ordinary document stores still search.
    logger.error(
      'Could not resolve archived character vaults; excluding all character vaults from search',
      { error: error instanceof Error ? error.message : String(error) }
    )
    for (const mp of enabled) {
      if (mp.storeType === 'character') excluded.add(mp.id)
    }
  }

  const stores = enabled.filter((mp) => !excluded.has(mp.id))
  if (stores.length === 0) {
    logger.debug('Document text search found no stores in scope', {
      enabled: enabled.length,
      excluded: excluded.size,
    })
    return { results: [], totalCount: 0 }
  }

  const mountPointIds = stores.map((mp) => mp.id)
  const [nameHits, contentHits] = await Promise.all([
    repos.docMountFileLinks.searchByNameOrPath(trimmed, mountPointIds, SCAN_CAP),
    repos.docMountChunks.searchContent(trimmed, mountPointIds, SCAN_CAP),
  ])

  const refResolver = await buildDocStoreRefResolver()
  const storeById = new Map(stores.map((mp) => [mp.id, mp]))
  const lowerQuery = trimmed.toLowerCase()

  const byLinkId = new Map<string, DocumentTextSearchResult>()

  const describe = (
    mountPointId: string
  ): { name: string; ref: string; storeType: 'documents' | 'character' } | null => {
    const store = storeById.get(mountPointId)
    if (!store) return null
    return {
      name: store.name,
      ref: refResolver.refForMount(store.name, store.id),
      storeType: store.storeType ?? 'documents',
    }
  }

  // Name/path hits first — they outrank (and so shadow) a content hit on the
  // same document.
  for (const hit of nameHits) {
    const store = describe(hit.mountPointId)
    if (!store) continue
    const nameLower = hit.fileName.toLowerCase()
    const nameMatches = nameLower.includes(lowerQuery)
    byLinkId.set(hit.id, {
      linkId: hit.id,
      mountPointId: hit.mountPointId,
      mountPointName: store.name,
      mountPointRef: store.ref,
      storeType: store.storeType,
      relativePath: hit.relativePath,
      fileName: hit.fileName,
      matchedField: nameMatches ? 'fileName' : 'relativePath',
      matchedValue: nameMatches ? hit.fileName : hit.relativePath,
      snippet: hit.relativePath,
      matchPriority: nameLower === lowerQuery ? 0 : 1,
      updatedAt: hit.updatedAt,
    })
  }

  for (const hit of contentHits) {
    if (byLinkId.has(hit.linkId)) continue
    const store = describe(hit.mountPointId)
    if (!store) continue
    byLinkId.set(hit.linkId, {
      linkId: hit.linkId,
      mountPointId: hit.mountPointId,
      mountPointName: store.name,
      mountPointRef: store.ref,
      storeType: store.storeType,
      relativePath: hit.relativePath,
      fileName: hit.fileName,
      matchedField: 'content',
      matchedValue: hit.content.slice(0, 200),
      snippet: buildContentSnippet(hit.content, trimmed, hit.headingContext),
      matchPriority: 2,
      updatedAt: hit.updatedAt,
    })
  }

  const merged = Array.from(byLinkId.values()).sort((a, b) => {
    if (a.matchPriority !== b.matchPriority) return a.matchPriority - b.matchPriority
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  logger.debug('Document text search completed', {
    queryLength: trimmed.length,
    stores: stores.length,
    archivedVaultsExcluded,
    nameHits: nameHits.length,
    contentHits: contentHits.length,
    documents: merged.length,
    returned: Math.min(merged.length, limit),
    elapsedMs: Date.now() - startedAt,
  })

  return { results: merged.slice(0, limit), totalCount: merged.length }
}
