/**
 * Shared fetcher for TanStack Query.
 *
 * Throws on non-2xx (carrying `status` + parsed `info`) so components can
 * branch on `error.status`. Use as
 * `queryFn: ({ signal }) => apiFetch<T>(url, { signal })` so
 * TanStack's cancellation `AbortSignal` is forwarded and in-flight reads abort
 * when a query is no longer observed.
 */

export class ApiFetchError extends Error {
  status: number
  info?: unknown

  constructor(message: string, status: number, info?: unknown) {
    super(message)
    this.name = 'ApiFetchError'
    this.status = status
    this.info = info
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let info: unknown = undefined
    try {
      info = await res.json()
    } catch {
      // response body wasn't JSON
    }
    throw new ApiFetchError(
      `Request to ${url} failed: ${res.status} ${res.statusText}`,
      res.status,
      info
    )
  }
  // 204 No Content (and other empty bodies) have nothing to parse.
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

/**
 * Pull a human-readable message out of a thrown value.
 *
 * The v1 API answers a failure with `{ error }` (see `@/lib/api/responses`), so
 * an `ApiFetchError`'s parsed `info` carries the sentence a person should read;
 * `message` is accepted as the older shape. Anything that is not an
 * `ApiFetchError` falls back to its own `Error.message`, and a non-Error to the
 * caller's `fallback` — which is where each surface says what it could not do.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) {
    const info = err.info
    if (info && typeof info === 'object') {
      const record = info as Record<string, unknown>
      if (typeof record.error === 'string') return record.error
      if (typeof record.message === 'string') return record.message
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return fallback
}
