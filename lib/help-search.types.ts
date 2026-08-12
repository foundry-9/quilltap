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
 * Search result returned by semantic search
 */
export interface HelpSearchResult {
  /** The matching document */
  document: HelpDocument
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number
}
