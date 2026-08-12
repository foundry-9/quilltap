/**
 * Conversation Summary Semantic Search
 *
 * Read-side companion to the conversation-summary vault bridge
 * ([[conversation-summary-vault-bridge]]). Semantically searches a character's
 * vault documents scoped to the `Conversation Summaries/` folder and returns the
 * matching past conversations — each carrying the `conversationId` from
 * frontmatter so the character can pull the full transcript via the
 * `read_conversation` tool.
 *
 * There is no general exported service that semantically searches vault
 * documents (memory search covers *memories*, not docs), so this is the single
 * reusable entry point. Shared by the memory recap's "relevant conversations"
 * list (Workstream B) and the fold-triggered relevance refresh (Workstream D).
 *
 * @module memory/conversation-summary-search
 */

import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge'
import { SUMMARIES_FOLDER } from '@/lib/file-storage/conversation-summary-vault-bridge'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchDocumentChunks } from '@/lib/mount-index/document-search'
import { readDatabaseDocument } from '@/lib/mount-index/database-store'
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser'
import { createServiceLogger } from '@/lib/logging/create-logger'

const logger = createServiceLogger('ConversationSummarySearch')

/** A past conversation surfaced by semantic search over its vault summary. */
export interface VaultConversationMatch {
  /** Conversation UUID from frontmatter — callable via `read_conversation`. */
  conversationId: string
  /** Conversation title from frontmatter (for display). */
  conversationTitle: string
  /** Vault-relative path of the summary file the match came from. */
  relativePath: string
  /** Best cosine score among this conversation's chunks. */
  score: number
  /** ISO timestamp of the conversation's first message (frontmatter), when recorded. */
  firstMessageAt: string | null
  /** ISO timestamp of the conversation's last message (frontmatter), when recorded. */
  lastMessageAt: string | null
}

export interface SearchVaultConversationSummariesOptions {
  /** Character whose vault is searched. */
  characterId: string
  /** Free-text query describing the current moment. */
  query: string
  /** User id, for embedding-profile resolution. */
  userId: string
  /** Embedding profile override (falls back to the user default). */
  embeddingProfileId?: string | null
  /** Max conversations to return. Default 10. */
  limit?: number
  /** Minimum cosine score (defaults to searchDocumentChunks' default). */
  minScore?: number
  /** Conversation id to exclude from results (usually the current chat). */
  excludeConversationId?: string
  /**
   * Event-time window (episodic recall): prefer conversations whose
   * [firstMessageAt, lastMessageAt] span overlaps the window. Two-stage with
   * the same fallback the memory path uses — filter first; when fewer than
   * `limit` overlap, fall back to the full pool with window hits boosted
   * (×1.3) instead. Never fewer results than an unwindowed search.
   */
  timeRange?: { from: string; to: string } | null
}

/**
 * Semantically search a character's vault conversation summaries. Returns at
 * most `limit` conversations, best-scoring first, one entry per conversation.
 * Degrades gracefully to `[]` on any failure (no vault, dead embedding
 * provider, unreadable files) — recall is best-effort and must never break a
 * turn or a fold.
 */
