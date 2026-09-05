/**
 * Bind-variable budget for chunked SQLite `IN (...)` queries. The engine's
 * compile-time cap (SQLITE_MAX_VARIABLE_NUMBER) is 999 in older builds and
 * 32766 in current ones; 900 stays safely under both, so a chunked query
 * never throws "too many SQL variables" regardless of the linked binary.
 */
export const SQLITE_VARIABLE_CHUNK_SIZE = 900

/**
 * Split `items` into consecutive chunks of at most `size` elements,
 * preserving order. An empty input yields no chunks.
 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunkArray size must be a positive integer, got ${size}`)
  }
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
