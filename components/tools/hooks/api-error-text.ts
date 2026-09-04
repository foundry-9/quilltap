/**
 * The error sentences the memory-tool cards show, derived from a thrown
 * `apiFetch` failure exactly as their hand-rolled `fetch` handlers used to
 * derive them — so moving the reads and writes onto TanStack Query changed
 * no user-visible text.
 *
 * @module components/tools/hooks/api-error-text
 */

import { ApiFetchError } from '@/lib/query/fetcher'
import { getErrorMessage } from '@/lib/error-utils'

/**
 * For a read: any HTTP failure reads as `fallback` (the body is not consulted);
 * a network or other error keeps its own message.
 */
export function readErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) return fallback
  return getErrorMessage(err, fallback)
}

/**
 * For a write: an HTTP failure shows the server's `{ error }` sentence when
 * the body carries one, otherwise `fallback`; a network or other error keeps
 * its own message.
 */
export function writeErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) {
    const info = err.info as { error?: unknown } | undefined
    return typeof info?.error === 'string' && info.error ? info.error : fallback
  }
  return getErrorMessage(err, fallback)
}