export async function searchVaultConversationSummaries(
  options: SearchVaultConversationSummariesOptions,
): Promise<VaultConversationMatch[]> {
  const { characterId, query, userId, embeddingProfileId, excludeConversationId } = options
  const limit = options.limit ?? 10
  if (limit <= 0) return []
  const trimmedQuery = query?.trim()
  if (!trimmedQuery) return []

  // Resolve the character's vault mount point (returns null on a broken vault).
  const vault = await getCharacterVaultStore(characterId)
  if (!vault) return []

  // Embed the query. A dead embedding provider simply yields no relevant list.
  let queryEmbedding
  try {
    const result = await generateEmbeddingForUser(
      trimmedQuery,
      userId,
      embeddingProfileId ?? undefined,
    )
    queryEmbedding = result.embedding
  } catch (error) {
    logger.warn('Failed to embed query for vault conversation search', {
      context: 'memory.conversation-summary-search',
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  let chunks
  try {
    chunks = await searchDocumentChunks(queryEmbedding, {
      mountPointIds: [vault.mountPointId],
      pathPrefix: `${SUMMARIES_FOLDER}/`,
      // Pull a larger chunk pool than `limit`: a single summary file may chunk
      // into several pieces, so collapsing to one entry per conversation needs
      // headroom to still fill the list.
      limit: Math.max(limit * 4, 20),
      minScore: options.minScore,
      query: trimmedQuery,
    })
  } catch (error) {
    logger.warn('Vault conversation chunk search failed', {
      context: 'memory.conversation-summary-search',
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  // Collapse to the best-scoring chunk per summary file (one file per
  // conversation).
  const bestByPath = new Map<string, number>()
  for (const chunk of chunks) {
    const existing = bestByPath.get(chunk.relativePath)
    if (existing === undefined || chunk.score > existing) {
      bestByPath.set(chunk.relativePath, chunk.score)
    }
  }
  const orderedFiles = [...bestByPath.entries()]
    .map(([relativePath, score]) => ({ relativePath, score }))
    .sort((a, b) => b.score - a.score)

  // Read frontmatter per surviving file to recover the conversationId (the
  // filename is derived from the title, not the id) and the message-span
  // timestamps. With a timeRange in play, read past `limit` so the window
  // staging below has a pool to choose from.
  const readCap = options.timeRange ? Math.max(limit * 3, 15) : limit
  const matches: VaultConversationMatch[] = []
  for (const file of orderedFiles) {
    if (matches.length >= readCap) break
    try {
      const { content } = await readDatabaseDocument(vault.mountPointId, file.relativePath)
      const { data } = parseFrontmatter(content)
      const conversationId =
        data && typeof data.conversationId === 'string' ? data.conversationId : null
      if (!conversationId) continue
      if (excludeConversationId && conversationId === excludeConversationId) continue
      const titleValue = data && typeof data.conversationTitle === 'string' ? data.conversationTitle.trim() : ''
      const tsField = (key: string): string | null => {
        const value = data ? (data as Record<string, unknown>)[key] : null
        return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
      }
      matches.push({
        conversationId,
        conversationTitle: titleValue.length > 0 ? titleValue : 'Untitled conversation',
        relativePath: file.relativePath,
        score: file.score,
        firstMessageAt: tsField('firstMessageAt'),
        lastMessageAt: tsField('lastMessageAt'),
      })
    } catch {
      // Unreadable / garbled summary file — skip it.
    }
  }

  // Window staging: filter-first with boost fallback (mirrors the memory
  // path's two-stage rule — never fewer results than an unwindowed search).
  const window = options.timeRange
  if (window) {
    const from = Date.parse(window.from)
    const to = Date.parse(window.to)
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
      const overlapsWindow = (m: VaultConversationMatch): boolean => {
        const start = m.firstMessageAt ? Date.parse(m.firstMessageAt) : NaN
        const end = m.lastMessageAt ? Date.parse(m.lastMessageAt) : start
        if (!Number.isFinite(start)) return false
        const spanEnd = Number.isFinite(end) ? end : start
        return start <= to && spanEnd >= from
      }
      const windowHits = matches.filter(overlapsWindow)
      if (windowHits.length >= limit) {
        return windowHits.slice(0, limit)
      }
      const CONVERSATION_WINDOW_BOOST = 1.3
      const boosted = matches
        .map(m => (overlapsWindow(m) ? { ...m, score: m.score * CONVERSATION_WINDOW_BOOST } : m))
        .sort((a, b) => b.score - a.score)
      return boosted.slice(0, limit)
    }
  }

  return matches.slice(0, limit)
}

/**
 * Closing note appended to a conversation list, telling the LLM the UUIDs in
 * backticks are callable. Shared by the recap's two-list block and the
 * fold-triggered relevant-conversations refresh so the instruction reads
 * identically everywhere.
 */
export const READ_CONVERSATION_CALL_NOTE =
  '_Pass any of the conversation IDs above (in backticks) to the `read_conversation` tool to revisit the full transcript._'

/**
 * Render the `### Relevant Past Conversations` markdown block (entries only, no
 * call note) from a list of matches. Returns `''` for an empty list. Shared by
 * the recap's relevant section and the fold-triggered refresh whisper so both
 * surface the conversation UUID identically.
 */
export function renderRelevantConversationsBlock(matches: VaultConversationMatch[]): string {
  if (matches.length === 0) return ''
  const entries = matches
    .map(m => {
      // Episodic recall: print the conversation's date so "last week"
      // becomes confirmable — the frontmatter finally gets read.
      const date = m.firstMessageAt ? ` (${m.firstMessageAt.slice(0, 10)})` : ''
      return `#### ${m.conversationTitle}${date} (\`${m.conversationId}\`)`
    })
    .join('\n')
  return `### Relevant Past Conversations\n\n${entries}`
}
