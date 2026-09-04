'use client'

/**
 * Status of a fan-out of background jobs — a regenerate sweep, an embedding
 * backfill, a summary re-mirroring — read through TanStack Query.
 *
 * The live path is the `jobs` realtime topic: every enqueue, claim and
 * completion moves it, so the card re-reads the moment something changes.
 * The pre-realtime poll is kept as the offline fallback, gated by
 * {@link useRealtimeRefetchInterval} so it only ticks while the socket is
 * down. Both paths can be further gated on `inFlightOf`, so an idle card has
 * no reason to re-read on every unrelated job.
 *
 * @module components/tools/hooks/useJobFanOutStatus
 */

import { useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { useRealtimeRefetchInterval, useRealtimeTopic } from '@/hooks/useRealtime'

export interface JobFanOutStatusOptions<T> {
  /** A key from `lib/query/keys.ts` — never a raw string. */
  queryKey: QueryKey
  /** The GET endpoint that reports the status. */
  url: string
  /** The pre-realtime poll cadence, used only while the socket is down. */
  pollMs: number
  /**
   * Reads the in-flight count off a loaded status. When given, both the live
   * re-read and the fallback poll run only while it is greater than zero;
   * omit to re-read on every `jobs` event and poll whenever the socket is down.
   */
  inFlightOf?: (status: T) => number
}

/**
 * Read a fan-out's status, kept current by the `jobs` topic with the old poll
 * as the offline fallback. Returns the query result unchanged so callers can
 * read `data`, `isLoading`, `error` and `dataUpdatedAt` as they need.
 */
export function useJobFanOutStatus<T>({
  queryKey,
  url,
  pollMs,
  inFlightOf,
}: JobFanOutStatusOptions<T>): UseQueryResult<T> {
  const fallbackMs = useRealtimeRefetchInterval(pollMs)

  // The key is the caller's canonical one from lib/query/keys.ts and names
  // exactly this endpoint; folding the url in would fork that single source.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- queryKey is the caller's canonical `queryKeys.*` entry, which names this url 1:1
  const query = useQuery<T>({
    queryKey,
    queryFn: ({ signal }) => apiFetch<T>(url, { signal }),
    // TanStack re-evaluates this on every render and every fetch, so the poll
    // engages the moment the socket drops and stops the moment work drains.
    refetchInterval: current => {
      if (fallbackMs === false) return false
      if (!inFlightOf) return fallbackMs
      const status = current.state.data
      return status !== undefined && inFlightOf(status) > 0 ? fallbackMs : false
    },
  })

  const { data, refetch } = query
  useRealtimeTopic('jobs', () => {
    if (!inFlightOf || (data !== undefined && inFlightOf(data) > 0)) void refetch()
  })

  return query
}
