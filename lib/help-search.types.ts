/**
 * Help Search Types
 *
 * TypeScript interfaces for the help documentation search system.
 * Help docs are stored in the database and embedded at runtime
 * using the user's chosen embedding profile.
 */

/**
 * A single help document (without embedding — embedding is managed separately)
 */
export interface HelpDocument {
  /** Unique document ID (database primary key) */
  id: string
  /** Stable slug derived from the filename — the identifier used outside the database */
  slug: string
  /** Document title (from first H1 or filename) */
  title: string
  /** Relative path to the Markdown file */
  path: string
  /** URL route this help document is associated with */
  url: string
  /** Full document content (frontmatter stripped) */
  content: string
}

/**
 * A help document with its embedding vector (for search operations)
 */
export interface HelpDocumentWithEmbedding extends HelpDocument {
  /** Unit-length embedding vector (Float32Array hydrated from BLOB) */
  embedding: Float32Array
}

/**
 * The section of a document that matched, when the match came from a chunk
 * rather than from the whole-document vector.
 */
export interface HelpMatchedSection {
  /** Nearest Markdown heading above the matching text, if any */
  heading: string | null
  /** The matching excerpt itself */
  content: string
  /** 0-based position of this chunk within the document */
  chunkIndex: number
}

/**
 * Search result returned by semantic search
 */
export interface HelpSearchResult {
  /** The matching document */
  document: HelpDocument
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number
  /**
   * The best-matching section, when the score came from a section vector.
   * Absent when the document matched only on its whole-document embedding —
   * i.e. it has no chunk rows embedded yet.
   */
  matchedSection?: HelpMatchedSection
}
